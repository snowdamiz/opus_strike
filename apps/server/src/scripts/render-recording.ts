import crypto from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  RecordingHudMode,
  RecordingManifest,
  RecordingRenderArtifact,
  RecordingRenderStage,
  RecordingSummary,
  RecordingViewport,
} from '@voxel-strike/shared';
import {
  getRecordingArtifactDir,
} from '../recordings/artifacts';
import type { RecordingRenderQueueItem } from '../recordings/service';

export interface RenderRecordingOptions {
  recording: string | null;
  jobPath: string | null;
  clientUrl: string | null;
  clientDist: string | null;
  outputPath: string | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hudMode: RecordingHudMode | null;
  hudSubjectPlayerId: string | null;
  keepBrowserOpen: boolean;
  onProgress: RenderProgressReporter | null;
}

interface LocalPlaybackServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface RenderPage {
  evaluate<T = unknown>(pageFunction: (...args: any[]) => T | Promise<T>, arg?: unknown): Promise<T>;
  exposeBinding(
    name: string,
    callback: (source: unknown, ...args: any[]) => unknown | Promise<unknown>
  ): Promise<void>;
  goto(url: string, options?: { waitUntil?: 'networkidle' | 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  on?(event: 'console', handler: (message: RenderConsoleMessage) => void): void;
  on?(event: 'pageerror', handler: (error: Error) => void): void;
  route(url: string, handler: (route: RenderRoute) => Promise<void> | void): Promise<void>;
  waitForFunction(pageFunction: (...args: any[]) => unknown, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
}

interface RenderConsoleMessage {
  type(): string;
  text(): string;
}

interface RenderRoute {
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
  request(): {
    resourceType(): string;
    url(): string;
  };
}

interface RenderBrowser {
  newContext(options: {
    viewport: RecordingViewport;
    deviceScaleFactor: number;
  }): Promise<RenderBrowserContext>;
  close(): Promise<void>;
}

interface RenderBrowserContext {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}

interface PlaywrightRuntime {
  chromium?: {
    launch(options: { headless: boolean }): Promise<RenderBrowser>;
  };
}

type RecordingBrowserWindow = Window & {
  __voxelRecording?: {
    isReady: boolean;
    durationMs: number;
    currentTimeMs: number;
    progress: number;
    playbackError: string | null;
    playbackWarningCount: number;
    play: () => void;
    pause: () => void;
    waitUntilFinished: () => Promise<void>;
  };
  __voxelRecordingCanvasCapture?: {
    stop: () => Promise<RecordingCanvasCaptureResult>;
  };
  __voxelRecordingWriteVideoChunk?: (base64Chunk: string) => Promise<void>;
};

interface RecordingCanvasCaptureResult {
  byteCount: number;
  chunkCount: number;
  mimeType: string;
}

interface CanvasVideoCapture {
  webmPath: string;
  stop: () => Promise<RecordingCanvasCaptureResult>;
}

export interface RecordingRenderProgressUpdate {
  stage: RecordingRenderStage;
  progress: number;
  heartbeatAt: string;
  startedAt?: string | null;
  message?: string | null;
  error?: string | null;
}

type RenderProgressReporter = (progress: RecordingRenderProgressUpdate) => Promise<void> | void;

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const REMOTE_FONT_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);
const FONT_FILE_EXTENSION_PATTERN = /\.(?:eot|otf|ttf|woff|woff2)$/i;
const RECORDING_PLAYBACK_BOOT_TIMEOUT_MS = 30_000;
const RECORDING_PLAYBACK_READY_TIMEOUT_MS = 120_000;
const RECORDING_RENDER_HEARTBEAT_MS = 5_000;
const RECORDING_CAPTURE_TIMEOUT_BUFFER_MS = 90_000;
const RECORDING_CAPTURE_POLL_MS = 1_000;
const RECORDING_CAPTURE_PROGRESS_READ_TIMEOUT_MS = 3_000;
const RECORDING_CAPTURE_PROGRESS_STALE_MS = 60_000;
const RECORDING_TRANSCODE_MIN_TIMEOUT_MS = 120_000;
const RECORDING_TRANSCODE_TIMEOUT_MULTIPLIER = 2.5;
const RECORDING_BROWSER_CLOSE_TIMEOUT_MS = 15_000;
const RECORDING_CANVAS_CAPTURE_TIMESLICE_MS = 1_000;
const RECORDING_CANVAS_CAPTURE_STOP_TIMEOUT_MS = 30_000;
const RECORDING_CANVAS_VIDEO_BITS_PER_SECOND = 7_000_000;
const RECORDING_MIN_EFFECTIVE_FPS_RATIO = 0.4;
const RECORDING_MIN_EFFECTIVE_FPS = 10;
const RECORDING_VALIDATE_MIN_TIMEOUT_MS = 60_000;
const RECORDING_VALIDATE_TIMEOUT_MULTIPLIER = 0.4;

// Stalled web fonts can keep the replay page from ever reaching a stable ready state.
export function shouldAbortRecordingRenderRequest(input: {
  resourceType?: string | null;
  url: string;
}): boolean {
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.url);
  } catch {
    return false;
  }

  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return false;
  }

  if (REMOTE_FONT_HOSTS.has(requestUrl.hostname.toLowerCase())) {
    return true;
  }

  return input.resourceType === 'font' || FONT_FILE_EXTENSION_PATTERN.test(requestUrl.pathname);
}

