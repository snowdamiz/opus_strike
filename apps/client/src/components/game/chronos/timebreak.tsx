import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_RADIUS,
  type Team,
} from '@voxel-strike/shared';
import type { ChronosTimebreakData } from '../../../store/gameStore';
import { useGameStore } from '../../../store/gameStore';
import { SHARED_GEOMETRIES } from '../effectResources';

const TIMEBREAK_SHOCKWAVE_DURATION_MS = 460;
const TIMEBREAK_COLOR = 0x22c55e;
const CHRONOS_TIMEBREAK_ABILITY_ID = 'chronos_timebreak';
let timebreakEffectIdCounter = 0;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface AddChronosTimebreakEffectOptions {
  id?: string;
  position: Vec3Like;
  ownerId: string;
  ownerTeam?: Team | null;
  startTime?: number;
  releaseTime?: number;
  duration?: number;
  radius?: number;
}

export function addChronosTimebreakEffect({
  id,
  position,
  ownerId,
  ownerTeam,
  startTime = Date.now(),
  releaseTime = startTime,
  duration = ABILITY_DEFINITIONS[CHRONOS_TIMEBREAK_ABILITY_ID]?.duration ?? 5,
  radius = CHRONOS_TIMEBREAK_RADIUS,
}: AddChronosTimebreakEffectOptions): void {
  useGameStore.getState().addChronosTimebreak({
    id: id ?? `chronos_timebreak_${ownerId}_${timebreakEffectIdCounter++}`,
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    startTime,
    releaseTime,
    duration,
    radius,
    ownerId,
    ownerTeam: (ownerTeam || 'red') as 'red' | 'blue',
  });
}

function createTimebreakShockwaveMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function ChronosTimebreakEffect({ timebreak }: { timebreak: ChronosTimebreakData }) {
  const groupRef = useRef<THREE.Group>(null);
  const shockwaveShellRef = useRef<THREE.Mesh>(null);
  const shockwaveRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shockwaveMaterial = useMemo(() => createTimebreakShockwaveMaterial(TIMEBREAK_COLOR), []);

  useEffect(() => () => {
    shockwaveMaterial.dispose();
  }, [shockwaveMaterial]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    const now = Date.now();
    const elapsedMs = now - timebreak.releaseTime;

    if (elapsedMs < 0 || elapsedMs > TIMEBREAK_SHOCKWAVE_DURATION_MS) {
      group.visible = false;
      return;
    }

    const progress = THREE.MathUtils.clamp(elapsedMs / TIMEBREAK_SHOCKWAVE_DURATION_MS, 0, 1);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const shockwaveScale = THREE.MathUtils.lerp(0.06, 0.74, easedProgress);
    const shockwaveOpacity = (1 - THREE.MathUtils.smoothstep(progress, 0.18, 1)) * 0.62;

    group.visible = true;
    group.position.set(timebreak.position.x, timebreak.position.y, timebreak.position.z);

    shockwaveShellRef.current?.scale.setScalar(shockwaveScale);
    shockwaveRingRefs.current.forEach((ring) => {
      ring?.scale.set(shockwaveScale, shockwaveScale, 1);
    });
    shockwaveMaterial.opacity = THREE.MathUtils.clamp(shockwaveOpacity, 0, 0.62);
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={shockwaveShellRef} geometry={SHARED_GEOMETRIES.sphere16} material={shockwaveMaterial} scale={0.001} frustumCulled={false} />
      {[
        [Math.PI / 2, 0, 0],
        [0, Math.PI / 2, 0],
        [0, 0, Math.PI / 2],
      ].map((rotation, index) => (
        <mesh
          key={index}
          ref={(node) => {
            shockwaveRingRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.ring24}
          material={shockwaveMaterial}
          rotation={rotation as [number, number, number]}
          scale={[0.001, 0.001, 1]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

export function ChronosTimebreakManager() {
  const timebreaks = useGameStore(state => state.chronosTimebreaks);

  return (
    <group>
      {timebreaks.map((timebreak) => (
        <ChronosTimebreakEffect key={timebreak.id} timebreak={timebreak} />
      ))}
    </group>
  );
}
