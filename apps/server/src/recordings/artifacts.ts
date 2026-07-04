import crypto from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RECORDING_ARTIFACT_VERSION,
  type RecordingActionRow,
  type RecordingArtifactRefs,
  type RecordingCheckpointRow,
  type RecordingEventRow,
  type RecordingFileChecksums,
  type RecordingManifest,
  type RecordingStatus,
  type RecordingSummary,
} from '@voxel-strike/shared';

const DEFAULT_RECORDINGS_DIR = 'recordings';
const STOP_REQUEST_FILE = 'stop.requested';
const MANIFEST_FILE = 'manifest.json';
const EVENTS_FILE = 'events.ndjson';
const ACTIONS_FILE = 'actions.ndjson';
const CHECKPOINTS_FILE = 'checkpoints.ndjson';
const SUMMARY_FILE = 'summary.json';

export type RecordingArtifactKey = Exclude<keyof RecordingArtifactRefs, 'mp4'>;

const REDACTED = '[redacted]';
const SENSITIVE_KEY_PARTS = [
  'authorization',
  'auth_token',
  'authtoken',
  'cookie',
  'csrf',
  'entryticket',
  'matchmakingticket',
  'password',
  'secret',
  'sessioncookie',
  'streamerobserverticket',
  'token',
  'voicetoken',
];

const BLOCKED_OBSERVER_MESSAGE_TYPES = new Set([
  'playerPingRequest',
  'playerPingResponse',
  'playerPings',
  'streamerHeartbeat',
  'streamerObserverReady',
  'streamerObserverJoined',
  'requestVoiceToken',
  'voiceToken',
  'voiceTeamChanged',
  'playerReport',
  'playerReportResult',
  'duplicateSession',
  'error',
]);

const ALLOWED_OBSERVER_MESSAGE_TYPES = new Set([
  'abilityUsed',
  'blazePrimaryState',
  'chat',
  'chronosAegisBroken',
  'chronosAegisDamaged',
  'chronosPrimaryState',
  'chronosTimebreakImpulse',
  'flagCapture',
  'flagDrop',
  'flagPickup',
  'flagReturn',
  'gameEnd',
  'matchCancelled',
  'matchSnapshot',
  'mapPing',
  'phaseChange',
  'phantomPrimaryState',
  'phantomShieldBroken',
  'playerDamaged',
  'playerDowned',
  'playerEventBatch',
  'playerHealed',
  'playerInterest',
  'playerJoined',
  'playerKilled',
  'playerLeft',
  'playerReviveCancelled',
  'playerReviveStarted',
  'playerRevived',
  'playerTransformsV2',
  'playerVitals',
  'powerupCollected',
  'powerupState',
  'roundEnd',
  'voidZoneCreated',
  'voidZoneExpired',
]);

interface NdjsonWriterOptions {
  filePath: string;
}

class NdjsonWriter<TRow> {
  private readonly stream: WriteStream;
  private readonly hash = crypto.createHash('sha256');
  private closed = false;
  private drainPromise: Promise<void> | null = null;
  private resolveDrain: (() => void) | null = null;
  count = 0;

  constructor(options: NdjsonWriterOptions) {
    this.stream = createWriteStream(options.filePath, {
      flags: 'a',
      encoding: 'utf8',
      highWaterMark: 256 * 1024,
    });
    this.stream.on('drain', () => {
      this.resolveDrain?.();
      this.resolveDrain = null;
      this.drainPromise = null;
    });
  }

  append(row: TRow): void {
    if (this.closed) return;
    const line = `${JSON.stringify(row)}\n`;
    this.hash.update(line);
    this.count++;
    const accepted = this.stream.write(line);
    if (!accepted && !this.drainPromise) {
      this.drainPromise = new Promise((resolve) => {
        this.resolveDrain = resolve;
      });
    }
  }

  async close(): Promise<string> {
    if (this.closed) return this.hash.digest('hex');
    this.closed = true;
    if (this.drainPromise) await this.drainPromise;
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(resolve);
    });
    return this.hash.digest('hex');
  }
}

export interface RecordingArtifactWriterOptions {
  manifest: RecordingManifest;
  rootDir?: string;
  now?: () => number;
}

export interface RecordingAppendContext {
  serverTime: number;
  tick: number;
}

export function getRecordingStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.RECORDINGS_DIR || env.RECORDING_ARTIFACT_DIR || DEFAULT_RECORDINGS_DIR);
}

function cleanRecordingId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 160);
  if (!cleaned) throw new Error('Recording id must not be empty');
  return cleaned;
}

export function getRecordingArtifactDir(id: string, rootDir = getRecordingStorageRoot()): string {
  return path.join(rootDir, cleanRecordingId(id));
}

