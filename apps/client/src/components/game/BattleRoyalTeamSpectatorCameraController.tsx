import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import type { Player } from '../../store/types';

const CAMERA_DISTANCE = 6.4;
const CAMERA_HEIGHT = 2.6;
const LOOK_HEIGHT = 1.15;
const DOWNED_CAMERA_HEIGHT = 1.7;
const DOWNED_LOOK_HEIGHT = 0.45;
const POSITION_LERP = 0.16;

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

function writeBehindOffset(lookYaw: number, downed: boolean, target: THREE.Vector3): THREE.Vector3 {
  return target.set(
    Math.sin(lookYaw) * CAMERA_DISTANCE,
    downed ? DOWNED_CAMERA_HEIGHT : CAMERA_HEIGHT,
    Math.cos(lookYaw) * CAMERA_DISTANCE
  );
}

export function BattleRoyalTeamSpectatorCameraController({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree();
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const [targetId, setTargetId] = useState<string | null>(null);
  const initializedTargetRef = useRef<string | null>(null);
  const targetPositionRef = useRef(new THREE.Vector3());
  const desiredPositionRef = useRef(new THREE.Vector3());
  const behindOffsetRef = useRef(new THREE.Vector3());

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
      setTargetId(null);
      return;
    }

    if (targetId && teammateTargets.some((player) => player.id === targetId)) return;
    setTargetId(teammateTargets[0]?.id ?? null);
  }, [enabled, targetId, teammateTargets]);

  const cycleTarget = useCallback((direction: 1 | -1) => {
    setTargetId((current) => getNextBattleRoyalTeamSpectatorTargetId(current, teammateTargets, direction));
  }, [teammateTargets]);

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
    if (!enabled || teammateTargets.length <= 1) return undefined;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      event.preventDefault();
      cycleTarget(1);
    };

    const canvas = gl.domElement;
    canvas.addEventListener('mousedown', handleMouseDown);
    return () => canvas.removeEventListener('mousedown', handleMouseDown);
  }, [cycleTarget, enabled, gl, teammateTargets.length]);

  useFrame(() => {
    if (!enabled) return;

    const target = (targetId ? teammateTargetById.get(targetId) : undefined)
      ?? teammateTargets[0]
      ?? localPlayer;
    if (!target) return;

    const isDowned = target.state === 'downed';
    const targetPosition = targetPositionRef.current.set(
      target.position.x,
      target.position.y + (isDowned ? DOWNED_LOOK_HEIGHT : LOOK_HEIGHT),
      target.position.z
    );
    const desiredPosition = desiredPositionRef.current
      .copy(targetPosition)
      .add(writeBehindOffset(target.lookYaw, isDowned, behindOffsetRef.current));

    if (initializedTargetRef.current !== target.id) {
      camera.position.copy(desiredPosition);
      initializedTargetRef.current = target.id;
    } else {
      camera.position.lerp(desiredPosition, POSITION_LERP);
    }
    camera.lookAt(targetPosition);
  });

  return null;
}
