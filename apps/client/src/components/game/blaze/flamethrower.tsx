import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { BLAZE_FLAMETHROWER_RANGE } from '@voxel-strike/shared';
import { SHARED_GEOMETRIES } from '../effectResources';
import { visualStore } from '../../../store/visualStore';
import { raycastDirection } from '../../../hooks/usePhysics';
import { triggerTerrainImpact } from '../TerrainImpactEffects';

// ============================================================================
// FLAMETHROWER EFFECT - Held Blaze E ability
// ============================================================================

interface FlamethrowerEffectProps {
  isActive: boolean;
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3(0, 0, -1);
const _defaultAxis = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _inverseQuat = new THREE.Quaternion();
const _lag = new THREE.Vector3();
const _localLag = new THREE.Vector3();
const OPEN_FLAME_GEOMETRY = new THREE.ConeGeometry(1, 1, 10, 1, true);

const FLAME_SEGMENTS = [
  { y: 0.55, radius: 0.1, length: 1.1, color: 0xffffff, opacity: 0.46, lag: 0.14 },
  { y: 1.15, radius: 0.22, length: 1.65, color: 0xfff2a6, opacity: 0.4, lag: 0.24 },
  { y: 2.0, radius: 0.4, length: 2.35, color: 0xffa000, opacity: 0.34, lag: 0.42 },
  { y: 3.05, radius: 0.66, length: 3.0, color: 0xff4d00, opacity: 0.26, lag: 0.64 },
  { y: 4.35, radius: 0.95, length: 3.6, color: 0xbb1f00, opacity: 0.18, lag: 0.86 },
  { y: 5.9, radius: 1.24, length: 4.1, color: 0x6f1600, opacity: 0.12, lag: 1.08 },
];

const FLAME_SPARKS = Array.from({ length: 14 }, (_, i) => ({
  phase: i / 14,
  side: i % 2 === 0 ? -1 : 1,
  drift: 0.08 + Math.random() * 0.18,
  speed: 1.8 + Math.random() * 1.5,
  size: 0.025 + Math.random() * 0.03,
}));

const SMOKE_PUFFS = Array.from({ length: 8 }, (_, i) => ({
  phase: i / 8,
  drift: (Math.random() - 0.5) * 0.35,
  rise: 0.15 + Math.random() * 0.25,
  size: 0.1 + Math.random() * 0.12,
}));

export const FlamethrowerEffect = React.memo(({ isActive }: FlamethrowerEffectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const startTimeRef = useRef(Date.now());
  const lastTerrainImpactRef = useRef(0);
  const smoothedOriginRef = useRef(new THREE.Vector3());
  const smoothedDirectionRef = useRef(new THREE.Vector3(0, 0, -1));
  const poseInitializedRef = useRef(false);

  useFrame((state, delta) => {
    if (!isActive || !groupRef.current) return;

    const { flamethrowerOrigin, flamethrowerDirection } = visualStore.getState();
    if (!flamethrowerOrigin) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;

    _origin.set(flamethrowerOrigin.x, flamethrowerOrigin.y, flamethrowerOrigin.z);
    _direction.set(flamethrowerDirection.x, flamethrowerDirection.y, flamethrowerDirection.z);
    if (_direction.lengthSq() < 0.0001) {
      _direction.set(0, 0, -1);
    }
    _direction.normalize();

    const now = Date.now();
    if (now - lastTerrainImpactRef.current > 120) {
      const hit = raycastDirection(
        _origin.x, _origin.y, _origin.z,
        _direction.x, _direction.y, _direction.z,
        BLAZE_FLAMETHROWER_RANGE
      );

      if (hit?.hit) {
        lastTerrainImpactRef.current = now;
        triggerTerrainImpact('blaze_flamethrower', hit.point, {
          normal: hit.normal,
          direction: { x: _direction.x, y: _direction.y, z: _direction.z },
          scale: 1 + Math.max(0, 1 - hit.distance / BLAZE_FLAMETHROWER_RANGE) * 0.35,
        });
      }
    }

    if (!poseInitializedRef.current) {
      smoothedOriginRef.current.copy(_origin);
      smoothedDirectionRef.current.copy(_direction);
      poseInitializedRef.current = true;
    }

    const originAlpha = 1 - Math.exp(-delta * 7);
    const directionAlpha = 1 - Math.exp(-delta * 10);
    smoothedOriginRef.current.lerp(_origin, originAlpha);
    smoothedDirectionRef.current.lerp(_direction, directionAlpha).normalize();

    groupRef.current.position.copy(smoothedOriginRef.current);
    _quat.setFromUnitVectors(_defaultAxis, smoothedDirectionRef.current);
    groupRef.current.quaternion.copy(_quat);
    _inverseQuat.copy(_quat).invert();
    _lag.copy(smoothedOriginRef.current).sub(_origin);
    _localLag.copy(_lag).applyQuaternion(_inverseQuat);

    const elapsed = (now - startTimeRef.current) / 1000;
    const time = state.clock.elapsedTime;
    const flicker = 0.88 + Math.sin(time * 34) * 0.08 + Math.sin(time * 71) * 0.04;

    flameRefs.current.forEach((flame, i) => {
      if (!flame) return;
      const segment = FLAME_SEGMENTS[i];
      const pulse = flicker + Math.sin(time * (18 + i * 3) + i) * 0.06;
      flame.position.set(
        _localLag.x * segment.lag + Math.sin(time * (9 + i) + i) * segment.radius * 0.14,
        segment.y * pulse + Math.max(-0.35, Math.min(0.15, _localLag.y * segment.lag)),
        _localLag.z * segment.lag + Math.cos(time * (7 + i) + i) * segment.radius * 0.14
      );
      flame.scale.set(segment.radius * pulse, segment.length * pulse, segment.radius * pulse);
      (flame.material as THREE.MeshBasicMaterial).opacity = segment.opacity * Math.min(1, pulse + 0.05);
    });

    if (glowRef.current) {
      const glowPulse = 1 + Math.sin(time * 28) * 0.12;
      glowRef.current.position.set(_localLag.x * 0.45, BLAZE_FLAMETHROWER_RANGE * 0.32, _localLag.z * 0.45);
      glowRef.current.scale.set(0.7 * glowPulse, BLAZE_FLAMETHROWER_RANGE * 0.48, 0.7 * glowPulse);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.055 + flicker * 0.02;
    }

    sparkRefs.current.forEach((spark, i) => {
      if (!spark) return;
      const data = FLAME_SPARKS[i];
      const cycle = (elapsed * data.speed + data.phase) % 1;
      const distance = 0.5 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.85);
      const spread = cycle * cycle * 1.65;
      spark.position.set(
        _localLag.x * (0.25 + cycle * 0.75) + data.side * spread * data.drift + Math.sin(time * 14 + i) * 0.05,
        distance,
        _localLag.z * (0.25 + cycle * 0.75) + Math.cos(time * 11 + i) * spread * 0.12
      );
      spark.scale.setScalar(cycle < 0.85 ? data.size * (1 + cycle * 1.2) : 0);
      (spark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - cycle);
    });

    smokeRefs.current.forEach((smoke, i) => {
      if (!smoke) return;
      const data = SMOKE_PUFFS[i];
      const cycle = (elapsed * 0.9 + data.phase) % 1;
      const distance = 2.4 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.45);
      const spread = cycle * 2.0;
      smoke.position.set(
        _localLag.x * (0.45 + cycle) + data.drift * spread,
        distance,
        _localLag.z * (0.45 + cycle) + data.rise * spread
      );
      smoke.scale.setScalar(data.size + cycle * 0.28);
      (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.28 - cycle * 0.28);
    });

    if (lightRef.current) {
      lightRef.current.position.y = BLAZE_FLAMETHROWER_RANGE * 0.35;
      lightRef.current.intensity = 2 + flicker * 1.5;
    }
  });

  if (!isActive) return null;

  if (Date.now() - startTimeRef.current > 5000) {
    startTimeRef.current = Date.now();
  }

  return (
    <group ref={groupRef}>
      {FLAME_SEGMENTS.map((segment, i) => (
        <mesh
          key={`flame-${i}`}
          ref={el => flameRefs.current[i] = el}
          geometry={OPEN_FLAME_GEOMETRY}
          rotation-x={Math.PI}
        >
          <meshBasicMaterial
            color={segment.color}
            transparent
            opacity={segment.opacity}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      <mesh ref={glowRef} position={[0, BLAZE_FLAMETHROWER_RANGE * 0.32, 0]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6a00} transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {FLAME_SPARKS.map((_, i) => (
        <mesh
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffdd55} transparent opacity={0.8} />
        </mesh>
      ))}

      {SMOKE_PUFFS.map((_, i) => (
        <mesh
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x3a302a} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}

      <pointLight ref={lightRef} color={0xff7a00} intensity={8} distance={10} decay={2} />
    </group>
  );
}, (prev, next) => prev.isActive === next.isActive);
