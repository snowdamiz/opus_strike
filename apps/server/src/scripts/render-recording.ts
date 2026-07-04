import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  RecordingHudMode,
  RecordingManifest,
  RecordingRenderArtifact,
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
}

interface LocalPlaybackServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface RenderPage {
  evaluate<T = unknown>(pageFunction: (...args: any[]) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(url: string, options?: { waitUntil?: 'networkidle' | 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  route(url: string, handler: (route: RenderRoute) => Promise<void> | void): Promise<void>;
  screenshot(options?: { type?: 'png'; animations?: 'disabled' | 'allow'; timeout?: number }): Promise<Buffer>;
  waitForFunction(pageFunction: (...args: any[]) => unknown, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
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
  newPage(options: {
    viewport: RecordingViewport;
    deviceScaleFactor: number;
  }): Promise<RenderPage>;
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
    stepTo: (recordingTimeMs: number) => Promise<void>;
  };
};

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
const RECORDING_FRAME_SCREENSHOT_TIMEOUT_MS = 120_000;

// Playwright screenshots wait for document.fonts.ready; stalled web fonts can block every rendered frame.
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
}): string {
  const url = new URL(input.baseUrl);
  url.searchParams.set('recordingPlayback', '1');
  url.searchParams.set('recordingAutoplay', '0');
  url.searchParams.set('recordingManifestUrl', input.manifestUrl);
  url.searchParams.set('recordingEventsUrl', input.eventsUrl);
  url.searchParams.set('recordingHudMode', input.hudMode);
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

async function writeBufferToStream(stream: NodeJS.WritableStream, buffer: Buffer): Promise<void> {
  if (stream.write(buffer)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function renderFrames(input: {
  page: RenderPage;
  outputPath: string;
  fps: number;
  durationMs: number;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(input.fps),
    '-i', 'pipe:0',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    input.outputPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const frameCount = Math.max(1, Math.ceil((input.durationMs / 1000) * input.fps));
  for (let frame = 0; frame < frameCount; frame++) {
    const recordingTimeMs = Math.min(input.durationMs, Math.round((frame / input.fps) * 1000));
    await input.page.evaluate(async (timeMs) => {
      await (window as RecordingBrowserWindow).__voxelRecording?.stepTo(timeMs);
    }, recordingTimeMs);
    const screenshot = await input.page.screenshot({
      type: 'png',
      animations: 'disabled',
      timeout: RECORDING_FRAME_SCREENSHOT_TIMEOUT_MS,
    });
    await writeBufferToStream(ffmpeg.stdin, screenshot);
  }
  ffmpeg.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode ?? 'unknown'}`);
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

  await updateSummaryRender({
    artifactDir,
    renderId: job?.renderId ?? null,
    patch: {
      status: 'rendering',
      outputPath,
      fps,
      viewport,
      hudMode,
      error: null,
    },
  });

  let playbackServer: LocalPlaybackServer | null = null;
  let browser: RenderBrowser | null = null;
  try {
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
    });
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: !normalizedOptions.keepBrowserOpen });
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: manifest.devicePixelRatio || 1,
    });
    await installRenderRequestGuards(page);
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

    await renderFrames({ page, outputPath, fps, durationMs });
    const mp4Sha256 = await sha256File(outputPath);
    await updateSummaryRender({
      artifactDir,
      renderId: job?.renderId ?? null,
      patch: {
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputPath,
        error: null,
      },
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
    await updateSummaryRender({
      artifactDir,
      renderId: job?.renderId ?? null,
      patch: {
        status: 'failed',
        completedAt: new Date().toISOString(),
        outputPath,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => {});
    throw error;
  } finally {
    if (browser && !normalizedOptions.keepBrowserOpen) await browser.close();
    if (playbackServer) await playbackServer.close();
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
