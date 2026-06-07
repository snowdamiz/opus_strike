import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HeroId, Team } from '@voxel-strike/shared';

type PartKind = 'box' | 'sphere' | 'cylinder';
type MaterialKind = 'armor' | 'dark' | 'accent' | 'glow' | 'glass' | 'skin';

interface VoxelPart {
  kind?: PartKind;
  material: MaterialKind;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  emissive?: boolean;
  transparent?: boolean;
}

interface HeroVoxelBodyProps {
  heroId: HeroId | null;
  team: Team;
  height: number;
  isBot?: boolean;
  isMoving?: boolean;
  hasFlag?: boolean;
  postureScaleY?: number;
}

const TEAM_COLORS: Record<Team, string> = {
  red: '#ef4444',
  blue: '#06b6d4',
};

const HERO_COLORS: Record<HeroId, Record<MaterialKind, string>> = {
  phantom: {
    armor: '#2a2138',
    dark: '#0b0711',
    accent: '#7c3aed',
    glow: '#c084fc',
    glass: '#6d28d9',
    skin: '#22162c',
  },
  hookshot: {
    armor: '#1f3b4a',
    dark: '#10242e',
    accent: '#14b8a6',
    glow: '#67e8f9',
    glass: '#22d3ee',
    skin: '#20313a',
  },
  blaze: {
    armor: '#7c2d12',
    dark: '#1f130d',
    accent: '#f97316',
    glow: '#facc15',
    glass: '#fb923c',
    skin: '#3a2118',
  },
  glacier: {
    armor: '#dbeafe',
    dark: '#1e3a5f',
    accent: '#38bdf8',
    glow: '#bfdbfe',
    glass: '#7dd3fc',
    skin: '#c7d2fe',
  },
  pulse: {
    armor: '#173225',
    dark: '#0d1f18',
    accent: '#22c55e',
    glow: '#86efac',
    glass: '#4ade80',
    skin: '#183326',
  },
  sentinel: {
    armor: '#53411d',
    dark: '#211b10',
    accent: '#eab308',
    glow: '#fde68a',
    glass: '#facc15',
    skin: '#3b3016',
  },
};

