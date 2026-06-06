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
const _smoothedLocalDirection = new THREE.Vector3();
const OPEN_FLAME_GEOMETRY = new THREE.ConeGeometry(1, 1, 10, 1, true);

const FLAME_SEGMENTS = [
  { y: 0.55, radius: 0.1, length: 1.1, color: 0xffffff, opacity: 0.46, lag: 0 },
  { y: 1.15, radius: 0.22, length: 1.65, color: 0xfff2a6, opacity: 0.4, lag: 0.12 },
  { y: 2.0, radius: 0.4, length: 2.35, color: 0xffa000, opacity: 0.34, lag: 0.3 },
  { y: 3.05, radius: 0.66, length: 3.0, color: 0xff4d00, opacity: 0.26, lag: 0.5 },
  { y: 4.35, radius: 0.95, length: 3.6, color: 0xbb1f00, opacity: 0.18, lag: 0.72 },
  { y: 5.9, radius: 1.24, length: 4.1, color: 0x6f1600, opacity: 0.12, lag: 0.95 },
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

const FLAMETHROWER_SPIN_UP_DURATION = 0.14;
const FLAMETHROWER_SPIN_DOWN_DURATION = 0.18;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp01(value), 3);

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
  const rampRef = useRef(0);
  const wasLiveRef = useRef(false);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const { flamethrowerOrigin, flamethrowerDirection } = visualStore.getState();
    const hasLivePose = isActive && Boolean(flamethrowerOrigin);
    const rampStep = delta / (hasLivePose ? FLAMETHROWER_SPIN_UP_DURATION : FLAMETHROWER_SPIN_DOWN_DURATION);
    rampRef.current = hasLivePose
      ? Math.min(1, rampRef.current + rampStep)
      : Math.max(0, rampRef.current - rampStep);

    if (!hasLivePose && (!poseInitializedRef.current || rampRef.current <= 0.001)) {
      groupRef.current.visible = false;
      if (rampRef.current <= 0.001) {
        poseInitializedRef.current = false;
      }
      wasLiveRef.current = false;
      return;
    }
    groupRef.current.visible = true;

    if (hasLivePose && flamethrowerOrigin) {
      _origin.set(flamethrowerOrigin.x, flamethrowerOrigin.y, flamethrowerOrigin.z);
      _direction.set(flamethrowerDirection.x, flamethrowerDirection.y, flamethrowerDirection.z);
    } else {
      _origin.copy(smoothedOriginRef.current);
      _direction.copy(smoothedDirectionRef.current);
    }

    if (_direction.lengthSq() < 0.0001) {
      _direction.set(0, 0, -1);
    }
    _direction.normalize();

    const now = Date.now();
    if (hasLivePose && !wasLiveRef.current) {
      startTimeRef.current = now;
    }
    wasLiveRef.current = hasLivePose;

    if (hasLivePose && rampRef.current > 0.35 && now - lastTerrainImpactRef.current > 120) {
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

    groupRef.current.position.copy(_origin);
    _quat.setFromUnitVectors(_defaultAxis, _direction);
    groupRef.current.quaternion.copy(_quat);
    _inverseQuat.copy(_quat).invert();
    _lag.copy(smoothedOriginRef.current).sub(_origin);
    _localLag.copy(_lag).applyQuaternion(_inverseQuat);
    _smoothedLocalDirection.copy(smoothedDirectionRef.current).applyQuaternion(_inverseQuat);

    const elapsed = (now - startTimeRef.current) / 1000;
    const time = state.clock.elapsedTime;
    const flicker = 0.88 + Math.sin(time * 34) * 0.08 + Math.sin(time * 71) * 0.04;
    const plumeIntensity = easeOutCubic(rampRef.current);
    const spin = time * (10 + plumeIntensity * 18);

    flameRefs.current.forEach((flame, i) => {
      if (!flame) return;
      const segment = FLAME_SEGMENTS[i];
      const pulse = flicker + Math.sin(time * (18 + i * 3) + i) * 0.06;
      const segmentRamp = easeOutCubic(clamp01((rampRef.current - i * 0.06) / 0.7));
      const trailLag = segment.lag * segmentRamp;
      const trailX =
        _localLag.x * trailLag +
        _smoothedLocalDirection.x * segment.y * trailLag * 0.45;
      const trailY = Math.max(-0.25, Math.min(0.2, _localLag.y * trailLag));
      const trailZ =
        _localLag.z * trailLag +
        _smoothedLocalDirection.z * segment.y * trailLag * 0.45;
      const spinAngle = spin + i * 0.75;
      const spinWobble = Math.sin(spinAngle) * segment.radius * 0.08 * plumeIntensity;

      flame.visible = segmentRamp > 0.01;
      flame.rotation.y = spinAngle;
      flame.position.set(
        trailX + spinWobble + Math.sin(time * (9 + i) + i) * segment.radius * 0.14,
        segment.y * pulse * (0.28 + segmentRamp * 0.72) + trailY,
        trailZ + Math.cos(spinAngle) * segment.radius * 0.08 * plumeIntensity +
          Math.cos(time * (7 + i) + i) * segment.radius * 0.14
      );
      flame.scale.set(
        Math.max(0.001, segment.radius * pulse * segmentRamp),
        Math.max(0.001, segment.length * pulse * (0.2 + segmentRamp * 0.8)),
        Math.max(0.001, segment.radius * pulse * segmentRamp)
      );
      (flame.material as THREE.MeshBasicMaterial).opacity =
        segment.opacity * Math.min(1, pulse + 0.05) * segmentRamp;
    });

    if (glowRef.current) {
      const glowPulse = 1 + Math.sin(time * 28) * 0.12;
      glowRef.current.visible = plumeIntensity > 0.01;
      glowRef.current.position.set(
        _localLag.x * 0.32 + _smoothedLocalDirection.x * BLAZE_FLAMETHROWER_RANGE * 0.12,
        BLAZE_FLAMETHROWER_RANGE * 0.32,
        _localLag.z * 0.32 + _smoothedLocalDirection.z * BLAZE_FLAMETHROWER_RANGE * 0.12
      );
      glowRef.current.scale.set(
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity),
        BLAZE_FLAMETHROWER_RANGE * 0.48 * (0.25 + plumeIntensity * 0.75),
        Math.max(0.001, 0.7 * glowPulse * plumeIntensity)
      );
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        (0.055 + flicker * 0.02) * plumeIntensity;
    }

    sparkRefs.current.forEach((spark, i) => {
      if (!spark) return;
      const data = FLAME_SPARKS[i];
      const cycle = (elapsed * data.speed + data.phase) % 1;
      const distance = 0.5 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.85);
      const spread = cycle * cycle * 1.65;
      const lag = 0.18 + cycle * 0.8;
      const sparkRamp = easeOutCubic(clamp01((rampRef.current - 0.1) / 0.65));
      const spinAngle = spin * 1.25 + i * 0.9 + cycle * Math.PI * 2;

      spark.visible = sparkRamp > 0.01;
      spark.position.set(
        _localLag.x * lag +
          _smoothedLocalDirection.x * distance * lag * 0.35 +
          data.side * spread * data.drift +
          Math.cos(spinAngle) * spread * 0.18 * sparkRamp +
          Math.sin(time * 14 + i) * 0.05,
        distance * (0.3 + sparkRamp * 0.7),
        _localLag.z * lag +
          _smoothedLocalDirection.z * distance * lag * 0.35 +
          Math.sin(spinAngle) * spread * 0.18 * sparkRamp +
          Math.cos(time * 11 + i) * spread * 0.12
      );
      spark.scale.setScalar(cycle < 0.85 ? data.size * (1 + cycle * 1.2) * sparkRamp : 0);
      (spark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - cycle) * sparkRamp;
    });

    smokeRefs.current.forEach((smoke, i) => {
      if (!smoke) return;
      const data = SMOKE_PUFFS[i];
      const cycle = (elapsed * 0.9 + data.phase) % 1;
      const distance = 2.4 + cycle * (BLAZE_FLAMETHROWER_RANGE * 0.45);
      const spread = cycle * 2.0;
      const lag = 0.42 + cycle * 0.95;
      const smokeRamp = easeOutCubic(clamp01((rampRef.current - 0.18) / 0.7));

      smoke.visible = smokeRamp > 0.01;
      smoke.position.set(
        _localLag.x * lag +
          _smoothedLocalDirection.x * distance * lag * 0.28 +
          data.drift * spread,
        distance * (0.45 + smokeRamp * 0.55),
        _localLag.z * lag +
          _smoothedLocalDirection.z * distance * lag * 0.28 +
          data.rise * spread
      );
      smoke.scale.setScalar((data.size + cycle * 0.28) * smokeRamp);
      (smoke.material as THREE.MeshBasicMaterial).opacity =
        Math.max(0, 0.28 - cycle * 0.28) * smokeRamp;
    });

    if (lightRef.current) {
      lightRef.current.position.y = BLAZE_FLAMETHROWER_RANGE * 0.35;
      lightRef.current.intensity = (2 + flicker * 1.5) * plumeIntensity;
    }
  });

  if (Date.now() - startTimeRef.current > 5000) {
    startTimeRef.current = Date.now();
  }

  return (
    <group ref={groupRef} visible={false}>
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
