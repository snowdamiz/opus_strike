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

const HOOKSHOT_VIEWMODEL_CHEVRON_GLOW_GEOMETRY = createHookshotForwardChevronGeometry(0.026);
const HOOKSHOT_VIEWMODEL_CHEVRON_CORE_GEOMETRY = createHookshotForwardChevronGeometry(0.012);

function createHookshotForwardChevronGeometry(radius: number): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-0.145, 0, -0.025),
      new THREE.Vector3(-0.036, 0, -0.122),
      new THREE.Vector3(0, 0, -0.165),
      new THREE.Vector3(0.036, 0, -0.122),
      new THREE.Vector3(0.145, 0, -0.025),
    ],
    false,
    'centripetal',
    0.5
  );
  return new THREE.TubeGeometry(curve, 24, radius, 8, false);
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
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_GLOW_GEOMETRY}
        material={materials.glow}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_GLOW_GEOMETRY}
        material={materials.glow}
        rotation={[0, 0, Math.PI / 2]}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_CORE_GEOMETRY}
        material={materials.tip}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_CORE_GEOMETRY}
        material={materials.tip}
        rotation={[0, 0, Math.PI / 2]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.sphere8}
        material={materials.glow}
        position={[0, 0, -0.165]}
        scale={0.052}
      />
      <BudgetedPointLight
        budgetPriority={1.3}
        color={HOOKSHOT_COLORS.energy}
        intensity={lightIntensity * 1.35}
        distance={2.8}
        decay={2}
        position={[0, 0, -0.145]}
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

      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_GLOW_GEOMETRY}
        material={materials.glow}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_GLOW_GEOMETRY}
        material={materials.glow}
        rotation={[0, 0, Math.PI / 2]}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_CORE_GEOMETRY}
        material={materials.tip}
      />
      <mesh
        geometry={HOOKSHOT_VIEWMODEL_CHEVRON_CORE_GEOMETRY}
        material={materials.tip}
        rotation={[0, 0, Math.PI / 2]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.sphere8}
        material={materials.glow}
        position={[0, 0, -0.165]}
        scale={0.052}
      />
      <BudgetedPointLight
        budgetPriority={lightPriority}
        color={HOOKSHOT_COLORS.energy}
        intensity={lightIntensity}
        distance={lightDistance}
        decay={2}
        position={[0, 0, -0.145]}
      />
    </group>
  );
}
