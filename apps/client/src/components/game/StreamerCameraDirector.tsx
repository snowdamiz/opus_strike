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

export type StreamerCameraShotKind = 'first_person' | 'chase' | 'orbit' | 'aerial';
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
  patrolRadius: number;
  patrolAngularSpeed: number;
  followSide: number;
}

const SHOT_DURATION_SECONDS = 7.5;
const FIXED_AERIAL_PATROL_DURATION_SECONDS = 15;
const FIXED_AERIAL_CHASE_DURATION_SECONDS = 9.5;
const TARGET_RESELECT_GRACE_SECONDS = 1.2;
const CAMERA_POSITION_SMOOTHING = 2.7;
const CAMERA_LOOK_SMOOTHING = 4.8;
const FIXED_AERIAL_PATROL_POSITION_SMOOTHING = 0.85;
const FIXED_AERIAL_PATROL_LOOK_SMOOTHING = 1.45;
const FIXED_AERIAL_CHASE_POSITION_SMOOTHING = 1.9;
const FIXED_AERIAL_CHASE_LOOK_SMOOTHING = 2.35;
const FIRST_PERSON_POSITION_SMOOTHING = 14;
const FIRST_PERSON_LOOK_SMOOTHING = 18;
const PLAYER_FORWARD_DISTANCE = 9;
const FIXED_AERIAL_BOUNDARY_PADDING = 11;
const FIXED_AERIAL_PATROL_HEIGHT = 16;
const FIXED_AERIAL_PATROL_GROUND_CLEARANCE = 9;
const FIXED_AERIAL_CHASE_GROUND_CLEARANCE = 7;
const FIXED_AERIAL_CHASE_DISTANCE = 8.2;
const FIXED_AERIAL_CHASE_HEIGHT = 7.2;
const FIXED_AERIAL_CHASE_TERRAIN_SAMPLE_RADIUS = 24;
const FIXED_AERIAL_PATROL_TERRAIN_SAMPLE_RADIUS = 10;
const STREAMER_CAMERA_TERRAIN_PADDING = 3.2;
const FALLBACK_MAP_CENTER = new THREE.Vector3(0, 2, 0);

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
    const shouldFollowPlayer = candidates.length > 0 && Math.abs(input.shotIndex) % 3 === 1;
    if (shouldFollowPlayer) {
      candidates.sort((a, b) => {
        const scoreDelta = playerScore(b, input.previousTargetId ?? null) - playerScore(a, input.previousTargetId ?? null);
        if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
        return a.id.localeCompare(b.id);
      });
      const windowSize = Math.min(4, candidates.length);
      const target = candidates[Math.floor(Math.abs(input.shotIndex) / 3) % windowSize] ?? candidates[0];
      return { targetId: target.id, shotKind: 'chase' };
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
  const shotRoll = hashShotIndex(input.shotIndex, target.id) % 10;
  const shotKind: StreamerCameraShotKind = shotRoll <= 2
    ? 'first_person'
    : shotRoll <= 5
    ? 'chase'
    : shotRoll <= 7
    ? 'orbit'
    : 'aerial';

  return { targetId: target.id, shotKind };
}

function smoothingAlpha(rate: number, delta: number): number {
  return Math.min(1, Math.max(0, 1 - Math.exp(-rate * delta)));
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
  return selection.shotKind === 'chase'
    ? FIXED_AERIAL_CHASE_DURATION_SECONDS
    : FIXED_AERIAL_PATROL_DURATION_SECONDS;
}

function getStreamerShotDuration(selection: StreamerCameraSelection, cameraMode: StreamerCameraMode): number {
  return cameraMode === 'fixed_aerial'
    ? getFixedAerialShotDuration(selection)
    : SHOT_DURATION_SECONDS;
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
    patrolRadius: 14 + (shotSeed % 4) * 3,
    patrolAngularSpeed: 0.105 + (shotSeed % 3) * 0.018,
    followSide: shotSeed % 2 === 0 ? 1 : -1,
  };
}