const HERO_PARTS: Record<HeroId, VoxelPart[]> = {
  phantom: [
    { material: 'dark', position: [0, 0.92, 0], scale: [0.42, 0.78, 0.26] },
    { material: 'armor', position: [0, 1.48, 0.01], scale: [0.52, 0.42, 0.44] },
    { material: 'dark', position: [0, 1.72, 0.03], scale: [0.36, 0.34, 0.34] },
    { material: 'armor', position: [0, 1.88, -0.03], scale: [0.62, 0.22, 0.48] },
    { material: 'glow', position: [-0.09, 1.75, -0.16], scale: [0.05, 0.05, 0.03], emissive: true },
    { material: 'glow', position: [0.09, 1.75, -0.16], scale: [0.05, 0.05, 0.03], emissive: true },
    { material: 'armor', position: [-0.36, 1.1, -0.05], scale: [0.16, 0.72, 0.18] },
    { material: 'armor', position: [0.36, 1.1, -0.05], scale: [0.16, 0.72, 0.18] },
    { material: 'dark', position: [-0.16, 0.38, 0], scale: [0.16, 0.68, 0.18] },
    { material: 'dark', position: [0.16, 0.38, 0], scale: [0.16, 0.68, 0.18] },
    { material: 'glass', position: [-0.28, 0.68, 0.18], scale: [0.12, 0.18, 0.08], transparent: true },
    { material: 'glass', position: [0.28, 0.68, 0.18], scale: [0.12, 0.18, 0.08], transparent: true },
  ],
  hookshot: [
    { material: 'armor', position: [0, 1.04, 0], scale: [0.58, 0.82, 0.34] },
    { material: 'dark', position: [0, 1.67, 0], scale: [0.42, 0.34, 0.38] },
    { material: 'glow', position: [0, 1.7, -0.19], scale: [0.32, 0.08, 0.04], emissive: true },
    { material: 'dark', position: [0, 1.16, 0.28], scale: [0.42, 0.46, 0.18] },
    { material: 'accent', position: [0.52, 1.08, -0.02], scale: [0.2, 0.68, 0.22] },
    { material: 'glow', position: [0.66, 1.18, -0.24], scale: [0.14, 0.14, 0.22], emissive: true },
    { material: 'armor', position: [-0.48, 1.06, 0], scale: [0.18, 0.64, 0.2] },
    { material: 'accent', position: [-0.18, 0.38, 0], scale: [0.18, 0.72, 0.2] },
    { material: 'accent', position: [0.18, 0.38, 0], scale: [0.18, 0.72, 0.2] },
    { material: 'glow', position: [-0.02, 1.14, -0.22], scale: [0.1, 0.1, 0.04], emissive: true },
  ],
  blaze: [
    { material: 'armor', position: [0, 1.02, 0], scale: [0.66, 0.84, 0.42] },
    { material: 'dark', position: [0, 1.68, 0], scale: [0.46, 0.34, 0.42] },
    { material: 'glow', position: [0, 1.7, -0.22], scale: [0.34, 0.08, 0.04], emissive: true },
    { material: 'dark', position: [-0.2, 1.2, 0.34], scale: [0.18, 0.62, 0.18] },
    { material: 'dark', position: [0.2, 1.2, 0.34], scale: [0.18, 0.62, 0.18] },
    { material: 'glow', position: [-0.2, 0.76, 0.44], scale: [0.12, 0.18, 0.12], emissive: true },
    { material: 'glow', position: [0.2, 0.76, 0.44], scale: [0.12, 0.18, 0.12], emissive: true },
    { material: 'armor', position: [-0.48, 1.04, -0.02], scale: [0.18, 0.66, 0.2] },
    { material: 'armor', position: [0.48, 1.04, -0.02], scale: [0.18, 0.66, 0.2] },
    { material: 'dark', position: [-0.2, 0.36, 0], scale: [0.2, 0.72, 0.22] },
    { material: 'dark', position: [0.2, 0.36, 0], scale: [0.2, 0.72, 0.22] },
  ],
  glacier: [
    { material: 'armor', position: [0, 1.0, 0], scale: [0.82, 0.92, 0.46] },
    { material: 'dark', position: [0, 1.74, 0], scale: [0.48, 0.36, 0.42] },
    { material: 'glass', position: [-0.36, 1.4, -0.02], scale: [0.22, 0.32, 0.18], transparent: true },
    { material: 'glass', position: [0.36, 1.4, -0.02], scale: [0.22, 0.32, 0.18], transparent: true },
    { material: 'accent', position: [-0.62, 1.02, 0], scale: [0.28, 0.72, 0.28] },
    { material: 'accent', position: [0.62, 1.02, 0], scale: [0.28, 0.72, 0.28] },
    { material: 'glass', position: [-0.72, 0.7, -0.06], scale: [0.32, 0.26, 0.28], transparent: true },
    { material: 'glass', position: [0.72, 0.7, -0.06], scale: [0.32, 0.26, 0.28], transparent: true },
    { material: 'dark', position: [-0.24, 0.34, 0], scale: [0.26, 0.68, 0.28] },
    { material: 'dark', position: [0.24, 0.34, 0], scale: [0.26, 0.68, 0.28] },
    { material: 'glow', position: [0, 1.1, -0.25], scale: [0.2, 0.12, 0.04], emissive: true },
  ],
  pulse: [
    { material: 'armor', position: [0, 1.0, 0], scale: [0.44, 0.78, 0.28] },
    { material: 'dark', position: [0, 1.64, 0], scale: [0.34, 0.32, 0.32] },
    { material: 'glow', position: [0, 1.08, -0.18], scale: [0.16, 0.16, 0.04], emissive: true },
    { material: 'glow', position: [0, 1.66, -0.18], scale: [0.26, 0.06, 0.04], emissive: true },
    { material: 'accent', position: [-0.34, 1.04, 0], scale: [0.12, 0.64, 0.14] },
    { material: 'accent', position: [0.34, 1.04, 0], scale: [0.12, 0.64, 0.14] },
    { material: 'dark', position: [-0.14, 0.34, 0], scale: [0.14, 0.68, 0.16] },
    { material: 'dark', position: [0.14, 0.34, 0], scale: [0.14, 0.68, 0.16] },
    { material: 'glow', position: [-0.28, 0.22, 0.08], scale: [0.04, 0.38, 0.04], emissive: true },
    { material: 'glow', position: [0.28, 0.22, 0.08], scale: [0.04, 0.38, 0.04], emissive: true },
  ],
  sentinel: [
    { material: 'armor', position: [0, 0.98, 0], scale: [0.74, 0.86, 0.44] },
    { material: 'dark', position: [0, 1.68, 0], scale: [0.46, 0.34, 0.4] },
    { material: 'accent', position: [0, 1.93, 0], scale: [0.12, 0.24, 0.18] },
    { material: 'glow', position: [0, 1.68, -0.22], scale: [0.3, 0.06, 0.04], emissive: true },
    { material: 'armor', position: [-0.5, 1.02, -0.02], scale: [0.18, 0.64, 0.2] },
    { material: 'accent', position: [0.62, 1.0, -0.12], scale: [0.16, 0.88, 0.62] },
    { material: 'glow', position: [0.7, 1.0, -0.47], scale: [0.06, 0.7, 0.04], emissive: true },
    { material: 'dark', position: [-0.24, 0.34, 0], scale: [0.24, 0.68, 0.26] },
    { material: 'dark', position: [0.24, 0.34, 0], scale: [0.24, 0.68, 0.26] },
  ],
};