function usage(): never {
  throw new Error([
    'Usage:',
    '  pnpm render:recording -- --recording <id-or-artifact-dir> [--client-url http://localhost:5173] [--output out.mp4]',
    '  pnpm render:recording -- --job recordings/render-queue/render_id.json [--client-dist ../client/dist]',
  ].join('\n'));
}

function readArgValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.trunc(parsed);
}

function readHudMode(value: string): RecordingHudMode {
  if (value === 'hidden' || value === 'selected_player' || value === 'cinematic_observer') return value;
  throw new Error(`Unknown HUD mode: ${value}`);
}

function parseArgs(args = process.argv.slice(2)): RenderRecordingOptions {
  const options: RenderRecordingOptions = {
    recording: null,
    jobPath: null,
    clientUrl: null,
    clientDist: null,
    outputPath: null,
    fps: null,
    width: null,
    height: null,
    durationMs: null,
    hudMode: null,
    hudSubjectPlayerId: null,
    keepBrowserOpen: false,
    onProgress: null,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--recording') options.recording = readArgValue(args, index++, arg);
    else if (arg === '--job') options.jobPath = readArgValue(args, index++, arg);
    else if (arg === '--client-url') options.clientUrl = readArgValue(args, index++, arg);
    else if (arg === '--client-dist') options.clientDist = readArgValue(args, index++, arg);
    else if (arg === '--output') options.outputPath = readArgValue(args, index++, arg);
    else if (arg === '--fps') options.fps = readPositiveInteger(readArgValue(args, index++, arg), arg);
    else if (arg === '--width') options.width = readPositiveInteger(readArgValue(args, index++, arg), arg);
    else if (arg === '--height') options.height = readPositiveInteger(readArgValue(args, index++, arg), arg);
    else if (arg === '--duration-ms') options.durationMs = readPositiveInteger(readArgValue(args, index++, arg), arg);
    else if (arg === '--hud-mode') options.hudMode = readHudMode(readArgValue(args, index++, arg));
    else if (arg === '--hud-subject') options.hudSubjectPlayerId = readArgValue(args, index++, arg);
    else if (arg === '--keep-browser-open') options.keepBrowserOpen = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.recording && !options.jobPath) usage();
  return options;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveArtifactDir(recording: string): Promise<string> {
  const absolute = path.resolve(recording);
  if (await pathExists(path.join(absolute, 'manifest.json'))) {
    return absolute;
  }
  return getRecordingArtifactDir(recording);
}

async function resolveClientDist(explicit: string | null): Promise<string | null> {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
      path.resolve(process.cwd(), '../client/dist'),
      path.resolve(process.cwd(), 'apps/client/dist'),
      path.resolve(process.cwd(), '../../apps/client/dist'),
    ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

function sendFile(res: ServerResponse, filePath: string, contentType?: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType ?? MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

function sendNotFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.end('Not found');
}

async function startLocalPlaybackServer(input: {
  artifactDir: string;
  clientDist: string | null;
}): Promise<LocalPlaybackServer> {
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (requestUrl.pathname === '/__recording/manifest.json') {
        sendFile(res, path.join(input.artifactDir, 'manifest.json'), MIME_TYPES['.json']);
        return;
      }
      if (requestUrl.pathname === '/__recording/events.ndjson') {
        sendFile(res, path.join(input.artifactDir, 'events.ndjson'), MIME_TYPES['.ndjson']);
        return;
      }

      if (!input.clientDist) {
        sendNotFound(res);
        return;
      }

      const normalizedPath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, '');
      const relativePath = normalizedPath === '/' || normalizedPath === '.'
        ? 'index.html'
        : normalizedPath.replace(/^[/\\]/, '');
      const candidate = path.resolve(input.clientDist, relativePath);
      if (!candidate.startsWith(input.clientDist)) {
        sendNotFound(res);
        return;
      }
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat?.isFile()) {
        sendFile(res, candidate);
        return;
      }
      sendFile(res, path.join(input.clientDist, 'index.html'), MIME_TYPES['.html']);
    } catch {
      sendNotFound(res);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate local playback server port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function buildPlaybackUrl(input: {
  baseUrl: string;
  manifestUrl: string;
  eventsUrl: string;
  hudMode: RecordingHudMode;
  hudSubjectPlayerId: string | null;
  renderMode: boolean;
}): string {
  const url = new URL(input.baseUrl);
  url.searchParams.set('recordingPlayback', '1');
  url.searchParams.set('recordingAutoplay', '0');
  url.searchParams.set('recordingManifestUrl', input.manifestUrl);
  url.searchParams.set('recordingEventsUrl', input.eventsUrl);
  url.searchParams.set('recordingHudMode', input.hudMode);
  if (input.renderMode) {
    url.searchParams.set('recordingRender', '1');
  }
  if (input.hudSubjectPlayerId) {
    url.searchParams.set('recordingHudSubjectPlayerId', input.hudSubjectPlayerId);
  }
  return url.toString();
}

async function installRenderRequestGuards(page: RenderPage): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (shouldAbortRecordingRenderRequest({
      resourceType: request.resourceType(),
      url: request.url(),
    })) {
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
}

function installRenderPageDiagnostics(page: RenderPage): void {
  page.on?.('console', (message) => {
    const type = message.type();
    if (type !== 'warning' && type !== 'error') return;
    console.warn(`[recording-render:${type}] ${message.text()}`);
  });
  page.on?.('pageerror', (error) => {
    console.warn(`[recording-render:pageerror] ${error.stack ?? error.message}`);
  });
}

function updateRender(summary: RecordingSummary, renderId: string | null, patch: Partial<RecordingRenderArtifact>): RecordingSummary {
  if (!renderId) return summary;
  return {
    ...summary,
    renders: summary.renders.map((render) => (
      render.id === renderId ? { ...render, ...patch } : render
    )),
  };
}

async function updateSummaryRender(input: {
  artifactDir: string;
  renderId: string | null;
  patch: Partial<RecordingRenderArtifact>;
}): Promise<void> {
  if (!input.renderId) return;
  const summaryPath = path.join(input.artifactDir, 'summary.json');
  const summary = await readJson<RecordingSummary>(summaryPath);
  await writeJson(summaryPath, updateRender(summary, input.renderId, input.patch));
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

function captureTimeoutMs(durationMs: number): number {
  return Math.max(RECORDING_PLAYBACK_READY_TIMEOUT_MS, durationMs + RECORDING_CAPTURE_TIMEOUT_BUFFER_MS);
}

function transcodeTimeoutMs(durationMs: number): number {
  return Math.max(
    RECORDING_TRANSCODE_MIN_TIMEOUT_MS,
    Math.ceil(durationMs * RECORDING_TRANSCODE_TIMEOUT_MULTIPLIER)
  );
}

function validateTimeoutMs(durationMs: number): number {
  return Math.max(
    RECORDING_VALIDATE_MIN_TIMEOUT_MS,
    Math.ceil(durationMs * RECORDING_VALIDATE_TIMEOUT_MULTIPLIER)
  );
}

function formatFfmpegSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

function waitForProcessClose(process: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    process.once('error', reject);
    process.once('close', resolve);
  });
}