export function buildRecordingArtifactRefs(id: string): RecordingArtifactRefs {
  const prefix = cleanRecordingId(id);
  return {
    manifest: `${prefix}/${MANIFEST_FILE}`,
    events: `${prefix}/${EVENTS_FILE}`,
    actions: `${prefix}/${ACTIONS_FILE}`,
    checkpoints: `${prefix}/${CHECKPOINTS_FILE}`,
    summary: `${prefix}/${SUMMARY_FILE}`,
    mp4: null,
  };
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactRecordingPayload<T>(payload: T, depth = 0, seen = new WeakSet<object>()): T {
  if (payload === null || typeof payload !== 'object') return payload;
  if (depth > 24) return REDACTED as T;
  if (seen.has(payload)) return REDACTED as T;
  seen.add(payload);

  if (Array.isArray(payload)) {
    return payload.map((item) => redactRecordingPayload(item, depth + 1, seen)) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : redactRecordingPayload(value, depth + 1, seen);
  }
  return output as T;
}

export function shouldRecordObserverMessage(type: string): boolean {
  if (BLOCKED_OBSERVER_MESSAGE_TYPES.has(type)) return false;
  return ALLOWED_OBSERVER_MESSAGE_TYPES.has(type);
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export class RecordingArtifactWriter {
  private readonly rootDir: string;
  private readonly artifactDir: string;
  private readonly now: () => number;
  private readonly eventWriter: NdjsonWriter<RecordingEventRow>;
  private readonly actionWriter: NdjsonWriter<RecordingActionRow>;
  private readonly checkpointWriter: NdjsonWriter<RecordingCheckpointRow>;
  private manifest: RecordingManifest;
  private status: RecordingStatus;
  private finalized = false;

  private constructor(options: Required<RecordingArtifactWriterOptions>) {
    this.rootDir = options.rootDir;
    this.artifactDir = getRecordingArtifactDir(options.manifest.id, options.rootDir);
    this.now = options.now;
    this.manifest = options.manifest;
    this.status = options.manifest.status;
    this.eventWriter = new NdjsonWriter({ filePath: path.join(this.artifactDir, EVENTS_FILE) });
    this.actionWriter = new NdjsonWriter({ filePath: path.join(this.artifactDir, ACTIONS_FILE) });
    this.checkpointWriter = new NdjsonWriter({ filePath: path.join(this.artifactDir, CHECKPOINTS_FILE) });
  }

  static async create(options: RecordingArtifactWriterOptions): Promise<RecordingArtifactWriter> {
    const rootDir = options.rootDir ?? getRecordingStorageRoot();
    const manifest: RecordingManifest = {
      ...options.manifest,
      recordingVersion: RECORDING_ARTIFACT_VERSION,
      status: options.manifest.status === 'creating' ? 'recording' : options.manifest.status,
      startedAt: options.manifest.startedAt ?? new Date(options.now?.() ?? Date.now()).toISOString(),
      artifacts: options.manifest.artifacts ?? buildRecordingArtifactRefs(options.manifest.id),
      checksums: options.manifest.checksums ?? {},
    };
    const artifactDir = getRecordingArtifactDir(manifest.id, rootDir);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.rm(path.join(artifactDir, STOP_REQUEST_FILE), { force: true });
    await fs.writeFile(path.join(artifactDir, EVENTS_FILE), '', { flag: 'a' });
    await fs.writeFile(path.join(artifactDir, ACTIONS_FILE), '', { flag: 'a' });
    await fs.writeFile(path.join(artifactDir, CHECKPOINTS_FILE), '', { flag: 'a' });
    await writeJsonFile(path.join(artifactDir, MANIFEST_FILE), manifest);
    return new RecordingArtifactWriter({
      manifest,
      rootDir,
      now: options.now ?? Date.now,
    });
  }

  get id(): string {
    return this.manifest.id;
  }

  get dir(): string {
    return this.artifactDir;
  }

  get eventCount(): number {
    return this.eventWriter.count;
  }

  get actionCount(): number {
    return this.actionWriter.count;
  }

  get checkpointCount(): number {
    return this.checkpointWriter.count;
  }

  getStatus(): RecordingStatus {
    return this.status;
  }

  appendEvent(type: string, payload: unknown, context: RecordingAppendContext): void {
    if (this.finalized || !shouldRecordObserverMessage(type)) return;
    this.eventWriter.append({
      recordingTimeMs: Math.max(0, this.now() - Date.parse(this.manifest.startedAt ?? this.manifest.createdAt)),
      serverTime: context.serverTime,
      tick: context.tick,
      type,
      payload: redactRecordingPayload(payload),
    });
  }

  appendAction(action: RecordingActionRow): void {
    if (this.finalized) return;
    this.actionWriter.append(redactRecordingPayload(action));
  }

  appendCheckpoint(checkpoint: RecordingCheckpointRow): void {
    if (this.finalized) return;
    this.checkpointWriter.append(redactRecordingPayload(checkpoint));
  }

  async markStopping(): Promise<void> {
    if (this.status !== 'recording') return;
    this.status = 'stopping';
    this.manifest = { ...this.manifest, status: 'stopping' };
    await writeJsonFile(path.join(this.artifactDir, MANIFEST_FILE), this.manifest);
  }

  async hasStopBeenRequested(): Promise<boolean> {
    try {
      await fs.access(path.join(this.artifactDir, STOP_REQUEST_FILE));
      return true;
    } catch {
      return false;
    }
  }

  async finalize(summary: Omit<RecordingSummary, 'eventCount' | 'actionCount' | 'checkpointCount' | 'checksums'>): Promise<RecordingSummary> {
    if (this.finalized) {
      return readRecordingSummary(this.manifest.id, this.rootDir);
    }
    this.finalized = true;

    const eventsSha256 = await this.eventWriter.close();
    const actionsSha256 = await this.actionWriter.close();
    const checkpointsSha256 = await this.checkpointWriter.close();
    const checksums: RecordingFileChecksums = {
      eventsSha256,
      actionsSha256,
      checkpointsSha256,
    };
    const finalizedAt = summary.finalizedAt ?? new Date(this.now()).toISOString();
    this.status = summary.status;
    this.manifest = {
      ...this.manifest,
      status: summary.status,
      finalizedAt,
      roomId: summary.roomId,
      matchId: summary.matchId,
      checksums,
      error: summary.error,
    };

    const fullSummary: RecordingSummary = {
      ...summary,
      finalizedAt,
      eventCount: this.eventWriter.count,
      actionCount: this.actionWriter.count,
      checkpointCount: this.checkpointWriter.count,
      checksums,
    };
    await writeJsonFile(path.join(this.artifactDir, MANIFEST_FILE), this.manifest);
    await writeJsonFile(path.join(this.artifactDir, SUMMARY_FILE), fullSummary);
    const summarySha256 = await sha256File(path.join(this.artifactDir, SUMMARY_FILE));
    const nextChecksums = { ...checksums, summarySha256 };
    this.manifest = { ...this.manifest, checksums: nextChecksums };
    const finalSummary = { ...fullSummary, checksums: nextChecksums };
    await writeJsonFile(path.join(this.artifactDir, MANIFEST_FILE), this.manifest);
    await writeJsonFile(path.join(this.artifactDir, SUMMARY_FILE), finalSummary);
    return finalSummary;
  }
}

export async function requestRecordingStop(id: string, rootDir = getRecordingStorageRoot()): Promise<void> {
  const artifactDir = getRecordingArtifactDir(id, rootDir);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, STOP_REQUEST_FILE), new Date().toISOString(), 'utf8');
}

