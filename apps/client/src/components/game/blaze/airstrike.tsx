import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLAZE_GEARSTORM_RADIUS } from '@voxel-strike/shared';
import { checkGroundWithNormal, isPhysicsReady } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';

// ============================================================================
// INFERNAL GEARSTORM EFFECT - BLAZE ULTIMATE
// Legacy export names are kept so callers do not need to know the old airstrike
// implementation was replaced.
// ============================================================================

interface BurningCogData {
  angle: number;
  radius: number;
  groundY: number;
  height: number;
  size: number;
  spinSpeed: number;
  orbitSpeed: number;
  bobSpeed: number;
  bobAmount: number;
  yaw: number;
  tiltX: number;
  tiltY: number;
  phase: number;
}

interface BurnPatchData {
  x: number;
  z: number;
  groundY: number;
  radiusX: number;
  radiusZ: number;
  phase: number;
  opacity: number;
  color: number;
}

interface GroundFlameData {
  x: number;
  z: number;
  groundY: number;
  radius: number;
  height: number;
  phase: number;
  flickerSpeed: number;
  dutyCycle: number;
  yaw: number;
  leanX: number;
  leanZ: number;
}

interface AirStrikeData {
  id: string;
  centerPosition: { x: number; y: number; z: number };
  startTime: number;
  frameStartTime: number;
  groundY: number;
  cogs: BurningCogData[];
  burnPatches: BurnPatchData[];
  groundFlames: GroundFlameData[];
}

const airStrikes: AirStrikeData[] = [];
let airStrikeIdCounter = 0;
let airStrikeRevision = 0;

export const AIR_STRIKE_DURATION = 5200;

const GEARSTORM_RADIUS = BLAZE_GEARSTORM_RADIUS;
const GEARSTORM_COG_COUNT = 18;
const GEARSTORM_BURN_PATCH_COUNT = 72;
const GEARSTORM_GROUND_FLAME_COUNT = 64;
const COG_TEETH = 16;
const COG_FIRE_ORANGE = 0xff6a00;
const COG_TOOTH_INDEXES = Array.from({ length: COG_TEETH }, (_, index) => index);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function randomSigned(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

function randomInRadius(radius: number): { x: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radius;
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance,
  };
}

function resolveGroundY(x: number, z: number, fallbackY: number): number {
  if (!isPhysicsReady()) return fallbackY;

  const groundCheck = checkGroundWithNormal(x, fallbackY + 42, z, 96);
  return groundCheck?.isWalkable ? groundCheck.groundY + 0.08 : fallbackY;
}

export function triggerAirStrike(position: { x: number; y: number; z: number }) {
  const fallbackGroundY = position.y - 1;
  const groundY = resolveGroundY(position.x, position.z, fallbackGroundY);
  const cogs: BurningCogData[] = [];
  const burnPatches: BurnPatchData[] = [];
  const groundFlames: GroundFlameData[] = [];

  for (let i = 0; i < GEARSTORM_COG_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 4.2 + Math.sqrt(Math.random()) * (GEARSTORM_RADIUS - 4.2);
    const x = position.x + Math.cos(angle) * radius;
    const z = position.z + Math.sin(angle) * radius;

    cogs.push({
      angle,
      radius,
      groundY: resolveGroundY(x, z, groundY),
      height: 2.4 + Math.random() * 4.2,
      size: 1.05 + Math.random() * 1.15,
      spinSpeed: (Math.random() > 0.5 ? 1 : -1) * (1.65 + Math.random() * 1.8),
      orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.13),
      bobSpeed: 1.2 + Math.random() * 1.4,
      bobAmount: 0.3 + Math.random() * 0.55,
      yaw: Math.random() * Math.PI * 2,
      tiltX: randomSigned(0.7),
      tiltY: randomSigned(0.55),
      phase: Math.random() * Math.PI * 2,
    });
  }

  for (let i = 0; i < GEARSTORM_BURN_PATCH_COUNT; i++) {
    const offset = randomInRadius(GEARSTORM_RADIUS * 0.96);
    const x = position.x + offset.x;
    const z = position.z + offset.z;

    burnPatches.push({
      x,
      z,
      groundY: resolveGroundY(x, z, groundY),
      radiusX: 0.85 + Math.random() * 2.6,
      radiusZ: 0.55 + Math.random() * 1.85,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.18 + Math.random() * 0.24,
      color: Math.random() > 0.45 ? 0xff4a00 : 0xffaa00,
    });
  }

  for (let i = 0; i < GEARSTORM_GROUND_FLAME_COUNT; i++) {
    const offset = randomInRadius(GEARSTORM_RADIUS * 0.94);
    const x = position.x + offset.x;
    const z = position.z + offset.z;

    groundFlames.push({
      x,
      z,
      groundY: resolveGroundY(x, z, groundY),
      radius: 0.1 + Math.random() * 0.18,
      height: 0.5 + Math.random() * 1.15,
      phase: Math.random(),
      flickerSpeed: 0.42 + Math.random() * 0.46,
      dutyCycle: 0.24 + Math.random() * 0.26,
      yaw: Math.random() * Math.PI * 2,
      leanX: randomSigned(0.16),
      leanZ: randomSigned(0.16),
    });
  }

  airStrikes.push({
    id: `gearstorm_${airStrikeIdCounter++}`,
    centerPosition: { ...position },
    startTime: Date.now(),
    frameStartTime: getFrameClock().nowMs,
    groundY,
    cogs,
    burnPatches,
    groundFlames,
  });
  airStrikeRevision++;
}

