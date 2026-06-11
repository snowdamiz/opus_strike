import { simulateSharedMovement, type MovementTerrainAdapter } from '@voxel-strike/physics';
import type { HeroId, HeroStats, PlayerInput, PlayerMovementState, Vec3 } from '@voxel-strike/shared';

export interface MovementShadowSimulationState {
  initialized: boolean;
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  lastSequence: number;
  lastClientTimeMs: number;
}

export interface MovementShadowSimulationInput {
  state: MovementShadowSimulationState;
  playerPosition: Vec3;
  playerVelocity: Vec3;
  playerMovement: PlayerMovementState;
  heroStats: HeroStats;
  input: PlayerInput;
  terrain: MovementTerrainAdapter;
  flagCarrier: boolean;
  activeSpeedMultiplier: number;
  chronosAscendantActive?: boolean;
  proposedPosition: Vec3;
  proposedVelocity: Vec3;
}

export interface MovementShadowSimulationSample {
  positionDrift: number;
  velocityDrift: number;
  movementMismatch: boolean;
}

export interface MovementShadowSimulationResult {
  nextState: MovementShadowSimulationState;
  sample: MovementShadowSimulationSample;
}

export interface MovementShadowDriftDimensions {
  roomId: string;
  matchMode: string;
  heroId: HeroId | 'unknown';
  movementClass: string;
  mapSeed: number;
  pingBandMs: string;
  frameRateBand: string;
}

export interface MovementShadowDriftSample extends MovementShadowDriftDimensions {
  positionDrift: number;
  velocityDrift: number;
  movementMismatch: boolean;
  objectiveSuppressed: boolean;
  sampledAt: number;
}

export interface MovementShadowDriftBucketReport extends MovementShadowDriftDimensions {
  sampleCount: number;
  positionDriftP50: number;
  positionDriftP95: number;
  positionDriftP99: number;
  positionDriftMax: number;
  velocityDriftP50: number;
  velocityDriftP95: number;
  velocityDriftP99: number;
  velocityDriftMax: number;
  movementMismatchRate: number;
  objectiveSuppressionRate: number;
  lastSampleAt: string;
}

export interface MovementShadowDriftReport {
  generatedAt: string;
  sampleCount: number;
  bucketCount: number;
  buckets: MovementShadowDriftBucketReport[];
}

interface MovementShadowDriftBucket {
  dimensions: MovementShadowDriftDimensions;
  positionDrifts: number[];
  velocityDrifts: number[];
  movementMismatches: number;
  objectiveSuppressions: number;
  lastSampleAt: number;
}

const MAX_SHADOW_BUCKETS = 512;
const MAX_SAMPLES_PER_BUCKET = 256;
const shadowBuckets = new Map<string, MovementShadowDriftBucket>();

function zeroVec3(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function cloneMovementState(value: PlayerMovementState): PlayerMovementState {
  return {
    ...value,
    grapplePoint: value.grapplePoint ? cloneVec3(value.grapplePoint) : null,
  };
}

export function createMovementShadowSimulationState(): MovementShadowSimulationState {
  return {
    initialized: false,
    position: zeroVec3(),
    velocity: zeroVec3(),
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: 100,
      isGliding: false,
    },
    lastSequence: 0,
    lastClientTimeMs: 0,
  };
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function movementMismatch(a: PlayerMovementState, b: PlayerMovementState): boolean {
  return Boolean(a.isGrounded) !== Boolean(b.isGrounded) ||
    Boolean(a.isSprinting) !== Boolean(b.isSprinting) ||
    Boolean(a.isCrouching) !== Boolean(b.isCrouching) ||
    Boolean(a.isSliding) !== Boolean(b.isSliding) ||
    Boolean(a.isWallRunning) !== Boolean(b.isWallRunning) ||
    Boolean(a.isGrappling) !== Boolean(b.isGrappling) ||
    Boolean(a.isJetpacking) !== Boolean(b.isJetpacking) ||
    Boolean(a.isGliding) !== Boolean(b.isGliding) ||
    a.wallRunSide !== b.wallRunSide;
}

function initializeState(input: MovementShadowSimulationInput): MovementShadowSimulationState {
  return {
    initialized: true,
    position: cloneVec3(input.playerPosition),
    velocity: cloneVec3(input.playerVelocity),
    movement: cloneMovementState(input.playerMovement),
    lastSequence: input.input.tick,
    lastClientTimeMs: input.input.timestamp,
  };
}

export function advanceMovementShadowSimulation(input: MovementShadowSimulationInput): MovementShadowSimulationResult {
  const current = input.state.initialized ? input.state : initializeState(input);
  const deltaTime = Math.max(1 / 120, Math.min(0.1, (input.input.timestamp - current.lastClientTimeMs) / 1000 || 1 / 60));
  const simulated = simulateSharedMovement({
    position: current.position,
    velocity: current.velocity,
    movement: current.movement,
    heroStats: input.heroStats,
    input: input.input,
    lookYaw: input.input.lookYaw,
    deltaTime,
    terrain: input.terrain,
    flagCarrier: input.flagCarrier,
    activeSpeedMultiplier: input.activeSpeedMultiplier,
    chronosAscendantActive: input.chronosAscendantActive,
  });

  const sample = {
    positionDrift: distance(simulated.position, input.proposedPosition),
    velocityDrift: distance(simulated.velocity, input.proposedVelocity),
    movementMismatch: movementMismatch(simulated.movement, input.playerMovement),
  };

  return {
    nextState: {
      initialized: true,
      position: cloneVec3(simulated.position),
      velocity: cloneVec3(simulated.velocity),
      movement: cloneMovementState(simulated.movement),
      lastSequence: input.input.tick,
      lastClientTimeMs: input.input.timestamp,
    },
    sample,
  };
}

function bucketKey(dimensions: MovementShadowDriftDimensions): string {
  return [
    dimensions.matchMode,
    dimensions.heroId,
    dimensions.movementClass,
    dimensions.mapSeed,
    dimensions.pingBandMs,
    dimensions.frameRateBand,
  ].join('|');
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(pct * sorted.length) - 1));
  return sorted[index];
}