async function stopProcess(process: ReturnType<typeof spawn>, closePromise: Promise<number | null>): Promise<void> {
  process.stdin?.destroy();
  if (!process.killed) process.kill('SIGTERM');

  const closed = await Promise.race([
    closePromise.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (closed) return;

  process.kill('SIGKILL');
  await Promise.race([
    closePromise.catch(() => null),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function waitForProcessCloseOrTimeout(input: {
  process: ReturnType<typeof spawn>;
  closePromise: Promise<number | null>;
  timeoutMs: number;
  label: string;
}): Promise<number | null> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${input.label} timed out after ${input.timeoutMs}ms`)), input.timeoutMs);
  });

  try {
    return await Promise.race([input.closePromise, timeoutPromise]);
  } catch (error) {
    await stopProcess(input.process, input.closePromise);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function closeWithTimeout(label: string, close: () => Promise<void>): Promise<void> {
  try {
    await withTimeout(close(), RECORDING_BROWSER_CLOSE_TIMEOUT_MS, label);
  } catch (error) {
    console.warn(`${label} failed or timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeToStream(stream: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    stream.once('error', onError);
    if (stream.write(chunk)) {
      cleanup();
      resolve();
      return;
    }
    stream.once('drain', onDrain);
  });
}

function finishWriteStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off('error', onError);
    };

    stream.once('error', onError);
    stream.end(() => {
      cleanup();
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCanvasVideoCapture(input: {
  page: RenderPage;
  webmPath: string;
  fps: number;
}): Promise<CanvasVideoCapture> {
  await fs.mkdir(path.dirname(input.webmPath), { recursive: true });
  const output = createWriteStream(input.webmPath);
  let byteCount = 0;
  let chunkCount = 0;
  let writeError: Error | null = null;
  output.once('error', (error) => {
    writeError = error instanceof Error ? error : new Error(String(error));
  });

  await input.page.exposeBinding('__voxelRecordingWriteVideoChunk', async (_source, base64Chunk: string) => {
    if (writeError) throw writeError;
    const chunk = Buffer.from(base64Chunk, 'base64');
    if (chunk.byteLength === 0) return;
    await writeToStream(output, chunk);
    byteCount += chunk.byteLength;
    chunkCount += 1;
  });

  await input.page.waitForFunction(
    () => Array.from(document.querySelectorAll('canvas')).some((candidate) => (
      candidate instanceof HTMLCanvasElement &&
      candidate.width > 0 &&
      candidate.height > 0 &&
      typeof candidate.captureStream === 'function'
    )),
    null,
    { timeout: RECORDING_PLAYBACK_BOOT_TIMEOUT_MS }
  );

  await input.page.evaluate((settings) => {
    const win = window as RecordingBrowserWindow;
    const writeVideoChunk = win.__voxelRecordingWriteVideoChunk;
    if (!writeVideoChunk) throw new Error('Recording video chunk writer was not installed');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not available in this browser');

    const canvas = Array.from(document.querySelectorAll('canvas'))
      .filter((candidate): candidate is HTMLCanvasElement => (
        candidate instanceof HTMLCanvasElement &&
        candidate.width > 0 &&
        candidate.height > 0 &&
        typeof candidate.captureStream === 'function'
      ))
      .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0];
    if (!canvas) throw new Error('Recording gameplay canvas was not found');

    const mimeType = [
      'video/webm;codecs=vp8',
      'video/webm;codecs=vp9',
      'video/webm',
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
    const stream = canvas.captureStream(settings.fps);
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: settings.videoBitsPerSecond,
    });
    const pendingWrites: Promise<void>[] = [];
    let captureByteCount = 0;
    let captureChunkCount = 0;
    let captureError: string | null = null;

    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      const sliceSize = 0x8000;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += sliceSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + sliceSize));
      }
      return btoa(binary);
    };

    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return;
      captureByteCount += event.data.size;
      captureChunkCount += 1;
      pendingWrites.push(event.data.arrayBuffer().then((buffer) => (
        writeVideoChunk(arrayBufferToBase64(buffer))
      )));
    });
    recorder.addEventListener('error', (event) => {
      captureError = (event as ErrorEvent).message || 'Canvas recorder failed';
    });

    win.__voxelRecordingCanvasCapture = {
      stop: () => new Promise<RecordingCanvasCaptureResult>((resolve, reject) => {
        const finalize = () => {
          void Promise.all(pendingWrites)
            .then(() => {
              stream.getTracks().forEach((track) => track.stop());
              if (captureError) {
                reject(new Error(captureError));
                return;
              }
              resolve({
                byteCount: captureByteCount,
                chunkCount: captureChunkCount,
                mimeType: recorder.mimeType || mimeType || 'video/webm',
              });
            })
            .catch(reject);
        };

        if (recorder.state === 'inactive') {
          finalize();
          return;
        }
        recorder.addEventListener('stop', finalize, { once: true });
        recorder.stop();
      }),
    };

    recorder.start(settings.timesliceMs);
  }, {
    fps: input.fps,
    timesliceMs: RECORDING_CANVAS_CAPTURE_TIMESLICE_MS,
    videoBitsPerSecond: RECORDING_CANVAS_VIDEO_BITS_PER_SECOND,
  });

  return {
    webmPath: input.webmPath,
    stop: async () => {
      const captureResult = await withTimeout(
        input.page.evaluate(() => {
          const capture = (window as RecordingBrowserWindow).__voxelRecordingCanvasCapture;
          if (!capture) throw new Error('Recording canvas capture was not initialized');
          return capture.stop();
        }),
        RECORDING_CANVAS_CAPTURE_STOP_TIMEOUT_MS,
        'Recording canvas capture stop'
      );
      await finishWriteStream(output);
      if (writeError) throw writeError;
      if (byteCount <= 0 || chunkCount <= 0 || captureResult.byteCount <= 0 || captureResult.chunkCount <= 0) {
        throw new Error('Recording canvas capture produced no video data');
      }
      return {
        byteCount,
        chunkCount,
        mimeType: captureResult.mimeType,
      };
    },
  };
}

