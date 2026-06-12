import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { readViewmodelSocket } from '../../viewmodel/viewmodelSocketRegistry';
import { readRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';

interface Effect {
  id: string;
  type: 'grapple' | 'blink' | 'explosion' | 'hit' | 'lifeline' | 'heal';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  sourceSocketName?: string;
  sourcePlayerId?: string;
  startTime: number;
  duration: number;
}

// Global effect manager
const effects: Effect[] = [];
let effectIdCounter = 0;
const MAX_GLOBAL_EFFECTS = 96;
const EXPLOSION_PARTICLE_INDICES = Array.from({ length: 20 }, (_, i) => i);
const BLINK_RING_GEOMETRY = new THREE.RingGeometry(0.5, 0.7, 6);
const EXPLOSION_BOX_GEOMETRY = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const HIT_SPHERE_GEOMETRY = new THREE.SphereGeometry(0.3, 8, 8);
const LIFELINE_BEAM_GEOMETRY = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
const LIFELINE_AXIS = new THREE.Vector3(0, 1, 0);

export interface GlobalEffectStats {
  active: number;
  capacity: number;
  pressure: number;
}

function isEffectAlive(effect: Effect, now: number): boolean {
  return now - effect.startTime < effect.duration;
}

function compactExpiredEffects(now: number): boolean {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < effects.length; readIndex++) {
    const effect = effects[readIndex];
    if (!isEffectAlive(effect, now)) continue;
    effects[writeIndex++] = effect;
  }
  if (writeIndex === effects.length) return false;
  effects.length = writeIndex;
  return true;
}

function dropOldestNonCriticalEffect(): void {
  let dropIndex = 0;
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (effect.type !== 'lifeline' && effect.type !== 'heal') {
      dropIndex = index;
      break;
    }
  }
  for (let index = dropIndex + 1; index < effects.length; index++) {
    effects[index - 1] = effects[index];
  }
  effects.length = Math.max(0, effects.length - 1);
}

export function addEffect(effect: Omit<Effect, 'id' | 'startTime'>) {
  const now = Date.now();
  compactExpiredEffects(now);
  if (effects.length >= MAX_GLOBAL_EFFECTS) {
    dropOldestNonCriticalEffect();
  }
  effects.push({
    ...effect,
    id: `effect_${effectIdCounter++}`,
    startTime: now,
  });
}

export function getGlobalEffectStats(now = Date.now()): GlobalEffectStats {
  compactExpiredEffects(now);
  return {
    active: effects.length,
    capacity: MAX_GLOBAL_EFFECTS,
    pressure: effects.length / MAX_GLOBAL_EFFECTS,
  };
}

export function Effects() {
  // Use ref for active effects to avoid setState in useFrame (prevents 60fps re-renders)
  const activeEffectsRef = useRef<Effect[]>([]);

  // Version counter to trigger re-renders when effects change (incremented only when count changes)
  const [effectsVersion, setEffectsVersion] = useState(0);

  const lastEffectCountRef = useRef(0);
  const lastCleanupRef = useRef(0);

  useFrame(() => {
    const now = Date.now();

    // Only clean up every 100ms to avoid excessive processing
    if (now - lastCleanupRef.current < 100) return;
    lastCleanupRef.current = now;

    compactExpiredEffects(now);
    activeEffectsRef.current = effects;

    // PERFORMANCE: Only trigger re-render if effect count changed (not every frame)
    if (effects.length !== lastEffectCountRef.current) {
      lastEffectCountRef.current = effects.length;
      setEffectsVersion(v => v + 1);
    }
  });

  return (
    <group>
      {activeEffectsRef.current.map(effect => {
        switch (effect.type) {
          case 'grapple':
            return <GrappleLine key={effect.id} effect={effect} />;
          case 'blink':
            return <BlinkEffect key={effect.id} effect={effect} />;
          case 'explosion':
            return <ExplosionEffect key={effect.id} effect={effect} />;
          case 'hit':
            return <HitEffect key={effect.id} effect={effect} />;
          case 'lifeline':
            return <LifelineBeamEffect key={effect.id} effect={effect} />;
          case 'heal':
            return <HealPulseEffect key={effect.id} effect={effect} />;
          default:
            return null;
        }
      })}
    </group>
  );
}

interface EffectProps {
  effect: Effect;
}

function GrappleLine({ effect }: EffectProps) {
  const lineRef = useRef<THREE.Line>(null!);
  const lineObject = useMemo(() => new THREE.Line(), []);
  const points = useMemo(() => [new THREE.Vector3(), new THREE.Vector3()], []);

  useFrame(() => {
    if (!lineRef.current || !effect.endPosition) return;

    points[0].copy(effect.position);
    points[1].copy(effect.endPosition);
    lineRef.current.geometry.setFromPoints(points);
  });

  return (
    <primitive object={lineObject} ref={lineRef}>
      <bufferGeometry />
      <lineBasicMaterial color="#00ff88" linewidth={2} />
    </primitive>
  );
}

