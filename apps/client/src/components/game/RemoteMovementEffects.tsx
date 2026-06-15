import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Player, PlayerMovementState, VoxelMapTheme } from '@voxel-strike/shared';
import { PLAYER_HEIGHT } from '@voxel-strike/shared';
import { visualStore, type VisualState } from '../../store/visualStore';
import type { EffectQualityConfig } from './visualQuality';
import { SHARED_GEOMETRIES } from './effectResources';
import { gameplayFrameScheduler } from './systems/gameplayFrameScheduler';

export type RemoteMovementEffectMode = 'idle' | 'walk' | 'run' | 'slide';
export type MovementParticleShape = 'dust' | 'flake' | 'spark' | 'petal' | 'glint';

export interface RemoteMovementEffectStyle {
  label: string;
  shape: MovementParticleShape;
  colors: readonly number[];
  opacity: number;
  baseSize: number;
  sizeVariance: number;
  flatten: number;
  stretch: number;
  lift: number;
  gravity: number;
  drag: number;
  lifetimeMs: number;
}

interface RemoteMovementEffectsProps {
  players: readonly Player[];
  theme: VoxelMapTheme;
  config: Pick<EffectQualityConfig, 'maxActiveParticles'>;
}

interface EmitterState {
  initialized: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  emitCarry: number;
}

interface MovementParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageMs: number;
  lifetimeMs: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  colorIndex: number;
}

const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
const MIN_MOVEMENT_PARTICLE_CAPACITY = 24;
const MAX_MOVEMENT_PARTICLE_CAPACITY = 160;
const MOVING_SPEED_THRESHOLD = 0.65;
const RUN_SPEED_THRESHOLD = 5.2;
const MAX_PARTICLES_EMITTED_PER_PLAYER_FRAME = 5;
const MOVEMENT_EFFECT_SCHEDULER_PRIORITY = 8;
const PARTICLE_GROUND_OFFSET = 0.06;

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const REMOTE_MOVEMENT_EFFECT_STYLES = {
  verdant: {
    label: 'grass dust',
    shape: 'dust',
    colors: [0xb8d678, 0x7fa862, 0xc9b17a],
    opacity: 0.5,
    baseSize: 0.042,
    sizeVariance: 0.028,
    flatten: 0.72,
    stretch: 1.08,
    lift: 0.82,
    gravity: 2.9,
    drag: 2.7,
    lifetimeMs: 620,
  },
  basalt: {
    label: 'basalt grit',
    shape: 'dust',
    colors: [0x7c858e, 0x4b535c, 0xa4b1bd],
    opacity: 0.46,
    baseSize: 0.036,
    sizeVariance: 0.024,
    flatten: 0.8,
    stretch: 1,
    lift: 0.68,
    gravity: 3.6,
    drag: 3.1,
    lifetimeMs: 540,
  },
  desert: {
    label: 'sand kickup',
    shape: 'dust',
    colors: [0xf3d48a, 0xd7a85a, 0xb47c3f],
    opacity: 0.56,
    baseSize: 0.05,
    sizeVariance: 0.034,
    flatten: 0.62,
    stretch: 1.18,
    lift: 0.9,
    gravity: 2.55,
    drag: 2.35,
    lifetimeMs: 720,
  },
  frost: {
    label: 'snow kickup',
    shape: 'flake',
    colors: [0xffffff, 0xdff9ff, 0xaee6f3],
    opacity: 0.66,
    baseSize: 0.038,
    sizeVariance: 0.032,
    flatten: 0.28,
    stretch: 1.32,
    lift: 1.02,
    gravity: 1.85,
    drag: 2.15,
    lifetimeMs: 860,
  },
  crystal: {
    label: 'crystal motes',
    shape: 'glint',
    colors: [0xffd1ff, 0xaedcff, 0xd7b8ff],
    opacity: 0.58,
    baseSize: 0.032,
    sizeVariance: 0.02,
    flatten: 0.5,
    stretch: 1.7,
    lift: 0.92,
    gravity: 2.35,
    drag: 2.5,
    lifetimeMs: 760,
  },
  volcanic: {
    label: 'ash cinders',
    shape: 'spark',
    colors: [0x3d3935, 0x7b4631, 0xff8a3d],
    opacity: 0.52,
    baseSize: 0.034,
    sizeVariance: 0.026,
    flatten: 0.82,
    stretch: 1.35,
    lift: 1.12,
    gravity: 2.2,
    drag: 2.85,
    lifetimeMs: 700,
  },
  sakura: {
    label: 'petal flutter',
    shape: 'petal',
    colors: [0xffc7df, 0xff8fbd, 0xf8e0ed],
    opacity: 0.58,
    baseSize: 0.044,
    sizeVariance: 0.026,
    flatten: 0.2,
    stretch: 1.85,
    lift: 0.78,
    gravity: 1.55,
    drag: 1.95,
    lifetimeMs: 900,
  },
  golden: {
    label: 'gold dust',
    shape: 'glint',
    colors: [0xfff4b8, 0xffc95f, 0xffffff],
    opacity: 0.62,
    baseSize: 0.034,
    sizeVariance: 0.024,
    flatten: 0.42,
    stretch: 1.55,
    lift: 0.96,
    gravity: 2.25,
    drag: 2.45,
    lifetimeMs: 760,
  },
} as const satisfies Record<VoxelMapTheme['id'], RemoteMovementEffectStyle>;

