import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import { getFrameClock } from '../../utils/frameClock';

interface Effect {
  id: string;
  type: 'grapple' | 'blink' | 'explosion' | 'hit' | 'lifeline' | 'heal';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  sourceAbilityId?: string;
  sourcePlayerId?: string;
  startTime: number;
  duration: number;
}

// Global effect manager
const effects: Effect[] = [];
let effectIdCounter = 0;
const MAX_GLOBAL_EFFECTS = 96;
const EXPLOSION_PARTICLE_COUNT = 20;
const BLINK_RING_GEOMETRY = new THREE.RingGeometry(0.5, 0.7, 6);
const EXPLOSION_BOX_GEOMETRY = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const HIT_SPHERE_GEOMETRY = new THREE.SphereGeometry(0.3, 8, 8);
const LIFELINE_BEAM_GEOMETRY = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
const LIFELINE_AXIS = new THREE.Vector3(0, 1, 0);
const EXPLOSION_INSTANCE_DUMMY = new THREE.Object3D();

function hashEffectId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeededUnit(seed: number): [number, number] {
  const nextSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [nextSeed / 0xffffffff, nextSeed];
}

function createExplosionDirections(effectId: string): Float32Array {
  const directions = new Float32Array(EXPLOSION_PARTICLE_COUNT * 3);
  let seed = hashEffectId(effectId);

  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    let rx: number;
    let ry: number;
    let rz: number;
    [rx, seed] = nextSeededUnit(seed);
    [ry, seed] = nextSeededUnit(seed);
    [rz, seed] = nextSeededUnit(seed);

    const x = rx * 2 - 1;
    const y = ry;
    const z = rz * 2 - 1;
    const invLength = 1 / Math.max(0.0001, Math.hypot(x, y, z));
    const offset = i * 3;
    directions[offset] = x * invLength;
    directions[offset + 1] = y * invLength;
    directions[offset + 2] = z * invLength;
  }

  return directions;
}

function writeGrappleLinePositions(target: Float32Array, effect: Effect): void {
  const end = effect.endPosition ?? effect.position;
  target[0] = effect.position.x;
  target[1] = effect.position.y;
  target[2] = effect.position.z;
  target[3] = end.x;
  target[4] = end.y;
  target[5] = end.z;
}

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
    const now = getFrameClock().epochNowMs;

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
  const positions = useMemo(() => {
    const initialPositions = new Float32Array(6);
    writeGrappleLinePositions(initialPositions, effect);
    return initialPositions;
  }, [effect]);
  const geometry = useMemo(() => {
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return bufferGeometry;
  }, [positions]);
  const lineObject = useMemo(() => {
    const line = new THREE.Line(geometry);
    line.frustumCulled = false;
    return line;
  }, [geometry]);

  useFrame(() => {
    writeGrappleLinePositions(positions, effect);
    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <primitive object={lineObject}>
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
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const progress = useRef(0);
  const directions = useMemo(() => createExplosionDirections(effect.id), [effect.id]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const scale = 1 - t * 0.5;

    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      const offset = i * 3;
      EXPLOSION_INSTANCE_DUMMY.position.set(
        directions[offset] * t * 3,
        directions[offset + 1] * t * 3,
        directions[offset + 2] * t * 3
      );
      EXPLOSION_INSTANCE_DUMMY.scale.setScalar(scale);
      EXPLOSION_INSTANCE_DUMMY.updateMatrix();
      mesh.setMatrixAt(i, EXPLOSION_INSTANCE_DUMMY.matrix);
    }

    (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[EXPLOSION_BOX_GEOMETRY, undefined, EXPLOSION_PARTICLE_COUNT]}
      position={effect.position}
      frustumCulled={false}
    >
      <meshBasicMaterial
        color="#ff6b35"
        transparent
        opacity={1}
      />
    </instancedMesh>
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

    const socketOrigin = effect.sourceAbilityId
      ? resolveAbilitySocketOrigin({
        ownerScope: effect.sourcePlayerId ? 'remoteBody' : 'localViewmodel',
        playerId: effect.sourcePlayerId,
        abilityId: effect.sourceAbilityId,
      })
      : null;
    source.copy(socketOrigin?.position ?? effect.position);
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
