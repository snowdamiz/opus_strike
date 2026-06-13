import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
  doesSegmentHitPlayerCombatHitbox,
  type Player,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore, type DireBallData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { getFrameClock } from '../../../utils/frameClock';
import { SHARED_GEOMETRIES } from '../effectResources';
import { triggerTerrainImpact } from '../TerrainImpactEffects';
import { fillCombatVisualEnemyPlayers, rebuildCombatVisualFrameCache } from '../../../store/visualStore';

const DIRE_BALL_LIFETIME_MS = 3000;
const BALL_RADIUS = 0.21;
const PARTICLES_PER_BALL = 30;
const PROJECTILE_COMBAT_QUERY_PADDING = PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING + 0.75;
export const DIRE_BALL_CAPACITY = 96;

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface DireBallRuntimeSlot {
  active: boolean;
  id: string;
  ownerId: string;
  ownerTeam: Team | null;
  position: MutableVec3;
  velocity: MutableVec3;
  direction: MutableVec3;
  right: MutableVec3;
  up: MutableVec3;
  speed: number;
  expiresAtMs: number;
  particlePhase: number;
}

const WORLD_UP = { x: 0, y: 1, z: 0 };
const ZERO_VEC3 = { x: 0, y: 0, z: 0 };

let sharedCoreMaterial: THREE.ShaderMaterial | null = null;
let sharedGlowMaterial: THREE.ShaderMaterial | null = null;
let sharedInnerCoreMaterial: THREE.MeshBasicMaterial | null = null;
let sharedSecondaryShellMaterial: THREE.MeshBasicMaterial | null = null;
let sharedParticleMaterial: THREE.PointsMaterial | null = null;

function normalizeInto(input: MutableVec3, output: MutableVec3): number {
  const speed = Math.sqrt(input.x * input.x + input.y * input.y + input.z * input.z);
  if (speed <= 0.0001) {
    output.x = 1;
    output.y = 0;
    output.z = 0;
    return 0;
  }

  output.x = input.x / speed;
  output.y = input.y / speed;
  output.z = input.z / speed;
  return speed;
}

function crossInto(a: MutableVec3, b: MutableVec3, output: MutableVec3): void {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  output.x = x;
  output.y = y;
  output.z = z;
}