const MODE_EMISSION_RATES = {
  idle: 0,
  walk: 2.4,
  run: 8.5,
  slide: 24,
} as const satisfies Record<RemoteMovementEffectMode, number>;

const MODE_INTENSITY = {
  idle: 0,
  walk: 0.58,
  run: 0.92,
  slide: 1.32,
} as const satisfies Record<RemoteMovementEffectMode, number>;

export function getRemoteMovementEffectStyle(themeId: VoxelMapTheme['id']): RemoteMovementEffectStyle {
  return REMOTE_MOVEMENT_EFFECT_STYLES[themeId];
}

export function getRemoteMovementEffectMode(input: {
  playerState: Player['state'];
  movement: Pick<PlayerMovementState, 'isGrounded' | 'isSliding' | 'isSprinting'>;
  horizontalSpeed: number;
}): RemoteMovementEffectMode {
  if (input.playerState !== 'alive') return 'idle';
  if (!input.movement.isGrounded && !input.movement.isSliding) return 'idle';
  if (input.horizontalSpeed < MOVING_SPEED_THRESHOLD && !input.movement.isSliding) return 'idle';
  if (input.movement.isSliding) return 'slide';
  if (input.movement.isSprinting || input.horizontalSpeed >= RUN_SPEED_THRESHOLD) return 'run';
  return 'walk';
}

export function getRemoteMovementEmissionRate(mode: RemoteMovementEffectMode, horizontalSpeed: number): number {
  if (mode === 'idle') return 0;

  const speedBoost = Math.min(10, Math.max(0, horizontalSpeed)) * (
    mode === 'walk' ? 0.12 : mode === 'run' ? 0.34 : 0.55
  );
  return MODE_EMISSION_RATES[mode] + speedBoost;
}

export function getRemoteMovementParticleCapacity(maxActiveParticles: number): number {
  return Math.max(
    MIN_MOVEMENT_PARTICLE_CAPACITY,
    Math.min(MAX_MOVEMENT_PARTICLE_CAPACITY, Math.floor(maxActiveParticles * 0.3))
  );
}

function getParticleDensity(capacity: number): number {
  if (capacity < 40) return 0.42;
  if (capacity < 64) return 0.62;
  if (capacity < 100) return 0.82;
  return 1;
}

function createParticles(capacity: number): MovementParticle[] {
  return Array.from({ length: capacity }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ageMs: 0,
    lifetimeMs: 1,
    scaleX: 0,
    scaleY: 0,
    scaleZ: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    colorIndex: 0,
  }));
}

function horizontalSpeed(velocity: { x: number; z: number }): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function applyStyleScale(
  particle: MovementParticle,
  style: RemoteMovementEffectStyle,
  baseSize: number
): void {
  if (style.shape === 'petal') {
    particle.scaleX = baseSize * style.stretch;
    particle.scaleY = baseSize * style.flatten;
    particle.scaleZ = baseSize * 0.78;
    return;
  }

  if (style.shape === 'flake') {
    particle.scaleX = baseSize * style.stretch;
    particle.scaleY = baseSize * style.flatten;
    particle.scaleZ = baseSize * style.stretch;
    return;
  }

  if (style.shape === 'spark' || style.shape === 'glint') {
    particle.scaleX = baseSize * 0.74;
    particle.scaleY = baseSize * style.stretch;
    particle.scaleZ = baseSize * 0.74;
    return;
  }

  particle.scaleX = baseSize * style.stretch;
  particle.scaleY = baseSize * style.flatten;
  particle.scaleZ = baseSize;
}

