import type { HeroStats, MovementCorrectionReason, PlayerMovementState, Vec3 } from '@voxel-strike/shared';
import {
  BHOP_MAX_VELOCITY,
  SLIDE_MAX_SPEED_MULTIPLIER,
  SPRINT_MULTIPLIER,
} from '@voxel-strike/shared';

export interface MovementBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface LastSafeMovementState {
  position: Vec3;
  velocity: Vec3;
  acceptedAt: number;
  sequence: number;
}

export interface MovementProposalContext {
  previous: LastSafeMovementState;
  proposedPosition: Vec3;
  proposedVelocity: Vec3;
  inputSequence: number;
  receivedAt: number;
  heroStats: HeroStats;
  movement: Pick<PlayerMovementState, 'isSliding' | 'isGrappling' | 'isJetpacking' | 'isGliding'>;
  activeSpeedMultiplier: number;
  flagCarrier: boolean;
  bounds: MovementBounds;
  isInsidePlayableArea: (position: Vec3) => boolean;
  isSpaceBlocked: (position: Vec3) => boolean;
  isPathBlocked: (from: Vec3, to: Vec3) => boolean;
}

export interface MovementProposalResult {
  accepted: boolean;
  reason?: MovementCorrectionReason;
  metrics: {
    elapsedSeconds: number;
    horizontalSpeed: number;
    verticalSpeed: number;
    horizontalVelocity: number;
    verticalVelocity: number;
    maxHorizontalSpeed: number;
    maxVerticalSpeed: number;
  };
}

const MIN_ELAPSED_SECONDS = 1 / 120;
const MAX_ELAPSED_SECONDS = 0.75;
const POSITION_EPSILON = 0.001;

function isFiniteVec3(value: Vec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function horizontalMagnitude(value: { x: number; z: number }): number {
  return Math.sqrt(value.x * value.x + value.z * value.z);
}

function distance2D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function calculateMaxHorizontalSpeed(context: MovementProposalContext): number {
  const sprintSpeed = context.heroStats.moveSpeed * SPRINT_MULTIPLIER;
  const slideSpeed = sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER;
  let maxSpeed = Math.max(BHOP_MAX_VELOCITY, slideSpeed, sprintSpeed * 2.2, 16);

  if (context.movement.isSliding) {
    maxSpeed = Math.max(maxSpeed, slideSpeed * 1.45);
  }
  if (context.movement.isGrappling) {
    maxSpeed = Math.max(maxSpeed, 42);
  }
  if (context.movement.isJetpacking || context.movement.isGliding) {
    maxSpeed = Math.max(maxSpeed, 30);
  }

  maxSpeed *= Math.max(1, context.activeSpeedMultiplier);
  if (context.flagCarrier) {
    maxSpeed = Math.max(maxSpeed, sprintSpeed * 2.5);
  }

  return maxSpeed + 6;
}

function calculateMaxVerticalSpeed(context: MovementProposalContext): number {
  let maxSpeed = Math.max(24, context.heroStats.jumpForce * 3.5);
  if (context.movement.isGrappling) {
    maxSpeed = Math.max(maxSpeed, 42);
  }
  if (context.movement.isJetpacking || context.movement.isGliding) {
    maxSpeed = Math.max(maxSpeed, 34);
  }
  return maxSpeed + 6;
}

function withinBounds(position: Vec3, bounds: MovementBounds): boolean {
  return (
    position.x >= bounds.minX - POSITION_EPSILON &&
    position.x <= bounds.maxX + POSITION_EPSILON &&
    position.y >= bounds.minY - POSITION_EPSILON &&
    position.y <= bounds.maxY + POSITION_EPSILON &&
    position.z >= bounds.minZ - POSITION_EPSILON &&
    position.z <= bounds.maxZ + POSITION_EPSILON
  );
}

export function validateMovementProposal(context: MovementProposalContext): MovementProposalResult {
  const elapsedSeconds = Math.max(
    MIN_ELAPSED_SECONDS,
    Math.min(MAX_ELAPSED_SECONDS, (context.receivedAt - context.previous.acceptedAt) / 1000)
  );
  const horizontalSpeed = distance2D(context.previous.position, context.proposedPosition) / elapsedSeconds;
  const verticalSpeed = Math.abs(context.proposedPosition.y - context.previous.position.y) / elapsedSeconds;
  const horizontalVelocity = horizontalMagnitude(context.proposedVelocity);
  const verticalVelocity = Math.abs(context.proposedVelocity.y);
  const maxHorizontalSpeed = calculateMaxHorizontalSpeed(context);
  const maxVerticalSpeed = calculateMaxVerticalSpeed(context);
  const metrics = {
    elapsedSeconds,
    horizontalSpeed,
    verticalSpeed,
    horizontalVelocity,
    verticalVelocity,
    maxHorizontalSpeed,
    maxVerticalSpeed,
  };

  if (!isFiniteVec3(context.proposedPosition) || !isFiniteVec3(context.proposedVelocity)) {
    return { accepted: false, reason: 'invalid_transform', metrics };
  }

  if (!withinBounds(context.proposedPosition, context.bounds) || !context.isInsidePlayableArea(context.proposedPosition)) {
    return { accepted: false, reason: 'bounds', metrics };
  }

  if (context.isSpaceBlocked(context.proposedPosition) || context.isPathBlocked(context.previous.position, context.proposedPosition)) {
    return { accepted: false, reason: 'blocked_path', metrics };
  }

  if (
    horizontalSpeed > maxHorizontalSpeed ||
    horizontalVelocity > maxHorizontalSpeed + 10 ||
    verticalSpeed > maxVerticalSpeed ||
    verticalVelocity > maxVerticalSpeed + 16
  ) {
    return { accepted: false, reason: 'speed_limit', metrics };
  }

  return { accepted: true, metrics };
}
