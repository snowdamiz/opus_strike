import * as THREE from 'three';
import type {
  BattleRoyalDropPlayerSnapshot,
  BattleRoyalDropSnapshot,
} from '@voxel-strike/shared';

const DROP_SHIP_CAMERA_DISTANCE = 44;
const DROP_SHIP_CAMERA_HEIGHT = 18;
const DROP_SHIP_CAMERA_LOOK_AHEAD = 7;
const DROP_POD_CAMERA_DISTANCE = 13;
const DROP_POD_CAMERA_HEIGHT = 2.4;
const DROP_POD_CAMERA_LOOK_AHEAD = 6;
const DROP_POD_CAMERA_MAX_UP_PITCH = 0.35;
const DEPLOYMENT_CAMERA_LERP = 14;

export type BattleRoyalDeploymentCameraMode = 'ship' | 'pod';

export interface BattleRoyalDeploymentCameraTarget {
  mode: BattleRoyalDeploymentCameraMode;
  position: THREE.Vector3;
  yaw: number;
}

export function clampDropProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getBattleRoyalDropShipProgress(
  drop: BattleRoyalDropSnapshot,
  now: number
): number {
  return clampDropProgress((now - drop.ship.startedAt) / Math.max(1, drop.ship.endsAt - drop.ship.startedAt));
}

export function writeBattleRoyalDropShipPosition(
  drop: BattleRoyalDropSnapshot,
  now: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const progress = getBattleRoyalDropShipProgress(drop, now);
  return target.set(
    THREE.MathUtils.lerp(drop.ship.start.x, drop.ship.end.x, progress),
    THREE.MathUtils.lerp(drop.ship.start.y, drop.ship.end.y, progress),
    THREE.MathUtils.lerp(drop.ship.start.z, drop.ship.end.z, progress)
  );
}

export function getBattleRoyalDropShipYaw(drop: BattleRoyalDropSnapshot): number {
  return Math.atan2(
    drop.ship.end.x - drop.ship.start.x,
    drop.ship.end.z - drop.ship.start.z
  );
}

function writeShipForwardFromYaw(yaw: number, target: THREE.Vector3): THREE.Vector3 {
  return target.set(Math.sin(yaw), 0, Math.cos(yaw));
}

function writeViewForwardFromYaw(yaw: number, target: THREE.Vector3): THREE.Vector3 {
  return target.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function writeViewForwardFromYawPitch(
  yaw: number,
  pitch: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  return target.set(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch
  ).normalize();
}

export function writeBattleRoyalDropPlayerSnapshotPosition(
  snapshot: BattleRoyalDropPlayerSnapshot,
  target: THREE.Vector3
): THREE.Vector3 {
  return target.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
}

export function getBattleRoyalDropPodYaw(snapshot: BattleRoyalDropPlayerSnapshot): number {
  const horizontalSpeedSq = snapshot.velocity.x * snapshot.velocity.x + snapshot.velocity.z * snapshot.velocity.z;
  if (horizontalSpeedSq <= 0.0001) return 0;
  return Math.atan2(snapshot.velocity.x, snapshot.velocity.z);
}

export function findBattleRoyalDropPlayer(
  drop: BattleRoyalDropSnapshot | null | undefined,
  playerId: string | null | undefined
): BattleRoyalDropPlayerSnapshot | null {
  if (!drop || !playerId) return null;
  return drop.players.find((player) => player.playerId === playerId) ?? null;
}

export function writeBattleRoyalDeploymentCameraTarget(input: {
  drop: BattleRoyalDropSnapshot;
  playerId: string;
  now: number;
  livePodPosition?: THREE.Vector3;
  target: BattleRoyalDeploymentCameraTarget;
}): BattleRoyalDeploymentCameraTarget {
  const dropPlayer = findBattleRoyalDropPlayer(input.drop, input.playerId);
  if (!dropPlayer || dropPlayer.status === 'aboard') {
    input.target.mode = 'ship';
    writeBattleRoyalDropShipPosition(input.drop, input.now, input.target.position);
    input.target.yaw = getBattleRoyalDropShipYaw(input.drop);
    return input.target;
  }

  if (input.livePodPosition) {
    input.target.position.copy(input.livePodPosition);
  } else {
    writeBattleRoyalDropPlayerSnapshotPosition(dropPlayer, input.target.position);
  }
  input.target.yaw = dropPlayer.status === 'landed'
    ? input.target.yaw
    : getBattleRoyalDropPodYaw(dropPlayer);
  input.target.mode = 'pod';
  return input.target;
}

export function applyBattleRoyalDeploymentCamera(input: {
  camera: THREE.Camera;
  currentPosition: THREE.Vector3;
  lookTarget: THREE.Vector3;
  cameraTarget: BattleRoyalDeploymentCameraTarget;
  localYaw: number;
  localPitch: number;
  delta: number;
}): void {
  const { cameraTarget } = input;
  const distance = cameraTarget.mode === 'ship' ? DROP_SHIP_CAMERA_DISTANCE : DROP_POD_CAMERA_DISTANCE;
  const lookAhead = cameraTarget.mode === 'ship' ? DROP_SHIP_CAMERA_LOOK_AHEAD : DROP_POD_CAMERA_LOOK_AHEAD;
  const forward = cameraTarget.mode === 'ship'
    ? writeShipForwardFromYaw(cameraTarget.yaw, input.lookTarget)
    : writeViewForwardFromYawPitch(input.localYaw, input.localPitch, input.lookTarget);

  if (cameraTarget.mode === 'ship') {
    input.currentPosition.set(
      cameraTarget.position.x - forward.x * distance,
      cameraTarget.position.y + DROP_SHIP_CAMERA_HEIGHT,
      cameraTarget.position.z - forward.z * distance
    );
  } else {
    const cameraPitch = Math.min(input.localPitch, DROP_POD_CAMERA_MAX_UP_PITCH);
    const cameraForward = writeViewForwardFromYawPitch(input.localYaw, cameraPitch, input.currentPosition);
    input.currentPosition.set(
      cameraTarget.position.x - cameraForward.x * distance,
      cameraTarget.position.y - cameraForward.y * distance + DROP_POD_CAMERA_HEIGHT,
      cameraTarget.position.z - cameraForward.z * distance
    );
  }
  input.lookTarget.set(
    cameraTarget.position.x + forward.x * lookAhead,
    cameraTarget.position.y + forward.y * lookAhead,
    cameraTarget.position.z + forward.z * lookAhead
  );

  const smoothing = 1 - Math.exp(-DEPLOYMENT_CAMERA_LERP * input.delta);
  input.camera.position.lerp(input.currentPosition, smoothing);
  input.camera.lookAt(input.lookTarget);
}