function distanceToBoundary(x: number, z: number, manifest: VoxelMapManifest): number {
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

function keepCameraAboveGround(
  desiredPosition: THREE.Vector3,
  focusPosition: THREE.Vector3,
  minGroundClearance: number,
  manifest: VoxelMapManifest | null,
  sampleRadius: number
): void {
  if (manifest) {
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
  const rightRef = useRef(new THREE.Vector3());
  const centerRef = useRef(new THREE.Vector3());
  const shotCenterRef = useRef(new THREE.Vector3());
  const terrainAnchorRef = useRef(new THREE.Vector3());
  const terrainDirectionRef = useRef(new THREE.Vector3());
  const terrainHitRef = useRef(createRaycastDirectionHitResult());
  const didInitializePoseRef = useRef(false);

  useEffect(() => () => {
    setHiddenFirstPersonTargetId(null);
  }, [setHiddenFirstPersonTargetId]);

  useEffect(() => {
    shotRef.current = null;
    didInitializePoseRef.current = false;
  }, [streamerCameraMode]);

  useFrame(({ clock }, delta) => {
    if (!enabled) {
      setHiddenFirstPersonTargetId(null);
      didInitializePoseRef.current = false;
      return;
    }

    const now = clock.elapsedTime;
    const currentShot = shotRef.current;
    const currentTarget = currentShot?.targetId ? players.get(currentShot.targetId) ?? null : null;
    const targetStillValid = currentTarget ? isCombatCameraCandidate(currentTarget) : false;
    const forcedAerialMismatch = streamerCameraMode === 'fixed_aerial' &&
      currentShot !== null &&
      currentShot.shotKind !== 'aerial' &&
      currentShot.shotKind !== 'chase';
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
      shotRef.current = createStreamerCameraShot({
        selection,
        cameraMode: streamerCameraMode,
        players: players.values(),
        now,
        shotIndex: shotIndexRef.current,
        center: shotCenterRef.current,
      });
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
      const forward = getPlayerForward(forwardRef.current, targetPlayer);
      rightRef.current.set(forward.z, 0, -forward.x).normalize();

      if (shot.shotKind === 'first_person') {
        setHiddenFirstPersonTargetId(targetPlayer.id);
        desiredPosition.copy(targetPosition).addScaledVector(forward, 0.24);
        desiredPosition.y += eyeHeight;
        desiredLookAt.copy(desiredPosition).addScaledVector(forward, PLAYER_FORWARD_DISTANCE);
        desiredLookAt.y += THREE.MathUtils.clamp(-(targetPlayer.lookPitch ?? 0), -0.6, 0.6) * 2.2;
      } else if (shot.shotKind === 'chase') {
        setHiddenFirstPersonTargetId(null);
        const chaseDistance = streamerCameraMode === 'fixed_aerial'
          ? FIXED_AERIAL_CHASE_DISTANCE
          : 8.4;
        const chaseHeight = streamerCameraMode === 'fixed_aerial'
          ? Math.max(FIXED_AERIAL_CHASE_HEIGHT, visibleHeight + 4.2)
          : Math.max(3.2, visibleHeight + 2.2);
        const shoulderOffset = streamerCameraMode === 'fixed_aerial'
          ? 1.6 * shot.followSide
          : 2.2;
        desiredPosition.copy(targetPosition)
          .addScaledVector(forward, -chaseDistance)
          .addScaledVector(rightRef.current, shoulderOffset)
          .setY(targetPosition.y + chaseHeight);
        desiredLookAt.copy(targetPosition)
          .addScaledVector(forward, streamerCameraMode === 'fixed_aerial' ? 2.5 : 0)
          .setY(targetPosition.y + visibleHeight * 0.72);
      } else if (shot.shotKind === 'orbit') {
        setHiddenFirstPersonTargetId(null);
        const orbit = shot.orbitAngle + (now - shot.startedAt) * 0.42;
        desiredPosition.set(
          targetPosition.x + Math.cos(orbit) * 9.5,
          targetPosition.y + Math.max(4.4, visibleHeight + 3.5),
          targetPosition.z + Math.sin(orbit) * 9.5
        );
        desiredLookAt.copy(targetPosition).setY(targetPosition.y + visibleHeight * 0.68);
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

    if (streamerCameraMode === 'fixed_aerial') {
      const activeMap = getActiveProceduralMap();
      if (activeMap) {
        clampVectorToPlayableBoundary(desiredPosition, activeMap);
      }

      const terrainAnchor = terrainAnchorRef.current.copy(desiredLookAt);
      terrainAnchor.y += 0.9;
      const terrainDirection = terrainDirectionRef.current.copy(desiredPosition).sub(terrainAnchor);
      const desiredDistance = terrainDirection.length();
      if (desiredDistance > 0.001) {
        terrainDirection.multiplyScalar(1 / desiredDistance);
        const terrainHit = terrainHitRef.current;
        if (
          raycastDirectionInto(
            terrainHit,
            terrainAnchor.x,
            terrainAnchor.y,
            terrainAnchor.z,
            terrainDirection.x,
            terrainDirection.y,
            terrainDirection.z,
            desiredDistance,
            { priority: 'visual', feature: 'streamer-camera-obstruction' }
          ) &&
          terrainHit.distance < desiredDistance - STREAMER_CAMERA_TERRAIN_PADDING
        ) {
          const safeDistance = Math.max(1.5, terrainHit.distance - STREAMER_CAMERA_TERRAIN_PADDING);
          desiredPosition.copy(terrainAnchor).addScaledVector(terrainDirection, safeDistance);
          desiredPosition.x += terrainHit.normal.x * STREAMER_CAMERA_TERRAIN_PADDING;
          desiredPosition.y += Math.max(0, terrainHit.normal.y) * STREAMER_CAMERA_TERRAIN_PADDING * 0.7;
          desiredPosition.z += terrainHit.normal.z * STREAMER_CAMERA_TERRAIN_PADDING;
        }
      }

      keepCameraAboveGround(
        desiredPosition,
        desiredLookAt,
        shot.shotKind === 'chase'
          ? FIXED_AERIAL_CHASE_GROUND_CLEARANCE
          : FIXED_AERIAL_PATROL_GROUND_CLEARANCE,
        activeMap,
        shot.shotKind === 'chase'
          ? FIXED_AERIAL_CHASE_TERRAIN_SAMPLE_RADIUS
          : FIXED_AERIAL_PATROL_TERRAIN_SAMPLE_RADIUS
      );

      if (activeMap) {
        clampVectorToPlayableBoundary(desiredPosition, activeMap);
      }
    }

    const positionRate = shot.shotKind === 'first_person'
      ? FIRST_PERSON_POSITION_SMOOTHING
      : streamerCameraMode === 'fixed_aerial'
        ? shot.shotKind === 'chase'
          ? FIXED_AERIAL_CHASE_POSITION_SMOOTHING
          : FIXED_AERIAL_PATROL_POSITION_SMOOTHING
        : CAMERA_POSITION_SMOOTHING;
    const lookRate = shot.shotKind === 'first_person'
      ? FIRST_PERSON_LOOK_SMOOTHING
      : streamerCameraMode === 'fixed_aerial'
        ? shot.shotKind === 'chase'
          ? FIXED_AERIAL_CHASE_LOOK_SMOOTHING
          : FIXED_AERIAL_PATROL_LOOK_SMOOTHING
        : CAMERA_LOOK_SMOOTHING;

    if (!didInitializePoseRef.current) {
      didInitializePoseRef.current = true;
      camera.position.copy(desiredPosition);
      smoothedLookAtRef.current.copy(desiredLookAt);
      camera.lookAt(smoothedLookAtRef.current);
      return;
    }

    camera.position.lerp(desiredPosition, smoothingAlpha(positionRate, delta));
    smoothedLookAtRef.current.lerp(desiredLookAt, smoothingAlpha(lookRate, delta));
    camera.lookAt(smoothedLookAtRef.current);
  });

  return null;
}
