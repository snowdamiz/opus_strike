import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  clampToBoundaryPolygon,
  getClosestBoundaryPoint,
  isInsideBoundaryPolygon,
  type Player,
  type Vec3,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { useStreamerStore } from '../../store/streamerStore';
import { visualStore } from '../../store/visualStore';
import {
  checkGroundWithNormal,
  createRaycastDirectionHitResult,
  getActiveProceduralMap,
  raycastDirectionInto,
} from '../../hooks/usePhysics';
import { getVisiblePlayerHeight } from './playerWorldAnchors';

export type StreamerCameraShotKind =
  | 'first_person'
  | 'close_chase'
  | 'chase'
  | 'side_track'
  | 'orbit'
  | 'crane'
  | 'aerial';
export type StreamerCameraMode = 'directed' | 'fixed_aerial';

export interface StreamerCameraSelectablePlayer {
  id: string;
  role?: string | null;
  state?: string | null;
  isBot?: boolean | null;
  health?: number | null;
  maxHealth?: number | null;
  position: Pick<Vec3, 'x' | 'y' | 'z'>;
}

export interface StreamerCameraSelection {
  targetId: string | null;
  shotKind: StreamerCameraShotKind;
}

interface StreamerCameraShot extends StreamerCameraSelection {
  startedAt: number;
  duration: number;
  orbitAngle: number;
  anchorPosition: THREE.Vector3;
  entryLookAt: THREE.Vector3;
  entryPosition: THREE.Vector3;
  patrolRadius: number;
  patrolAngularSpeed: number;
  followSide: number;
  transitionDuration: number;
}

interface CameraPlacementScratch {
  baseOffset: THREE.Vector3;
  basePosition: THREE.Vector3;
  bestPosition: THREE.Vector3;
  candidatePosition: THREE.Vector3;
  rotatedOffset: THREE.Vector3;
  rayHit: ReturnType<typeof createRaycastDirectionHitResult>;
}

const SHOT_DURATION_SECONDS = 8.4;
const FIXED_AERIAL_PATROL_DURATION_SECONDS = 15;
const FIXED_AERIAL_CHASE_DURATION_SECONDS = 10.5;
const TARGET_RESELECT_GRACE_SECONDS = 1.2;
const CAMERA_POSITION_SMOOTHING = 2.7;
const CAMERA_LOOK_SMOOTHING = 4.8;
const FIXED_AERIAL_PATROL_POSITION_SMOOTHING = 0.85;
const FIXED_AERIAL_PATROL_LOOK_SMOOTHING = 1.45;
const FIXED_AERIAL_CHASE_POSITION_SMOOTHING = 1.9;
const FIXED_AERIAL_CHASE_LOOK_SMOOTHING = 2.35;
const FIRST_PERSON_POSITION_SMOOTHING = 14;
const FIRST_PERSON_LOOK_SMOOTHING = 18;
const CLOSE_CHASE_POSITION_SMOOTHING = 6.4;
const CLOSE_CHASE_LOOK_SMOOTHING = 7.2;
const SIDE_TRACK_POSITION_SMOOTHING = 4.2;
const SIDE_TRACK_LOOK_SMOOTHING = 5.6;
const CRANE_POSITION_SMOOTHING = 2.35;
const CRANE_LOOK_SMOOTHING = 3.4;
const FOLLOW_DIRECTION_SMOOTHING = 0.9;
const PLAYER_FORWARD_DISTANCE = 9;
const FIXED_AERIAL_BOUNDARY_PADDING = 11;
const FIXED_AERIAL_PATROL_HEIGHT = 16;
const FIXED_AERIAL_PATROL_GROUND_CLEARANCE = 9;
const FIXED_AERIAL_CHASE_GROUND_CLEARANCE = 7;
const FIXED_AERIAL_CHASE_DISTANCE = 6.6;
const FIXED_AERIAL_CHASE_TERRAIN_SAMPLE_RADIUS = 24;
const FIXED_AERIAL_PATROL_TERRAIN_SAMPLE_RADIUS = 10;
const STREAMER_CAMERA_TERRAIN_PADDING = 3.2;
const STREAMER_CAMERA_SIDEWALL_LIFT = 7.5;
const STREAMER_FOLLOW_WALL_CLEARANCE = 15;
const FALLBACK_MAP_CENTER = new THREE.Vector3(0, 2, 0);
const FOLLOW_CAMERA_ANGLE_CANDIDATES = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (Math.PI * 3) / 4,
  (-Math.PI * 3) / 4,
  Math.PI,
] as const;
const FOLLOW_CAMERA_HEIGHT_BOOSTS = [0, 6.5] as const;

function isCombatCameraCandidate(player: StreamerCameraSelectablePlayer): boolean {
  if (player.role === 'observer') return false;
  if (player.state === 'dead') return false;
  return player.state === 'alive' ||
    player.state === 'downed' ||
    player.state === 'spawning' ||
    player.state === 'dropping' ||
    player.state === 'selecting';
}

function playerScore(player: StreamerCameraSelectablePlayer, previousTargetId: string | null): number {
  let score = 0;
  if (player.state === 'alive') score += 100;
  if (player.state === 'downed') score += 72;
  if (player.state === 'dropping' || player.state === 'spawning') score += 56;
  if (!player.isBot) score += 34;
  if (player.id === previousTargetId) score -= 72;

  const maxHealth = typeof player.maxHealth === 'number' && player.maxHealth > 0 ? player.maxHealth : 100;
  const health = typeof player.health === 'number' ? player.health : maxHealth;
  const danger = 1 - Math.min(1, Math.max(0, health / maxHealth));
  score += danger * 24;

  return score;
}

