import { useRef, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import {
  chronosOrbForwardFromYaw,
  offsetChronosOrbVisualVector,
} from '../../model-system/chronosOrbVisualOrigin';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { getFrameClock } from '../../utils/frameClock';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import { createFrameUpdaterRegistry } from './systems/frameUpdaterRegistry';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';

interface Effect {
  id: string;
  type: 'grapple' | 'blink' | 'explosion' | 'hit' | 'lifeline' | 'heal' | 'chronosSelfHealPulse' | 'chronosAegisBreak';
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
const CHRONOS_SELF_HEAL_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 20, 14);
const LIFELINE_BEAM_GEOMETRY = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
const LIFELINE_AXIS = new THREE.Vector3(0, 1, 0);
const EFFECT_FORWARD = new THREE.Vector3(0, 0, 1);
const EXPLOSION_INSTANCE_DUMMY = new THREE.Object3D();
const CHRONOS_AEGIS_BREAK_SHARD_COUNT = 14;
type GlobalEffectUpdater = (state: RootState, delta: number) => void;
const globalEffectUpdaters = createFrameUpdaterRegistry<RootState>();

interface ChronosAegisBreakShard {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  spin: number;
  rotation: number;
}

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

function createChronosAegisBreakShards(effectId: string): ChronosAegisBreakShard[] {
  let seed = hashEffectId(`${effectId}:aegis_break`);
  return Array.from({ length: CHRONOS_AEGIS_BREAK_SHARD_COUNT }, (_, index) => {
    let unit: number;
    [unit, seed] = nextSeededUnit(seed);
    const angle = unit * Math.PI * 2;
    [unit, seed] = nextSeededUnit(seed);
    const radius = 0.55 + unit * 2.35;
    [unit, seed] = nextSeededUnit(seed);
    const z = 0.24 + unit * 0.95;
    [unit, seed] = nextSeededUnit(seed);
    const width = 0.018 + unit * 0.022;
    [unit, seed] = nextSeededUnit(seed);
    const height = 0.34 + unit * 0.82;
    [unit, seed] = nextSeededUnit(seed);
    const spin = (unit * 2 - 1) * (2.8 + index * 0.07);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.58,
      z,
      width,
      height,
      spin,
      rotation: angle + Math.PI * 0.5,
    };
  });
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

function useGlobalEffectUpdater(effectId: string, updater: GlobalEffectUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: GlobalEffectUpdater = (state, delta) => updaterRef.current(state, delta);
    return globalEffectUpdaters.register(effectId, registeredUpdater);
  }, [effectId]);
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
    if (
      effect.type !== 'lifeline' &&
      effect.type !== 'heal' &&
      effect.type !== 'chronosSelfHealPulse' &&
      effect.type !== 'chronosAegisBreak'
    ) {
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

function runGlobalEffectsFrame(
  state: RootState,
  delta: number,
  activeEffectsRef: MutableRefObject<Effect[]>,
  lastEffectCountRef: MutableRefObject<number>,
  lastCleanupRef: MutableRefObject<number>,
  setEffectsVersion: Dispatch<SetStateAction<number>>
): void {
  const now = getFrameClock().epochNowMs;

  // Only clean up every 100ms to avoid excessive processing
  if (now - lastCleanupRef.current >= 100) {
    lastCleanupRef.current = now;
    compactExpiredEffects(now);
    activeEffectsRef.current = effects;

    // PERFORMANCE: Only trigger re-render if effect count changed (not every frame)
    if (effects.length !== lastEffectCountRef.current) {
      lastEffectCountRef.current = effects.length;
      setEffectsVersion(v => v + 1);
    }
  }

  globalEffectUpdaters.run(state, delta);

  if (MOVEMENT_DIAGNOSTICS_ENABLED) {
    recordEffectSlotDiagnostics('globalEffects', {
      active: effects.length,
      capacity: MAX_GLOBAL_EFFECTS,
      hiddenMounted: Math.max(0, MAX_GLOBAL_EFFECTS - effects.length),
    });
  }
}

export function Effects() {
  // Use ref for active effects to avoid setState in useFrame (prevents 60fps re-renders)
  const activeEffectsRef = useRef<Effect[]>([]);

  // Version counter to trigger re-renders when effects change (incremented only when count changes)
  const [effectsVersion, setEffectsVersion] = useState(0);

  const lastEffectCountRef = useRef(0);
  const lastCleanupRef = useRef(0);

  useFrame((state, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.global', () => (
        runGlobalEffectsFrame(state, delta, activeEffectsRef, lastEffectCountRef, lastCleanupRef, setEffectsVersion)
      ));
    } else {
      runGlobalEffectsFrame(state, delta, activeEffectsRef, lastEffectCountRef, lastCleanupRef, setEffectsVersion);
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
          case 'chronosSelfHealPulse':
            return <ChronosSelfHealPulseEffect key={effect.id} effect={effect} />;
          case 'chronosAegisBreak':
            return <ChronosAegisBreakEffect key={effect.id} effect={effect} />;
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

  useGlobalEffectUpdater(effect.id, () => {
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

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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

function writeChronosEffectSourceForward(
  effect: Effect,
  camera: THREE.Camera,
  target: THREE.Vector3
): THREE.Vector3 | null {
  if (!effect.sourceAbilityId) return null;

  if (!effect.sourcePlayerId) {
    camera.getWorldDirection(target);
    return target;
  }

  const store = useGameStore.getState();
  const yaw = visualStore.getState().playerRotations.get(effect.sourcePlayerId)
    ?? store.players.get(effect.sourcePlayerId)?.lookYaw
    ?? (store.localPlayer?.id === effect.sourcePlayerId ? store.localPlayer.lookYaw : undefined);
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return null;

  const forward = chronosOrbForwardFromYaw(yaw);
  target.set(forward.x, forward.y, forward.z);
  return target;
}

function LifelineBeamEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const { camera } = useThree();
  const source = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const midpoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const sourceForward = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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
    offsetChronosOrbVisualVector(
      source,
      writeChronosEffectSourceForward(effect, camera, sourceForward),
      effect.sourceAbilityId
    );
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

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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

function ChronosSelfHealPulseEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sphereRef = useRef<THREE.Mesh>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const progress = useRef(0);
  const { camera } = useThree();
  const source = useMemo(() => new THREE.Vector3(), []);
  const sourceForward = useMemo(() => new THREE.Vector3(), []);

  useGlobalEffectUpdater(effect.id, (_, delta) => {
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
    offsetChronosOrbVisualVector(
      source,
      writeChronosEffectSourceForward(effect, camera, sourceForward),
      effect.sourceAbilityId
    );
    group.position.copy(source);

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.max(0, 1 - t);
    const pulse = Math.sin(t * Math.PI);
    const radius = 0.25 + t * 4.6;

    if (sphereRef.current) {
      const mat = sphereRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.34 * fade;
      sphereRef.current.scale.setScalar(radius);
    }

    ringRefs.current.forEach((ring, index) => {
      if (!ring) return;
      const mat = ring.material as THREE.MeshBasicMaterial;
      const ripple = 0.92 + Math.sin(t * Math.PI * 3 + index * 0.7) * 0.08;
      mat.opacity = 0.72 * fade;
      ring.scale.setScalar(radius * ripple);
      ring.rotation.z += delta * (1.5 + index * 0.35);
    });

    if (lightRef.current) {
      lightRef.current.intensity = 1.8 * pulse * fade;
    }
  });

  return (
    <group ref={groupRef} position={effect.position} frustumCulled={false}>
      <mesh ref={sphereRef} geometry={CHRONOS_SELF_HEAL_SPHERE_GEOMETRY}>
        <meshBasicMaterial
          color="#86efac"
          transparent
          opacity={0.34}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[
        [Math.PI / 2, 0, 0],
        [0, Math.PI / 2, 0],
        [0, 0, 0],
      ].map((rotation, index) => (
        <mesh
          key={index}
          ref={(node) => {
            ringRefs.current[index] = node;
          }}
          geometry={BLINK_RING_GEOMETRY}
          rotation={rotation as [number, number, number]}
        >
          <meshBasicMaterial
            color={index === 1 ? '#bbf7d0' : '#22c55e'}
            transparent
            opacity={0.72}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={3.2}
        budgetRadius={5.5}
        color="#86efac"
        intensity={0}
        distance={5.5}
        decay={2}
      />
    </group>
  );
}

function ChronosAegisBreakEffect({ effect }: EffectProps) {
  const flashRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const shardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const progress = useRef(0);
  const shards = useMemo(() => createChronosAegisBreakShards(effect.id), [effect.id]);
  const quaternion = useMemo(() => {
    const direction = (effect.direction ?? EFFECT_FORWARD).clone();
    if (direction.lengthSq() <= 0.0001) direction.copy(EFFECT_FORWARD);
    direction.normalize();
    return new THREE.Quaternion().setFromUnitVectors(EFFECT_FORWARD, direction);
  }, [effect.direction]);
  const materials = useMemo(() => {
    const flash = new THREE.MeshBasicMaterial({
      color: 0xfef9c3,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const ring = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const shard = new THREE.MeshBasicMaterial({
      color: 0x86efac,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return { flash, ring, shard };
  }, []);

  useEffect(() => () => {
    materials.flash.dispose();
    materials.ring.dispose();
    materials.shard.dispose();
  }, [materials]);

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.max(0, 1 - t);
    const burst = Math.sin(Math.min(1, t * 1.45) * Math.PI);

    if (flashRef.current) {
      materials.flash.opacity = 0.58 * fade;
      flashRef.current.scale.setScalar(0.78 + t * 2.4);
    }
    if (ringARef.current) {
      materials.ring.opacity = 0.72 * fade;
      ringARef.current.scale.setScalar(0.95 + t * 3.35);
      ringARef.current.rotation.z += delta * 1.8;
    }
    if (ringBRef.current) {
      ringBRef.current.scale.setScalar(0.56 + t * 2.5);
      ringBRef.current.rotation.z -= delta * 2.3;
    }
    materials.shard.opacity = 0.82 * fade;
    shards.forEach((shard, index) => {
      const mesh = shardRefs.current[index];
      if (!mesh) return;
      mesh.position.set(shard.x * t, shard.y * t, shard.z * burst);
      mesh.rotation.set(0, 0, shard.rotation + shard.spin * t);
      mesh.scale.set(shard.width * (1 - t * 0.25), shard.height * (1 - t * 0.42), 0.018);
    });
    if (lightRef.current) {
      lightRef.current.intensity = 3.1 * burst * fade;
    }
  });

  return (
    <group position={effect.position} quaternion={quaternion} frustumCulled={false}>
      <mesh ref={flashRef} geometry={HIT_SPHERE_GEOMETRY} material={materials.flash} frustumCulled={false} />
      <mesh ref={ringARef} geometry={BLINK_RING_GEOMETRY} material={materials.ring} frustumCulled={false} />
      <mesh ref={ringBRef} geometry={BLINK_RING_GEOMETRY} material={materials.ring} frustumCulled={false} />
      {shards.map((_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            shardRefs.current[index] = node;
          }}
          geometry={EXPLOSION_BOX_GEOMETRY}
          material={materials.shard}
          frustumCulled={false}
        />
      ))}
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={3.5}
        budgetRadius={5.8}
        color="#fde68a"
        intensity={0}
        distance={5.8}
        decay={2}
      />
    </group>
  );
}
