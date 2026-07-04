import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALL_HERO_IDS,
  isGameplayMode,
  type GameplayMode,
  type HeroId,
  type RecordingHudMode,
  type RecordingManifest,
  type RecordingRenderArtifact,
  type RecordingSummary,
  type RecordingViewport,
} from '@voxel-strike/shared';
import { runWithInGameCapacity, type InGameCapacityAdmissionFailureReason } from '../matchmaking/playerCapacity';
import { renderRecordingToMp4 } from '../scripts/render-recording';
import {
  createStreamerBotShowcaseRoomOptions,
  type StreamerGameRoomCreateOptions,
  type StreamerMatchMaker,
  type StreamerRoomListing,
} from '../streamer/service';
import { loggers } from '../utils/logger';
import {
  getRecordingArtifactDir,
  getRecordingStorageRoot,
  listRecordingManifests,
  readRecordingManifest,
  readRecordingSummary,
  requestRecordingStop,
  resolveRecordingArtifactPath,
} from './artifacts';
import type { GameRoomRecordingOptions } from './types';

const DEFAULT_RECORDING_DURATION_MS = 60_000;
const MIN_RECORDING_DURATION_MS = 5_000;
const MAX_RECORDING_DURATION_MS = 10 * 60_000;
const DEFAULT_RECORDING_FPS = 60;
const DEFAULT_RECORDING_VIEWPORT: RecordingViewport = { width: 1920, height: 1080 };
const DEFAULT_DEVICE_PIXEL_RATIO = 1;
const SHOWCASE_RECORDING_DURATION_MS = 5 * 60_000;
const SHOWCASE_RECORDING_FINALIZE_TIMEOUT_MS = SHOWCASE_RECORDING_DURATION_MS + 2 * 60_000;
const SHOWCASE_RECORDING_POLL_MS = 1_000;

export interface BotMatchRecordingRequest {
  heroId?: unknown;
  gameplayMode?: unknown;
  durationMs?: unknown;
  fps?: unknown;
  viewport?: unknown;
  devicePixelRatio?: unknown;
  hudMode?: unknown;
  hudSubjectPlayerId?: unknown;
  gameBuildId?: unknown;
  serverBuildId?: unknown;
}

export interface CreateBotMatchRecordingResult {
  id: string;
  room: StreamerRoomListing;
  manifest: RecordingManifest;
}

export interface RecordingRenderRequest {
  fps?: unknown;
  viewport?: unknown;
  hudMode?: unknown;
  outputPath?: unknown;
}

export interface RecordingRenderQueueItem {
  recordingId: string;
  renderId: string;
  requestedAt: string;
  fps: number;
  viewport: RecordingViewport;
  hudMode: RecordingHudMode;
  outputPath: string;
}

export type RecordingShowcaseJobStatus = 'recording' | 'rendering' | 'succeeded' | 'failed';

export interface RecordingShowcaseJob {
  id: string;
  recordingId: string;
  renderId: string | null;
  status: RecordingShowcaseJobStatus;
  heroId: HeroId;
  gameplayMode: GameplayMode;
  recordingDurationMs: number;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingShowcaseRequest {
  heroId?: unknown;
  gameplayMode?: unknown;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function readViewport(value: unknown, fallback: RecordingViewport = DEFAULT_RECORDING_VIEWPORT): RecordingViewport {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  return {
    width: boundedInteger(record.width, fallback.width, 320, 3840),
    height: boundedInteger(record.height, fallback.height, 240, 2160),
  };
}

function readHudMode(value: unknown): RecordingHudMode {
  return value === 'hidden' || value === 'cinematic_observer' || value === 'selected_player'
    ? value
    : 'selected_player';
}

function optionalString(value: unknown, maxLength = 256): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function isHeroId(value: unknown): value is HeroId {
  return typeof value === 'string' && (ALL_HERO_IDS as readonly string[]).includes(value);
}

function readOptionalHeroId(value: unknown): HeroId | null {
  return isHeroId(value) ? value : null;
}

function readOptionalGameplayMode(value: unknown): GameplayMode | null {
  return isGameplayMode(value) ? value : null;
}

function readRequiredHeroId(value: unknown): HeroId {
  if (isHeroId(value)) return value;
  throw new RecordingValidationError('Choose a valid hero before starting a recording');
}

function readRequiredGameplayMode(value: unknown): GameplayMode {
  if (isGameplayMode(value)) return value;
  throw new RecordingValidationError('Choose a valid game mode before starting a recording');
}

function createRecordingId(now = Date.now()): string {
  return `rec_${now.toString(36)}_${crypto.randomUUID()}`;
}

function createShowcaseJobId(now = Date.now()): string {
  return `showcase_${now.toString(36)}_${crypto.randomUUID()}`;
}

function cleanShowcaseJobId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180);
  if (!cleaned) throw new Error('Showcase recording job id must not be empty');
  return cleaned;
}

