import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type EarthWallData } from '../../../store/gameStore';
import {
  addTemporaryWallCollider,
  removeTemporaryWallCollider,
} from '../../../hooks/usePhysics';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import {
  SHARED_GEOMETRIES,
  EARTH_COLORS,
  HOOKSHOT_COLORS,
} from '../effectResources';

// ============================================================================
// ANCHOR WALL - Hookshot Q ability
// A ground anchor tears forward and lifts a temporary solid barricade.
// ============================================================================

const ANCHOR_WALL_SPEED = 42;
const ANCHOR_WALL_SEGMENT_SPACING = 2.35;
const ANCHOR_WALL_FIRST_SEGMENT_DISTANCE = 6.25;
const ANCHOR_WALL_MAX_HEIGHT = 4.15;
const ANCHOR_WALL_WIDTH = 3.25;
const ANCHOR_WALL_DEPTH = 1.05;
const ANCHOR_WALL_RISE_SPEED = 14;
const ANCHOR_WALL_COLLAPSE_DURATION = 1.15;
const ANCHOR_WALL_SEGMENT_BACKSET = 0.85;
const ANCHOR_WALL_COLLIDER_PREFIX = 'anchorwall_';

const STUD_INDICES = [0, 1, 2, 3];
const DEBRIS_INDICES = [0, 1, 2, 3, 4];

