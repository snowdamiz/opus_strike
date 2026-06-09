import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE,
  CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
  type Team,
} from '@voxel-strike/shared';
import type { ChronosTimebreakData } from '../../../store/gameStore';
import { useGameStore } from '../../../store/gameStore';

const TIMEBREAK_SHOCKWAVE_DURATION_MS = 520;
const TIMEBREAK_COLOR = 0x22c55e;
const CHRONOS_TIMEBREAK_ABILITY_ID = 'chronos_timebreak';
const DEFAULT_TIMEBREAK_DIRECTION = { x: 0, y: 0, z: -1 };
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
  direction?: Vec3Like;
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
  direction = DEFAULT_TIMEBREAK_DIRECTION,
  startTime = Date.now(),
  releaseTime = startTime,
  duration = ABILITY_DEFINITIONS[CHRONOS_TIMEBREAK_ABILITY_ID]?.duration ?? 0,
  radius = CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE,
}: AddChronosTimebreakEffectOptions): void {
  const normalizedDirection = normalizeTimebreakDirection(direction);

  useGameStore.getState().addChronosTimebreak({
    id: id ?? `chronos_timebreak_${ownerId}_${timebreakEffectIdCounter++}`,
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    direction: normalizedDirection,
    startTime,
    releaseTime,
    duration,
    radius,
    ownerId,
    ownerTeam: (ownerTeam || 'red') as 'red' | 'blue',
  });
}

function normalizeTimebreakDirection(direction: Vec3Like): Vec3Like {
  const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (length <= 0.0001) return DEFAULT_TIMEBREAK_DIRECTION;

  return {
    x: direction.x / length,
    y: 0,
    z: direction.z / length,
  };
}

function getYawFromDirection(direction: Vec3Like): number {
  return Math.atan2(-direction.x, -direction.z);
}

function createShockwaveWedgeGeometry(segments = 36): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = -CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE + t * CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE * 2;
    positions.push(Math.sin(angle), 0, -Math.cos(angle));
  }

  for (let i = 1; i <= segments; i++) {
    indices.push(0, i, i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createShockwaveArcGeometry(segments = 36): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const innerRadius = 0.94;
  const outerRadius = 1;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = -CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE + t * CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE * 2;
    const x = Math.sin(angle);
    const z = -Math.cos(angle);
    positions.push(x * innerRadius, 0, z * innerRadius);
    positions.push(x * outerRadius, 0, z * outerRadius);
  }

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createTimebreakShockwaveMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function ChronosTimebreakEffect({ timebreak }: { timebreak: ChronosTimebreakData }) {
  const groupRef = useRef<THREE.Group>(null);
  const shockwaveFanRef = useRef<THREE.Mesh>(null);
  const shockwaveArcRef = useRef<THREE.Mesh>(null);
  const shockwaveFanMaterial = useMemo(() => createTimebreakShockwaveMaterial(TIMEBREAK_COLOR), []);
  const shockwaveArcMaterial = useMemo(() => createTimebreakShockwaveMaterial(TIMEBREAK_COLOR), []);
  const shockwaveFanGeometry = useMemo(() => createShockwaveWedgeGeometry(), []);
  const shockwaveArcGeometry = useMemo(() => createShockwaveArcGeometry(), []);

  useEffect(() => () => {
    shockwaveFanMaterial.dispose();
    shockwaveArcMaterial.dispose();
    shockwaveFanGeometry.dispose();
    shockwaveArcGeometry.dispose();
  }, [shockwaveArcGeometry, shockwaveArcMaterial, shockwaveFanGeometry, shockwaveFanMaterial]);

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
    const shockwaveScale = THREE.MathUtils.lerp(0.04, 1, easedProgress);
    const shockwaveOpacity = (1 - THREE.MathUtils.smoothstep(progress, 0.18, 1)) * 0.62;

    group.visible = true;
    group.position.set(timebreak.position.x, timebreak.position.y, timebreak.position.z);
    group.rotation.y = getYawFromDirection(timebreak.direction);

    const shockwaveReach = (timebreak.radius || CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE) * shockwaveScale;
    shockwaveFanRef.current?.scale.set(shockwaveReach, 1, shockwaveReach);
    shockwaveArcRef.current?.scale.set(shockwaveReach, 1, shockwaveReach);
    shockwaveFanMaterial.opacity = THREE.MathUtils.clamp(shockwaveOpacity * 0.32, 0, 0.22);
    shockwaveArcMaterial.opacity = THREE.MathUtils.clamp(shockwaveOpacity, 0, 0.62);
  });

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={shockwaveFanRef} geometry={shockwaveFanGeometry} material={shockwaveFanMaterial} scale={[0.001, 1, 0.001]} frustumCulled={false} />
      <mesh ref={shockwaveArcRef} geometry={shockwaveArcGeometry} material={shockwaveArcMaterial} scale={[0.001, 1, 0.001]} frustumCulled={false} />
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