function hashShotIndex(seed: number, playerId: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < playerId.length; index++) {
    hash = Math.imul(hash ^ playerId.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

export function selectStreamerCameraShot(input: {
  players: Iterable<StreamerCameraSelectablePlayer>;
  previousTargetId?: string | null;
  shotIndex: number;
  cameraMode?: StreamerCameraMode;
}): StreamerCameraSelection {
  const candidates = Array.from(input.players).filter(isCombatCameraCandidate);

  if (input.cameraMode === 'fixed_aerial') {
    const fixedShotPhase = Math.abs(input.shotIndex) % 5;
    const shouldFollowPlayer = candidates.length > 0 && fixedShotPhase !== 0;
    if (shouldFollowPlayer) {
      candidates.sort((a, b) => {
        const scoreDelta = playerScore(b, input.previousTargetId ?? null) - playerScore(a, input.previousTargetId ?? null);
        if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
        return a.id.localeCompare(b.id);
      });
      const windowSize = Math.min(4, candidates.length);
      const target = candidates[Math.floor(Math.abs(input.shotIndex) / 5) % windowSize] ?? candidates[0];
      const shotKind: StreamerCameraShotKind = fixedShotPhase === 1
        ? 'close_chase'
        : fixedShotPhase === 2
          ? 'side_track'
          : fixedShotPhase === 3
            ? 'chase'
            : 'crane';
      return { targetId: target.id, shotKind };
    }

    return { targetId: null, shotKind: 'aerial' };
  }

  if (candidates.length === 0) {
    return { targetId: null, shotKind: 'aerial' };
  }

  candidates.sort((a, b) => {
    const scoreDelta = playerScore(b, input.previousTargetId ?? null) - playerScore(a, input.previousTargetId ?? null);
    if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
    return a.id.localeCompare(b.id);
  });

  const windowSize = Math.min(4, candidates.length);
  const target = candidates[Math.abs(input.shotIndex) % windowSize] ?? candidates[0];
  const shotRoll = hashShotIndex(input.shotIndex, target.id) % 12;
  const shotKind: StreamerCameraShotKind = shotRoll === 0
    ? 'first_person'
    : shotRoll <= 4
      ? 'close_chase'
      : shotRoll <= 6
        ? 'chase'
        : shotRoll === 7
          ? 'side_track'
          : shotRoll === 8
            ? 'orbit'
            : shotRoll === 9
              ? 'crane'
              : 'aerial';

  return { targetId: target.id, shotKind };
}

function smoothingAlpha(rate: number, delta: number): number {
  return Math.min(1, Math.max(0, 1 - Math.exp(-rate * delta)));
}

function smoothstep01(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function copyPlayerPosition(target: THREE.Vector3, player: Player): THREE.Vector3 {
  const visualPosition = visualStore.getState().renderedPlayerPositions.get(player.id) ??
    visualStore.getState().playerPositions.get(player.id);
  const position = visualPosition ?? player.position;
  return target.set(position.x, position.y, position.z);
}

function getPlayerForward(target: THREE.Vector3, player: Player): THREE.Vector3 {
  const visualYaw = visualStore.getState().renderedPlayerRotations.get(player.id) ??
    visualStore.getState().playerRotations.get(player.id);
  const yaw = visualYaw ?? player.lookYaw ?? 0;
  return target.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

function getPlayerMotionForward(
  target: THREE.Vector3,
  player: Player,
  fallbackForward: THREE.Vector3
): THREE.Vector3 {
  const velocity = player.velocity;
  const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
  if (speedSq > 0.18 * 0.18) {
    return target.set(velocity.x, 0, velocity.z).normalize();
  }

  return target.copy(fallbackForward);
}

export function selectStreamerCameraLookLeadDirection(
  shotKind: StreamerCameraShotKind,
  viewForward: THREE.Vector3,
  followForward: THREE.Vector3
): THREE.Vector3 {
  return shotKind === 'first_person' ? viewForward : followForward;
}

function getPlayersCenter(players: Iterable<Player>, target: THREE.Vector3): THREE.Vector3 {
  target.set(0, 0, 0);
  let count = 0;
  const visualState = visualStore.getState();
  for (const player of players) {
    if (!isCombatCameraCandidate(player)) continue;
    const visualPosition = visualState.renderedPlayerPositions.get(player.id) ??
      visualState.playerPositions.get(player.id);
    const position = visualPosition ?? player.position;
    target.x += position.x;
    target.y += position.y;
    target.z += position.z;
    count++;
  }

  if (count === 0) return target.copy(FALLBACK_MAP_CENTER);
  return target.multiplyScalar(1 / count);
}

function getFixedAerialShotDuration(selection: StreamerCameraSelection): number {
  return selection.shotKind !== 'aerial'
    ? FIXED_AERIAL_CHASE_DURATION_SECONDS
    : FIXED_AERIAL_PATROL_DURATION_SECONDS;
}

function getStreamerShotDuration(selection: StreamerCameraSelection, cameraMode: StreamerCameraMode): number {
  return cameraMode === 'fixed_aerial'
    ? getFixedAerialShotDuration(selection)
    : SHOT_DURATION_SECONDS;
}

function getShotTransitionDuration(selection: StreamerCameraSelection, cameraMode: StreamerCameraMode): number {
  if (selection.shotKind === 'first_person') return 0.75;
  if (selection.shotKind === 'close_chase') return cameraMode === 'fixed_aerial' ? 1.15 : 1.05;
  if (selection.shotKind === 'side_track') return 1.35;
  if (selection.shotKind === 'crane') return 1.8;
  if (selection.shotKind === 'aerial') return 2.2;
  return 1.25;
}

function createStreamerCameraShot(input: {
  selection: StreamerCameraSelection;
  cameraMode: StreamerCameraMode;
  players: Iterable<Player>;
  now: number;
  shotIndex: number;
  center: THREE.Vector3;
}): StreamerCameraShot {
  const anchorPosition = getPlayersCenter(input.players, input.center).clone();
  const shotSeed = Math.abs(input.shotIndex);
  return {
    ...input.selection,
    startedAt: input.now,
    duration: getStreamerShotDuration(input.selection, input.cameraMode),
    orbitAngle: (shotSeed * Math.PI * 0.73) % (Math.PI * 2),
    anchorPosition,
    entryLookAt: input.center.clone(),
    entryPosition: anchorPosition.clone(),
    patrolRadius: 14 + (shotSeed % 4) * 3,
    patrolAngularSpeed: 0.105 + (shotSeed % 3) * 0.018,
    followSide: shotSeed % 2 === 0 ? 1 : -1,
    transitionDuration: getShotTransitionDuration(input.selection, input.cameraMode),
  };
}

function distanceToBoundary(x: number, z: number, manifest: VoxelMapManifest): number {
  if (manifest.boundary.length < 3) return Number.POSITIVE_INFINITY;
  const closest = getClosestBoundaryPoint(x, z, manifest.boundary).point;
  return Math.hypot(x - closest.x, z - closest.z);
}

function clampVectorToPlayableBoundary(
  position: THREE.Vector3,
  manifest: VoxelMapManifest,
  padding = FIXED_AERIAL_BOUNDARY_PADDING
): void {
  if (manifest.boundary.length < 3) return;

  const clamped = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);
  position.x = clamped.x;
  position.z = clamped.z;

  if (distanceToBoundary(position.x, position.z, manifest) >= padding) return;

  const { point: closest, normal } = getClosestBoundaryPoint(position.x, position.z, manifest.boundary);
  const inset = {
    x: closest.x + normal.x * padding,
    z: closest.z + normal.z * padding,
  };

  if (isInsideBoundaryPolygon(inset.x, inset.z, manifest.boundary)) {
    position.x = inset.x;
    position.z = inset.z;
  }
}

function getHeightfieldTerrainY(manifest: VoxelMapManifest, x: number, z: number): number | null {
  const { heightfield } = manifest;
  const gridX = Math.floor((x - heightfield.origin.x) / heightfield.voxelSize.x);
  const gridZ = Math.floor((z - heightfield.origin.z) / heightfield.voxelSize.z);
  if (gridX < 0 || gridZ < 0 || gridX >= heightfield.size.x || gridZ >= heightfield.size.z) {
    return null;
  }

  const row = heightfield.topSolidRows[gridX + gridZ * heightfield.size.x] ?? 0;
  if (row <= 0) return null;
  return heightfield.origin.y + row * heightfield.voxelSize.y;
}

function getMaxTerrainYNear(
  manifest: VoxelMapManifest,
  x: number,
  z: number,
  radius: number
): number | null {
  const step = Math.max(manifest.voxelSize.x, manifest.voxelSize.z, 2);
  let maxY: number | null = null;

  for (let offsetX = -radius; offsetX <= radius + 0.001; offsetX += step) {
    for (let offsetZ = -radius; offsetZ <= radius + 0.001; offsetZ += step) {
      if (offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
      const sampleX = x + offsetX;
      const sampleZ = z + offsetZ;
      if (manifest.boundary.length >= 3 && !isInsideBoundaryPolygon(sampleX, sampleZ, manifest.boundary)) {
        continue;
      }
      const y = getHeightfieldTerrainY(manifest, sampleX, sampleZ);
      if (y === null) continue;
      maxY = maxY === null ? y : Math.max(maxY, y);
    }
  }

  return maxY;
}

function keepCameraAboveHeightfield(
  desiredPosition: THREE.Vector3,
  focusPosition: THREE.Vector3,
  minGroundClearance: number,
  manifest: VoxelMapManifest,
  sampleRadius: number
): void {
  const maxTerrainY = getMaxTerrainYNear(manifest, desiredPosition.x, desiredPosition.z, sampleRadius);
  const focusMaxTerrainY = getMaxTerrainYNear(manifest, focusPosition.x, focusPosition.z, sampleRadius);
  const terrainY = maxTerrainY === null
    ? focusMaxTerrainY
    : focusMaxTerrainY === null
      ? maxTerrainY
      : Math.max(maxTerrainY, focusMaxTerrainY);
  if (terrainY !== null) {
    desiredPosition.y = Math.max(desiredPosition.y, terrainY + minGroundClearance);
  }
}

function keepCameraAboveGround(
  desiredPosition: THREE.Vector3,
  focusPosition: THREE.Vector3,
  minGroundClearance: number,
  manifest: VoxelMapManifest | null,
  sampleRadius: number
): void {
  if (manifest) {
    keepCameraAboveHeightfield(desiredPosition, focusPosition, minGroundClearance, manifest, sampleRadius);
  }

  const ground = checkGroundWithNormal(
    desiredPosition.x,
    desiredPosition.y + 80,
    desiredPosition.z,
    150,
    { priority: 'visual', feature: 'streamer-camera-ground' }
  );
  if (!ground) return;
  desiredPosition.y = Math.max(desiredPosition.y, ground.groundY + minGroundClearance);
}

function getBoundaryPaddingForShot(shotKind: StreamerCameraShotKind, cameraMode: StreamerCameraMode): number {
  if (cameraMode === 'fixed_aerial') return FIXED_AERIAL_BOUNDARY_PADDING;
  if (shotKind === 'close_chase') return 5.5;
  if (shotKind === 'chase') return 7;
  if (shotKind === 'side_track' || shotKind === 'orbit') return 8.5;
  return 10.5;
}

function getGroundClearanceForShot(shotKind: StreamerCameraShotKind, cameraMode: StreamerCameraMode): number {
  if (cameraMode === 'fixed_aerial') {
    return shotKind === 'aerial'
      ? FIXED_AERIAL_PATROL_GROUND_CLEARANCE
      : FIXED_AERIAL_CHASE_GROUND_CLEARANCE;
  }

  if (shotKind === 'close_chase') return 2.2;
  if (shotKind === 'chase' || shotKind === 'side_track') return 3.2;
  if (shotKind === 'orbit') return 3.8;
  if (shotKind === 'crane') return 5.2;
  return 6.4;
}

function getTerrainSampleRadiusForShot(shotKind: StreamerCameraShotKind, cameraMode: StreamerCameraMode): number {
  if (cameraMode === 'fixed_aerial') {
    return shotKind === 'aerial'
      ? FIXED_AERIAL_PATROL_TERRAIN_SAMPLE_RADIUS
      : FIXED_AERIAL_CHASE_TERRAIN_SAMPLE_RADIUS;
  }

  if (shotKind === 'close_chase') return 7;
  if (shotKind === 'chase') return 10;
  if (shotKind === 'side_track' || shotKind === 'orbit') return 13;
  return 18;
}

function getPositionSmoothingForShot(shotKind: StreamerCameraShotKind, cameraMode: StreamerCameraMode): number {
  if (shotKind === 'first_person') return FIRST_PERSON_POSITION_SMOOTHING;
  if (shotKind === 'close_chase') return CLOSE_CHASE_POSITION_SMOOTHING;
  if (shotKind === 'side_track') return SIDE_TRACK_POSITION_SMOOTHING;
  if (shotKind === 'crane') return CRANE_POSITION_SMOOTHING;
  if (cameraMode === 'fixed_aerial') {
    return shotKind === 'chase'
      ? FIXED_AERIAL_CHASE_POSITION_SMOOTHING
      : FIXED_AERIAL_PATROL_POSITION_SMOOTHING;
  }
  return CAMERA_POSITION_SMOOTHING;
}

function getLookSmoothingForShot(shotKind: StreamerCameraShotKind, cameraMode: StreamerCameraMode): number {
  if (shotKind === 'first_person') return FIRST_PERSON_LOOK_SMOOTHING;
  if (shotKind === 'close_chase') return CLOSE_CHASE_LOOK_SMOOTHING;
  if (shotKind === 'side_track') return SIDE_TRACK_LOOK_SMOOTHING;
  if (shotKind === 'crane') return CRANE_LOOK_SMOOTHING;
  if (cameraMode === 'fixed_aerial') {
    return shotKind === 'chase'
      ? FIXED_AERIAL_CHASE_LOOK_SMOOTHING
      : FIXED_AERIAL_PATROL_LOOK_SMOOTHING;
  }
  return CAMERA_LOOK_SMOOTHING;
}

function pullCameraAwayFromBoundarySidewalls(
  desiredPosition: THREE.Vector3,
  focusPosition: THREE.Vector3,
  manifest: VoxelMapManifest,
  padding: number
): void {
  if (manifest.boundary.length < 3) return;

  const boundaryDistance = distanceToBoundary(desiredPosition.x, desiredPosition.z, manifest);
  const pressureRange = padding * 1.15;
  if (boundaryDistance >= pressureRange) return;

  const pressure = smoothstep01(1 - boundaryDistance / pressureRange);
  const horizontalScale = Math.max(0.52, 1 - pressure * 0.38);
  desiredPosition.x = focusPosition.x + (desiredPosition.x - focusPosition.x) * horizontalScale;
  desiredPosition.z = focusPosition.z + (desiredPosition.z - focusPosition.z) * horizontalScale;
  desiredPosition.y += pressure * STREAMER_CAMERA_SIDEWALL_LIFT;

  const { point: closest, normal } = getClosestBoundaryPoint(desiredPosition.x, desiredPosition.z, manifest.boundary);
  const inset = {
    x: closest.x + normal.x * padding,
    z: closest.z + normal.z * padding,
  };

  if (isInsideBoundaryPolygon(inset.x, inset.z, manifest.boundary)) {
    desiredPosition.x = THREE.MathUtils.lerp(desiredPosition.x, inset.x, pressure * 0.35);
    desiredPosition.z = THREE.MathUtils.lerp(desiredPosition.z, inset.z, pressure * 0.35);
  }
}

function isHeroFollowShot(shotKind: StreamerCameraShotKind): boolean {
  return shotKind === 'close_chase' ||
    shotKind === 'chase' ||
    shotKind === 'side_track' ||
    shotKind === 'crane';
}

function isCameraObstructed(
  focusPosition: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  hitResult: ReturnType<typeof createRaycastDirectionHitResult>
): boolean {
  const anchorX = focusPosition.x;
  const anchorY = focusPosition.y + 0.9;
  const anchorZ = focusPosition.z;
  const directionX = cameraPosition.x - anchorX;
  const directionY = cameraPosition.y - anchorY;
  const directionZ = cameraPosition.z - anchorZ;
  const desiredDistance = Math.hypot(directionX, directionY, directionZ);
  if (desiredDistance <= 0.001) return false;

  return raycastDirectionInto(
    hitResult,
    anchorX,
    anchorY,
    anchorZ,
    directionX / desiredDistance,
    directionY / desiredDistance,
    directionZ / desiredDistance,
    desiredDistance,
    { priority: 'visual', feature: 'streamer-camera-obstruction' }
  ) && hitResult.distance < desiredDistance - STREAMER_CAMERA_TERRAIN_PADDING;
}

function applyCameraTerrainAvoidance(input: {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  shotKind: StreamerCameraShotKind;
  cameraMode: StreamerCameraMode;
  manifest: VoxelMapManifest | null;
  terrainAnchor: THREE.Vector3;
  terrainDirection: THREE.Vector3;
  terrainHit: ReturnType<typeof createRaycastDirectionHitResult>;
}): void {
  const boundaryPadding = getBoundaryPaddingForShot(input.shotKind, input.cameraMode);
  if (input.manifest) {
    clampVectorToPlayableBoundary(input.position, input.manifest, boundaryPadding);
    pullCameraAwayFromBoundarySidewalls(input.position, input.lookAt, input.manifest, boundaryPadding);
  }

  const terrainAnchor = input.terrainAnchor.copy(input.lookAt);
  terrainAnchor.y += 0.9;
  const terrainDirection = input.terrainDirection.copy(input.position).sub(terrainAnchor);
  const desiredDistance = terrainDirection.length();
  if (desiredDistance > 0.001) {
    terrainDirection.multiplyScalar(1 / desiredDistance);
    if (
      raycastDirectionInto(
        input.terrainHit,
        terrainAnchor.x,
        terrainAnchor.y,
        terrainAnchor.z,
        terrainDirection.x,
        terrainDirection.y,
        terrainDirection.z,
        desiredDistance,
        { priority: 'visual', feature: 'streamer-camera-obstruction' }
      ) &&
      input.terrainHit.distance < desiredDistance - STREAMER_CAMERA_TERRAIN_PADDING
    ) {
      const safeDistance = Math.max(1.5, input.terrainHit.distance - STREAMER_CAMERA_TERRAIN_PADDING);
      input.position.copy(terrainAnchor).addScaledVector(terrainDirection, safeDistance);
      input.position.x += input.terrainHit.normal.x * STREAMER_CAMERA_TERRAIN_PADDING;
      input.position.y += Math.max(0.55, input.terrainHit.normal.y) * STREAMER_CAMERA_TERRAIN_PADDING * 1.35;
      input.position.z += input.terrainHit.normal.z * STREAMER_CAMERA_TERRAIN_PADDING;
      if (input.terrainHit.normal.y < 0.42) {
        input.position.y += STREAMER_CAMERA_TERRAIN_PADDING * 1.65;
      }
    }
  }

  keepCameraAboveGround(
    input.position,
    input.lookAt,
    getGroundClearanceForShot(input.shotKind, input.cameraMode),
    input.manifest,
    getTerrainSampleRadiusForShot(input.shotKind, input.cameraMode)
  );

  if (input.manifest) {
    clampVectorToPlayableBoundary(input.position, input.manifest, boundaryPadding);
    pullCameraAwayFromBoundarySidewalls(input.position, input.lookAt, input.manifest, boundaryPadding);
  }
}

function resolveHeroFollowCameraPlacement(input: {
  desiredPosition: THREE.Vector3;
  desiredLookAt: THREE.Vector3;
  shotKind: StreamerCameraShotKind;
  cameraMode: StreamerCameraMode;
  manifest: VoxelMapManifest;
  scratch: CameraPlacementScratch;
}): void {
  if (!isHeroFollowShot(input.shotKind)) return;

  const minClearance = Math.max(
    STREAMER_FOLLOW_WALL_CLEARANCE,
    getBoundaryPaddingForShot(input.shotKind, input.cameraMode) + 4
  );
  const hasBoundaryRoom = distanceToBoundary(input.desiredPosition.x, input.desiredPosition.z, input.manifest) >= minClearance;
  const hasObstruction = isCameraObstructed(input.desiredLookAt, input.desiredPosition, input.scratch.rayHit);
  if (hasBoundaryRoom && !hasObstruction) return;

  input.scratch.basePosition.copy(input.desiredPosition);
  input.scratch.bestPosition.copy(input.desiredPosition);
  input.scratch.baseOffset.copy(input.desiredPosition).sub(input.desiredLookAt);
  const baseHeight = input.scratch.baseOffset.y;
  input.scratch.baseOffset.y = 0;
  const baseDistance = input.scratch.baseOffset.length();
  if (baseDistance <= 0.001) return;

  const groundClearance = getGroundClearanceForShot(input.shotKind, input.cameraMode) + 1.2;
  const sampleRadius = getTerrainSampleRadiusForShot(input.shotKind, input.cameraMode);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let heightIndex = 0; heightIndex < FOLLOW_CAMERA_HEIGHT_BOOSTS.length; heightIndex++) {
    const heightBoost = FOLLOW_CAMERA_HEIGHT_BOOSTS[heightIndex];
    for (let angleIndex = 0; angleIndex < FOLLOW_CAMERA_ANGLE_CANDIDATES.length; angleIndex++) {
      const angle = FOLLOW_CAMERA_ANGLE_CANDIDATES[angleIndex];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      input.scratch.rotatedOffset.set(
        input.scratch.baseOffset.x * cos - input.scratch.baseOffset.z * sin,
        0,
        input.scratch.baseOffset.x * sin + input.scratch.baseOffset.z * cos
      );

      const candidate = input.scratch.candidatePosition.copy(input.desiredLookAt)
        .add(input.scratch.rotatedOffset);
      candidate.y = input.desiredLookAt.y + baseHeight + heightBoost;
      clampVectorToPlayableBoundary(candidate, input.manifest, minClearance);
      pullCameraAwayFromBoundarySidewalls(candidate, input.desiredLookAt, input.manifest, minClearance);
      keepCameraAboveHeightfield(candidate, input.desiredLookAt, groundClearance, input.manifest, sampleRadius);

      const boundaryDistance = distanceToBoundary(candidate.x, candidate.z, input.manifest);
      const distanceDelta = Math.abs(candidate.distanceTo(input.desiredLookAt) - baseDistance);
      let score = candidate.distanceToSquared(input.scratch.basePosition) * 0.025 +
        distanceDelta * 0.85 +
        angleIndex * 0.18 +
        heightIndex * 0.75;

      if (!isInsideBoundaryPolygon(candidate.x, candidate.z, input.manifest.boundary)) {
        score += 100_000;
      }
      if (boundaryDistance < minClearance) {
        score += Math.pow(minClearance - boundaryDistance, 2) * 18;
      }
      if (isCameraObstructed(input.desiredLookAt, candidate, input.scratch.rayHit)) {
        score += 20_000 + Math.max(0, minClearance - boundaryDistance) * 30;
      }

      if (score < bestScore) {
        bestScore = score;
        input.scratch.bestPosition.copy(candidate);
      }
    }
  }

  if (Number.isFinite(bestScore)) {
    input.desiredPosition.copy(input.scratch.bestPosition);
  }
}

export function StreamerCameraDirector({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const { players, gamePhase } = useGameStore(
    useShallow((state) => ({
      players: state.players,
      gamePhase: state.gamePhase,
    }))
  );
  const setHiddenFirstPersonTargetId = useStreamerStore((state) => state.setHiddenFirstPersonTargetId);
  const streamerCameraMode = useStreamerStore((state) => state.metadata?.streamerCameraMode ?? 'directed');
  const shotRef = useRef<StreamerCameraShot | null>(null);
  const shotIndexRef = useRef(0);
  const targetPositionRef = useRef(new THREE.Vector3());
  const desiredPositionRef = useRef(new THREE.Vector3(0, 18, 24));
  const desiredLookAtRef = useRef(new THREE.Vector3());
  const smoothedLookAtRef = useRef(new THREE.Vector3());
  const forwardRef = useRef(new THREE.Vector3());
  const motionForwardRef = useRef(new THREE.Vector3());
  const smoothedFollowForwardRef = useRef(new THREE.Vector3(0, 0, -1));
  const rightRef = useRef(new THREE.Vector3());
  const centerRef = useRef(new THREE.Vector3());
  const shotCenterRef = useRef(new THREE.Vector3());
  const terrainAnchorRef = useRef(new THREE.Vector3());
  const terrainDirectionRef = useRef(new THREE.Vector3());
  const terrainHitRef = useRef(createRaycastDirectionHitResult());
  const cameraPlacementScratchRef = useRef<CameraPlacementScratch>({
    baseOffset: new THREE.Vector3(),
    basePosition: new THREE.Vector3(),
    bestPosition: new THREE.Vector3(),
    candidatePosition: new THREE.Vector3(),
    rotatedOffset: new THREE.Vector3(),
    rayHit: createRaycastDirectionHitResult(),
  });
  const didInitializePoseRef = useRef(false);
  const smoothedFollowTargetIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    setHiddenFirstPersonTargetId(null);
  }, [setHiddenFirstPersonTargetId]);

  useEffect(() => {
    shotRef.current = null;
    didInitializePoseRef.current = false;
    smoothedFollowTargetIdRef.current = null;
  }, [streamerCameraMode]);

  useFrame(({ clock }, delta) => {
    if (!enabled) {
      setHiddenFirstPersonTargetId(null);
      didInitializePoseRef.current = false;
      smoothedFollowTargetIdRef.current = null;
      return;
    }

    const now = clock.elapsedTime;
    const currentShot = shotRef.current;
    const currentTarget = currentShot?.targetId ? players.get(currentShot.targetId) ?? null : null;
    const targetStillValid = currentTarget ? isCombatCameraCandidate(currentTarget) : false;
    const forcedAerialMismatch = streamerCameraMode === 'fixed_aerial' &&
      currentShot !== null &&
      (currentShot.shotKind === 'first_person' || currentShot.shotKind === 'orbit');
    const missingTargetExpired = currentShot
      ? Boolean(currentShot.targetId) &&
        !targetStillValid &&
        now - currentShot.startedAt > TARGET_RESELECT_GRACE_SECONDS
      : false;
    const needsShot = !currentShot ||
      forcedAerialMismatch ||
      now - currentShot.startedAt >= currentShot.duration ||
      missingTargetExpired;

    if (needsShot) {
      const selection = selectStreamerCameraShot({
        players: players.values(),
        previousTargetId: currentShot?.targetId ?? null,
        shotIndex: shotIndexRef.current,
        cameraMode: streamerCameraMode,
      });
      const nextShot = createStreamerCameraShot({
        selection,
        cameraMode: streamerCameraMode,
        players: players.values(),
        now,
        shotIndex: shotIndexRef.current,
        center: shotCenterRef.current,
      });
      nextShot.entryPosition.copy(camera.position);
      nextShot.entryLookAt.copy(smoothedLookAtRef.current);
      shotRef.current = nextShot;
      shotIndexRef.current++;
    }

    const shot = shotRef.current;
    if (!shot) return;

    const targetPlayer = shot.targetId ? players.get(shot.targetId) ?? null : null;
    const targetPosition = targetPositionRef.current;
    const desiredPosition = desiredPositionRef.current;
    const desiredLookAt = desiredLookAtRef.current;

    if (targetPlayer) {
      copyPlayerPosition(targetPosition, targetPlayer);
      const visibleHeight = getVisiblePlayerHeight(targetPlayer.heroId, targetPlayer.movement, targetPlayer.state);
      const eyeHeight = Math.max(1.25, visibleHeight - 0.18);
      const viewForward = getPlayerForward(forwardRef.current, targetPlayer);
      const motionForward = getPlayerMotionForward(motionForwardRef.current, targetPlayer, viewForward);
      const followForward = smoothedFollowForwardRef.current;
      if (smoothedFollowTargetIdRef.current !== targetPlayer.id || followForward.lengthSq() < 0.001) {
        followForward.copy(motionForward);
        smoothedFollowTargetIdRef.current = targetPlayer.id;
      } else {
        followForward.lerp(motionForward, smoothingAlpha(FOLLOW_DIRECTION_SMOOTHING, delta)).normalize();
      }
      rightRef.current.set(followForward.z, 0, -followForward.x).normalize();
      const lookLeadForward = selectStreamerCameraLookLeadDirection(shot.shotKind, viewForward, followForward);

      if (shot.shotKind === 'first_person') {
        setHiddenFirstPersonTargetId(targetPlayer.id);
        desiredPosition.copy(targetPosition).addScaledVector(viewForward, 0.24);
        desiredPosition.y += eyeHeight;
        desiredLookAt.copy(desiredPosition).addScaledVector(viewForward, PLAYER_FORWARD_DISTANCE);
        desiredLookAt.y += THREE.MathUtils.clamp(-(targetPlayer.lookPitch ?? 0), -0.6, 0.6) * 2.2;
      } else if (shot.shotKind === 'close_chase') {
        setHiddenFirstPersonTargetId(null);
        const chaseDistance = streamerCameraMode === 'fixed_aerial' ? 4.9 : 4.35;
        const chaseHeight = Math.max(2.55, visibleHeight + (streamerCameraMode === 'fixed_aerial' ? 1.75 : 1.25));
        desiredPosition.copy(targetPosition)
          .addScaledVector(followForward, -chaseDistance)
          .addScaledVector(rightRef.current, 0.82 * shot.followSide)
          .setY(targetPosition.y + chaseHeight);
        desiredLookAt.copy(targetPosition)
          .addScaledVector(lookLeadForward, 1.9)
          .setY(targetPosition.y + visibleHeight * 0.78);
      } else if (shot.shotKind === 'chase') {
        setHiddenFirstPersonTargetId(null);
        const chaseDistance = streamerCameraMode === 'fixed_aerial'
          ? FIXED_AERIAL_CHASE_DISTANCE
          : 7.1;
        const chaseHeight = streamerCameraMode === 'fixed_aerial'
          ? Math.max(4.8, visibleHeight + 3.1)
          : Math.max(3.4, visibleHeight + 2.35);
        const shoulderOffset = streamerCameraMode === 'fixed_aerial'
          ? 1.35 * shot.followSide
          : 1.65 * shot.followSide;
        desiredPosition.copy(targetPosition)
          .addScaledVector(followForward, -chaseDistance)
          .addScaledVector(rightRef.current, shoulderOffset)
          .setY(targetPosition.y + chaseHeight);
        desiredLookAt.copy(targetPosition)
          .addScaledVector(lookLeadForward, streamerCameraMode === 'fixed_aerial' ? 2.35 : 1.2)
          .setY(targetPosition.y + visibleHeight * 0.72);
      } else if (shot.shotKind === 'side_track') {
        setHiddenFirstPersonTargetId(null);
        const sideDistance = streamerCameraMode === 'fixed_aerial' ? 6.8 : 6.2;
        const trailingDistance = streamerCameraMode === 'fixed_aerial' ? 2.8 : 2.1;
        desiredPosition.copy(targetPosition)
          .addScaledVector(followForward, -trailingDistance)
          .addScaledVector(rightRef.current, sideDistance * shot.followSide)
          .setY(targetPosition.y + Math.max(3.4, visibleHeight + 2.1));
        desiredLookAt.copy(targetPosition)
          .addScaledVector(lookLeadForward, 2.2)
          .setY(targetPosition.y + visibleHeight * 0.7);
      } else if (shot.shotKind === 'orbit') {
        setHiddenFirstPersonTargetId(null);
        const orbit = shot.orbitAngle + (now - shot.startedAt) * 0.42;
        desiredPosition.set(
          targetPosition.x + Math.cos(orbit) * 9.5,
          targetPosition.y + Math.max(4.4, visibleHeight + 3.5),
          targetPosition.z + Math.sin(orbit) * 9.5
        );
        desiredLookAt.copy(targetPosition).setY(targetPosition.y + visibleHeight * 0.68);
      } else if (shot.shotKind === 'crane') {
        setHiddenFirstPersonTargetId(null);
        const craneProgress = smoothstep01((now - shot.startedAt) / Math.min(5.4, shot.duration * 0.72));
        const craneDistance = THREE.MathUtils.lerp(16, streamerCameraMode === 'fixed_aerial' ? 7.2 : 6.4, craneProgress);
        const craneHeight = THREE.MathUtils.lerp(13.5, streamerCameraMode === 'fixed_aerial' ? 6.6 : 5.2, craneProgress);
        const craneSide = THREE.MathUtils.lerp(4.8, 1.25, craneProgress) * shot.followSide;
        desiredPosition.copy(targetPosition)
          .addScaledVector(followForward, -craneDistance)
          .addScaledVector(rightRef.current, craneSide)
          .setY(targetPosition.y + Math.max(craneHeight, visibleHeight + 2.9));
        desiredLookAt.copy(targetPosition)
          .addScaledVector(lookLeadForward, THREE.MathUtils.lerp(0, 2, craneProgress))
          .setY(targetPosition.y + visibleHeight * THREE.MathUtils.lerp(0.52, 0.78, craneProgress));
      } else {
        setHiddenFirstPersonTargetId(null);
        if (streamerCameraMode === 'fixed_aerial') {
          const patrolAngle = shot.orbitAngle + (now - shot.startedAt) * shot.patrolAngularSpeed;
          const liveCenter = getPlayersCenter(players.values(), centerRef.current);
          desiredPosition.set(
            shot.anchorPosition.x + Math.cos(patrolAngle) * shot.patrolRadius,
            shot.anchorPosition.y + FIXED_AERIAL_PATROL_HEIGHT,
            shot.anchorPosition.z + Math.sin(patrolAngle) * shot.patrolRadius
          );
          desiredLookAt.copy(liveCenter).setY(liveCenter.y + 2.2);
        } else {
          const center = getPlayersCenter(players.values(), centerRef.current);
          desiredPosition.set(center.x + 18, center.y + 17, center.z + 22);
          desiredLookAt.copy(center).setY(center.y + 1.8);
        }
      }
    } else {
      setHiddenFirstPersonTargetId(null);
      smoothedFollowTargetIdRef.current = null;
      const center = getPlayersCenter(players.values(), centerRef.current);
      if (streamerCameraMode === 'fixed_aerial') {
        const patrolAngle = shot.orbitAngle + (now - shot.startedAt) * shot.patrolAngularSpeed;
        desiredPosition.set(
          shot.anchorPosition.x + Math.cos(patrolAngle) * shot.patrolRadius,
          shot.anchorPosition.y + FIXED_AERIAL_PATROL_HEIGHT,
          shot.anchorPosition.z + Math.sin(patrolAngle) * shot.patrolRadius
        );
        desiredLookAt.copy(center).setY(center.y + 2.2);
      } else {
        desiredPosition.set(center.x + 20, center.y + 20, center.z + 24);
        desiredLookAt.copy(center);
      }
    }

    if (gamePhase === 'hero_select') {
      desiredPosition.y += 2.4;
    }

    const activeMap = shot.shotKind !== 'first_person' ? getActiveProceduralMap() : null;
    if (activeMap && targetPlayer) {
      resolveHeroFollowCameraPlacement({
        desiredPosition,
        desiredLookAt,
        shotKind: shot.shotKind,
        cameraMode: streamerCameraMode,
        manifest: activeMap,
        scratch: cameraPlacementScratchRef.current,
      });
    }

    if (didInitializePoseRef.current && shot.transitionDuration > 0) {
      const transitionProgress = smoothstep01((now - shot.startedAt) / shot.transitionDuration);
      if (transitionProgress < 1) {
        desiredPosition.lerpVectors(shot.entryPosition, desiredPosition, transitionProgress);
        desiredLookAt.lerpVectors(shot.entryLookAt, desiredLookAt, transitionProgress);
      }
    }

    if (shot.shotKind !== 'first_person') {
      applyCameraTerrainAvoidance({
        position: desiredPosition,
        lookAt: desiredLookAt,
        shotKind: shot.shotKind,
        cameraMode: streamerCameraMode,
        manifest: activeMap,
        terrainAnchor: terrainAnchorRef.current,
        terrainDirection: terrainDirectionRef.current,
        terrainHit: terrainHitRef.current,
      });
    }

    const positionRate = getPositionSmoothingForShot(shot.shotKind, streamerCameraMode);
    const lookRate = getLookSmoothingForShot(shot.shotKind, streamerCameraMode);

    if (!didInitializePoseRef.current) {
      didInitializePoseRef.current = true;
      camera.position.copy(desiredPosition);
      smoothedLookAtRef.current.copy(desiredLookAt);
      if (shot.shotKind !== 'first_person') {
        applyCameraTerrainAvoidance({
          position: camera.position,
          lookAt: smoothedLookAtRef.current,
          shotKind: shot.shotKind,
          cameraMode: streamerCameraMode,
          manifest: activeMap,
          terrainAnchor: terrainAnchorRef.current,
          terrainDirection: terrainDirectionRef.current,
          terrainHit: terrainHitRef.current,
        });
      }
      camera.lookAt(smoothedLookAtRef.current);
      return;
    }

    camera.position.lerp(desiredPosition, smoothingAlpha(positionRate, delta));
    smoothedLookAtRef.current.lerp(desiredLookAt, smoothingAlpha(lookRate, delta));
    if (shot.shotKind !== 'first_person') {
      applyCameraTerrainAvoidance({
        position: camera.position,
        lookAt: smoothedLookAtRef.current,
        shotKind: shot.shotKind,
        cameraMode: streamerCameraMode,
        manifest: activeMap,
        terrainAnchor: terrainAnchorRef.current,
        terrainDirection: terrainDirectionRef.current,
        terrainHit: terrainHitRef.current,
      });
    }
    camera.lookAt(smoothedLookAtRef.current);
  });

  return null;
}
