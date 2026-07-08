import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  MOUSE_SENSITIVITY as BASE_AIM_SENSITIVITY,
  PITCH_LIMIT,
} from '@voxel-strike/shared';
import { useGamepadInput } from '../../hooks/gamepadInput';
import { useGameStore } from '../../store/gameStore';
import { consumeLookDelta } from '../../store/lookInputStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { Player } from '../../store/types';
import {
  sampleRemoteTransformInto,
  visualStore,
  type SampledRemoteTransform,
} from '../../store/visualStore';

const CAMERA_DISTANCE = 6.4;
const CAMERA_HEIGHT = 2.6;
const LOOK_HEIGHT = 1.15;
const DOWNED_CAMERA_HEIGHT = 1.7;
const DOWNED_LOOK_HEIGHT = 0.45;
const SPECTATOR_PITCH_LIMIT = Math.min(PITCH_LIMIT, Math.PI / 3);
const SPECTATOR_VERTICAL_ORBIT_DISTANCE = 3.2;
const SPECTATOR_TARGET_POSITION_DAMPING = 14;
const SPECTATOR_CAMERA_POSITION_DAMPING = 9;
const SPECTATOR_LOOK_TARGET_DAMPING = 18;
const SPECTATOR_SNAP_DISTANCE_SQ = 36;
const SPECTATOR_FRAME_DELTA_CAP_SECONDS = 0.05;

export type BattleRoyalTeamSpectatorTarget = Pick<Player, 'id' | 'name' | 'team' | 'state'>;

export function getBattleRoyalTeamSpectatorTargets<T extends BattleRoyalTeamSpectatorTarget>(
  localPlayer: Pick<Player, 'id' | 'team'> | null | undefined,
  players: Iterable<T>
): T[] {
  if (!localPlayer?.team) return [];

  const targets: T[] = [];
  for (const player of players) {
    if (
      player.team === localPlayer.team
      && player.id !== localPlayer.id
      && (player.state === 'alive' || player.state === 'downed')
    ) {
      targets.push(player);
    }
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

export function getNextBattleRoyalTeamSpectatorTargetId(
  currentId: string | null,
  targets: readonly BattleRoyalTeamSpectatorTarget[],
  direction: 1 | -1
): string | null {
  if (targets.length === 0) return null;

  const currentIndex = currentId
    ? targets.findIndex((player) => player.id === currentId)
    : -1;
  if (currentIndex < 0) {
    return direction > 0
      ? targets[0]?.id ?? null
      : targets[targets.length - 1]?.id ?? null;
  }

  const nextIndex = (currentIndex + direction + targets.length) % targets.length;
  return targets[nextIndex]?.id ?? currentId;
}

export function writeBattleRoyalSpectatorCameraOffset(
  lookYaw: number,
  lookPitch: number,
  downed: boolean,
  target: THREE.Vector3
): THREE.Vector3 {
  const pitch = THREE.MathUtils.clamp(lookPitch, -SPECTATOR_PITCH_LIMIT, SPECTATOR_PITCH_LIMIT);

  return target.set(
    Math.sin(lookYaw) * CAMERA_DISTANCE,
    (downed ? DOWNED_CAMERA_HEIGHT : CAMERA_HEIGHT) - Math.sin(pitch) * SPECTATOR_VERTICAL_ORBIT_DISTANCE,
    Math.cos(lookYaw) * CAMERA_DISTANCE
  );
}

export function getBattleRoyalSpectatorDampingAlpha(damping: number, deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  if (!Number.isFinite(damping) || damping <= 0) return 1;
  return THREE.MathUtils.clamp(1 - Math.exp(-damping * deltaSeconds), 0, 1);
}

function dampBattleRoyalSpectatorVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  damping: number,
  deltaSeconds: number
): THREE.Vector3 {
  return current.lerp(target, getBattleRoyalSpectatorDampingAlpha(damping, deltaSeconds));
}

function createSampledRemoteTransform(): SampledRemoteTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
}

function writeBattleRoyalSpectatorTargetCenter(
  player: Player,
  sampledTransform: SampledRemoteTransform,
  target: THREE.Vector3,
  nowMs: number
): THREE.Vector3 {
  const visualState = visualStore.getState();
  const renderedPosition = visualState.renderedPlayerPositions.get(player.id);
  if (renderedPosition) {
    return target.set(renderedPosition.x, renderedPosition.y, renderedPosition.z);
  }

  if (sampleRemoteTransformInto(player.id, sampledTransform, nowMs)) {
    return target.set(
      sampledTransform.position.x,
      sampledTransform.position.y,
      sampledTransform.position.z
    );
  }

  const visualPosition = visualState.playerPositions.get(player.id);
  return target.set(
    visualPosition?.x ?? player.position.x,
    visualPosition?.y ?? player.position.y,
    visualPosition?.z ?? player.position.z
  );
}

function requestCanvasPointerLock(canvas: HTMLCanvasElement): void {
  if (document.pointerLockElement === canvas) return;

  const lockResult = canvas.requestPointerLock() as Promise<void> | void;
  if (lockResult && typeof lockResult.catch === 'function') {
    lockResult.catch(() => {});
  }
}