function pushBounded(values: number[], value: number): void {
  values.push(value);
  if (values.length > MAX_SAMPLES_PER_BUCKET) {
    values.splice(0, values.length - MAX_SAMPLES_PER_BUCKET);
  }
}

export function recordMovementShadowDriftSample(sample: MovementShadowDriftSample): void {
  if (!Number.isFinite(sample.positionDrift) || !Number.isFinite(sample.velocityDrift)) return;

  const key = bucketKey(sample);
  let bucket = shadowBuckets.get(key);
  if (!bucket) {
    if (shadowBuckets.size >= MAX_SHADOW_BUCKETS) {
      const oldest = Array.from(shadowBuckets.entries())
        .sort((a, b) => a[1].lastSampleAt - b[1].lastSampleAt)[0]?.[0];
      if (oldest) shadowBuckets.delete(oldest);
    }
    bucket = {
      dimensions: {
        roomId: sample.roomId,
        matchMode: sample.matchMode,
        heroId: sample.heroId,
        movementClass: sample.movementClass,
        mapSeed: sample.mapSeed,
        pingBandMs: sample.pingBandMs,
        frameRateBand: sample.frameRateBand,
      },
      positionDrifts: [],
      velocityDrifts: [],
      movementMismatches: 0,
      objectiveSuppressions: 0,
      lastSampleAt: sample.sampledAt,
    };
    shadowBuckets.set(key, bucket);
  }

  pushBounded(bucket.positionDrifts, sample.positionDrift);
  pushBounded(bucket.velocityDrifts, sample.velocityDrift);
  bucket.movementMismatches += sample.movementMismatch ? 1 : 0;
  bucket.objectiveSuppressions += sample.objectiveSuppressed ? 1 : 0;
  bucket.lastSampleAt = sample.sampledAt;
}

export function getMovementShadowDriftReport(options: { limit?: number } = {}): MovementShadowDriftReport {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const buckets = Array.from(shadowBuckets.values())
    .map((bucket): MovementShadowDriftBucketReport => {
      const sampleCount = bucket.positionDrifts.length;
      return {
        ...bucket.dimensions,
        sampleCount,
        positionDriftP50: percentile(bucket.positionDrifts, 0.5),
        positionDriftP95: percentile(bucket.positionDrifts, 0.95),
        positionDriftP99: percentile(bucket.positionDrifts, 0.99),
        positionDriftMax: bucket.positionDrifts.reduce((max, value) => Math.max(max, value), 0),
        velocityDriftP50: percentile(bucket.velocityDrifts, 0.5),
        velocityDriftP95: percentile(bucket.velocityDrifts, 0.95),
        velocityDriftP99: percentile(bucket.velocityDrifts, 0.99),
        velocityDriftMax: bucket.velocityDrifts.reduce((max, value) => Math.max(max, value), 0),
        movementMismatchRate: sampleCount > 0 ? bucket.movementMismatches / sampleCount : 0,
        objectiveSuppressionRate: sampleCount > 0 ? bucket.objectiveSuppressions / sampleCount : 0,
        lastSampleAt: new Date(bucket.lastSampleAt).toISOString(),
      };
    })
    .sort((a, b) => b.positionDriftP95 - a.positionDriftP95 || b.sampleCount - a.sampleCount)
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: Array.from(shadowBuckets.values()).reduce((sum, bucket) => sum + bucket.positionDrifts.length, 0),
    bucketCount: shadowBuckets.size,
    buckets,
  };
}

export function resetMovementShadowDriftForTests(): void {
  shadowBuckets.clear();
}