function spawnParticle(
  particle: MovementParticle,
  style: RemoteMovementEffectStyle,
  mode: RemoteMovementEffectMode,
  position: THREE.Vector3,
  moveDirX: number,
  moveDirZ: number,
  speed: number
): void {
  const intensity = MODE_INTENSITY[mode];
  const perpendicularX = -moveDirZ;
  const perpendicularZ = moveDirX;
  const sideJitter = randomBetween(-0.34, 0.34) * intensity;
  const backstep = randomBetween(0.08, mode === 'slide' ? 0.46 : 0.3);
  const forwardSpray = randomBetween(0.1, mode === 'slide' ? 1.45 : 0.78) * intensity;
  const lateralSpeed = randomBetween(-0.75, 0.75) * intensity;
  const baseSize = (style.baseSize + Math.random() * style.sizeVariance) * randomBetween(0.86, 1.22) * intensity;

  particle.active = true;
  particle.x = position.x - moveDirX * backstep + perpendicularX * sideJitter;
  particle.y = position.y + PARTICLE_GROUND_OFFSET + randomBetween(0, 0.05);
  particle.z = position.z - moveDirZ * backstep + perpendicularZ * sideJitter;
  particle.vx = -moveDirX * forwardSpray + perpendicularX * lateralSpeed + randomBetween(-0.08, 0.08);
  particle.vy = randomBetween(0.22, style.lift) * (mode === 'slide' ? 0.82 : 1);
  particle.vz = -moveDirZ * forwardSpray + perpendicularZ * lateralSpeed + randomBetween(-0.08, 0.08);
  particle.ageMs = 0;
  particle.lifetimeMs = style.lifetimeMs * randomBetween(0.72, mode === 'slide' ? 1.32 : 1.12);
  particle.colorIndex = Math.floor(Math.random() * style.colors.length);
  particle.spinX = randomBetween(-2.4, 2.4) + speed * 0.03;
  particle.spinY = randomBetween(-2.2, 2.2);
  particle.spinZ = randomBetween(-2.4, 2.4) - speed * 0.03;
  applyStyleScale(particle, style, baseSize);
}

function getEffectPosition(player: Player, visualState: VisualState, target: THREE.Vector3): THREE.Vector3 {
  const position = visualState.renderedPlayerPositions.get(player.id)
    ?? visualState.playerPositions.get(player.id)
    ?? player.position;

  return target.set(position.x, position.y - PLAYER_CENTER_TO_FEET, position.z);
}

function updateEmitterState(
  emitterState: EmitterState,
  position: THREE.Vector3,
  player: Player,
  deltaSeconds: number,
  density: number,
  style: RemoteMovementEffectStyle,
  particles: MovementParticle[],
  nextParticleIndexRef: { current: number }
): void {
  if (!emitterState.initialized || deltaSeconds <= 0) {
    emitterState.initialized = true;
    emitterState.lastX = position.x;
    emitterState.lastY = position.y;
    emitterState.lastZ = position.z;
    emitterState.emitCarry = 0;
    return;
  }

  const dx = position.x - emitterState.lastX;
  const dz = position.z - emitterState.lastZ;
  const visualDistance = Math.sqrt(dx * dx + dz * dz);
  const visualSpeed = visualDistance / deltaSeconds;
  const networkSpeed = horizontalSpeed(player.velocity);
  const speed = Math.max(visualSpeed, networkSpeed);
  const mode = getRemoteMovementEffectMode({
    playerState: player.state,
    movement: player.movement,
    horizontalSpeed: speed,
  });

  if (mode === 'idle') {
    emitterState.emitCarry = 0;
    emitterState.lastX = position.x;
    emitterState.lastY = position.y;
    emitterState.lastZ = position.z;
    return;
  }

  let moveDirX = dx;
  let moveDirZ = dz;
  const visualLength = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
  if (visualLength > 0.001) {
    moveDirX /= visualLength;
    moveDirZ /= visualLength;
  } else if (networkSpeed > 0.001) {
    moveDirX = player.velocity.x / networkSpeed;
    moveDirZ = player.velocity.z / networkSpeed;
  } else {
    moveDirX = -Math.sin(player.lookYaw);
    moveDirZ = -Math.cos(player.lookYaw);
  }

  emitterState.emitCarry += getRemoteMovementEmissionRate(mode, speed) * density * deltaSeconds;
  const emitCount = Math.min(MAX_PARTICLES_EMITTED_PER_PLAYER_FRAME, Math.floor(emitterState.emitCarry));
  emitterState.emitCarry -= emitCount;

  for (let index = 0; index < emitCount; index++) {
    const particle = particles[nextParticleIndexRef.current];
    nextParticleIndexRef.current = (nextParticleIndexRef.current + 1) % particles.length;
    spawnParticle(particle, style, mode, position, moveDirX, moveDirZ, speed);
  }

  emitterState.lastX = position.x;
  emitterState.lastY = position.y;
  emitterState.lastZ = position.z;
}

