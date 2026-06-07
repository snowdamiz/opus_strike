import { memo, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import type { HeroId } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  BLAZE_COLORS,
  HOOKSHOT_COLORS,
  PHANTOM_COLORS,
  SHARED_GEOMETRIES,
  getHookshotMaterials,
} from './effectResources';

type ViewmodelHeroId = Extract<HeroId, 'phantom' | 'hookshot' | 'blaze'>;

interface ViewmodelActionState {
  active: boolean;
  charging: boolean;
  targeting: boolean;
}

interface ViewmodelMaterialSet {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
}

interface HeroViewmodelProps {
  heroId: ViewmodelHeroId;
  action: ViewmodelActionState;
}

const VIEWMODEL_HEROES = new Set<HeroId>(['phantom', 'hookshot', 'blaze']);
const materialCache = new Map<ViewmodelHeroId, ViewmodelMaterialSet>();

const HERO_MATERIAL_COLORS: Record<ViewmodelHeroId, {
  armor: number;
  dark: number;
  metal: number;
  accent: number;
  glow: number;
  glass: number;
}> = {
  phantom: {
    armor: 0x302447,
    dark: 0x090612,
    metal: 0x211833,
    accent: PHANTOM_COLORS.violet,
    glow: PHANTOM_COLORS.lightPurple,
    glass: 0x251a3a,
  },
  hookshot: {
    armor: 0x1f3b4a,
    dark: 0x10242e,
    metal: HOOKSHOT_COLORS.metal,
    accent: HOOKSHOT_COLORS.energy,
    glow: HOOKSHOT_COLORS.energy,
    glass: 0x22d3ee,
  },
  blaze: {
    armor: 0x7c2d12,
    dark: 0x1f130d,
    metal: BLAZE_COLORS.metal,
    accent: BLAZE_COLORS.fireOrange,
    glow: BLAZE_COLORS.fireYellow,
    glass: 0xfb923c,
  },
};

function isViewmodelHero(heroId: HeroId | '' | null | undefined): heroId is ViewmodelHeroId {
  return Boolean(heroId && VIEWMODEL_HEROES.has(heroId));
}

function getViewmodelMaterials(heroId: ViewmodelHeroId): ViewmodelMaterialSet {
  const cached = materialCache.get(heroId);
  if (cached) return cached;

  const colors = HERO_MATERIAL_COLORS[heroId];
  const materials: ViewmodelMaterialSet = {
    armor: new THREE.MeshStandardMaterial({
      color: colors.armor,
      metalness: 0.3,
      roughness: 0.42,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: colors.dark,
      metalness: 0.24,
      roughness: 0.6,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: colors.metal,
      metalness: 0.76,
      roughness: 0.25,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.34,
      metalness: 0.2,
      roughness: 0.32,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: colors.glow,
      toneMapped: false,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: colors.glass,
      emissive: colors.glass,
      emissiveIntensity: 0.26,
      metalness: 0.1,
      roughness: 0.18,
    }),
  };

  materialCache.set(heroId, materials);
  return materials;
}

function getActionState(heroId: ViewmodelHeroId): ViewmodelActionState {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;

  switch (heroId) {
    case 'phantom':
      return {
        active: store.voidRays.some(ray => ray.ownerId === localPlayerId),
        charging: store.voidRayCharging,
        targeting: store.shadowStepTargeting,
      };
    case 'hookshot':
      return {
        active:
          store.hookProjectiles.some(hook => hook.ownerId === localPlayerId) ||
          store.dragHooks.some(hook => hook.ownerId === localPlayerId) ||
          store.grappleLines.some(line => line.ownerId === localPlayerId),
        charging: false,
        targeting: store.grappleTrapTargeting,
      };
    case 'blaze':
      return {
        active: store.flamethrowerActive || store.rockets.some(rocket => rocket.ownerId === localPlayerId),
        charging: false,
        targeting: store.bombTargeting || store.airStrikeTargeting,
      };
  }
}

function Forearm({
  side,
  materials,
  length = 0.34,
  width = 0.16,
  thickness = 0.13,
  positionZ = -0.24,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  length?: number;
  width?: number;
  thickness?: number;
  positionZ?: number;
}) {
  return (
    <group position={[side * 0.34, -0.58, positionZ]} rotation={[0.22, side * -0.18, side * -0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[width * 0.72, thickness, length]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.27, -0.06]} scale={[width, thickness * 0.7, length * 0.7]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.005, -length * 0.5]} scale={[width * 0.86, thickness, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.7, -0.09]} scale={[width * 0.56, Math.max(0.014, thickness * 0.2), length * 0.46]} />
    </group>
  );
}

