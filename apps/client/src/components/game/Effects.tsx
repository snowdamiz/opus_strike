import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Effect {
  id: string;
  type: 'grapple' | 'dash' | 'blink' | 'explosion' | 'hit';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  startTime: number;
  duration: number;
}

// Global effect manager
const effects: Effect[] = [];
let effectIdCounter = 0;

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
          case 'dash':
            return <DashTrail key={effect.id} effect={effect} />;
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

  useFrame(() => {
    if (!lineRef.current || !effect.endPosition) return;

    const points = [
      effect.position.clone(),
      effect.endPosition.clone(),
    ];

    lineRef.current.geometry.setFromPoints(points);
  });

  return (
    <primitive object={new THREE.Line()} ref={lineRef}>
      <bufferGeometry />
      <lineBasicMaterial color="#00ff88" linewidth={2} />
    </primitive>
  );
}

function DashTrail({ effect }: EffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    // Fade out
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = 1 - t;

    // Scale up
    meshRef.current.scale.setScalar(1 + t * 2);
  });

  return (
    <mesh ref={meshRef} position={effect.position}>
      <sphereGeometry args={[0.5, 8, 8]} />
      <meshBasicMaterial 
        color="#7c3aed"
        transparent
        opacity={1}
      />
    </mesh>
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
      <mesh ref={startRef} position={effect.position}>
        <ringGeometry args={[0.5, 0.7, 6]} />
        <meshBasicMaterial 
          color="#9f7aea"
          transparent
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* End position effect */}
      {effect.endPosition && (
        <mesh ref={endRef} position={effect.endPosition}>
          <ringGeometry args={[0.5, 0.7, 6]} />
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
      {Array.from({ length: 20 }).map((_, i) => (
        <mesh key={i}>
          <boxGeometry args={[0.2, 0.2, 0.2]} />
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
    <mesh ref={meshRef} position={effect.position}>
      <sphereGeometry args={[0.3, 8, 8]} />
      <meshBasicMaterial 
        color="#ff4444"
        transparent
        opacity={1}
      />
    </mesh>
  );
}