function updateParticles(
  particles: MovementParticle[],
  deltaSeconds: number,
  style: RemoteMovementEffectStyle
): void {
  const deltaMs = deltaSeconds * 1000;
  const dragFactor = Math.max(0, 1 - style.drag * deltaSeconds);

  for (const particle of particles) {
    if (!particle.active) continue;

    particle.ageMs += deltaMs;
    if (particle.ageMs >= particle.lifetimeMs) {
      particle.active = false;
      continue;
    }

    particle.vx *= dragFactor;
    particle.vz *= dragFactor;
    particle.vy -= style.gravity * deltaSeconds;
    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
    particle.z += particle.vz * deltaSeconds;
  }
}

function renderParticles(
  mesh: THREE.InstancedMesh,
  particles: MovementParticle[],
  palette: readonly THREE.Color[],
  dummy: THREE.Object3D
): void {
  let instanceIndex = 0;

  for (const particle of particles) {
    if (!particle.active) continue;

    const progress = Math.min(1, particle.ageMs / particle.lifetimeMs);
    const fadeScale = Math.sin((1 - progress) * Math.PI * 0.5);
    dummy.position.set(particle.x, particle.y, particle.z);
    dummy.rotation.set(
      particle.spinX * progress,
      particle.spinY * progress,
      particle.spinZ * progress
    );
    dummy.scale.set(
      particle.scaleX * fadeScale,
      particle.scaleY * fadeScale,
      particle.scaleZ * fadeScale
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(instanceIndex, dummy.matrix);
    mesh.setColorAt(instanceIndex, palette[particle.colorIndex % palette.length]);
    instanceIndex++;
  }

  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

export function RemoteMovementEffects({
  players,
  theme,
  config,
}: RemoteMovementEffectsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const emitterStatesRef = useRef(new Map<string, EmitterState>());
  const nextParticleIndexRef = useRef(0);
  const dummyRef = useRef(new THREE.Object3D());
  const positionScratchRef = useRef(new THREE.Vector3());
  const capacity = getRemoteMovementParticleCapacity(config.maxActiveParticles);
  const particles = useMemo(() => createParticles(capacity), [capacity]);
  const density = useMemo(() => getParticleDensity(capacity), [capacity]);
  const style = getRemoteMovementEffectStyle(theme.id);
  const palette = useMemo(() => style.colors.map((color) => new THREE.Color(color)), [style]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: style.opacity,
    vertexColors: true,
    depthWrite: false,
    toneMapped: false,
  }), [style.opacity]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < capacity; index++) {
      mesh.setMatrixAt(index, ZERO_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [capacity]);

  useEffect(() => {
    const activePlayerIds = new Set(players.map((player) => player.id));
    for (const playerId of emitterStatesRef.current.keys()) {
      if (!activePlayerIds.has(playerId)) {
        emitterStatesRef.current.delete(playerId);
      }
    }
  }, [players]);

  useEffect(() => gameplayFrameScheduler.register({
    system: 'remoteMovementEffects',
    label: 'frame.effects.remoteMovement',
    priority: MOVEMENT_EFFECT_SCHEDULER_PRIORITY,
    callback: ({ deltaSeconds }) => {
      const mesh = meshRef.current;
      if (!mesh) return;

      const visualState = visualStore.getState();
      const positionScratch = positionScratchRef.current;
      for (const player of players) {
        let emitterState = emitterStatesRef.current.get(player.id);
        if (!emitterState) {
          emitterState = {
            initialized: false,
            lastX: 0,
            lastY: 0,
            lastZ: 0,
            emitCarry: 0,
          };
          emitterStatesRef.current.set(player.id, emitterState);
        }

        updateEmitterState(
          emitterState,
          getEffectPosition(player, visualState, positionScratch),
          player,
          deltaSeconds,
          density,
          style,
          particles,
          nextParticleIndexRef
        );
      }

      updateParticles(particles, deltaSeconds, style);
      renderParticles(mesh, particles, palette, dummyRef.current);
    },
  }), [density, palette, particles, players, style]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[SHARED_GEOMETRIES.sphere4, material, capacity]}
      frustumCulled={false}
      renderOrder={18}
      dispose={null}
    />
  );
}