function getShowcaseJobsDir(): string {
  return path.join(getRecordingStorageRoot(), 'showcase-jobs');
}

function getShowcaseJobPath(id: string): string {
  return path.join(getShowcaseJobsDir(), `${cleanShowcaseJobId(id)}.json`);
}

async function readRecordingManifestWithRetry(id: string, attempts = 20): Promise<RecordingManifest> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await readRecordingManifest(id);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt < 4 ? 25 : 100));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Recording manifest ${id} was not created`);
}

function buildRecordingOptions(input: {
  id: string;
  adminUserId: string;
  request: BotMatchRecordingRequest;
  roomOptions: StreamerGameRoomCreateOptions;
}): GameRoomRecordingOptions {
  const durationMs = boundedInteger(
    input.request.durationMs,
    DEFAULT_RECORDING_DURATION_MS,
    MIN_RECORDING_DURATION_MS,
    MAX_RECORDING_DURATION_MS
  );
  const hudMode = readHudMode(input.request.hudMode);
  const hudSubjectPlayerId = optionalString(input.request.hudSubjectPlayerId)
    ?? input.roomOptions.botAssignments[0]?.playerId
    ?? null;
  return {
    id: input.id,
    requestedByAdminUserId: input.adminUserId,
    requestedDurationMs: durationMs,
    maxDurationMs: MAX_RECORDING_DURATION_MS,
    fps: boundedInteger(input.request.fps, DEFAULT_RECORDING_FPS, 24, 120),
    viewport: readViewport(input.request.viewport),
    devicePixelRatio: boundedInteger(input.request.devicePixelRatio, DEFAULT_DEVICE_PIXEL_RATIO, 1, 3),
    cameraMode: 'fixed_aerial',
    hudMode,
    hudSubjectPlayerId,
    gameBuildId: optionalString(input.request.gameBuildId, 128),
    serverBuildId: optionalString(input.request.serverBuildId, 128),
  };
}

export async function createBotMatchRecording(input: {
  adminUserId: string;
  matchMaker: StreamerMatchMaker;
  request: BotMatchRecordingRequest;
  random?: () => number;
  now?: () => number;
}): Promise<CreateBotMatchRecordingResult> {
  const now = input.now?.() ?? Date.now();
  const id = createRecordingId(now);
  const gameplayMode = readOptionalGameplayMode(input.request.gameplayMode) ?? 'team_deathmatch';
  const roomOptions = createStreamerBotShowcaseRoomOptions({
    adminUserId: input.adminUserId,
    random: input.random ?? Math.random,
    now,
    gameplayMode,
    featuredHeroId: readOptionalHeroId(input.request.heroId),
  });
  roomOptions.recording = buildRecordingOptions({
    id,
    adminUserId: input.adminUserId,
    request: input.request,
    roomOptions,
  });

  const admission = await runWithInGameCapacity({
    matchMaker: input.matchMaker,
    requestedPlayers: roomOptions.capacityPlayerCost,
  }, () => input.matchMaker.createRoom('game_room', roomOptions));

  if (!admission.admitted) {
    throw new RecordingCapacityError(admission.reason, roomOptions.capacityPlayerCost);
  }

  const manifest = await readRecordingManifestWithRetry(id);
  return {
    id,
    room: admission.result,
    manifest,
  };
}

export class RecordingCapacityError extends Error {
  constructor(
    readonly reason: InGameCapacityAdmissionFailureReason,
    readonly requestedPlayers: number
  ) {
    super(`Recording bot match capacity unavailable: ${reason}`);
  }
}

export class RecordingValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function writeShowcaseJob(job: RecordingShowcaseJob): Promise<void> {
  await fs.mkdir(getShowcaseJobsDir(), { recursive: true });
  const jobPath = getShowcaseJobPath(job.id);
  const tempPath = `${jobPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, jobPath);
}