export async function readRecordingManifest(id: string, rootDir = getRecordingStorageRoot()): Promise<RecordingManifest> {
  const raw = await fs.readFile(path.join(getRecordingArtifactDir(id, rootDir), MANIFEST_FILE), 'utf8');
  return JSON.parse(raw) as RecordingManifest;
}

export async function readRecordingSummary(id: string, rootDir = getRecordingStorageRoot()): Promise<RecordingSummary> {
  const raw = await fs.readFile(path.join(getRecordingArtifactDir(id, rootDir), SUMMARY_FILE), 'utf8');
  return JSON.parse(raw) as RecordingSummary;
}

export async function listRecordingManifests(rootDir = getRecordingStorageRoot()): Promise<RecordingManifest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const manifests: RecordingManifest[] = [];
  for (const entry of entries) {
    try {
      manifests.push(await readRecordingManifest(entry, rootDir));
    } catch {
      // Ignore incomplete artifact directories while a room is still creating.
    }
  }
  return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function readCompleteNdjsonRows<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const rows: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      break;
    }
  }
  return rows;
}

export function resolveRecordingArtifactPath(id: string, artifact: RecordingArtifactKey, rootDir = getRecordingStorageRoot()): string {
  const fileName = artifact === 'manifest'
    ? MANIFEST_FILE
    : artifact === 'events'
    ? EVENTS_FILE
    : artifact === 'actions'
    ? ACTIONS_FILE
    : artifact === 'checkpoints'
    ? CHECKPOINTS_FILE
    : artifact === 'summary'
    ? SUMMARY_FILE
    : 'output.mp4';
  return path.join(getRecordingArtifactDir(id, rootDir), fileName);
}