function BlinkEffect({ effect }: EffectProps) {
  const startRef = useRef<THREE.Mesh>(null);
  const endRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);

  useFrame((_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    if (startRef.current) {
      const mat = startRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      startRef.current.scale.setScalar(1 + t);
    }

    if (endRef.current && effect.endPosition) {
      const mat = endRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = t * (1 - t) * 4; // Peak at middle
      endRef.current.scale.setScalar(t * 2);
    }
  });

  return (
    <group>
      {/* Start position effect */}
      <mesh ref={startRef} position={effect.position} geometry={BLINK_RING_GEOMETRY}>
        <meshBasicMaterial 
          color="#9f7aea"
          transparent
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* End position effect */}
      {effect.endPosition && (
        <mesh ref={endRef} position={effect.endPosition} geometry={BLINK_RING_GEOMETRY}>
          <meshBasicMaterial 
            color="#9f7aea"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

function ExplosionEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const particles = useRef<THREE.Vector3[]>([]);

  useEffect(() => {
    // Generate random particle directions
    particles.current = Array.from({ length: 20 }, () => 
      new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random(),
        (Math.random() - 0.5) * 2
      ).normalize()
    );
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    // Animate particles
    groupRef.current.children.forEach((child, i) => {
      const dir = particles.current[i];
      if (dir && child instanceof THREE.Mesh) {
        child.position.copy(dir).multiplyScalar(t * 3);
        const mat = child.material as THREE.MeshBasicMaterial;
        mat.opacity = 1 - t;
        child.scale.setScalar(1 - t * 0.5);
      }
    });
  });

  return (
    <group ref={groupRef} position={effect.position}>
      {EXPLOSION_PARTICLE_INDICES.map((i) => (
        <mesh key={i} geometry={EXPLOSION_BOX_GEOMETRY}>
          <meshBasicMaterial 
            color="#ff6b35"
            transparent
            opacity={1}
          />
        </mesh>
      ))}
    </group>
  );
}

function HitEffect({ effect }: EffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 1 - t;
    meshRef.current.scale.setScalar(0.5 + t);
  });

  return (
    <mesh ref={meshRef} position={effect.position} geometry={HIT_SPHERE_GEOMETRY}>
      <meshBasicMaterial 
        color="#ff4444"
        transparent
        opacity={1}
      />
    </mesh>
  );
}

function LifelineBeamEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const source = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const midpoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const socketPose = effect.sourceSocketName
      ? (
        effect.sourcePlayerId
          ? readRemoteModelSocket(effect.sourcePlayerId, effect.sourceSocketName)
          : readViewmodelSocket(effect.sourceSocketName)
      )
      : null;
    source.copy(socketPose?.position ?? effect.position);
    end.copy(effect.endPosition ?? source);
    direction.copy(end).sub(source);
    const length = Math.max(0.001, direction.length());
    direction.normalize();
    midpoint.copy(source).add(end).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(LIFELINE_AXIS, direction);
    group.position.copy(midpoint);
    group.quaternion.copy(quaternion);

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.sin((1 - t) * Math.PI * 0.5);
    const beamRadius = 0.74 + Math.sin(t * Math.PI * 4) * 0.08;

    if (beamRef.current) {
      const mat = beamRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.72 * fade;
      beamRef.current.scale.set(beamRadius, length, beamRadius);
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 * fade;
      glowRef.current.scale.set(beamRadius * 2.4, length, beamRadius * 2.4);
    }
  });

  return (
    <group ref={groupRef} position={effect.position}>
      <mesh
        ref={glowRef}
        geometry={LIFELINE_BEAM_GEOMETRY}
        scale={[1.8, 1, 1.8]}
      >
        <meshBasicMaterial
          color="#22c55e"
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={beamRef}
        geometry={LIFELINE_BEAM_GEOMETRY}
        scale={[0.74, 1, 0.74]}
      >
        <meshBasicMaterial
          color="#bbf7d0"
          transparent
          opacity={0.72}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function HealPulseEffect({ effect }: EffectProps) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);

  useFrame((_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = 1 - t;

    if (sphereRef.current) {
      const mat = sphereRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.46 * fade;
      sphereRef.current.scale.setScalar(0.7 + t * 1.45);
    }

    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.62 * fade;
      ringRef.current.scale.setScalar(0.45 + t * 1.35);
    }
  });

  return (
    <group position={effect.position}>
      <mesh ref={sphereRef} geometry={HIT_SPHERE_GEOMETRY}>
        <meshBasicMaterial
          color="#86efac"
          transparent
          opacity={0.46}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ringRef} geometry={BLINK_RING_GEOMETRY} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial
          color="#bbf7d0"
          transparent
          opacity={0.62}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
