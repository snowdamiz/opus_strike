import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';

const CAMERA_DISTANCE = 6.4;
const CAMERA_HEIGHT = 2.6;
const LOOK_HEIGHT = 1.15;
const DOWNED_CAMERA_HEIGHT = 1.7;
const DOWNED_LOOK_HEIGHT = 0.45;
const POSITION_LERP = 0.16;

function getBehindOffset(lookYaw: number, downed: boolean): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(lookYaw) * CAMERA_DISTANCE,
    downed ? DOWNED_CAMERA_HEIGHT : CAMERA_HEIGHT,
    Math.cos(lookYaw) * CAMERA_DISTANCE
  );
}

export function BattleRoyalTeamSpectatorCameraController({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const localPlayer = useGameStore((state) => state.localPlayer);
  const players = useGameStore((state) => state.players);
  const [targetId, setTargetId] = useState<string | null>(null);
  const initializedTargetRef = useRef<string | null>(null);

  const teammateTargets = useMemo(() => {
    if (!localPlayer?.team) return [];
    return Array.from(players.values())
      .filter((player) => (
        player.team === localPlayer.team
        && player.id !== localPlayer.id
        && (player.state === 'alive' || player.state === 'downed')
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [localPlayer?.id, localPlayer?.team, players]);

  useEffect(() => {
    if (!enabled) {
      initializedTargetRef.current = null;
      setTargetId(null);
      return;
    }

    if (targetId && teammateTargets.some((player) => player.id === targetId)) return;
    setTargetId(teammateTargets[0]?.id ?? null);
  }, [enabled, targetId, teammateTargets]);

  useEffect(() => {
    if (!enabled || teammateTargets.length <= 1) return undefined;

    const cycleTarget = (direction: 1 | -1) => {
      setTargetId((current) => {
        const currentIndex = Math.max(0, teammateTargets.findIndex((player) => player.id === current));
        const nextIndex = (currentIndex + direction + teammateTargets.length) % teammateTargets.length;
        return teammateTargets[nextIndex]?.id ?? current;
      });
    };

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
  }, [enabled, teammateTargets]);

  useFrame(() => {
    if (!enabled) return;

    const target = teammateTargets.find((player) => player.id === targetId)
      ?? teammateTargets[0]
      ?? localPlayer;
    if (!target) return;

    const isDowned = target.state === 'downed';
    const targetPosition = new THREE.Vector3(
      target.position.x,
      target.position.y + (isDowned ? DOWNED_LOOK_HEIGHT : LOOK_HEIGHT),
      target.position.z
    );
    const desiredPosition = targetPosition.clone().add(getBehindOffset(target.lookYaw, isDowned));

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