function BurningCog({ cog }: { cog: BurningCogData }) {
  return (
    <group scale={[cog.size, cog.size, cog.size]}>
      <mesh geometry={SHARED_GEOMETRIES.ring32}>
        <meshBasicMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.48}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <mesh geometry={SHARED_GEOMETRIES.ring16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh geometry={SHARED_GEOMETRIES.circle16} scale={[0.18, 0.18, 1]}>
        <meshBasicMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {COG_TOOTH_INDEXES.map((index) => {
        const angle = (index / COG_TEETH) * Math.PI * 2;
        return (
          <mesh
            key={index}
            geometry={SHARED_GEOMETRIES.box}
            position={[Math.cos(angle) * 1.03, Math.sin(angle) * 1.03, 0]}
            rotation-z={angle}
            scale={[0.28, 0.3, 0.16]}
          >
            <meshBasicMaterial
              color={COG_FIRE_ORANGE}
              transparent
              opacity={0.44}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function GroundFlame({
  flame,
  setRef,
}: {
  flame: GroundFlameData;
  setRef: (element: THREE.Group | null) => void;
}) {
  return (
    <group
      ref={setRef}
      position={[flame.x, flame.groundY + 0.08, flame.z]}
      rotation={[flame.leanX, flame.yaw, flame.leanZ]}
      visible={false}
    >
      <mesh
        geometry={SHARED_GEOMETRIES.cone8}
        position-y={flame.height * 0.5}
        scale={[flame.radius, flame.height, flame.radius]}
      >
        <meshBasicMaterial
          color={0xff5a00}
          transparent
          opacity={0.66}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh
        geometry={SHARED_GEOMETRIES.cone6}
        position-y={flame.height * 0.44}
        scale={[flame.radius * 0.48, flame.height * 0.72, flame.radius * 0.48]}
      >
        <meshBasicMaterial
          color={0xffd36a}
          transparent
          opacity={0.56}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function InfernalGearstormEffect({ strike }: { strike: AirStrikeData }) {
  const groupRef = useRef<THREE.Group>(null);
  const groundFillRef = useRef<THREE.Mesh>(null);
  const groundRingRef = useRef<THREE.Mesh>(null);
  const groundHotCoreRef = useRef<THREE.Mesh>(null);
  const patchRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flameRefs = useRef<(THREE.Group | null)[]>([]);
  const cogRefs = useRef<(THREE.Group | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const elapsed = getFrameClock().nowMs - strike.frameStartTime;

    if (elapsed > AIR_STRIKE_DURATION) {
      if (groupRef.current) groupRef.current.visible = false;
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    const elapsedSeconds = elapsed / 1000;
    const fadeIn = clamp01(elapsed / 420);
    const fadeOut = clamp01((AIR_STRIKE_DURATION - elapsed) / 950);
    const fade = fadeIn * fadeOut;
    const pulse = 0.92 + Math.sin(elapsed * 0.006) * 0.08;

    if (groundFillRef.current) {
      groundFillRef.current.rotation.z = elapsed * 0.00065;
      groundFillRef.current.scale.setScalar(GEARSTORM_RADIUS * (0.94 + fadeIn * 0.08) * pulse);
      (groundFillRef.current.material as THREE.MeshBasicMaterial).opacity = 0.1 * fade;
    }

    if (groundRingRef.current) {
      groundRingRef.current.rotation.z = -elapsed * 0.0012;
      groundRingRef.current.scale.setScalar(GEARSTORM_RADIUS * (0.92 + Math.sin(elapsed * 0.004) * 0.035));
      (groundRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0.52 * fade;
    }

    if (groundHotCoreRef.current) {
      groundHotCoreRef.current.rotation.z = elapsed * 0.0015;
      groundHotCoreRef.current.scale.setScalar(GEARSTORM_RADIUS * 0.4 * (0.95 + Math.sin(elapsed * 0.008) * 0.08));
      (groundHotCoreRef.current.material as THREE.MeshBasicMaterial).opacity = 0.16 * fade;
    }

    strike.burnPatches.forEach((patch, index) => {
      const patchMesh = patchRefs.current[index];
      if (!patchMesh) return;

      const patchPulse = 0.84 + Math.sin(elapsed * 0.008 + patch.phase) * 0.18;
      patchMesh.rotation.z = patch.phase + elapsed * 0.0009;
      patchMesh.scale.set(patch.radiusX * patchPulse, patch.radiusZ * patchPulse, 1);
      (patchMesh.material as THREE.MeshBasicMaterial).opacity = patch.opacity * fade;
    });

    strike.groundFlames.forEach((flame, index) => {
      const flameGroup = flameRefs.current[index];
      if (!flameGroup) return;

      const cycle = (elapsedSeconds * flame.flickerSpeed + flame.phase) % 1;
      const active = cycle <= flame.dutyCycle;
      const flameLife = active ? cycle / flame.dutyCycle : 0;
      const rise = active ? Math.sin(flameLife * Math.PI) * fade : 0;
      const shimmer = 0.86 + Math.sin(elapsed * 0.024 + flame.phase * 17.31) * 0.14;

      flameGroup.visible = rise > 0.04;
      flameGroup.position.y = flame.groundY + 0.08 + rise * 0.05;
      flameGroup.rotation.y = flame.yaw + Math.sin(elapsedSeconds * 2.4 + flame.phase * Math.PI * 2) * 0.18;
      flameGroup.scale.set(
        (0.72 + rise * 0.38) * shimmer,
        Math.max(0.02, rise),
        (0.72 + rise * 0.32) * (1.72 - shimmer)
      );
    });

    strike.cogs.forEach((cog, index) => {
      const cogGroup = cogRefs.current[index];
      if (!cogGroup) return;

      const orbitAngle = cog.angle + elapsedSeconds * cog.orbitSpeed;
      cogGroup.visible = true;
      cogGroup.position.set(
        strike.centerPosition.x + Math.cos(orbitAngle) * cog.radius,
        cog.groundY + cog.height + Math.sin(elapsedSeconds * cog.bobSpeed + cog.phase) * cog.bobAmount,
        strike.centerPosition.z + Math.sin(orbitAngle) * cog.radius
      );
      cogGroup.rotation.set(
        cog.tiltX + Math.sin(elapsedSeconds * 0.8 + cog.phase) * 0.14,
        cog.yaw + elapsedSeconds * 0.35 + cog.tiltY,
        cog.phase + elapsedSeconds * cog.spinSpeed
      );
    });

    if (lightRef.current) {
      lightRef.current.position.set(strike.centerPosition.x, strike.groundY + 4.2, strike.centerPosition.z);
      lightRef.current.intensity = 12 * fade + Math.sin(elapsed * 0.012) * 1.8 * fade;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={groundFillRef}
        position={[strike.centerPosition.x, strike.groundY + 0.06, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.circle32}
      >
        <meshBasicMaterial
          color={0xff2a00}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh
        ref={groundRingRef}
        position={[strike.centerPosition.x, strike.groundY + 0.11, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.ring32}
      >
        <meshBasicMaterial
          color={0xff7a00}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh
        ref={groundHotCoreRef}
        position={[strike.centerPosition.x, strike.groundY + 0.13, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.circle16}
      >
        <meshBasicMaterial
          color={0xffcc33}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {strike.burnPatches.map((patch, index) => (
        <mesh
          key={index}
          ref={element => patchRefs.current[index] = element}
          position={[patch.x, patch.groundY + 0.16, patch.z]}
          rotation-x={-Math.PI / 2}
          geometry={SHARED_GEOMETRIES.circle16}
        >
          <meshBasicMaterial
            color={patch.color}
            transparent
            opacity={patch.opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      {strike.groundFlames.map((flame, index) => (
        <GroundFlame
          key={index}
          flame={flame}
          setRef={element => flameRefs.current[index] = element}
        />
      ))}

      {strike.cogs.map((cog, index) => (
        <group
          key={index}
          ref={element => cogRefs.current[index] = element}
          visible={false}
        >
          <BurningCog cog={cog} />
        </group>
      ))}

      <BudgetedPointLight
        budgetPriority={8}
        ref={lightRef}
        position={[strike.centerPosition.x, strike.groundY + 4.2, strike.centerPosition.z]}
        color={0xff4a00}
        intensity={12}
        distance={GEARSTORM_RADIUS * 2.1}
        decay={2}
      />
    </group>
  );
}

interface AirStrikeTargetingIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

export function AirStrikeTargetingIndicator({ isActive, onTargetUpdate }: AirStrikeTargetingIndicatorProps) {
  const wasActiveRef = useRef(false);

  useFrame(() => {
    if (isActive && !wasActiveRef.current) {
      onTargetUpdate(null, false);
    }
    wasActiveRef.current = isActive;
  });

  return null;
}

export function useAirStrikes() {
  const [activeStrikes, setActiveStrikes] = useState<AirStrikeData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const now = getFrameClock().nowMs;
    let changed = lastRevisionRef.current !== airStrikeRevision;

    for (let i = airStrikes.length - 1; i >= 0; i--) {
      if (now - airStrikes[i].frameStartTime >= AIR_STRIKE_DURATION + 300) {
        airStrikes.splice(i, 1);
        changed = true;
      }
    }

    if (changed) {
      lastRevisionRef.current = airStrikeRevision;
      setActiveStrikes([...airStrikes]);
    }
  });

  return activeStrikes;
}

export function AirStrikeEffects() {
  const activeStrikes = useAirStrikes();

  return (
    <>
      {activeStrikes.map(strike => (
        <InfernalGearstormEffect key={strike.id} strike={strike} />
      ))}
    </>
  );
}
