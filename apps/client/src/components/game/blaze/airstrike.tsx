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
const GEARSTORM_COG_COUNT = 60;
const GEARSTORM_BURN_PATCH_COUNT = 112;
const GEARSTORM_GROUND_FLAME_COUNT = 112;
const GEARSTORM_GROUND_RAY_START_HEIGHT = 96;
const GEARSTORM_GROUND_RAY_DISTANCE = 220;
const GROUND_FILL_OFFSET = 0.09;
const GROUND_RING_OFFSET = 0.13;
const GROUND_HOT_CORE_OFFSET = 0.16;
const GROUND_PATCH_OFFSET = 0.18;
const GROUND_FLAME_OFFSET = 0.12;
const COG_TEETH = 18;
const COG_DEPTH = 0.34;
const COG_FIRE_ORANGE = 0xff6a00;
const GROUND_FLAME_PLANE_ANGLES = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function createGearShape(teeth: number, rootRadius: number, outerRadius: number, innerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const sector = (Math.PI * 2) / teeth;
  const points: THREE.Vector2[] = [];

  for (let tooth = 0; tooth < teeth; tooth++) {
    const baseAngle = tooth * sector;
    const toothPoints: Array<[number, number]> = [
      [0.02, rootRadius],
      [0.16, outerRadius],
      [0.46, outerRadius],
      [0.6, rootRadius],
      [0.96, rootRadius],
    ];

    toothPoints.forEach(([sectorPosition, radius]) => {
      const angle = baseAngle + sectorPosition * sector;
      points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
    });
  }

  points.forEach((point, index) => {
    if (index === 0) {
      shape.moveTo(point.x, point.y);
      return;
    }
    shape.lineTo(point.x, point.y);
  });
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

function createRingShape(innerRadius: number, outerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

function createDiscShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

function createExtrudedGeometry(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createFlameShape(tipLean: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.48, 0.08, -0.52, 0.34, -0.28, 0.56);
  shape.bezierCurveTo(-0.2, 0.72, -0.12, 0.86, tipLean, 1);
  shape.bezierCurveTo(0.2, 0.8, 0.5, 0.62, 0.34, 0.36);
  shape.bezierCurveTo(0.5, 0.18, 0.36, 0.04, 0, 0);
  return shape;
}

const COG_BODY_GEOMETRY = createExtrudedGeometry(
  createGearShape(COG_TEETH, 0.86, 1.16, 0.42),
  COG_DEPTH
);
const COG_INNER_RING_GEOMETRY = createExtrudedGeometry(createRingShape(0.36, 0.58), COG_DEPTH * 1.12);
const COG_HUB_GEOMETRY = createExtrudedGeometry(createDiscShape(0.2), COG_DEPTH * 1.28);
const GROUND_FLAME_OUTER_GEOMETRY = new THREE.ShapeGeometry(createFlameShape(-0.04));
const GROUND_FLAME_INNER_GEOMETRY = new THREE.ShapeGeometry(createFlameShape(0.12));

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

  const groundCheck = checkGroundWithNormal(
    x,
    fallbackY + GEARSTORM_GROUND_RAY_START_HEIGHT,
    z,
    GEARSTORM_GROUND_RAY_DISTANCE,
    {
      priority: 'visual',
      feature: 'effect:blazeAirstrikeGround',
    }
  );

  return groundCheck ? groundCheck.groundY : fallbackY;
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
      height: 2.2 + Math.random() * 4.6,
      size: 0.92 + Math.random() * 1.0,
      spinSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.38 + Math.random() * 0.42),
      orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.025 + Math.random() * 0.045),
      bobSpeed: 0.7 + Math.random() * 0.85,
      bobAmount: 0.22 + Math.random() * 0.42,
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
      radius: 0.28 + Math.random() * 0.4,
      height: 0.85 + Math.random() * 1.65,
      phase: Math.random(),
      flickerSpeed: 0.58 + Math.random() * 0.62,
      dutyCycle: 0.36 + Math.random() * 0.22,
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
      <mesh geometry={COG_BODY_GEOMETRY}>
        <meshStandardMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.56}
          depthWrite={false}
          emissive={COG_FIRE_ORANGE}
          emissiveIntensity={0.42}
          roughness={0.42}
          metalness={0.15}
        />
      </mesh>

      <mesh geometry={COG_INNER_RING_GEOMETRY} position-z={0.03}>
        <meshStandardMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.42}
          depthWrite={false}
          emissive={COG_FIRE_ORANGE}
          emissiveIntensity={0.36}
          roughness={0.46}
          metalness={0.12}
        />
      </mesh>

      <mesh geometry={COG_HUB_GEOMETRY} position-z={0.07}>
        <meshStandardMaterial
          color={COG_FIRE_ORANGE}
          transparent
          opacity={0.5}
          depthWrite={false}
          emissive={COG_FIRE_ORANGE}
          emissiveIntensity={0.46}
          roughness={0.4}
          metalness={0.16}
        />
      </mesh>
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
      position={[flame.x, flame.groundY + GROUND_FLAME_OFFSET, flame.z]}
      rotation={[flame.leanX, flame.yaw, flame.leanZ]}
      visible={false}
    >
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={0.015}
        geometry={SHARED_GEOMETRIES.ring16}
        scale={[flame.radius * 1.28, flame.radius * 1.28, 1]}
      >
        <meshBasicMaterial
          color={0xff7a00}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>
      <mesh
        geometry={SHARED_GEOMETRIES.sphere8}
        position-y={flame.height * 0.24}
        scale={[flame.radius * 0.72, flame.height * 0.32, flame.radius * 0.72]}
      >
        <meshBasicMaterial
          color={0xff5a00}
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {GROUND_FLAME_PLANE_ANGLES.map((angle, index) => (
        <group key={index} rotation-y={angle}>
          <mesh
            geometry={GROUND_FLAME_OUTER_GEOMETRY}
            scale={[flame.radius, flame.height, 1]}
          >
            <meshBasicMaterial
              color={0xff5a00}
              transparent
              opacity={0.68}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh
            geometry={GROUND_FLAME_INNER_GEOMETRY}
            position-y={flame.height * 0.03}
            scale={[flame.radius * 0.58, flame.height * 0.78, 1]}
          >
            <meshBasicMaterial
              color={0xffd36a}
              transparent
              opacity={0.56}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
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
      const bloom = active ? Math.sin(flameLife * Math.PI) * fade : 0;
      const shimmer = 0.88 + Math.sin(elapsed * 0.028 + flame.phase * 17.31) * 0.12;
      const flameHeight = 0.34 + bloom * 0.92;

      flameGroup.visible = bloom > 0.035;
      flameGroup.position.y = flame.groundY + GROUND_FLAME_OFFSET + bloom * 0.08;
      flameGroup.rotation.y = flame.yaw + Math.sin(elapsedSeconds * 2.1 + flame.phase * Math.PI * 2) * 0.2;
      flameGroup.scale.set(
        (0.82 + bloom * 0.36) * shimmer,
        flameHeight,
        (0.82 + bloom * 0.3) * (1.76 - shimmer)
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
        cog.yaw + elapsedSeconds * 0.12 + cog.tiltY,
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
        position={[strike.centerPosition.x, strike.groundY + GROUND_FILL_OFFSET, strike.centerPosition.z]}
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
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <mesh
        ref={groundRingRef}
        position={[strike.centerPosition.x, strike.groundY + GROUND_RING_OFFSET, strike.centerPosition.z]}
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
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <mesh
        ref={groundHotCoreRef}
        position={[strike.centerPosition.x, strike.groundY + GROUND_HOT_CORE_OFFSET, strike.centerPosition.z]}
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
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      {strike.burnPatches.map((patch, index) => (
        <mesh
          key={index}
          ref={element => patchRefs.current[index] = element}
          position={[patch.x, patch.groundY + GROUND_PATCH_OFFSET, patch.z]}
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
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-4}
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