export function BattleRoyalTeamSpectatorCameraController({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree();
  const aimSensitivity = useSettingsStore(state => state.settings.sensitivity);
  const invertY = useSettingsStore(state => state.settings.invertY);
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const [targetId, setTargetId] = useState<string | null>(null);
  const initializedTargetRef = useRef<string | null>(null);
  const initializedLookRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const targetPositionRef = useRef(new THREE.Vector3());
  const rawTargetCenterRef = useRef(new THREE.Vector3());
  const smoothedTargetPositionRef = useRef(new THREE.Vector3());
  const cameraLookTargetRef = useRef(new THREE.Vector3());
  const desiredPositionRef = useRef(new THREE.Vector3());
  const behindOffsetRef = useRef(new THREE.Vector3());
  const sampledTransformRef = useRef(createSampledRemoteTransform());
  useGamepadInput(enabled);

  const teammateTargets = useMemo(() => {
    return getBattleRoyalTeamSpectatorTargets(localPlayer, players.values());
  }, [localPlayer?.id, localPlayer?.team, players]);

  const teammateTargetById = useMemo(() => {
    const byId = new Map<string, (typeof teammateTargets)[number]>();
    for (const player of teammateTargets) {
      byId.set(player.id, player);
    }
    return byId;
  }, [teammateTargets]);

  useEffect(() => {
    if (!enabled) {
      initializedTargetRef.current = null;
      initializedLookRef.current = false;
      setTargetId(null);
      return;
    }

    if (targetId && teammateTargets.some((player) => player.id === targetId)) return;
    setTargetId(teammateTargets[0]?.id ?? null);
  }, [enabled, targetId, teammateTargets]);

  const cycleTarget = useCallback((direction: 1 | -1) => {
    setTargetId((current) => getNextBattleRoyalTeamSpectatorTargetId(current, teammateTargets, direction));
  }, [teammateTargets]);

  const applyLookDelta = useCallback((deltaX: number, deltaY: number) => {
    const sensitivityMultiplier = aimSensitivity / 50;
    yawRef.current -= deltaX * BASE_AIM_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current += (invertY ? 1 : -1) * deltaY * BASE_AIM_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current = THREE.MathUtils.clamp(
      pitchRef.current,
      -SPECTATOR_PITCH_LIMIT,
      SPECTATOR_PITCH_LIMIT
    );
  }, [aimSensitivity, invertY]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      applyLookDelta(event.movementX, event.movementY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [applyLookDelta, enabled, gl]);

  useEffect(() => {
    if (!enabled || teammateTargets.length <= 1) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === 'ArrowRight' || event.code === 'PageDown' || event.code === 'Space') {
        event.preventDefault();
        cycleTarget(1);
      } else if (event.code === 'ArrowLeft' || event.code === 'PageUp') {
        event.preventDefault();
        cycleTarget(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cycleTarget, enabled, teammateTargets.length]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const canvas = gl.domElement;

      if (document.pointerLockElement !== canvas) {
        event.preventDefault();
        requestCanvasPointerLock(canvas);
        return;
      }

      if (teammateTargets.length <= 1) return;
      event.preventDefault();
      cycleTarget(1);
    };

    const canvas = gl.domElement;
    canvas.addEventListener('mousedown', handleMouseDown);
    return () => canvas.removeEventListener('mousedown', handleMouseDown);
  }, [cycleTarget, enabled, gl, teammateTargets.length]);

  useFrame((_, delta) => {
    if (!enabled) return;

    const target = (targetId ? teammateTargetById.get(targetId) : undefined)
      ?? teammateTargets[0]
      ?? localPlayer;
    if (!target) return;

    const isDowned = target.state === 'downed';
    const frameDelta = Math.min(Math.max(0, delta), SPECTATOR_FRAME_DELTA_CAP_SECONDS);
    const rawTargetCenter = writeBattleRoyalSpectatorTargetCenter(
      target,
      sampledTransformRef.current,
      rawTargetCenterRef.current,
      Date.now()
    );
    const rawLookTargetY = rawTargetCenter.y + (isDowned ? DOWNED_LOOK_HEIGHT : LOOK_HEIGHT);
    const rawLookTarget = targetPositionRef.current.set(
      rawTargetCenter.x,
      rawLookTargetY,
      rawTargetCenter.z
    );
    if (!initializedLookRef.current) {
      yawRef.current = Number.isFinite(target.lookYaw) ? target.lookYaw : 0;
      pitchRef.current = 0;
      initializedLookRef.current = true;
    }

    const lookDelta = consumeLookDelta();
    if (lookDelta.x !== 0 || lookDelta.y !== 0) {
      applyLookDelta(lookDelta.x, lookDelta.y);
    }

    const targetChanged = initializedTargetRef.current !== target.id;
    if (
      targetChanged ||
      smoothedTargetPositionRef.current.distanceToSquared(rawLookTarget) > SPECTATOR_SNAP_DISTANCE_SQ
    ) {
      smoothedTargetPositionRef.current.copy(rawLookTarget);
      cameraLookTargetRef.current.copy(rawLookTarget);
    } else {
      dampBattleRoyalSpectatorVector(
        smoothedTargetPositionRef.current,
        rawLookTarget,
        SPECTATOR_TARGET_POSITION_DAMPING,
        frameDelta
      );
      dampBattleRoyalSpectatorVector(
        cameraLookTargetRef.current,
        rawLookTarget,
        SPECTATOR_LOOK_TARGET_DAMPING,
        frameDelta
      );
    }

    const desiredPosition = desiredPositionRef.current
      .copy(smoothedTargetPositionRef.current)
      .add(writeBattleRoyalSpectatorCameraOffset(
        yawRef.current,
        pitchRef.current,
        isDowned,
        behindOffsetRef.current
      ));

    if (targetChanged) {
      camera.position.copy(desiredPosition);
      initializedTargetRef.current = target.id;
    } else {
      dampBattleRoyalSpectatorVector(
        camera.position,
        desiredPosition,
        SPECTATOR_CAMERA_POSITION_DAMPING,
        frameDelta
      );
    }
    camera.lookAt(cameraLookTargetRef.current);
  });

  return null;
}