async function updateShowcaseJob(
  job: RecordingShowcaseJob,
  patch: Partial<Omit<RecordingShowcaseJob, 'id' | 'createdAt'>>
): Promise<RecordingShowcaseJob> {
  const next: RecordingShowcaseJob = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeShowcaseJob(next);
  return next;
}

function showcaseDownloadUrl(recordingId: string): string {
  return `/recordings/${encodeURIComponent(recordingId)}/download`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getRecordingShowcaseJob(id: string): Promise<RecordingShowcaseJob> {
  return JSON.parse(await fs.readFile(getShowcaseJobPath(id), 'utf8')) as RecordingShowcaseJob;
}

async function waitForFinalizedRecording(id: string): Promise<{
  manifest: RecordingManifest;
  summary: RecordingSummary;
}> {
  const deadline = Date.now() + SHOWCASE_RECORDING_FINALIZE_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() <= deadline) {
    try {
      const recording = await getRecording(id);
      if (recording.summary?.status === 'finalized') {
        return {
          manifest: recording.manifest,
          summary: recording.summary,
        };
      }
      if (recording.summary?.status === 'failed' || recording.manifest.status === 'failed') {
        throw new Error(recording.summary?.error ?? recording.manifest.error ?? 'Recording failed');
      }
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.includes('Recording failed')) {
        throw error;
      }
    }
    await sleep(SHOWCASE_RECORDING_POLL_MS);
  }

  throw lastError instanceof Error
    ? new Error(`Timed out waiting for recording finalization: ${lastError.message}`)
    : new Error('Timed out waiting for recording finalization');
}

