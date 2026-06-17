import type { HeroId, ViewmodelChannelKind, ViewmodelPoseChannelDriver } from '@voxel-strike/shared';
import { VIEWMODEL_MODEL_DOCUMENTS } from './viewmodelManifests';

export interface HeldBlendRuntime {
  held: boolean;
  changedAtMs: number;
  blendAtChange: number;
}

export interface ViewmodelEventRuntime {
  revision: number;
  startedAtMs: number;
}

export interface ViewmodelPoseRuntime {
  heroId: HeroId | null;
  revision: number;
  channelKinds: Record<string, ViewmodelChannelKind>;
  channelDrivers: Record<string, ViewmodelPoseChannelDriver>;
  heldChannels: Record<string, HeldBlendRuntime>;
  eventChannels: Record<string, ViewmodelEventRuntime>;
}

const HELD_CHANNEL_KINDS = new Set<ViewmodelChannelKind>([
  'held',
  'charge',
  'targeting',
  'movement',
]);

function createHeldBlendRuntime(): HeldBlendRuntime {
  return {
    held: false,
    changedAtMs: 0,
    blendAtChange: 0,
  };
}

function createEventRuntime(startedAtMs = -Infinity): ViewmodelEventRuntime {
  return {
    revision: 0,
    startedAtMs,
  };
}

function createRuntimeChannels(): Pick<ViewmodelPoseRuntime, 'channelKinds' | 'channelDrivers' | 'heldChannels' | 'eventChannels'> {
  const channelKinds: Record<string, ViewmodelChannelKind> = {};
  const channelDrivers: Record<string, ViewmodelPoseChannelDriver> = {};
  const heldChannels: Record<string, HeldBlendRuntime> = {};
  const eventChannels: Record<string, ViewmodelEventRuntime> = {};

  for (const document of Object.values(VIEWMODEL_MODEL_DOCUMENTS)) {
    for (const channel of document.poseChannels) {
      const driver = channel.driver ?? 'poseRuntime';
      channelKinds[channel.id] = channel.kind;
      channelDrivers[channel.id] = driver;
      if (driver !== 'poseRuntime') continue;

      if (HELD_CHANNEL_KINDS.has(channel.kind)) {
        heldChannels[channel.id] = createHeldBlendRuntime();
      } else {
        eventChannels[channel.id] = createEventRuntime();
      }
    }
  }

  return { channelKinds, channelDrivers, heldChannels, eventChannels };
}

export function createViewmodelPoseRuntime(heroId: HeroId | null = null): ViewmodelPoseRuntime {
  return {
    heroId,
    revision: 0,
    ...createRuntimeChannels(),
  };
}

export const defaultViewmodelPoseRuntime = createViewmodelPoseRuntime();

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function assertDeclaredChannel(
  runtime: ViewmodelPoseRuntime,
  channelId: string,
  expected: 'held' | 'event'
): void {
  const kind = runtime.channelKinds[channelId];
  if (!kind) {
    throw new Error(`Unknown viewmodel pose channel "${channelId}"`);
  }
  const driver = runtime.channelDrivers[channelId] ?? 'poseRuntime';
  if (driver !== 'poseRuntime') {
    throw new Error(`Viewmodel pose channel "${channelId}" is driven by ${driver}, not the pose runtime`);
  }
  const isHeldChannel = HELD_CHANNEL_KINDS.has(kind);
  if (expected === 'held' && !isHeldChannel) {
    throw new Error(`Viewmodel pose channel "${channelId}" is not a held channel`);
  }
  if (expected === 'event' && isHeldChannel) {
    throw new Error(`Viewmodel pose channel "${channelId}" is not an event channel`);
  }
}

export function getViewmodelHeldChannel(
  runtime: ViewmodelPoseRuntime,
  channelId: string
): HeldBlendRuntime {
  assertDeclaredChannel(runtime, channelId, 'held');
  return runtime.heldChannels[channelId] ??= createHeldBlendRuntime();
}

export function getViewmodelEventChannel(
  runtime: ViewmodelPoseRuntime,
  channelId: string
): ViewmodelEventRuntime {
  assertDeclaredChannel(runtime, channelId, 'event');
  return runtime.eventChannels[channelId] ??= createEventRuntime();
}

export function getViewmodelHeldBlend({
  runtime,
  channelId,
  transitionSeconds,
  timestampMs,
}: {
  runtime: ViewmodelPoseRuntime;
  channelId: string;
  transitionSeconds: number;
  timestampMs: number;
}): number {
  const state = getViewmodelHeldChannel(runtime, channelId);
  const targetBlend = state.held ? 1 : 0;
  const elapsedSeconds = Math.max(0, timestampMs - state.changedAtMs) / 1000;
  const progress = smoothstep(0, transitionSeconds, elapsedSeconds);
  return state.blendAtChange + (targetBlend - state.blendAtChange) * progress;
}

export function setViewmodelHeldChannel({
  runtime,
  channelId,
  held,
  transitionSeconds,
  timestampMs,
}: {
  runtime: ViewmodelPoseRuntime;
  channelId: string;
  held: boolean;
  transitionSeconds: number;
  timestampMs: number;
}): void {
  const state = getViewmodelHeldChannel(runtime, channelId);
  if (state.held === held) return;

  state.blendAtChange = getViewmodelHeldBlend({
    runtime,
    channelId,
    transitionSeconds,
    timestampMs,
  });
  state.held = held;
  state.changedAtMs = timestampMs;
  runtime.revision += 1;
}

export function triggerViewmodelEventChannel(
  runtime: ViewmodelPoseRuntime,
  channelId: string,
  timestampMs: number
): number {
  const state = getViewmodelEventChannel(runtime, channelId);
  state.revision += 1;
  state.startedAtMs = timestampMs;
  runtime.revision += 1;
  return state.revision;
}

export function clearViewmodelEventChannel(
  runtime: ViewmodelPoseRuntime,
  channelId: string,
  startedAtMs = 0
): void {
  getViewmodelEventChannel(runtime, channelId).startedAtMs = startedAtMs;
  runtime.revision += 1;
}

export function resetViewmodelPoseRuntime(
  runtime: ViewmodelPoseRuntime = defaultViewmodelPoseRuntime,
  heroId: HeroId | null = runtime.heroId
): ViewmodelPoseRuntime {
  const next = createViewmodelPoseRuntime(heroId);
  runtime.heroId = next.heroId;
  runtime.revision += 1;
  runtime.channelKinds = next.channelKinds;
  runtime.channelDrivers = next.channelDrivers;
  runtime.heldChannels = next.heldChannels;
  runtime.eventChannels = next.eventChannels;
  return runtime;
}