function getSharedCoreMaterial(): THREE.ShaderMaterial {
  if (!sharedCoreMaterial) {
    sharedCoreMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x0a0015) },
        color2: { value: new THREE.Color(0x7c3aed) },
        color3: { value: new THREE.Color(0xc084fc) },
        color4: { value: new THREE.Color(0x00ffff) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vPosition = position;

          vec3 pos = position;
          float wave = sin(position.x * 15.0 + time * 10.0) * 0.02;
          pos += normal * wave;

          #ifdef USE_INSTANCING
            vec4 instancePosition = instanceMatrix * vec4(pos, 1.0);
          #else
            vec4 instancePosition = vec4(pos, 1.0);
          #endif

          gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 color4;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;

        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
        }

        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z
          );
        }

        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.5);
          float swirl1 = sin(vPosition.x * 12.0 + time * 8.0) *
                        cos(vPosition.y * 10.0 - time * 6.0) *
                        sin(vPosition.z * 14.0 + time * 5.0);
          swirl1 = swirl1 * 0.5 + 0.5;

          float swirl2 = cos(vPosition.x * 8.0 - time * 7.0) *
                        sin(vPosition.y * 12.0 + time * 4.0);
          swirl2 = swirl2 * 0.5 + 0.5;

          float pulse = sin(time * 15.0 + vPosition.y * 20.0) * 0.3 + 0.7;
          float fastPulse = sin(time * 30.0) * 0.15 + 0.85;
          float n = noise(vPosition * 15.0 + time * 3.0);
          n += noise(vPosition * 30.0 - time * 5.0) * 0.5;

          vec3 baseColor = color1;
          baseColor = mix(baseColor, color2, swirl1 * 0.8);
          baseColor = mix(baseColor, color3, swirl2 * swirl1 * 0.6);

          float core = pow(1.0 - length(vPosition) * 3.0, 2.0);
          baseColor = mix(baseColor, color4, core * 0.5 * pulse);
          baseColor += color3 * fresnel * 1.8;
          baseColor += color4 * fresnel * n * 0.5;

          float lightning = step(0.85, noise(vPosition * 50.0 + time * 20.0));
          baseColor += color4 * lightning * 2.0;

          float flicker = 0.8 + hash(vec3(time * 50.0, 0.0, 0.0)) * 0.2;
          baseColor *= flicker * fastPulse * 1.3;

          gl_FragColor = vec4(baseColor, 1.0);
        }
      `,
      side: THREE.FrontSide,
    });
  }

  return sharedCoreMaterial;
}

function getSharedGlowMaterial(): THREE.ShaderMaterial {
  if (!sharedGlowMaterial) {
    sharedGlowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x7c3aed) },
        color2: { value: new THREE.Color(0xc084fc) },
        color3: { value: new THREE.Color(0x00ffff) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        uniform float time;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vec3 pos = position * (sin(time * 5.0) * 0.05 + 1.0);

          #ifdef USE_INSTANCING
            vec4 instancePosition = instanceMatrix * vec4(pos, 1.0);
          #else
            vec4 instancePosition = vec4(pos, 1.0);
          #endif

          gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          float pulse1 = sin(time * 10.0) * 0.2 + 0.8;
          float pulse2 = sin(time * 15.0 + vPosition.y * 10.0) * 0.15 + 0.85;
          float fresnel = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          float swirl = sin(vPosition.x * 10.0 + time * 8.0) * 0.5 + 0.5;

          vec3 color = mix(color1, color2, swirl);
          color = mix(color, color3, fresnel * pulse2 * 0.3);
          float alpha = fresnel * pulse1 * pulse2 * 0.7;
          alpha = min(alpha * 1.28, 0.92);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  return sharedGlowMaterial;
}

function getSharedInnerCoreMaterial(): THREE.MeshBasicMaterial {
  if (!sharedInnerCoreMaterial) {
    sharedInnerCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  return sharedInnerCoreMaterial;
}

function getSharedSecondaryShellMaterial(): THREE.MeshBasicMaterial {
  if (!sharedSecondaryShellMaterial) {
    sharedSecondaryShellMaterial = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  return sharedSecondaryShellMaterial;
}

function getSharedParticleMaterial(): THREE.PointsMaterial {
  if (!sharedParticleMaterial) {
    sharedParticleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
    });
  }

  return sharedParticleMaterial;
}

class DireBallRuntimePool {
  private readonly slots: DireBallRuntimeSlot[];
  private readonly freeList: number[];
  private readonly idToSlot = new Map<string, number>();
  private overflowCursor = 0;
  activeCount = 0;

  constructor(private readonly capacity = DIRE_BALL_CAPACITY) {
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      id: '',
      ownerId: '',
      ownerTeam: null,
      position: { ...ZERO_VEC3 },
      velocity: { ...ZERO_VEC3 },
      direction: { x: 1, y: 0, z: 0 },
      right: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
      speed: 0,
      expiresAtMs: 0,
      particlePhase: 0,
    }));
    this.freeList = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }

  add(ball: DireBallData, expiresAtMs: number, ownerTeam: Team | null): void {
    if (this.idToSlot.has(ball.id)) return;

    const slotIndex = this.allocateSlot();
    const slot = this.slots[slotIndex];
    if (!slot.active) this.activeCount++;

    slot.active = true;
    slot.id = ball.id;
    slot.ownerId = ball.ownerId;
    slot.ownerTeam = ownerTeam;
    slot.position.x = ball.position.x;
    slot.position.y = ball.position.y;
    slot.position.z = ball.position.z;
    slot.velocity.x = ball.velocity.x;
    slot.velocity.y = ball.velocity.y;
    slot.velocity.z = ball.velocity.z;
    slot.speed = normalizeInto(slot.velocity, slot.direction);
    slot.expiresAtMs = expiresAtMs;
    slot.particlePhase = ((slotIndex * 37) % 97) / 97;

    crossInto(slot.direction, WORLD_UP, slot.right);
    if (normalizeInto(slot.right, slot.right) <= 0.0001) {
      slot.right.x = 0;
      slot.right.y = 0;
      slot.right.z = 1;
    }
    crossInto(slot.right, slot.direction, slot.up);
    normalizeInto(slot.up, slot.up);

    this.idToSlot.set(ball.id, slotIndex);
  }

  remove(id: string): void {
    const index = this.idToSlot.get(id);
    if (index === undefined) return;
    this.deactivate(index);
  }

  removeMissing(activeIds: Set<string>): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.active && !activeIds.has(slot.id)) {
        this.deactivate(i);
      }
    }
  }

  forEachActive(callback: (slot: DireBallRuntimeSlot, slotIndex: number) => void): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.active) callback(slot, i);
    }
  }

  deactivate(index: number): void {
    const slot = this.slots[index];
    if (!slot.active) return;

    this.idToSlot.delete(slot.id);
    slot.active = false;
    slot.id = '';
    slot.ownerId = '';
    slot.ownerTeam = null;
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.freeList.push(index);
  }

  private allocateSlot(): number {
    const free = this.freeList.pop();
    if (free !== undefined) return free;

    for (let i = 0; i < this.capacity; i++) {
      const index = (this.overflowCursor + i) % this.capacity;
      if (this.slots[index].active) {
        this.idToSlot.delete(this.slots[index].id);
        this.slots[index].active = false;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.overflowCursor = (index + 1) % this.capacity;
        return index;
      }
    }

    return 0;
  }
}

function fillTrailParticles(
  slot: DireBallRuntimeSlot,
  elapsedSeconds: number,
  positions: Float32Array,
  particleOffset: number
): number {
  for (let i = 0; i < PARTICLES_PER_BALL; i++) {
    const particleIndex = particleOffset + i;
    const index = particleIndex * 3;
    const phase = (slot.particlePhase + i * 0.071 + elapsedSeconds * 1.9) % 1;
    const angle = i * 2.399963 + elapsedSeconds * (2.2 + (i % 4) * 0.17);
    const trailDistance = 0.16 + phase * 2.35;
    const radius = BALL_RADIUS * (0.36 + (1 - phase) * 0.86);
    const orbitX = Math.cos(angle) * radius;
    const orbitY = Math.sin(angle) * radius;

    positions[index] =
      slot.position.x -
      slot.direction.x * trailDistance +
      slot.right.x * orbitX +
      slot.up.x * orbitY;
    positions[index + 1] =
      slot.position.y -
      slot.direction.y * trailDistance +
      slot.right.y * orbitX +
      slot.up.y * orbitY;
    positions[index + 2] =
      slot.position.z -
      slot.direction.z * trailDistance +
      slot.right.z * orbitX +
      slot.up.z * orbitY;
  }

  return particleOffset + PARTICLES_PER_BALL;
}

function setSphereInstance(
  mesh: THREE.InstancedMesh,
  dummy: THREE.Object3D,
  index: number,
  slot: DireBallRuntimeSlot,
  scale: number
): void {
  dummy.position.set(slot.position.x, slot.position.y, slot.position.z);
  dummy.quaternion.identity();
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function setInstancedMeshCount(mesh: THREE.InstancedMesh | null, count: number): void {
  if (!mesh) return;
  mesh.count = count;
  if (count > 0) {
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function prewarmDireBallResources(): void {
  getSharedCoreMaterial();
  getSharedGlowMaterial();
  getSharedInnerCoreMaterial();
  getSharedSecondaryShellMaterial();
  getSharedParticleMaterial();
}

export function DireBallsManager() {
  const storeBalls = useGameStore(state => state.direBalls);
  const removeDireBalls = useGameStore(state => state.removeDireBalls);
  const poolRef = useRef<DireBallRuntimePool>();
  const activeStoreIdsRef = useRef<Set<string>>(new Set());
  const enemyPlayersRef = useRef<Player[]>([]);
  const removalsRef = useRef<string[]>([]);
  const rayDirectionRef = useRef<MutableVec3>({ x: 1, y: 0, z: 0 });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null);
  const glowMeshRef = useRef<THREE.InstancedMesh>(null);
  const innerMeshRef = useRef<THREE.InstancedMesh>(null);
  const secondaryShellMeshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  if (!poolRef.current) {
    poolRef.current = new DireBallRuntimePool(DIRE_BALL_CAPACITY);
  }

  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(DIRE_BALL_CAPACITY * PARTICLES_PER_BALL * 3), 3)
    );
    const colors = new Float32Array(DIRE_BALL_CAPACITY * PARTICLES_PER_BALL * 3);
    const palette = [
      new THREE.Color(0x00ffff),
      new THREE.Color(0xc084fc),
      new THREE.Color(0x9333ea),
    ];
    for (let i = 0; i < DIRE_BALL_CAPACITY * PARTICLES_PER_BALL; i++) {
      const color = palette[i % palette.length];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);

  useEffect(() => () => particleGeometry.dispose(), [particleGeometry]);

  useEffect(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const activeIds = activeStoreIdsRef.current;
    const nowDateMs = Date.now();
    const frameNowMs = getFrameClock().nowMs;
    const state = useGameStore.getState();

    activeIds.clear();
    for (const ball of storeBalls) {
      activeIds.add(ball.id);
      const ageMs = Math.max(0, nowDateMs - ball.startTime);
      const expiresAtMs = frameNowMs + Math.max(0, DIRE_BALL_LIFETIME_MS - ageMs);
      const ownerTeam = ball.ownerTeam ?? state.players.get(ball.ownerId)?.team ?? null;
      pool.add(ball, expiresAtMs, ownerTeam);
    }
    pool.removeMissing(activeIds);
  }, [storeBalls]);

  useFrame(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const clock = getFrameClock();
    const delta = clock.clampedDeltaSeconds;
    const elapsedSeconds = clock.elapsedSeconds;

    const coreMaterial = getSharedCoreMaterial();
    const glowMaterial = getSharedGlowMaterial();
    coreMaterial.uniforms.time.value = elapsedSeconds;
    glowMaterial.uniforms.time.value = elapsedSeconds;

    const removals = removalsRef.current;
    removals.length = 0;
    let instanceIndex = 0;
    let particleOffset = 0;

    if (pool.activeCount === 0) {
      setInstancedMeshCount(coreMeshRef.current, 0);
      setInstancedMeshCount(glowMeshRef.current, 0);
      setInstancedMeshCount(innerMeshRef.current, 0);
      setInstancedMeshCount(secondaryShellMeshRef.current, 0);
      particleGeometry.setDrawRange(0, 0);
      return;
    }

    const store = useGameStore.getState();
    const enemies = enemyPlayersRef.current;
    const combatCache = rebuildCombatVisualFrameCache(store.players.values(), clock.nowMs, clock.nowMs, store.players.size);
    const physicsWorld = isPhysicsReady() ? getPhysicsWorld() : null;
    const positions = particleGeometry.attributes.position.array as Float32Array;

    pool.forEachActive((slot, slotIndex) => {
      if (clock.nowMs >= slot.expiresAtMs) {
        removals.push(slot.id);
        pool.deactivate(slotIndex);
        return;
      }

      const moveDistance = slot.speed * delta;
      if (moveDistance > 0.001 && physicsWorld) {
        rayDirectionRef.current.x = slot.direction.x;
        rayDirectionRef.current.y = slot.direction.y;
        rayDirectionRef.current.z = slot.direction.z;
        const hit = raycast(physicsWorld, slot.position, rayDirectionRef.current, moveDistance + BALL_RADIUS, {
          priority: 'visual',
          feature: 'projectile:phantomDireBall',
        });

        if (hit && hit.distance <= moveDistance + BALL_RADIUS) {
          triggerTerrainImpact('phantom_dire_ball', hit.point, {
            normal: hit.normal,
            direction: slot.direction,
          });
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      fillCombatVisualEnemyPlayers(
        combatCache,
        slot.ownerTeam,
        slot.ownerId,
        enemies,
        slot.position,
        moveDistance + BALL_RADIUS + PROJECTILE_COMBAT_QUERY_PADDING
      );
      for (let i = 0; i < enemies.length; i++) {
        const player = enemies[i];
        if (doesSegmentHitPlayerCombatHitbox(slot.position, slot.direction, moveDistance, player, BALL_RADIUS)) {
          removals.push(slot.id);
          pool.deactivate(slotIndex);
          return;
        }
      }

      const coreMesh = coreMeshRef.current;
      const glowMesh = glowMeshRef.current;
      const innerMesh = innerMeshRef.current;
      const secondaryShellMesh = secondaryShellMeshRef.current;
      if (coreMesh && glowMesh && innerMesh && secondaryShellMesh) {
        setSphereInstance(coreMesh, dummy, instanceIndex, slot, BALL_RADIUS);
        setSphereInstance(glowMesh, dummy, instanceIndex, slot, BALL_RADIUS * 1.68);
        setSphereInstance(innerMesh, dummy, instanceIndex, slot, BALL_RADIUS * 0.4);
        setSphereInstance(secondaryShellMesh, dummy, instanceIndex, slot, BALL_RADIUS * 0.5);
      }

      particleOffset = fillTrailParticles(slot, elapsedSeconds, positions, particleOffset);

      slot.position.x += slot.velocity.x * delta;
      slot.position.y += slot.velocity.y * delta;
      slot.position.z += slot.velocity.z * delta;

      instanceIndex++;
    });

    setInstancedMeshCount(coreMeshRef.current, instanceIndex);
    setInstancedMeshCount(glowMeshRef.current, instanceIndex);
    setInstancedMeshCount(innerMeshRef.current, instanceIndex);
    setInstancedMeshCount(secondaryShellMeshRef.current, instanceIndex);

    particleGeometry.setDrawRange(0, particleOffset);
    const positionAttribute = particleGeometry.attributes.position as THREE.BufferAttribute;
    positionAttribute.needsUpdate = particleOffset > 0;

    if (removals.length > 0) {
      removeDireBalls(removals);
      removals.length = 0;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={coreMeshRef}
        args={[SHARED_GEOMETRIES.sphere16, getSharedCoreMaterial(), DIRE_BALL_CAPACITY]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={glowMeshRef}
        args={[SHARED_GEOMETRIES.sphere12, getSharedGlowMaterial(), DIRE_BALL_CAPACITY]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={innerMeshRef}
        args={[SHARED_GEOMETRIES.sphere8, getSharedInnerCoreMaterial(), DIRE_BALL_CAPACITY]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={secondaryShellMeshRef}
        args={[SHARED_GEOMETRIES.sphere8, getSharedSecondaryShellMaterial(), DIRE_BALL_CAPACITY]}
        frustumCulled={false}
      />
      <points ref={particlesRef} geometry={particleGeometry} frustumCulled={false}>
        <primitive object={getSharedParticleMaterial()} />
      </points>
    </group>
  );
}

if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    prewarmDireBallResources();
  });
}