export async function readRecordingPlaybackProgress(page: Pick<RenderPage, 'evaluate'>): Promise<{
  currentTimeMs: number;
  durationMs: number;
  progress: number;
  playbackError: string | null;
  playbackWarningCount: number;
}> {
  return page.evaluate(() => {
    const recording = (window as RecordingBrowserWindow).__voxelRecording;
    return {
      currentTimeMs: recording?.currentTimeMs ?? 0,
      durationMs: recording?.durationMs ?? 0,
      progress: recording?.progress ?? 0,
      playbackError: recording?.playbackError ?? null,
      playbackWarningCount: recording?.playbackWarningCount ?? 0,
    };
  });
}

async function waitForRecordingPlayback(input: {
  page: RenderPage;
  durationMs: number;
  onProgress: (progress: number, message: string) => Promise<void>;
}): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + captureTimeoutMs(input.durationMs);
  let lastProgressMs = 0;
  let lastProgressWallTime = startedAt;
  let lastHeartbeatTime = 0;
  try {
    await input.page.evaluate(() => {
      const recording = (window as RecordingBrowserWindow).__voxelRecording;
      if (!recording) throw new Error('Recording playback controls were not initialized');
      recording.play();
    });

    while (Date.now() <= deadline) {
      await sleep(RECORDING_CAPTURE_POLL_MS);
      const now = Date.now();
      let progress: Awaited<ReturnType<typeof readRecordingPlaybackProgress>>;
      try {
        progress = await withTimeout(
          readRecordingPlaybackProgress(input.page),
          RECORDING_CAPTURE_PROGRESS_READ_TIMEOUT_MS,
          'Recording playback progress read'
        );
      } catch (error) {
        if (now - lastProgressWallTime > RECORDING_CAPTURE_PROGRESS_STALE_MS) {
          throw new Error(
            `Recording playback stopped responding near ${Math.round(lastProgressMs / 1000)}s: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        continue;
      }

      if (progress.playbackError) {
        throw new Error(`Recording playback failed: ${progress.playbackError}`);
      }

      const progressDurationMs = progress.durationMs || input.durationMs;
      const currentTimeMs = Math.max(0, Math.min(progressDurationMs, progress.currentTimeMs));
      const ratio = clampProgress(progress.progress || (progressDurationMs > 0 ? currentTimeMs / progressDurationMs : 0));
      if (currentTimeMs > lastProgressMs + 50 || ratio >= 1) {
        lastProgressMs = currentTimeMs;
        lastProgressWallTime = now;
      }

      if (now - lastHeartbeatTime >= RECORDING_RENDER_HEARTBEAT_MS || ratio >= 1) {
        lastHeartbeatTime = now;
        const warningSuffix = progress.playbackWarningCount > 0
          ? ` (${progress.playbackWarningCount} replay warnings)`
          : '';
        await input.onProgress(
          ratio,
          `Captured ${Math.round(currentTimeMs / 1000)}s of ${Math.round(progressDurationMs / 1000)}s${warningSuffix}`
        );
      }

      if (ratio >= 1 || currentTimeMs >= progressDurationMs) {
        await input.onProgress(1, 'Capture complete');
        return;
      }

      if (now - lastProgressWallTime > RECORDING_CAPTURE_PROGRESS_STALE_MS) {
        throw new Error(
          `Recording playback stalled at ${Math.round(currentTimeMs / 1000)}s of ${Math.round(progressDurationMs / 1000)}s`
        );
      }
    }

    throw new Error(`Recording playback capture timed out after ${captureTimeoutMs(input.durationMs)}ms`);
  } finally {
    void input.page.evaluate(() => {
      (window as RecordingBrowserWindow).__voxelRecording?.pause();
    }).catch(() => {});
  }
}

async function transcodeVideoToMp4(input: {
  webmPath: string;
  outputPath: string;
  fps: number;
  durationMs: number;
  startOffsetMs: number;
  onProgress: (progress: number, message: string) => Promise<void>;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-i', input.webmPath,
    '-ss', formatFfmpegSeconds(input.startOffsetMs),
    '-t', formatFfmpegSeconds(input.durationMs),
    '-r', String(input.fps),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    input.outputPath,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  const ffmpegClose = waitForProcessClose(ffmpeg);
  const startedAt = Date.now();
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    const elapsedMs = Date.now() - startedAt;
    const progress = clampProgress(0.9 + Math.min(0.08, (elapsedMs / transcodeTimeoutMs(input.durationMs)) * 0.08));
    void input.onProgress(progress, 'Encoding MP4')
      .catch(() => {})
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, RECORDING_RENDER_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const exitCode = await waitForProcessCloseOrTimeout({
      process: ffmpeg,
      closePromise: ffmpegClose,
      timeoutMs: transcodeTimeoutMs(input.durationMs),
      label: 'Recording MP4 transcode',
    });
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode ?? 'unknown'}`);
    }
    await input.onProgress(0.98, 'MP4 encoded');
  } catch (error) {
    await fs.rm(input.outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function estimateDistinctFrameCount(input: {
  videoPath: string;
  durationMs: number;
}): Promise<number> {
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-i', input.videoPath,
    '-vf', 'mpdecimate=max=64:hi=768:lo=320:frac=0.33',
    '-an',
    '-f', 'null',
    '-',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ffmpegClose = waitForProcessClose(ffmpeg);
  let distinctFrameCount = 0;
  ffmpeg.stderr?.setEncoding('utf8');
  ffmpeg.stderr?.on('data', (chunk: string) => {
    for (const match of chunk.matchAll(/frame=\s*(\d+)/g)) {
      distinctFrameCount = Math.max(distinctFrameCount, Number(match[1]));
    }
  });

  const exitCode = await waitForProcessCloseOrTimeout({
    process: ffmpeg,
    closePromise: ffmpegClose,
    timeoutMs: validateTimeoutMs(input.durationMs),
    label: 'Recording MP4 motion validation',
  });
  if (exitCode !== 0) {
    throw new Error(`ffmpeg motion validation exited with code ${exitCode ?? 'unknown'}`);
  }
  return distinctFrameCount;
}

async function validateMp4EffectiveFrameRate(input: {
  outputPath: string;
  fps: number;
  durationMs: number;
}): Promise<void> {
  const distinctFrameCount = await estimateDistinctFrameCount({
    videoPath: input.outputPath,
    durationMs: input.durationMs,
  });
  const effectiveFps = distinctFrameCount / Math.max(1, input.durationMs / 1000);
  const minimumEffectiveFps = Math.min(
    input.fps * RECORDING_MIN_EFFECTIVE_FPS_RATIO,
    RECORDING_MIN_EFFECTIVE_FPS
  );
  if (effectiveFps < minimumEffectiveFps) {
    throw new Error(
      `Recording video effective frame rate ${effectiveFps.toFixed(1)}fps is below ${minimumEffectiveFps.toFixed(1)}fps`
    );
  }
}

async function loadChromium(): Promise<{
  launch(options: { headless: boolean }): Promise<RenderBrowser>;
}> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  let playwright: PlaywrightRuntime;
  try {
    playwright = await dynamicImport('playwright') as PlaywrightRuntime;
  } catch (error) {
    throw new Error(
      `Playwright is required to render recordings. Install it in @voxel-strike/server before running render:recording. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!playwright.chromium) {
    throw new Error('Playwright chromium launcher was not found');
  }
  return playwright.chromium;
}

export async function renderRecordingToMp4(options: Partial<RenderRecordingOptions>): Promise<{
  recordingId: string;
  outputPath: string;
}> {
  const normalizedOptions: RenderRecordingOptions = {
    recording: options.recording ?? null,
    jobPath: options.jobPath ?? null,
    clientUrl: options.clientUrl ?? null,
    clientDist: options.clientDist ?? null,
    outputPath: options.outputPath ?? null,
    fps: options.fps ?? null,
    width: options.width ?? null,
    height: options.height ?? null,
    durationMs: options.durationMs ?? null,
    hudMode: options.hudMode ?? null,
    hudSubjectPlayerId: options.hudSubjectPlayerId ?? null,
    keepBrowserOpen: options.keepBrowserOpen ?? false,
    onProgress: options.onProgress ?? null,
  };
  const job = normalizedOptions.jobPath
    ? await readJson<RecordingRenderQueueItem>(path.resolve(normalizedOptions.jobPath))
    : null;
  const recordingRef = normalizedOptions.recording ?? job?.recordingId;
  if (!recordingRef) usage();

  const artifactDir = await resolveArtifactDir(recordingRef);
  const manifest = await readJson<RecordingManifest>(path.join(artifactDir, 'manifest.json'));
  const viewport: RecordingViewport = {
    width: normalizedOptions.width ?? job?.viewport.width ?? manifest.viewport.width,
    height: normalizedOptions.height ?? job?.viewport.height ?? manifest.viewport.height,
  };
  const fps = normalizedOptions.fps ?? job?.fps ?? manifest.fps;
  const hudMode = normalizedOptions.hudMode ?? job?.hudMode ?? manifest.hudMode;
  const outputPath = path.resolve(
    normalizedOptions.outputPath
    ?? job?.outputPath
    ?? path.join(artifactDir, `${job?.renderId ?? `render_${Date.now().toString(36)}`}.mp4`)
  );
  const clientDist = normalizedOptions.clientUrl ? null : await resolveClientDist(normalizedOptions.clientDist);
  if (!normalizedOptions.clientUrl && !clientDist) {
    throw new Error('No client URL was provided and apps/client/dist was not found. Build the client or pass --client-url.');
  }

  const renderStartedAt = new Date().toISOString();
  let lastProgressUpdate: RecordingRenderProgressUpdate = {
    stage: 'preparing',
    progress: 0,
    heartbeatAt: renderStartedAt,
    startedAt: renderStartedAt,
    message: 'Preparing playback',
  };
  const reportProgress = async (
    stage: RecordingRenderStage,
    progress: number,
    message: string | null = null
  ): Promise<void> => {
    const update: RecordingRenderProgressUpdate = {
      stage,
      progress: clampProgress(progress),
      heartbeatAt: new Date().toISOString(),
      startedAt: renderStartedAt,
      message,
    };
    lastProgressUpdate = update;
    await updateSummaryRender({
      artifactDir,
      renderId: job?.renderId ?? null,
      patch: {
        stage: update.stage,
        progress: update.progress,
        progressMessage: update.message ?? null,
        heartbeatAt: update.heartbeatAt,
        startedAt: update.startedAt ?? null,
      },
    });
    await normalizedOptions.onProgress?.(update);
  };

  await updateSummaryRender({
    artifactDir,
    renderId: job?.renderId ?? null,
    patch: {
      status: 'rendering',
      startedAt: renderStartedAt,
      outputPath,
      fps,
      viewport,
      hudMode,
      stage: 'preparing',
      progress: 0,
      progressMessage: 'Preparing playback',
      heartbeatAt: renderStartedAt,
      error: null,
    },
  });
  await normalizedOptions.onProgress?.({
    stage: 'preparing',
    progress: 0,
    heartbeatAt: renderStartedAt,
    startedAt: renderStartedAt,
    message: 'Preparing playback',
  });

  let playbackServer: LocalPlaybackServer | null = null;
  let browser: RenderBrowser | null = null;
  let context: RenderBrowserContext | null = null;
  let tempVideoDir: string | null = null;
  let canvasCapture: CanvasVideoCapture | null = null;
  try {
    await reportProgress('preparing', 0.01, 'Starting playback server');
    playbackServer = await startLocalPlaybackServer({ artifactDir, clientDist });
    const baseUrl = normalizedOptions.clientUrl ?? playbackServer?.baseUrl;
    if (!baseUrl) throw new Error('Playback URL was not resolved');
    const manifestUrl = `${playbackServer.baseUrl}/__recording/manifest.json`;
    const eventsUrl = `${playbackServer.baseUrl}/__recording/events.ndjson`;
    const playbackUrl = buildPlaybackUrl({
      baseUrl,
      manifestUrl,
      eventsUrl,
      hudMode,
      hudSubjectPlayerId: normalizedOptions.hudSubjectPlayerId ?? manifest.hudSubjectPlayerId,
      renderMode: true,
    });
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: !normalizedOptions.keepBrowserOpen });
    tempVideoDir = await fs.mkdtemp(path.join(artifactDir, `${job?.renderId ?? 'render'}.video-`));
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: manifest.devicePixelRatio || 1,
    });
    const page = await context.newPage();

    installRenderPageDiagnostics(page);
    await installRenderRequestGuards(page);
    await reportProgress('preparing', 0.03, 'Loading replay');
    await page.goto(playbackUrl, { waitUntil: 'networkidle', timeout: RECORDING_PLAYBACK_BOOT_TIMEOUT_MS });
    await page.waitForFunction(
      () => Boolean((window as RecordingBrowserWindow).__voxelRecording),
      null,
      { timeout: RECORDING_PLAYBACK_BOOT_TIMEOUT_MS }
    );
    await page.waitForFunction(
      () => Boolean((window as RecordingBrowserWindow).__voxelRecording?.isReady),
      null,
      { timeout: RECORDING_PLAYBACK_READY_TIMEOUT_MS }
    );
    const durationMs = normalizedOptions.durationMs ?? await page.evaluate(() => (
      (window as RecordingBrowserWindow).__voxelRecording?.durationMs ?? 0
    ));
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Recording duration was not available');
    }

    const webmPath = path.join(tempVideoDir, `${job?.renderId ?? 'render'}.webm`);
    await reportProgress('capturing', 0.05, 'Capturing gameplay canvas');
    canvasCapture = await startCanvasVideoCapture({
      page,
      webmPath,
      fps,
    });
    await waitForRecordingPlayback({
      page,
      durationMs,
      onProgress: (progress, message) => reportProgress('capturing', 0.05 + progress * 0.85, message),
    });
    const captureResult = await canvasCapture.stop();
    canvasCapture = null;
    console.info('Recording canvas capture complete', {
      renderId: job?.renderId ?? null,
      chunkCount: captureResult.chunkCount,
      byteCount: captureResult.byteCount,
      mimeType: captureResult.mimeType,
    });

    await reportProgress('transcoding', 0.9, 'Encoding MP4');
    await transcodeVideoToMp4({
      webmPath,
      outputPath,
      fps,
      durationMs,
      startOffsetMs: 0,
      onProgress: (progress, message) => reportProgress('transcoding', progress, message),
    });
    await reportProgress('finalizing', 0.985, 'Checking MP4 motion');
    await validateMp4EffectiveFrameRate({ outputPath, fps, durationMs });
    await reportProgress('finalizing', 0.99, 'Finalizing MP4');
    const mp4Sha256 = await sha256File(outputPath);
    await updateSummaryRender({
      artifactDir,
      renderId: job?.renderId ?? null,
      patch: {
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputPath,
        stage: 'complete',
        progress: 1,
        progressMessage: null,
        heartbeatAt: new Date().toISOString(),
        error: null,
      },
    });
    await normalizedOptions.onProgress?.({
      stage: 'complete',
      progress: 1,
      heartbeatAt: new Date().toISOString(),
      startedAt: renderStartedAt,
      message: null,
    });
    const manifestPath = path.join(artifactDir, 'manifest.json');
    const nextManifest = await readJson<RecordingManifest>(manifestPath);
    await writeJson(manifestPath, {
      ...nextManifest,
      artifacts: { ...nextManifest.artifacts, mp4: outputPath },
      checksums: { ...nextManifest.checksums, mp4Sha256 },
    });
    return {
      recordingId: manifest.id,
      outputPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await fs.rm(outputPath, { force: true }).catch(() => {});
    await updateSummaryRender({
      artifactDir,
      renderId: job?.renderId ?? null,
      patch: {
        status: 'failed',
        completedAt: new Date().toISOString(),
        outputPath,
        heartbeatAt: new Date().toISOString(),
        error: errorMessage,
      },
    }).catch(() => {});
    await Promise.resolve(normalizedOptions.onProgress?.({
      ...lastProgressUpdate,
      heartbeatAt: new Date().toISOString(),
      message: errorMessage,
      error: errorMessage,
    })).catch(() => {});
    throw error;
  } finally {
    if (canvasCapture) {
      await canvasCapture.stop().catch((error) => {
        console.warn(`Recording canvas capture cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (context) {
      await closeWithTimeout('Recording browser context close', () => context!.close());
    }
    if (browser && !normalizedOptions.keepBrowserOpen) {
      await closeWithTimeout('Recording browser close', () => browser!.close());
    }
    if (playbackServer) await playbackServer.close().catch(() => {});
    if (tempVideoDir) await fs.rm(tempVideoDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const result = await renderRecordingToMp4(parseArgs());
  console.log(`Rendered recording ${result.recordingId} to ${result.outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