function PhantomFist({
  side,
  materials,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
}) {
  const fingerRows = [-0.066, -0.022, 0.022, 0.066] as const;

  return (
    <group position={[side * 0.3, -0.52, -0.64]} rotation={[0.18, side * 0.78, side * -0.08]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[0.092, 0.124, 0.12]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.018, 0.006, 0.018]} scale={[0.076, 0.102, 0.074]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.052, 0, -0.014]} scale={[0.018, 0.105, 0.068]} />

      {fingerRows.map((y, index) => (
        <group key={y} position={[side * -0.006, y, -0.072]}>
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} scale={[0.106, 0.028, 0.052]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.026, 0, -0.026]} scale={[0.04, 0.026, 0.034]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[side * -0.028, 0, -0.034]} scale={[0.07, 0.026, 0.042]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.058, 0, -0.06]} scale={[0.02, 0.018, 0.022]} />
          {index === 1 && (
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * 0.052, 0, 0.012]} scale={[0.018, 0.019, 0.034]} />
          )}
        </group>
      ))}

      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={materials.metal}
        position={[side * 0.072, -0.042, -0.004]}
        rotation={[0, 0, side * 0.4]}
        scale={[0.05, 0.1, 0.062]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={materials.dark}
        position={[0, 0, 0.085]}
        scale={[0.074, 0.088, 0.038]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.sphere8}
        material={materials.glow}
        position={[side * -0.052, 0, -0.11]}
        scale={0.034}
      />
    </group>
  );
}

function PhantomViewmodel({ materials }: { materials: ViewmodelMaterialSet }) {
  return (
    <group position={[0, 0.28, -0.04]}>
      <Forearm side={-1} materials={materials} length={0.24} width={0.068} thickness={0.064} positionZ={-0.43} />
      <Forearm side={1} materials={materials} length={0.24} width={0.068} thickness={0.064} positionZ={-0.43} />
      <PhantomFist side={-1} materials={materials} />
      <PhantomFist side={1} materials={materials} />
    </group>
  );
}

function HookHand({
  side,
  materials,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
}) {
  const hookMaterials = getHookshotMaterials();

  return (
    <group position={[side * 0.34, -0.49, -0.54]} rotation={[0.08, side * -0.18, side * 0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, 0.01, 0.08]} scale={[0.2, 0.16, 0.22]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, 0.105, 0.04]} scale={[0.14, 0.03, 0.14]} />
      <mesh geometry={SHARED_GEOMETRIES.ring16} material={hookMaterials.ring} position={[0, 0, -0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[0.21, 0.21, 0.06]} />
      <mesh geometry={SHARED_GEOMETRIES.sphere8} material={hookMaterials.glow} position={[0, 0, -0.08]} scale={0.11} />

      <mesh geometry={SHARED_GEOMETRIES.cylinder8} material={hookMaterials.shaft} position={[0, 0, -0.27]} rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.34, 0.07]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder8} material={hookMaterials.crown} position={[0, 0, -0.45]} rotation={[0, 0, Math.PI / 2]} scale={[0.052, 0.26, 0.052]} />
      <mesh geometry={SHARED_GEOMETRIES.cone8} material={hookMaterials.tip} position={[0, 0, -0.64]} rotation={[Math.PI / 2, 0, 0]} scale={[0.08, 0.16, 0.08]} />

      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={hookMaterials.fluke}
        position={[side * 0.14, 0.01, -0.47]}
        rotation={[0.52, 0, side * 0.72]}
        scale={[0.048, 0.28, 0.048]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cone8}
        material={hookMaterials.tip}
        position={[side * 0.26, 0.035, -0.55]}
        rotation={[0.78, 0, side * 1.18]}
        scale={[0.07, 0.14, 0.052]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={hookMaterials.fluke}
        position={[side * -0.13, -0.01, -0.47]}
        rotation={[0.48, 0, side * -0.72]}
        scale={[0.045, 0.24, 0.045]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cone8}
        material={hookMaterials.tip}
        position={[side * -0.23, 0.02, -0.54]}
        rotation={[0.75, 0, side * -1.12]}
        scale={[0.062, 0.12, 0.048]}
      />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, -0.105, -0.28]} scale={[0.035, 0.035, 0.28]} />
    </group>
  );
}

function HookshotViewmodel({ materials }: { materials: ViewmodelMaterialSet }) {
  return (
    <group>
      <Forearm side={-1} materials={materials} length={0.32} width={0.17} />
      <Forearm side={1} materials={materials} length={0.32} width={0.17} />
      <HookHand side={-1} materials={materials} />
      <HookHand side={1} materials={materials} />
    </group>
  );
}

