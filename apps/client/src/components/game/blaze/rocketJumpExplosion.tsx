import { memo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../../movement/networkDiagnostics';

interface RocketJumpExplosionData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
  frameStartTime: number;
}

const rocketJumpExplosions: RocketJumpExplosionData[] = [];
let explosionIdCounter = 0;
let rocketJumpExplosionRevision = 0;

export function triggerRocketJumpExplosion(position: { x: number; y: number; z: number }) {
  rocketJumpExplosions.push({
    id: `rj_${explosionIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
    frameStartTime: getFrameClock().nowMs,
  });
  rocketJumpExplosionRevision++;
}

export const ROCKET_JUMP_DURATION = 1000;

const ROCKET_JUMP_SPARKS = Array.from({ length: 20 }, (_, i) => ({
  angle: (i / 20) * Math.PI * 2 + Math.random() * 0.35,
  speed: 5 + Math.random() * 8,
  ySpeed: 7 + Math.random() * 10,
  size: 0.035 + Math.random() * 0.07,
}));

const ROCKET_JUMP_SMOKE_PUFFS = Array.from({ length: 6 }, (_, i) => ({
  angle: i * 1.14,
  radius: 0.28 + (i % 3) * 0.18,
  lift: 1.8 + i * 0.34,
}));

const RocketJumpExplosion = memo(({ explosion }: { explosion: RocketJumpExplosionData }) => {
  const flashRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const pressureShellRef = useRef<THREE.Mesh>(null);
  const heatCurtainRef = useRef<THREE.Mesh>(null);
  const outerShockwaveRef = useRef<THREE.Mesh>(null);
  const innerShockwaveRef = useRef<THREE.Mesh>(null);
  const emberShockwaveRef = useRef<THREE.Mesh>(null);
  const scorchRef = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(() => measureFrameWork('frame.effects.blazeRocketJumpExplosion', () => {
    const elapsed = getFrameClock().nowMs - explosion.frameStartTime;
    if (elapsed > ROCKET_JUMP_DURATION) return;

    const progress = elapsed / ROCKET_JUMP_DURATION;
    const easeOut = 1 - Math.pow(1 - progress, 2);
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const fadeOut = Math.max(0, 1 - progress * 1.1);
    const fadeOutSlow = Math.max(0, 1 - progress);
    const shockwaveFade = Math.max(0, 1 - progress * 1.35);

    if (flashRef.current) {
      const flashProgress = Math.min(1, elapsed / 110);
      const flashScale = 0.75 + flashProgress * 3.2;
      flashRef.current.scale.setScalar(flashScale);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 1.75);
    }

    if (coreRef.current) {
      const s = 0.55 + easeOut * 3.1;
      coreRef.current.scale.setScalar(s);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.95;
    }
    if (midRef.current) {
      const s = 0.8 + easeOut * 3.8;
      midRef.current.scale.setScalar(s);
      (midRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.8;
    }
    if (outerRef.current) {
      const s = 1 + easeOut * 4.8;
      outerRef.current.scale.setScalar(s);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.58;
    }

    if (pressureShellRef.current) {
      const horizontalScale = 1.1 + easeOutQuart * 6.7;
      const verticalScale = 0.35 + easeOut * 1.85;
      pressureShellRef.current.position.y = 0.55 + easeOut * 0.35;
      pressureShellRef.current.scale.set(horizontalScale, verticalScale, horizontalScale);
      (pressureShellRef.current.material as THREE.MeshBasicMaterial).opacity = shockwaveFade * 0.24;
    }
    if (heatCurtainRef.current) {
      const radius = 0.7 + easeOutQuart * 8.8;
      heatCurtainRef.current.position.y = 0.48 + easeOut * 0.42;
      heatCurtainRef.current.scale.set(radius, 1.5 + easeOut * 1.1, radius);
      (heatCurtainRef.current.material as THREE.MeshBasicMaterial).opacity = shockwaveFade * 0.3;
    }
    if (outerShockwaveRef.current) {
      const s = 0.8 + easeOutQuart * 10.5;
      outerShockwaveRef.current.scale.set(s, s, 1);
      (outerShockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = shockwaveFade * 0.9;
    }
    if (innerShockwaveRef.current) {
      const s = 0.55 + easeOutQuart * 7.6;
      innerShockwaveRef.current.scale.set(s, s, 1);
      (innerShockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = shockwaveFade * 0.72;
    }
    if (emberShockwaveRef.current) {
      const s = 0.35 + easeOutQuart * 5.8;
      emberShockwaveRef.current.scale.set(s, s, 1);
      (emberShockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = shockwaveFade * 0.62;
    }
    if (scorchRef.current) {
      const scorchScale = 2.1 + easeOut * 1.8;
      scorchRef.current.scale.set(scorchScale, scorchScale, 1);
      (scorchRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOutSlow * 0.48;
    }

    smokeRefs.current.forEach((smoke, i) => {
      if (smoke) {
        const puff = ROCKET_JUMP_SMOKE_PUFFS[i];
        const smokeDelay = i * 38;
        const smokeElapsed = Math.max(0, elapsed - smokeDelay);
        const smokeProgress = Math.min(1, smokeElapsed / 700);
        const drift = smokeProgress * (0.28 + i * 0.04);
        const y = smokeProgress * puff.lift;
        const smokeScale = 0.42 + smokeProgress * (0.9 + i * 0.16);
        smoke.position.x = Math.cos(puff.angle) * (puff.radius + drift);
        smoke.position.z = Math.sin(puff.angle) * (puff.radius + drift);
        smoke.position.y = y;
        smoke.scale.setScalar(smokeScale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.45 - smokeProgress * 0.45);
      }
    });

    const t = elapsed / 1000;
    sparkRefs.current.forEach((spark, i) => {
      if (spark && i < ROCKET_JUMP_SPARKS.length) {
        const s = ROCKET_JUMP_SPARKS[i];
        const sparkX = Math.cos(s.angle) * s.speed * t;
        const sparkY = s.ySpeed * t - 15 * t * t;
        const sparkZ = Math.sin(s.angle) * s.speed * t;
        spark.position.set(sparkX, Math.max(-0.3, sparkY), sparkZ);
        spark.scale.setScalar(s.size * fadeOutSlow);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkY > 0 ? fadeOutSlow : 0;
      }
    });

    if (lightRef.current) {
      lightRef.current.intensity = fadeOut * 36;
    }
  }));

  const elapsed = getFrameClock().nowMs - explosion.frameStartTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;

  return (
    <group position={[explosion.position.x, explosion.position.y - 0.3, explosion.position.z]}>
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffff} transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={midRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={pressureShellRef} geometry={SHARED_GEOMETRIES.sphere16}>
        <meshBasicMaterial color={0xfff0a0} transparent opacity={0.24} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={heatCurtainRef} position-y={0.5} geometry={SHARED_GEOMETRIES.cylinderOpen16}>
        <meshBasicMaterial color={0xff7a00} transparent opacity={0.3} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={outerShockwaveRef} rotation-x={-Math.PI / 2} position-y={0.12} geometry={SHARED_GEOMETRIES.ring32}>
        <meshBasicMaterial color={0xff5a12} transparent opacity={0.9} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={innerShockwaveRef} rotation-x={-Math.PI / 2} position-y={0.2} geometry={SHARED_GEOMETRIES.ring24}>
        <meshBasicMaterial color={0xffc03a} transparent opacity={0.72} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={emberShockwaveRef} rotation-x={-Math.PI / 2} position-y={0.3} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={0xffff88} transparent opacity={0.62} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {ROCKET_JUMP_SMOKE_PUFFS.map((puff, i) => (
        <mesh
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          position={[Math.cos(puff.angle) * puff.radius, 0, Math.sin(puff.angle) * puff.radius]}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x555555} transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}

      {ROCKET_JUMP_SPARKS.map((_, i) => (
        <mesh
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffcc00} transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}

      <mesh ref={scorchRef} rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[2.1, 2.1, 1]}>
        <meshBasicMaterial color={0x331100} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      <BudgetedPointLight budgetPriority={7} ref={lightRef} color={0xff6a00} intensity={36} distance={24} decay={2} />
    </group>
  );
}, (prev, next) => {
  return (
    prev.explosion.id === next.explosion.id &&
    prev.explosion.position.x === next.explosion.position.x &&
    prev.explosion.position.y === next.explosion.position.y &&
    prev.explosion.position.z === next.explosion.position.z &&
    prev.explosion.startTime === next.explosion.startTime
  );
});

export function useRocketJumpExplosions() {
  const [activeExplosions, setActiveExplosions] = useState<RocketJumpExplosionData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const now = getFrameClock().nowMs;
    let changed = lastRevisionRef.current !== rocketJumpExplosionRevision;

    for (let i = rocketJumpExplosions.length - 1; i >= 0; i--) {
      if (now - rocketJumpExplosions[i].frameStartTime >= ROCKET_JUMP_DURATION) {
        rocketJumpExplosions.splice(i, 1);
        changed = true;
      }
    }

    if (changed) {
      lastRevisionRef.current = rocketJumpExplosionRevision;
      setActiveExplosions([...rocketJumpExplosions]);
    }

    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      recordEffectSlotDiagnostics('blazeRocketJumpExplosion', {
        active: rocketJumpExplosions.length,
        capacity: Math.max(1, rocketJumpExplosions.length),
        hiddenMounted: 0,
      });
    }
  });

  return activeExplosions;
}

export function RocketJumpExplosions() {
  const activeExplosions = useRocketJumpExplosions();

  return (
    <>
      {activeExplosions.map(explosion => (
        <RocketJumpExplosion key={explosion.id} explosion={explosion} />
      ))}
    </>
  );
}