async function runShowcaseRecordingPipeline(jobId: string): Promise<void> {
  let job = await getRecordingShowcaseJob(jobId);
  try {
    const recording = await waitForFinalizedRecording(job.recordingId);
    const render = await enqueueRecordingRender(job.recordingId, {
      fps: DEFAULT_RECORDING_FPS,
      viewport: recording.manifest.viewport,
      hudMode: 'selected_player',
    });
    job = await updateShowcaseJob(job, {
      status: 'rendering',
      renderId: render.renderId,
      error: null,
    });

    await renderRecordingToMp4({
      jobPath: path.join(getRecordingArtifactDir(job.recordingId), `${render.renderId}.render-job.json`),
    });

    await updateShowcaseJob(job, {
      status: 'succeeded',
      downloadUrl: showcaseDownloadUrl(job.recordingId),
      error: null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateShowcaseJob(job, {
      status: 'failed',
      error: errorMessage,
    }).catch(() => {});
    loggers.room.error('Showcase recording job failed', {
      jobId,
      recordingId: job.recordingId,
      renderId: job.renderId,
      error: errorMessage,
    });
  }
}

export async function startShowcaseRecordingJob(input: {
  adminUserId: string;
  matchMaker: StreamerMatchMaker;
  request: RecordingShowcaseRequest;
  random?: () => number;
  now?: () => number;
}): Promise<RecordingShowcaseJob> {
  const requestNow = input.now?.() ?? Date.now();
  const heroId = readRequiredHeroId(input.request.heroId);
  const gameplayMode = readRequiredGameplayMode(input.request.gameplayMode);
  const result = await createBotMatchRecording({
    adminUserId: input.adminUserId,
    matchMaker: input.matchMaker,
    request: {
      heroId,
      gameplayMode,
      durationMs: SHOWCASE_RECORDING_DURATION_MS,
      fps: DEFAULT_RECORDING_FPS,
      viewport: DEFAULT_RECORDING_VIEWPORT,
      devicePixelRatio: DEFAULT_DEVICE_PIXEL_RATIO,
      hudMode: 'selected_player',
    },
    random: input.random,
    now: () => requestNow,
  });

  const timestamp = new Date(requestNow).toISOString();
  const job: RecordingShowcaseJob = {
    id: createShowcaseJobId(requestNow),
    recordingId: result.id,
    renderId: null,
    status: 'recording',
    heroId,
    gameplayMode,
    recordingDurationMs: SHOWCASE_RECORDING_DURATION_MS,
    downloadUrl: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeShowcaseJob(job);
  void runShowcaseRecordingPipeline(job.id).catch((error) => {
    loggers.room.error('Showcase recording job runner crashed', {
      jobId: job.id,
      recordingId: job.recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return job;
}

export async function listRecordings(limit = 50): Promise<RecordingManifest[]> {
  return (await listRecordingManifests()).slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
}

export async function getRecording(id: string): Promise<{
  manifest: RecordingManifest;
  summary: RecordingSummary | null;
}> {
  const manifest = await readRecordingManifest(id);
  let summary: RecordingSummary | null = null;
  try {
    summary = await readRecordingSummary(id);
  } catch {
    summary = null;
  }
  return { manifest, summary };
}

async function writeRecordingSummary(summary: RecordingSummary): Promise<void> {
  await fs.writeFile(
    resolveRecordingArtifactPath(summary.id, 'summary'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
}

export async function stopRecording(id: string): Promise<void> {
  await requestRecordingStop(id);
}

export async function deleteRecording(id: string): Promise<void> {
  await fs.rm(getRecordingArtifactDir(id), { recursive: true, force: true });
}

export async function enqueueRecordingRender(
  id: string,
  request: RecordingRenderRequest
): Promise<RecordingRenderQueueItem> {
  const { manifest, summary } = await getRecording(id);
  if (!summary || summary.status !== 'finalized') {
    throw new Error('Recording must be finalized before rendering');
  }

  const renderId = `render_${Date.now().toString(36)}_${crypto.randomUUID()}`;
  const viewport = readViewport(request.viewport, manifest.viewport);
  const fps = boundedInteger(request.fps, manifest.fps, 24, 120);
  const hudMode = readHudMode(request.hudMode ?? manifest.hudMode);
  const outputPath = optionalString(request.outputPath, 1024)
    ?? path.join(getRecordingArtifactDir(id), `${renderId}.mp4`);
  const render: RecordingRenderArtifact = {
    id: renderId,
    status: 'queued',
    requestedAt: new Date().toISOString(),
    completedAt: null,
    fps,
    viewport,
    hudMode,
    outputPath,
    error: null,
  };
  const nextSummary = {
    ...summary,
    renders: [...summary.renders, render],
  };
  await writeRecordingSummary(nextSummary);

  const item: RecordingRenderQueueItem = {
    recordingId: id,
    renderId,
    requestedAt: render.requestedAt,
    fps,
    viewport,
    hudMode,
    outputPath,
  };
  await fs.writeFile(
    path.join(getRecordingArtifactDir(id), `${renderId}.render-job.json`),
    `${JSON.stringify(item, null, 2)}\n`,
    'utf8'
  );
  await fs.mkdir(path.join(getRecordingStorageRoot(), 'render-queue'), { recursive: true });
  await fs.writeFile(
    path.join(getRecordingStorageRoot(), 'render-queue', `${renderId}.json`),
    `${JSON.stringify(item, null, 2)}\n`,
    'utf8'
  );
  return item;
}

export async function getLatestRecordingMp4Path(id: string): Promise<string | null> {
  const { summary } = await getRecording(id);
  const latest = [...(summary?.renders ?? [])].reverse().find((render) => (
    render.status === 'succeeded' && render.outputPath
  ));
  if (!latest?.outputPath) return null;
  await fs.access(latest.outputPath);
  return latest.outputPath;
}
