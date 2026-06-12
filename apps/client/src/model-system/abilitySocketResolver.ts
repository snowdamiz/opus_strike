import * as THREE from 'three';
import {
  calculateAbilityFallbackSocketOrigin,
  resolveAbilitySocket,
  type ModelOwnerScope,
  type ModelSide,
} from '@voxel-strike/shared';
import {
  readRemoteModelSocketAny,
  type RemoteModelSocketPose,
} from '../viewmodel/remoteModelSocketRegistry';
import {
  readViewmodelSocket,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../viewmodel/viewmodelSocketRegistry';
import { loggers } from '../utils/logger';

export type AbilitySocketOriginSource =
  | 'localViewmodel'
  | 'sampledViewmodel'
  | 'remoteBody'
  | 'fallback';

export interface AbilitySocketFallbackContext {
  position: { x: number; y: number; z: number };
  yaw: number;
}

export interface ResolveAbilitySocketOriginOptions {
  ownerScope: Extract<ModelOwnerScope, 'localViewmodel' | 'remoteBody' | 'serverFallback'>;
  abilityId: string;
  side?: ModelSide;
  playerId?: string;
  fallback?: AbilitySocketFallbackContext;
  sampledContext?: unknown;
  preferSampled?: boolean;
  warnOnSampleDrift?: boolean;
  driftTolerance?: number;
}

export interface ResolvedAbilitySocketOrigin {
  abilityId: string;
  socketName: string;
  source: AbilitySocketOriginSource;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  timestampMs: number;
  revision: number;
}

const fallbackQuaternion = new THREE.Quaternion();

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function fromViewmodelPose(
  abilityId: string,
  pose: ViewmodelSocketPose,
  source: Extract<AbilitySocketOriginSource, 'localViewmodel' | 'sampledViewmodel'>
): ResolvedAbilitySocketOrigin {
  return {
    abilityId,
    socketName: pose.socketName,
    source,
    position: pose.position.clone(),
    quaternion: pose.quaternion.clone(),
    timestampMs: pose.timestampMs,
    revision: pose.revision,
  };
}

function fromRemotePose(abilityId: string, pose: RemoteModelSocketPose): ResolvedAbilitySocketOrigin {
  return {
    abilityId,
    socketName: pose.socketName,
    source: 'remoteBody',
    position: pose.position.clone(),
    quaternion: pose.quaternion.clone(),
    timestampMs: pose.timestampMs,
    revision: pose.revision,
  };
}

function warnIfDrifted({
  abilityId,
  livePose,
  sampledPose,
  tolerance,
}: {
  abilityId: string;
  livePose: ViewmodelSocketPose | null;
  sampledPose: ViewmodelSocketPose | null;
  tolerance: number;
}): void {
  if (!import.meta.env.DEV || !livePose || !sampledPose) return;
  const distance = livePose.position.distanceTo(sampledPose.position);
  if (distance <= tolerance) return;

  loggers.viewmodel.warn('live socket diverged from sampled pose', {
    abilityId,
    socketName: livePose.socketName,
    distance,
    livePosition: {
      x: livePose.position.x,
      y: livePose.position.y,
      z: livePose.position.z,
    },
    sampledPosition: {
      x: sampledPose.position.x,
      y: sampledPose.position.y,
      z: sampledPose.position.z,
    },
  });
}

function readLocalViewmodelOrigin(
  abilityId: string,
  socketNames: readonly string[],
  options: Pick<ResolveAbilitySocketOriginOptions, 'sampledContext' | 'preferSampled' | 'warnOnSampleDrift' | 'driftTolerance'>
): ResolvedAbilitySocketOrigin | null {
  let livePose: ViewmodelSocketPose | null = null;
  let sampledPose: ViewmodelSocketPose | null = null;

  for (const socketName of socketNames) {
    if (!livePose) livePose = readViewmodelSocket(socketName);
    if (!sampledPose && options.sampledContext) {
      sampledPose = sampleViewmodelPose(socketName, options.sampledContext);
    }
    if (livePose || sampledPose) break;
  }

  if (options.warnOnSampleDrift) {
    warnIfDrifted({
      abilityId,
      livePose,
      sampledPose,
      tolerance: options.driftTolerance ?? 0.08,
    });
  }

  if (options.preferSampled && sampledPose) {
    return fromViewmodelPose(abilityId, sampledPose, 'sampledViewmodel');
  }
  if (livePose) {
    return fromViewmodelPose(abilityId, livePose, 'localViewmodel');
  }
  if (sampledPose) {
    return fromViewmodelPose(abilityId, sampledPose, 'sampledViewmodel');
  }
  return null;
}

function readFallbackOrigin(
  abilityId: string,
  side: ModelSide | undefined,
  fallback: AbilitySocketFallbackContext | undefined
): ResolvedAbilitySocketOrigin | null {
  if (!fallback) return null;
  const position = calculateAbilityFallbackSocketOrigin(
    fallback.position,
    fallback.yaw,
    { abilityId, side }
  );
  if (!position) return null;

  return {
    abilityId,
    socketName: `${abilityId}:fallback`,
    source: 'fallback',
    position: new THREE.Vector3(position.x, position.y, position.z),
    quaternion: fallbackQuaternion.clone(),
    timestampMs: nowMs(),
    revision: 0,
  };
}

export function resolveAbilitySocketOrigin(
  options: ResolveAbilitySocketOriginOptions
): ResolvedAbilitySocketOrigin | null {
  const resolved = resolveAbilitySocket({
    abilityId: options.abilityId,
    side: options.side,
  });
  if (!resolved) {
    return readFallbackOrigin(options.abilityId, options.side, options.fallback);
  }

  if (options.ownerScope === 'localViewmodel') {
    return readLocalViewmodelOrigin(options.abilityId, resolved.socketNames, options)
      ?? readFallbackOrigin(options.abilityId, options.side, options.fallback);
  }

  if (options.ownerScope === 'remoteBody' && options.playerId) {
    const remotePose = readRemoteModelSocketAny(options.playerId, resolved.socketNames);
    if (remotePose) return fromRemotePose(options.abilityId, remotePose);
  }

  return readFallbackOrigin(options.abilityId, options.side, options.fallback);
}

export function writeAbilitySocketOrigin(
  out: { x: number; y: number; z: number },
  options: ResolveAbilitySocketOriginOptions
): boolean {
  const origin = resolveAbilitySocketOrigin(options);
  if (!origin) return false;

  out.x = origin.position.x;
  out.y = origin.position.y;
  out.z = origin.position.z;
  return true;
}