function PartGeometry({ part }: { part: VoxelPart }) {
  switch (part.kind) {
    case 'sphere':
      return <sphereGeometry args={[0.5, 10, 8]} />;
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 8]} />;
    default:
      return <boxGeometry args={[1, 1, 1]} />;
  }
}

export const HeroVoxelBody = memo(function HeroVoxelBody({
  heroId,
  team,
  height,
  isBot = false,
  isMoving = false,
  hasFlag = false,
  postureScaleY = 1,
}: HeroVoxelBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const resolvedHero = heroId || 'phantom';
  const scale = height / 1.8;
  const verticalScale = Math.max(0.45, Math.min(1, postureScaleY));
  const teamColor = TEAM_COLORS[team];
  const parts = HERO_PARTS[resolvedHero];
  const colors = HERO_COLORS[resolvedHero];

  const materials = useMemo(() => {
    const materialByKind = new Map<MaterialKind, THREE.MeshStandardMaterial>();
    (Object.keys(colors) as MaterialKind[]).forEach((kind) => {
      const baseColor = kind === 'accent' && isBot ? teamColor : colors[kind];
      materialByKind.set(kind, new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: kind === 'glow' ? new THREE.Color(baseColor) : new THREE.Color('#000000'),
        emissiveIntensity: kind === 'glow' ? (hasFlag ? 0.9 : 0.45) : 0,
        roughness: kind === 'glass' ? 0.25 : 0.75,
        metalness: kind === 'armor' || kind === 'accent' ? 0.25 : 0.05,
        transparent: kind === 'glass',
        opacity: kind === 'glass' ? 0.68 : 1,
      }));
    });
    return materialByKind;
  }, [colors, hasFlag, isBot, teamColor]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const bob = isMoving ? Math.sin(state.clock.elapsedTime * 8) * 0.025 : Math.sin(state.clock.elapsedTime * 2) * 0.01;
    groupRef.current.position.y = bob;
  });

  return (
    <group ref={groupRef} scale={[scale, scale * verticalScale, scale]}>
      {parts.map((part, index) => (
        <mesh
          key={`${resolvedHero}-${index}`}
          position={part.position}
          rotation={part.rotation}
          scale={part.scale}
          castShadow
        >
          <PartGeometry part={part} />
          <primitive object={materials.get(part.material)!} attach="material" />
        </mesh>
      ))}

      <mesh position={[-0.34, 0.96, -0.23]} scale={[0.08, 0.42, 0.04]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0.34, 0.96, -0.23]} scale={[0.08, 0.42, 0.04]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.35} />
      </mesh>

      {isBot && (
        <mesh position={[0, 1.98, 0]} scale={[0.14, 0.04, 0.14]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.75} />
        </mesh>
      )}
    </group>
  );
});
