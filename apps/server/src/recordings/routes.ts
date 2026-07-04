import fs from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import type { ColyseusRuntimeConfig } from '../config/colyseus';
import {
  createAdminCsrfToken,
  ensureGameAdmin,
  ensureGameAdminMutation,
  noStore,
  type GameAdminUser,
} from '../auth/gameAdmin';
import { consumeRateLimitForKey } from '../auth/rateLimit';
import { loggers } from '../utils/logger';
import {
  resolveRecordingArtifactPath,
  type RecordingArtifactKey,
} from './artifacts';
import {
  buildFlyReplayHeader,
} from '../runtime/flyReplayRouting';
import {
  createBotMatchRecording,
  deleteRecording,
  enqueueRecordingRender,
  getLatestRecordingMp4Path,
  getRecording,
  getRecordingShowcaseJob,
  listRecordings,
  RecordingCapacityError,
  type RecordingShowcaseJob,
  type RecordingShowcaseJobStore,
  RecordingValidationError,
  startShowcaseRecordingJob,
  stopRecording,
} from './service';
import type { StreamerMatchMaker } from '../streamer/service';

interface RecordingsRouterOptions {
  matchMaker: StreamerMatchMaker;
  showcaseJobStore?: RecordingShowcaseJobStore;
  config?: ColyseusRuntimeConfig;
}

const RECORDING_MUTATION_RATE_LIMIT = {
  limit: 15,
  windowMs: 60 * 1000,
};

const ARTIFACT_CONTENT_TYPES: Record<RecordingArtifactKey, string> = {
  manifest: 'application/json; charset=utf-8',
  events: 'application/x-ndjson; charset=utf-8',
  actions: 'application/x-ndjson; charset=utf-8',
  checkpoints: 'application/x-ndjson; charset=utf-8',
  summary: 'application/json; charset=utf-8',
};