const ANCHOR_WALL_MATERIALS = {
  slab: new THREE.MeshStandardMaterial({
    color: 0x2f3338,
    roughness: 0.78,
    metalness: 0.42,
  }),
  slabAlt: new THREE.MeshStandardMaterial({
    color: 0x252b31,
    roughness: 0.82,
    metalness: 0.36,
  }),
  slabDark: new THREE.MeshStandardMaterial({
    color: 0x191d22,
    roughness: 0.88,
    metalness: 0.25,
  }),
  edge: new THREE.MeshStandardMaterial({
    color: 0x59616d,
    roughness: 0.55,
    metalness: 0.72,
  }),
  rock: new THREE.MeshStandardMaterial({
    color: EARTH_COLORS.rock,
    roughness: 0.94,
    metalness: 0.08,
  }),
  glow: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  coreGlow: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  hookShaft: new THREE.MeshStandardMaterial({
    color: HOOKSHOT_COLORS.metalLight,
    metalness: 0.9,
    roughness: 0.22,
  }),
  hookTip: new THREE.MeshStandardMaterial({
    color: HOOKSHOT_COLORS.hookTip,
    metalness: 0.96,
    roughness: 0.12,
  }),
  ringGlow: new THREE.MeshBasicMaterial({
    color: HOOKSHOT_COLORS.energy,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
};

interface AnchorWallSegmentData {
  id: string;
  x: number;
  y: number;
  z: number;
  height: number;
  width: number;
  depth: number;
}

function seededRange(index: number, salt: number, min: number, max: number): number {
  const raw = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  const unit = raw - Math.floor(raw);
  return min + unit * (max - min);
}

function releaseColliderSet(ids: Set<string>): void {
  for (const id of ids) {
    removeTemporaryWallCollider(id);
  }
  ids.clear();
}

const WallSegment = React.memo(function WallSegment({
  segment,
  index,
  rotationY,
  wallStartTime,
  wallDuration,
}: {
  segment: AnchorWallSegmentData;
  index: number;
  rotationY: number;
  wallStartTime: number;
  wallDuration: number;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const currentHeightRef = useRef(0.05);

  const faceInset = seededRange(index, 1, -0.14, 0.14);
  const capTilt = seededRange(index, 2, -0.07, 0.07);
  const ribShift = seededRange(index, 3, -0.18, 0.18);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const wallAge = (Date.now() - wallStartTime) / 1000;
    const collapseProgress = Math.min(
      Math.max((wallAge - wallDuration) / ANCHOR_WALL_COLLAPSE_DURATION, 0),
      1
    );
    const liveHeight = segment.height * (1 - collapseProgress * collapseProgress);

    if (collapseProgress > 0) {
      currentHeightRef.current = Math.max(0.01, liveHeight);
    } else if (currentHeightRef.current < segment.height) {
      currentHeightRef.current = Math.min(
        currentHeightRef.current + ANCHOR_WALL_RISE_SPEED * delta,
        segment.height
      );
    }

    const height = currentHeightRef.current;
    meshRef.current.position.set(
      segment.x,
      segment.y + height / 2 - collapseProgress * 0.28,
      segment.z
    );
    meshRef.current.scale.set(1, Math.max(0.01, height), 1);
  });

  return (
    <group ref={meshRef} position={[segment.x, segment.y, segment.z]} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={SHARED_GEOMETRIES.box}
        material={index % 2 === 0 ? ANCHOR_WALL_MATERIALS.slab : ANCHOR_WALL_MATERIALS.slabAlt}
        scale={[segment.width, 1, segment.depth]}
      />

      <mesh
        position={[faceInset, 0.03, segment.depth * 0.54]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.slabDark}
        scale={[segment.width * 0.78, 0.74, 0.08]}
      />

      <mesh
        position={[faceInset * -0.8, 0.04, -segment.depth * 0.54]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.slabDark}
        scale={[segment.width * 0.72, 0.68, 0.08]}
      />

      <mesh
        position={[0, 0.52, 0]}
        rotation={[0, 0, capTilt]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.edge}
        scale={[segment.width * 1.04, 0.13, segment.depth * 1.12]}
      />

      <mesh
        position={[0, -0.5, 0]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.edge}
        scale={[segment.width * 1.08, 0.16, segment.depth * 1.22]}
      />

      <mesh
        position={[-segment.width * 0.46, 0, 0]}
        rotation={[0, 0, 0.08]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.edge}
        scale={[0.16, 1.12, segment.depth * 1.22]}
      />
      <mesh
        position={[segment.width * 0.46, 0, 0]}
        rotation={[0, 0, -0.08]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.edge}
        scale={[0.16, 1.1, segment.depth * 1.22]}
      />

      <mesh
        position={[ribShift, 0.18, segment.depth * 0.61]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.glow}
        scale={[segment.width * 0.78, 0.035, 0.08]}
      />
      <mesh
        position={[ribShift * -0.7, -0.12, -segment.depth * 0.61]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.glow}
        scale={[segment.width * 0.62, 0.035, 0.08]}
      />
      <mesh
        position={[0, 0.48, 0]}
        geometry={SHARED_GEOMETRIES.box}
        material={ANCHOR_WALL_MATERIALS.coreGlow}
        scale={[segment.width * 0.24, 0.035, segment.depth * 1.28]}
      />

      {STUD_INDICES.map((studIndex) => {
        const studX = -segment.width * 0.34 + studIndex * segment.width * 0.23;
        return (
          <mesh
            key={studIndex}
            position={[studX, 0.34, segment.depth * 0.66]}
            geometry={SHARED_GEOMETRIES.box}
            material={ANCHOR_WALL_MATERIALS.edge}
            scale={[0.13, 0.13, 0.08]}
          />
        );
      })}

      {DEBRIS_INDICES.map((debrisIndex) => (
        <mesh
          key={debrisIndex}
          position={[
            seededRange(index, debrisIndex + 10, -segment.width * 0.45, segment.width * 0.45),
            -0.48,
            seededRange(index, debrisIndex + 20, -segment.depth * 0.92, segment.depth * 0.92),
          ]}
          rotation={[
            seededRange(index, debrisIndex + 30, -0.45, 0.45),
            seededRange(index, debrisIndex + 40, -0.9, 0.9),
            seededRange(index, debrisIndex + 50, -0.45, 0.45),
          ]}
          geometry={SHARED_GEOMETRIES.box}
          material={ANCHOR_WALL_MATERIALS.rock}
          scale={[
            seededRange(index, debrisIndex + 60, 0.13, 0.28),
            seededRange(index, debrisIndex + 70, 0.07, 0.18),
            seededRange(index, debrisIndex + 80, 0.13, 0.28),
          ]}
        />
      ))}
    </group>
  );
}, (prev, next) => prev.segment.id === next.segment.id);

interface EarthWallProps {
  wall: EarthWallData;
}

export const EarthWallEffect = React.memo(({ wall }: EarthWallProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);

  const hookProgressRef = useRef(0);
  const lastSegmentDistRef = useRef(0);
  const hookGroundYRef = useRef(wall.startPosition.y);
  const hasStartImpactRef = useRef(false);
  const hasEndImpactRef = useRef(false);
  const wallColliderRegisteredRef = useRef(false);
  const collidersReleasedRef = useRef(false);
  const registeredCollidersRef = useRef<Set<string>>(new Set());
  const wallSegmentsRef = useRef<AnchorWallSegmentData[]>([]);

  const [, setSegmentsVersion] = useState(0);

  const removeEarthWall = useGameStore(state => state.removeEarthWall);
  const rotationY = Math.atan2(wall.direction.x, wall.direction.z) + Math.PI / 2;

  useEffect(() => {
    return () => releaseColliderSet(registeredCollidersRef.current);
  }, []);

  const registerWallCollider = () => {
    if (wallColliderRegisteredRef.current) return;

    const colliderStartDist = ANCHOR_WALL_FIRST_SEGMENT_DISTANCE - ANCHOR_WALL_SEGMENT_BACKSET - ANCHOR_WALL_DEPTH / 2;
    const colliderEndDist = wall.maxDistance - ANCHOR_WALL_SEGMENT_BACKSET + ANCHOR_WALL_DEPTH / 2;
    const colliderLength = Math.max(ANCHOR_WALL_DEPTH, colliderEndDist - colliderStartDist);
    const colliderCenterDist = colliderStartDist + colliderLength / 2;
    const colliderId = `${ANCHOR_WALL_COLLIDER_PREFIX}${wall.id}_solid`;
    const colliderAdded = addTemporaryWallCollider(
      colliderId,
      wall.startPosition.x + wall.direction.x * colliderCenterDist,
      wall.startPosition.y,
      wall.startPosition.z + wall.direction.z * colliderCenterDist,
      rotationY,
      ANCHOR_WALL_WIDTH * 1.1,
      ANCHOR_WALL_MAX_HEIGHT,
      colliderLength
    );

    if (colliderAdded) {
      wallColliderRegisteredRef.current = true;
      registeredCollidersRef.current.add(colliderId);
    }
  };

  useFrame((state, delta) => {
    if (!groupRef.current || !hookRef.current) return;

    const time = state.clock.elapsedTime;
    const elapsed = (Date.now() - wall.startTime) / 1000;

    if (elapsed > wall.duration && !collidersReleasedRef.current) {
      collidersReleasedRef.current = true;
      releaseColliderSet(registeredCollidersRef.current);
    }

    if (elapsed > wall.duration + ANCHOR_WALL_COLLAPSE_DURATION) {
      removeEarthWall(wall.id);
      return;
    }

    if (hookProgressRef.current < wall.maxDistance) {
      hookProgressRef.current = Math.min(
        hookProgressRef.current + ANCHOR_WALL_SPEED * delta,
        wall.maxDistance
      );
    }

    const currentDist = hookProgressRef.current;
    const hookX = wall.startPosition.x + wall.direction.x * currentDist;
    const hookZ = wall.startPosition.z + wall.direction.z * currentDist;

    const hookPos = {
      x: hookX,
      y: hookGroundYRef.current,
      z: hookZ,
    };

    if (!hasStartImpactRef.current) {
      hasStartImpactRef.current = true;
      triggerTerrainImpact('earth_wall', hookPos, {
        direction: wall.direction,
        scale: 1.05,
      });
    }

    if (currentDist < wall.maxDistance) {
      if (currentDist >= ANCHOR_WALL_FIRST_SEGMENT_DISTANCE) {
        registerWallCollider();
      }

      if (
        currentDist >= ANCHOR_WALL_FIRST_SEGMENT_DISTANCE &&
        currentDist - lastSegmentDistRef.current >= ANCHOR_WALL_SEGMENT_SPACING
      ) {
        lastSegmentDistRef.current = currentDist;

        const segmentIndex = wallSegmentsRef.current.length;
        const segmentX = hookPos.x - wall.direction.x * ANCHOR_WALL_SEGMENT_BACKSET;
        const segmentZ = hookPos.z - wall.direction.z * ANCHOR_WALL_SEGMENT_BACKSET;

        const segment: AnchorWallSegmentData = {
          id: `${ANCHOR_WALL_COLLIDER_PREFIX}${wall.id}_${segmentIndex}`,
          x: segmentX,
          y: wall.startPosition.y,
          z: segmentZ,
          height: ANCHOR_WALL_MAX_HEIGHT * seededRange(segmentIndex, 91, 0.86, 1.08),
          width: ANCHOR_WALL_WIDTH * seededRange(segmentIndex, 92, 0.9, 1.08),
          depth: ANCHOR_WALL_DEPTH * seededRange(segmentIndex, 93, 0.92, 1.16),
        };

        wallSegmentsRef.current.push(segment);
        setSegmentsVersion(v => v + 1);
      }

      hookRef.current.visible = true;
      hookRef.current.position.set(hookPos.x, hookPos.y + 0.58, hookPos.z);
      hookRef.current.rotation.y = Math.atan2(wall.direction.x, wall.direction.z);
      hookRef.current.position.y += Math.sin(time * 18) * 0.08;
    } else {
      hookRef.current.visible = false;
      if (!hasEndImpactRef.current) {
        hasEndImpactRef.current = true;
        triggerTerrainImpact('earth_wall', hookPos, {
          direction: wall.direction,
          scale: 1.2,
        });
      }
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={hookRef} position={[wall.startPosition.x, wall.startPosition.y + 0.58, wall.startPosition.z]}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={ANCHOR_WALL_MATERIALS.edge} scale={[0.72, 0.42, 1.55]} />

        <mesh
          position={[0, -0.18, -0.88]}
          rotation={[0.34, 0, 0]}
          geometry={SHARED_GEOMETRIES.box}
          material={ANCHOR_WALL_MATERIALS.slabDark}
          scale={[1.52, 0.12, 0.54]}
        />

        <mesh
          position={[0, -0.34, -0.42]}
          rotation={[-0.55, 0, 0]}
          geometry={SHARED_GEOMETRIES.cylinder8}
          material={ANCHOR_WALL_MATERIALS.hookShaft}
          scale={[0.14, 0.88, 0.14]}
        />

        <mesh
          position={[0, -0.72, -0.13]}
          rotation={[-1.18, 0, 0]}
          geometry={SHARED_GEOMETRIES.cone8}
          material={ANCHOR_WALL_MATERIALS.hookTip}
          scale={[0.24, 0.46, 0.24]}
        />

        <mesh position={[0.58, 0.02, 0.04]} rotation={[0, 0, 0.28]} geometry={SHARED_GEOMETRIES.box} material={ANCHOR_WALL_MATERIALS.edge} scale={[0.12, 0.44, 0.9]} />
        <mesh position={[-0.58, 0.02, 0.04]} rotation={[0, 0, -0.28]} geometry={SHARED_GEOMETRIES.box} material={ANCHOR_WALL_MATERIALS.edge} scale={[0.12, 0.44, 0.9]} />

        <mesh geometry={SHARED_GEOMETRIES.sphere12} material={ANCHOR_WALL_MATERIALS.glow} scale={0.42} />
        <mesh position={[0, -0.39, -0.3]} rotation={[-Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring24} material={ANCHOR_WALL_MATERIALS.ringGlow} scale={[1.12, 1.12, 0.3]} />

        <pointLight color={HOOKSHOT_COLORS.energy} intensity={4.8} distance={5.8} decay={2} />
      </group>

      {wallSegmentsRef.current.map((segment, i) => (
        <WallSegment
          key={segment.id}
          segment={segment}
          index={i}
          rotationY={rotationY}
          wallStartTime={wall.startTime}
          wallDuration={wall.duration}
        />
      ))}
    </group>
  );
}, (prev, next) => prev.wall.id === next.wall.id && prev.wall.startTime === next.wall.startTime);
