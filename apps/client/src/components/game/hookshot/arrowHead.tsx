import * as THREE from 'three';
import { HOOKSHOT_COLORS, SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';

export interface HookshotArrowMaterials {
  shaft: THREE.Material;
  tip: THREE.Material;
  glow: THREE.Material;
  core?: THREE.Material;
  ring?: THREE.Material;
}

export const HOOKSHOT_ARROW_TIP_Z = -0.15;

const HOOKSHOT_ARROW_REAR_Z = -0.052;
const HOOKSHOT_ARROW_LIGHT_Z = -0.132;
const HOOKSHOT_ARROW_HALF_WIDTH = 0.132;

const HOOKSHOT_CHEVRON_POINTS = [
  new THREE.Vector3(-HOOKSHOT_ARROW_HALF_WIDTH, 0, HOOKSHOT_ARROW_REAR_Z),
  new THREE.Vector3(0, 0, HOOKSHOT_ARROW_TIP_Z),
  new THREE.Vector3(HOOKSHOT_ARROW_HALF_WIDTH, 0, HOOKSHOT_ARROW_REAR_Z),
] as const;

const HOOKSHOT_CHEVRON_SEGMENTS = createHookshotChevronSegments();

function createHookshotChevronSegments() {
  const pairs = [
    [HOOKSHOT_CHEVRON_POINTS[0], HOOKSHOT_CHEVRON_POINTS[1]],
    [HOOKSHOT_CHEVRON_POINTS[1], HOOKSHOT_CHEVRON_POINTS[2]],
  ] as const;

  return pairs.map(([start, end]) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return {
      length,
      position: [
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5,
      ] as [number, number, number],
      rotation: [0, Math.atan2(dx, dz), 0] as [number, number, number],
    };
  });
}

function HookshotChevronBars({
  material,
  thickness,
}: {
  material: THREE.Material;
  thickness: number;
}) {
  return (
    <>
      {HOOKSHOT_CHEVRON_SEGMENTS.map((segment, index) => (
        <mesh
          key={index}
          geometry={SHARED_GEOMETRIES.box}
          material={material}
          position={segment.position}
          rotation={segment.rotation}
          scale={[thickness, thickness, segment.length]}
        />
      ))}
    </>
  );
}

function HookshotChevronCross({
  material,
  thickness,
}: {
  material: THREE.Material;
  thickness: number;
}) {
  return (
    <>
      <HookshotChevronBars material={material} thickness={thickness} />
      <group rotation={[0, 0, Math.PI / 2]}>
        <HookshotChevronBars material={material} thickness={thickness} />
      </group>
    </>
  );
}

export function HookshotViewmodelArrow({
  materials,
  lightIntensity = 1.8,
}: {
  side: -1 | 1;
  materials: HookshotArrowMaterials;
  lightIntensity?: number;
}) {
  return (
    <group>
      <HookshotChevronCross material={materials.glow} thickness={0.036} />
      <HookshotChevronCross material={materials.tip} thickness={0.026} />
      <BudgetedPointLight
        budgetPriority={1.3}
        color={HOOKSHOT_COLORS.energy}
        intensity={lightIntensity * 1.35}
        distance={2.8}
        decay={2}
        position={[0, 0, HOOKSHOT_ARROW_LIGHT_Z]}
      />
    </group>
  );
}

export function HookshotProjectileArrowHead({
  materials,
  scale = 1,
  lightPriority = 2,
  lightIntensity = 2.4,
  lightDistance = 3.4,
  includeBackRing = true,
}: {
  materials: HookshotArrowMaterials;
  scale?: number;
  lightPriority?: number;
  lightIntensity?: number;
  lightDistance?: number;
  includeBackRing?: boolean;
}) {
  return (
    <group scale={[scale, scale, scale]}>
      {includeBackRing && (
        <mesh
          position={[0, 0, 0.02]}
          rotation={[Math.PI / 2, 0, 0]}
          geometry={SHARED_GEOMETRIES.ring16}
          scale={[0.11, 0.11, 0.035]}
          material={materials.ring ?? materials.shaft}
        />
      )}

      <HookshotChevronCross material={materials.glow} thickness={0.036} />
      <HookshotChevronCross material={materials.tip} thickness={0.026} />
      <BudgetedPointLight
        budgetPriority={lightPriority}
        color={HOOKSHOT_COLORS.energy}
        intensity={lightIntensity}
        distance={lightDistance}
        decay={2}
        position={[0, 0, HOOKSHOT_ARROW_LIGHT_Z]}
      />
    </group>
  );
}
