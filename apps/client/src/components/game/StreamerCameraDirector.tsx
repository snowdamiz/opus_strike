import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Player, Vec3 } from '@voxel-strike/shared';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { useStreamerStore } from '../../store/streamerStore';
import { visualStore } from '../../store/visualStore';
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
}

const SHOT_DURATION_SECONDS = 7.5;
const TARGET_RESELECT_GRACE_SECONDS = 1.2;
const CAMERA_POSITION_SMOOTHING = 2.7;
const CAMERA_LOOK_SMOOTHING = 4.8;
const FIRST_PERSON_POSITION_SMOOTHING = 14;
const FIRST_PERSON_LOOK_SMOOTHING = 18;
const PLAYER_FORWARD_DISTANCE = 9;
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
  if (input.cameraMode === 'fixed_aerial') {
    return { targetId: null, shotKind: 'aerial' };
  }

  const candidates = Array.from(input.players).filter(isCombatCameraCandidate);
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
  for (const player of players) {
    if (!isCombatCameraCandidate(player)) continue;
    target.x += player.position.x;
    target.y += player.position.y;
    target.z += player.position.z;
    count++;
  }

  if (count === 0) return target.copy(FALLBACK_MAP_CENTER);
  return target.multiplyScalar(1 / count);
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

  useEffect(() => () => {
    setHiddenFirstPersonTargetId(null);
  }, [setHiddenFirstPersonTargetId]);

  useFrame(({ clock }, delta) => {
    if (!enabled) {
      setHiddenFirstPersonTargetId(null);
      return;
    }

    const now = clock.elapsedTime;
    const currentShot = shotRef.current;
    const currentTarget = currentShot?.targetId ? players.get(currentShot.targetId) ?? null : null;
    const targetStillValid = currentTarget ? isCombatCameraCandidate(currentTarget) : false;
    const forcedAerialMismatch = streamerCameraMode === 'fixed_aerial' && currentShot?.shotKind !== 'aerial';
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
      shotRef.current = {
        ...selection,
        startedAt: now,
        duration: SHOT_DURATION_SECONDS,
        orbitAngle: (shotIndexRef.current * Math.PI * 0.73) % (Math.PI * 2),
      };
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
        desiredPosition.copy(targetPosition)
          .addScaledVector(forward, -8.4)
          .addScaledVector(rightRef.current, 2.2)
          .setY(targetPosition.y + Math.max(3.2, visibleHeight + 2.2));
        desiredLookAt.copy(targetPosition).setY(targetPosition.y + visibleHeight * 0.72);
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
        const center = getPlayersCenter(players.values(), centerRef.current);
        desiredPosition.set(center.x + 18, center.y + 17, center.z + 22);
        desiredLookAt.copy(center).setY(center.y + 1.8);
      }
    } else {
      setHiddenFirstPersonTargetId(null);
      const center = getPlayersCenter(players.values(), centerRef.current);
      desiredPosition.set(center.x + 20, center.y + 20, center.z + 24);
      desiredLookAt.copy(center);
    }

    if (gamePhase === 'hero_select') {
      desiredPosition.y += 2.4;
    }

    const positionRate = shot.shotKind === 'first_person'
      ? FIRST_PERSON_POSITION_SMOOTHING
      : CAMERA_POSITION_SMOOTHING;
    const lookRate = shot.shotKind === 'first_person'
      ? FIRST_PERSON_LOOK_SMOOTHING
      : CAMERA_LOOK_SMOOTHING;

    camera.position.lerp(desiredPosition, smoothingAlpha(positionRate, delta));
    smoothedLookAtRef.current.lerp(desiredLookAt, smoothingAlpha(lookRate, delta));
    camera.lookAt(smoothedLookAtRef.current);
  });

  return null;
}