function RocketLauncher({
  side,
  materials,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
}) {
  return (
    <group position={[side * 0.33, -0.49, -0.55]} rotation={[0.07, side * -0.12, side * 0.05]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.02, 0.12]} scale={[0.2, 0.14, 0.28]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.metal} position={[0, 0, -0.14]} rotation={[Math.PI / 2, 0, 0]} scale={[0.15, 0.46, 0.15]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.dark} position={[0, 0, -0.39]} rotation={[Math.PI / 2, 0, 0]} scale={[0.17, 0.06, 0.17]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.glow} position={[0, 0, -0.43]} rotation={[Math.PI / 2, 0, 0]} scale={[0.092, 0.03, 0.092]} />

      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, 0.12, -0.12]} scale={[0.27, 0.08, 0.45]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.16, 0, -0.12]} scale={[0.07, 0.19, 0.4]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, 0.17, -0.16]} scale={[0.16, 0.025, 0.26]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.18, 0, -0.27]} scale={[0.025, 0.11, 0.18]} />

      {[-0.26, -0.12, 0.02].map(z => (
        <mesh key={z} geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.15, z]} scale={[0.2, 0.028, 0.035]} />
      ))}

      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.14, 0.12]} rotation={[0.28, 0, 0]} scale={[0.1, 0.18, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.glow} position={[0, -0.02, -0.48]} rotation={[Math.PI, 0, 0]} scale={[0.07, 0.16, 0.07]} />
    </group>
  );
}

function BlazeViewmodel({ materials }: { materials: ViewmodelMaterialSet }) {
  return (
    <group>
      <Forearm side={-1} materials={materials} length={0.34} width={0.18} />
      <Forearm side={1} materials={materials} length={0.34} width={0.18} />
      <RocketLauncher side={-1} materials={materials} />
      <RocketLauncher side={1} materials={materials} />
    </group>
  );
}

const HeroViewmodelInner = memo(function HeroViewmodelInner({ heroId, action }: HeroViewmodelProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const actionBlendRef = useRef(action.active || action.charging ? 1 : 0);
  const targetingBlendRef = useRef(action.targeting ? 1 : 0);
  const materials = useMemo(() => getViewmodelMaterials(heroId), [heroId]);

  useFrame((state, delta) => {
    if (!groupRef.current || !rootRef.current) return;

    const liveAction = getActionState(heroId);
    actionBlendRef.current = THREE.MathUtils.damp(
      actionBlendRef.current,
      liveAction.active || liveAction.charging ? 1 : 0,
      9,
      delta
    );
    targetingBlendRef.current = THREE.MathUtils.damp(
      targetingBlendRef.current,
      liveAction.targeting ? 1 : 0,
      10,
      delta
    );

    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);

    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 1.65) * 0.009;
    const sway = Math.sin(t * 0.92) * 0.006;
    const actionBlend = actionBlendRef.current;
    const targetingBlend = targetingBlendRef.current;

    rootRef.current.position.set(
      sway * 0.16,
      -0.055 + bob - targetingBlend * 0.09 + actionBlend * 0.025,
      0.17 - targetingBlend * 0.035 - actionBlend * 0.05
    );
    rootRef.current.rotation.set(
      -0.025 + targetingBlend * 0.09 - actionBlend * 0.035,
      sway * 0.07,
      Math.sin(t * 1.2) * 0.009
    );
  });

  return (
    <group ref={groupRef} frustumCulled={false} renderOrder={20}>
      <group ref={rootRef}>
        {heroId === 'phantom' && <PhantomViewmodel materials={materials} />}
        {heroId === 'hookshot' && <HookshotViewmodel materials={materials} />}
        {heroId === 'blaze' && <BlazeViewmodel materials={materials} />}
      </group>
    </group>
  );
});

export function HeroViewmodel() {
  const {
    heroId,
    playerState,
    gamePhase,
    actionActive,
    actionCharging,
    actionTargeting,
  } = useGameStore(
    useShallow(state => {
      const currentHeroId = state.localPlayer?.heroId ?? null;
      const viewmodelHeroId = isViewmodelHero(currentHeroId) ? currentHeroId : null;
      const localPlayerId = state.localPlayer?.id;

      return {
        heroId: viewmodelHeroId,
        playerState: state.localPlayer?.state ?? 'dead',
        gamePhase: state.gamePhase,
        actionActive: Boolean(
          viewmodelHeroId &&
          (
            (viewmodelHeroId === 'blaze' && state.flamethrowerActive) ||
            (viewmodelHeroId === 'phantom' && state.voidRays.some(ray => ray.ownerId === localPlayerId)) ||
            (viewmodelHeroId === 'hookshot' && state.hookProjectiles.some(hook => hook.ownerId === localPlayerId))
          )
        ),
        actionCharging: viewmodelHeroId === 'phantom' && state.voidRayCharging,
        actionTargeting: Boolean(
          viewmodelHeroId &&
          (
            (viewmodelHeroId === 'phantom' && state.shadowStepTargeting) ||
            (viewmodelHeroId === 'blaze' && (state.bombTargeting || state.airStrikeTargeting)) ||
            (viewmodelHeroId === 'hookshot' && state.grappleTrapTargeting)
          )
        ),
      };
    })
  );

  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  if (!heroId || !isPlaying || playerState !== 'alive') return null;

  return (
    <HeroViewmodelInner
      key={heroId}
      heroId={heroId}
      action={{
        active: actionActive,
        charging: actionCharging,
        targeting: actionTargeting,
      }}
    />
  );
}
