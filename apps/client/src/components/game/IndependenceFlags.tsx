import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelMapManifest } from '@voxel-strike/shared';

/**
 * Decorative waving American flags placed in a ring around the arena for the Independence
 * Day event biome. Positions are derived deterministically from the map manifest so every
 * client renders the same layout, and flags sit on the terrain surface via the heightfield
 * while steering clear of spawn/flag objective zones.
 */

interface IndependenceFlagsProps {
  manifest: VoxelMapManifest;
}

interface FlagPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const FLAG_COUNT = 14;
const POLE_HEIGHT = 3.4;
const CLOTH_WIDTH = 1.7;
const CLOTH_HEIGHT = 0.95;

let sharedFlagTexture: THREE.Texture | null = null;

/** A little stars-and-stripes canvas texture, built once and shared across every flag. */
function getUsFlagTexture(): THREE.Texture | null {
  if (sharedFlagTexture) return sharedFlagTexture;
  if (typeof document === 'undefined') return null;

  const width = 96;
  const height = 51; // ~1.9:1, the US flag ratio.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stripeHeight = height / 13;
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
    ctx.fillRect(0, i * stripeHeight, width, stripeHeight + 1);
  }

  const cantonWidth = width * 0.4;
  const cantonHeight = stripeHeight * 7;
  ctx.fillStyle = '#3c3b6e';
  ctx.fillRect(0, 0, cantonWidth, cantonHeight);

  ctx.fillStyle = '#ffffff';
  const starRows = 9;
  const starCols = 11;
  for (let row = 0; row < starRows; row++) {
    for (let col = 0; col < starCols; col++) {
      if ((row + col) % 2 !== 0) continue;
      const sx = ((col + 1) / (starCols + 1)) * cantonWidth;
      const sy = ((row + 1) / (starRows + 1)) * cantonHeight;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  sharedFlagTexture = texture;
  return texture;
}

function pointInPolygon(x: number, z: number, polygon: Array<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function sampleSurfaceY(manifest: VoxelMapManifest, x: number, z: number): number {
  const field = manifest.heightfield;
  const gx = Math.round((x - field.origin.x) / field.voxelSize.x);
  const gz = Math.round((z - field.origin.z) / field.voxelSize.z);
  const cx = Math.min(Math.max(gx, 0), field.size.x - 1);
  const cz = Math.min(Math.max(gz, 0), field.size.z - 1);
  const rows = field.topSolidRows[cx + cz * field.size.x] ?? 0;
  return field.origin.y + rows * field.voxelSize.y;
}

function computePlacements(manifest: VoxelMapManifest): FlagPlacement[] {
  const boundary = manifest.boundary;
  if (!boundary || boundary.length < 3) return [];

  let centerX = 0;
  let centerZ = 0;
  for (const point of boundary) {
    centerX += point.x;
    centerZ += point.z;
  }
  centerX /= boundary.length;
  centerZ /= boundary.length;

  let avgRadius = 0;
  for (const point of boundary) {
    avgRadius += Math.hypot(point.x - centerX, point.z - centerZ);
  }
  avgRadius /= boundary.length;
  const ringRadius = avgRadius * 0.7;

  const protectedZones = [
    { x: manifest.flagZones.red.x, z: manifest.flagZones.red.z, radiusSq: 8 ** 2 },
    { x: manifest.flagZones.blue.x, z: manifest.flagZones.blue.z, radiusSq: 8 ** 2 },
    ...Object.values(manifest.spawnPoints).flatMap((points) =>
      points.map((spawn) => ({ x: spawn.x, z: spawn.z, radiusSq: 6.5 ** 2 }))
    ),
  ];

  const placements: FlagPlacement[] = [];
  for (let i = 0; i < FLAG_COUNT; i++) {
    const angle = (i / FLAG_COUNT) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * ringRadius;
    const z = centerZ + Math.sin(angle) * ringRadius;
    if (!pointInPolygon(x, z, boundary)) continue;

    const blocked = protectedZones.some(
      (zone) => (x - zone.x) ** 2 + (z - zone.z) ** 2 < zone.radiusSq
    );
    if (blocked) continue;

    placements.push({
      x,
      y: sampleSurfaceY(manifest, x, z),
      z,
      // Face the pole roughly outward from the arena centre.
      yaw: angle + Math.PI / 2,
    });
  }

  return placements;
}

function WavingFlag({ placement, texture }: { placement: FlagPlacement; texture: THREE.Texture | null }) {
  const clothRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const cloth = clothRef.current;
    if (!cloth) return;
    const geometry = cloth.geometry as THREE.PlaneGeometry;
    const position = geometry.getAttribute('position');
    const time = state.clock.elapsedTime;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      // Anchor the mast edge (local x = -half) and let the free edge ripple further.
      const anchor = (x + CLOTH_WIDTH / 2) / CLOTH_WIDTH;
      const wave = Math.sin(x * 3.2 + time * 5) * 0.12 * anchor + Math.sin(x * 6 + time * 7) * 0.04 * anchor;
      position.setZ(i, wave);
    }
    position.needsUpdate = true;
  });

  return (
    <group position={[placement.x, placement.y, placement.z]} rotation={[0, placement.yaw, 0]}>
      {/* Pole */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.06, POLE_HEIGHT, 8]} />
        <meshStandardMaterial color="#c9ccd6" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Gold finial */}
      <mesh position={[0, POLE_HEIGHT + 0.08, 0]}>
        <sphereGeometry args={[0.11, 10, 10]} />
        <meshStandardMaterial color="#ffd76a" metalness={0.7} roughness={0.3} emissive="#5a4300" emissiveIntensity={0.4} />
      </mesh>
      {/* Cloth */}
      <mesh
        ref={clothRef}
        position={[CLOTH_WIDTH / 2 + 0.05, POLE_HEIGHT - CLOTH_HEIGHT / 2 - 0.15, 0]}
        castShadow
      >
        <planeGeometry args={[CLOTH_WIDTH, CLOTH_HEIGHT, 12, 6]} />
        <meshStandardMaterial
          map={texture ?? undefined}
          color={texture ? '#ffffff' : '#b22234'}
          emissive="#20263f"
          emissiveIntensity={0.35}
          roughness={0.85}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function IndependenceFlags({ manifest }: IndependenceFlagsProps) {
  const placements = useMemo(() => computePlacements(manifest), [manifest]);
  const texture = useMemo(() => getUsFlagTexture(), []);

  if (placements.length === 0) return null;

  return (
    <group name="independence-flags">
      {placements.map((placement, index) => (
        <WavingFlag key={`${placement.x.toFixed(1)}:${placement.z.toFixed(1)}:${index}`} placement={placement} texture={texture} />
      ))}
    </group>
  );
}