function readRecordingId(req: Request): string {
  const value = req.params.id;
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function readLimit(req: Request): number {
  const raw = req.query.limit;
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.max(1, Math.min(200, Math.trunc(value))) : 50;
}

function readArtifactKey(req: Request): RecordingArtifactKey | null {
  const key = req.params.artifact;
  return key === 'manifest'
    || key === 'events'
    || key === 'actions'
    || key === 'checkpoints'
    || key === 'summary'
    ? key
    : null;
}

function enforceRecordingMutationRateLimit(req: Request, res: Response, adminUser: GameAdminUser): boolean {
  const result = consumeRateLimitForKey(`admin:${adminUser.id}`, {
    keyPrefix: `recordings:${req.path}`,
    ...RECORDING_MUTATION_RATE_LIMIT,
  });
  if (result.ok) return true;

  res.setHeader('Retry-After', result.retryAfterSeconds.toString());
  res.status(429).json({ error: 'Too many recording requests' });
  return false;
}

function sendAdminError(res: Response, status: number, error: string, adminUser: GameAdminUser): void {
  res.status(status).json({
    error,
    csrfToken: createAdminCsrfToken(adminUser),
  });
}

function replayToShowcaseJobOwner(
  res: Response,
  job: RecordingShowcaseJob,
  config: ColyseusRuntimeConfig | undefined
): boolean {
  const ownerMachineId = job.serverMachineId;
  const localMachineId = config?.flyReplay.machineId;
  if (!config?.flyReplay.enabled || !ownerMachineId || !localMachineId || ownerMachineId === localMachineId) {
    return false;
  }

  res.status(307);
  res.setHeader('Fly-Replay', buildFlyReplayHeader(ownerMachineId, config));
  res.end();
  return true;
}

async function replayDownloadToShowcaseJobOwner(
  req: Request,
  res: Response,
  options: RecordingsRouterOptions
): Promise<boolean> {
  const showcaseJobId = typeof req.query.showcaseJobId === 'string'
    ? req.query.showcaseJobId.trim().slice(0, 180)
    : '';
  if (!showcaseJobId) return false;

  try {
    const job = await getRecordingShowcaseJob(showcaseJobId, options.showcaseJobStore);
    return replayToShowcaseJobOwner(res, job, options.config);
  } catch {
    return false;
  }
}

export function createRecordingsRouter(options: RecordingsRouterOptions): Router {
  const router = Router();

  router.get('/', ensureGameAdmin, async (_req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    try {
      const recordings = await listRecordings(readLimit(_req));
      res.json({
        recordings,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.error('Failed to list recordings', {
        adminUserId: adminUser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 500, 'Failed to list recordings', adminUser);
    }
  });

  router.post('/bot-match', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceRecordingMutationRateLimit(req, res, adminUser)) return;

    try {
      const result = await createBotMatchRecording({
        adminUserId: adminUser.id,
        matchMaker: options.matchMaker,
        request: req.body ?? {},
      });
      res.status(201).json({
        recording: result.manifest,
        room: result.room,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      if (error instanceof RecordingCapacityError) {
        sendAdminError(res, 503, error.message, adminUser);
        return;
      }

      loggers.room.error('Failed to create bot recording', {
        adminUserId: adminUser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 500, 'Failed to create bot recording', adminUser);
    }
  });

  router.post('/showcase', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceRecordingMutationRateLimit(req, res, adminUser)) return;

    try {
      const job = await startShowcaseRecordingJob({
        adminUserId: adminUser.id,
        matchMaker: options.matchMaker,
        request: req.body ?? {},
        showcaseJobStore: options.showcaseJobStore,
        serverProcessId: options.matchMaker.processId ?? null,
        serverMachineId: options.config?.flyReplay.machineId ?? null,
      });
      res.status(202).json({
        job,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      if (error instanceof RecordingValidationError) {
        sendAdminError(res, 400, error.message, adminUser);
        return;
      }
      if (error instanceof RecordingCapacityError) {
        sendAdminError(res, 503, error.message, adminUser);
        return;
      }

      loggers.room.error('Failed to start showcase recording', {
        adminUserId: adminUser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 500, 'Failed to start showcase recording', adminUser);
    }
  });

  router.get('/showcase/:jobId', ensureGameAdmin, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId.trim().slice(0, 180) : '';
    try {
      const job = await getRecordingShowcaseJob(jobId, options.showcaseJobStore);
      if (replayToShowcaseJobOwner(res, job, options.config)) return;
      res.json({
        job,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.warn('Failed to load showcase recording job', {
        adminUserId: adminUser.id,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 404, 'Showcase recording job not found', adminUser);
    }
  });

  router.get('/:id', ensureGameAdmin, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    try {
      const recording = await getRecording(readRecordingId(req));
      res.json({
        ...recording,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.warn('Failed to load recording', {
        adminUserId: adminUser.id,
        recordingId: readRecordingId(req),
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 404, 'Recording not found', adminUser);
    }
  });

  router.get('/:id/artifacts/:artifact', ensureGameAdmin, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    const artifact = readArtifactKey(req);
    if (!artifact) {
      sendAdminError(res, 404, 'Recording artifact not found', adminUser);
      return;
    }

    const recordingId = readRecordingId(req);
    try {
      const filePath = resolveRecordingArtifactPath(recordingId, artifact);
      await fs.access(filePath);
      res.type(ARTIFACT_CONTENT_TYPES[artifact]);
      res.sendFile(filePath);
    } catch (error) {
      loggers.room.warn('Failed to send recording artifact', {
        adminUserId: adminUser.id,
        recordingId,
        artifact,
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 404, 'Recording artifact not found', adminUser);
    }
  });

  router.post('/:id/stop', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceRecordingMutationRateLimit(req, res, adminUser)) return;

    try {
      await stopRecording(readRecordingId(req));
      res.json({
        stopped: true,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.error('Failed to stop recording', {
        adminUserId: adminUser.id,
        recordingId: readRecordingId(req),
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 500, 'Failed to stop recording', adminUser);
    }
  });

  router.post('/:id/render', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceRecordingMutationRateLimit(req, res, adminUser)) return;

    try {
      const render = await enqueueRecordingRender(readRecordingId(req), req.body ?? {});
      res.status(202).json({
        render,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.warn('Failed to enqueue recording render', {
        adminUserId: adminUser.id,
        recordingId: readRecordingId(req),
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 409, error instanceof Error ? error.message : 'Failed to enqueue recording render', adminUser);
    }
  });

  router.get('/:id/download', ensureGameAdmin, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    try {
      if (await replayDownloadToShowcaseJobOwner(req, res, options)) return;
      const mp4Path = await getLatestRecordingMp4Path(readRecordingId(req));
      if (!mp4Path) {
        sendAdminError(res, 404, 'Recording MP4 not found', adminUser);
        return;
      }
      res.download(mp4Path);
    } catch (error) {
      loggers.room.warn('Failed to download recording MP4', {
        adminUserId: adminUser.id,
        recordingId: readRecordingId(req),
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 404, 'Recording MP4 not found', adminUser);
    }
  });

  router.delete('/:id', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceRecordingMutationRateLimit(req, res, adminUser)) return;

    try {
      await deleteRecording(readRecordingId(req));
      res.json({
        deleted: true,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.error('Failed to delete recording', {
        adminUserId: adminUser.id,
        recordingId: readRecordingId(req),
        error: error instanceof Error ? error.message : String(error),
      });
      sendAdminError(res, 500, 'Failed to delete recording', adminUser);
    }
  });

  return router;
}
