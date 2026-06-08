import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Effect {
  id: string;
  type: 'grapple' | 'blink' | 'explosion' | 'hit';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  startTime: number;
  duration: number;
}

// Global effect manager
const effects: Effect[] = [];
let effectIdCounter = 0;
const EXPLOSION_PARTICLE_INDICES = Array.from({ length: 20 }, (_, i) => i);
const BLINK_RING_GEOMETRY = new THREE.RingGeometry(0.5, 0.7, 6);
const EXPLOSION_BOX_GEOMETRY = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const HIT_SPHERE_GEOMETRY = new THREE.SphereGeometry(0.3, 8, 8);

export function addEffect(effect: Omit<Effect, 'id' | 'startTime'>) {
  effects.push({
    ...effect,
    id: `effect_${effectIdCounter++}`,
    startTime: Date.now(),
  });
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

    // Clean up expired effects
    const currentEffects = effects.filter(e => now - e.startTime < e.duration);
    effects.length = 0;
    effects.push(...currentEffects);

    // Update ref with current effects (no re-render triggered)
    activeEffectsRef.current = currentEffects;

    // PERFORMANCE: Only trigger re-render if effect count changed (not every frame)
    if (currentEffects.length !== lastEffectCountRef.current) {
      lastEffectCountRef.current = currentEffects.length;
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
