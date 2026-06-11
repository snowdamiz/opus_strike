import type { InputState } from './input.js';
import type { PlayerMovementState } from './player.js';
import type { Vec3 } from './vector.js';

export const MOVEMENT_PROTOCOL_VERSION = 1;
export const MOVEMENT_SUBSTEP_RATE = 60;
export const MOVEMENT_SUBSTEP_MS = 1000 / MOVEMENT_SUBSTEP_RATE;
export const MOVEMENT_SUBSTEP_SECONDS = 1 / MOVEMENT_SUBSTEP_RATE;
export const MOVEMENT_COMMAND_BUFFER_SIZE = 256;
export const MOVEMENT_MAX_PACKET_COMMANDS = 8;
export const MOVEMENT_MAX_SERVER_QUEUE = 96;
export const MOVEMENT_MAX_COMMANDS_PER_SECOND = 90;
export const MOVEMENT_COMMAND_STALE_GRACE_STEPS = 6;
export const MOVEMENT_SERVER_CATCHUP_BUDGET = 4;
export const MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS = 100;
export const MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS = 100;
export const MOVEMENT_POSITION_EPSILON_METERS = 0.03;
export const MOVEMENT_VELOCITY_EPSILON_METERS_PER_SECOND = 0.05;
export const MOVEMENT_MEDIUM_CORRECTION_METERS = 0.35;
export const MOVEMENT_HARD_CORRECTION_METERS = 1.5;

export const MOVEMENT_BUTTON_MOVE_FORWARD = 1 << 0;
export const MOVEMENT_BUTTON_MOVE_BACKWARD = 1 << 1;
export const MOVEMENT_BUTTON_MOVE_LEFT = 1 << 2;
export const MOVEMENT_BUTTON_MOVE_RIGHT = 1 << 3;
export const MOVEMENT_BUTTON_JUMP = 1 << 4;
export const MOVEMENT_BUTTON_CROUCH = 1 << 5;
export const MOVEMENT_BUTTON_SPRINT = 1 << 6;
export const MOVEMENT_BUTTON_PRIMARY_FIRE = 1 << 7;
export const MOVEMENT_BUTTON_SECONDARY_FIRE = 1 << 8;
export const MOVEMENT_BUTTON_RELOAD = 1 << 9;
export const MOVEMENT_BUTTON_ABILITY_1 = 1 << 10;
export const MOVEMENT_BUTTON_ABILITY_2 = 1 << 11;
export const MOVEMENT_BUTTON_ULTIMATE = 1 << 12;
export const MOVEMENT_BUTTON_INTERACT = 1 << 13;
export const MOVEMENT_BUTTON_UNSTUCK = 1 << 14;
export const MOVEMENT_BUTTON_CROUCH_PRESSED = 1 << 15;

export const MOVEMENT_ALLOWED_BUTTON_MASK =
  MOVEMENT_BUTTON_MOVE_FORWARD |
  MOVEMENT_BUTTON_MOVE_BACKWARD |
  MOVEMENT_BUTTON_MOVE_LEFT |
  MOVEMENT_BUTTON_MOVE_RIGHT |
  MOVEMENT_BUTTON_JUMP |
  MOVEMENT_BUTTON_CROUCH |
  MOVEMENT_BUTTON_SPRINT |
  MOVEMENT_BUTTON_PRIMARY_FIRE |
  MOVEMENT_BUTTON_SECONDARY_FIRE |
  MOVEMENT_BUTTON_RELOAD |
  MOVEMENT_BUTTON_ABILITY_1 |
  MOVEMENT_BUTTON_ABILITY_2 |
  MOVEMENT_BUTTON_ULTIMATE |
  MOVEMENT_BUTTON_INTERACT |
  MOVEMENT_BUTTON_UNSTUCK |
  MOVEMENT_BUTTON_CROUCH_PRESSED;

export const MOVEMENT_HELD_COMMAND_CLEAR_MASK =
  MOVEMENT_BUTTON_CROUCH_PRESSED |
  MOVEMENT_BUTTON_RELOAD |
  MOVEMENT_BUTTON_ABILITY_1 |
  MOVEMENT_BUTTON_ABILITY_2 |
  MOVEMENT_BUTTON_ULTIMATE |
  MOVEMENT_BUTTON_INTERACT |
  MOVEMENT_BUTTON_UNSTUCK;

export type MovementCorrectionReason =
  | 'normal'
  | 'spawn'
  | 'respawn'
  | 'teleport'
  | 'unstuck'
  | 'knockback'
  | 'epoch_mismatch'
  | 'invalid_transform'
  | 'speed_limit'
  | 'blocked_path'
  | 'bounds'
  | 'queue_overflow'
  | 'collision_revision';

export interface MovementCommand {
  seq: number;
  buttons: number;
  lookYaw: number;
  lookPitch: number;
  clientTimeMs: number;
  movementEpoch: number;
  collisionRevision?: number;
}

export interface MovementCommandPacket {
  protocolVersion: number;
  firstSeq: number;
  commands: MovementCommand[];
}

export interface SelfMovementAuthority {
  serverTick: number;
  serverTime: number;
  ackSeq: number;
  movementEpoch: number;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  movement: PlayerMovementState;
  correctionReason?: MovementCorrectionReason;
  collisionRevision?: number;
}

export interface MovementTelemetrySnapshot {
  commandsReceived: number;
  commandsProcessed: number;
  queueLength: number;
  duplicateCommands: number;
  droppedCommands: number;
  lateCommands: number;
  malformedCommands: number;
  hardCorrections: number;
  mediumCorrections: number;
  invalidTransforms?: number;
  speedViolations?: number;
  blockedPathCorrections?: number;
  boundsCorrections?: number;
  objectiveSuppressions?: number;
  abilityRejects?: number;
  rateLimitDrops?: number;
  staleCollisionRevisionDrops?: number;
  shadowSamples?: number;
  shadowLastPositionDrift?: number;
  shadowLastVelocityDrift?: number;
  shadowMaxPositionDrift?: number;
  shadowMaxVelocityDrift?: number;
  shadowMovementMismatches?: number;
  lastAckSeq: number;
}

const UINT32_MAX = 0xffffffff;
const UINT32_HALF_RANGE = 0x80000000;
const TWO_PI = Math.PI * 2;

export function normalizeMovementSeq(seq: number): number {
  return Number.isFinite(seq) ? Math.trunc(seq) >>> 0 : 0;
}

export function nextMovementSeq(seq: number): number {
  return (normalizeMovementSeq(seq) + 1) >>> 0;
}

export function compareMovementSeq(a: number, b: number): number {
  const normalizedA = normalizeMovementSeq(a);
  const normalizedB = normalizeMovementSeq(b);
  if (normalizedA === normalizedB) return 0;

  const diff = (normalizedA - normalizedB) >>> 0;
  return diff < UINT32_HALF_RANGE ? 1 : -1;
}

export function isMovementSeqAfter(seq: number, reference: number): boolean {
  return compareMovementSeq(seq, reference) > 0;
}

export function movementSeqDistance(fromExclusive: number, toInclusive: number): number {
  return (normalizeMovementSeq(toInclusive) - normalizeMovementSeq(fromExclusive)) >>> 0;
}

export function clampLookPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
}

export function normalizeLookYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  return ((yaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

export function sanitizeMovementButtons(buttons: number): number {
  return (Number.isFinite(buttons) ? Math.trunc(buttons) : 0) & MOVEMENT_ALLOWED_BUTTON_MASK;
}

export function inputStateToMovementButtons(
  input: InputState,
  extras: { unstuck?: boolean; crouchPressed?: boolean } = {}
): number {
  let buttons = 0;
  if (input.moveForward) buttons |= MOVEMENT_BUTTON_MOVE_FORWARD;
  if (input.moveBackward) buttons |= MOVEMENT_BUTTON_MOVE_BACKWARD;
  if (input.moveLeft) buttons |= MOVEMENT_BUTTON_MOVE_LEFT;
  if (input.moveRight) buttons |= MOVEMENT_BUTTON_MOVE_RIGHT;
  if (input.jump) buttons |= MOVEMENT_BUTTON_JUMP;
  if (input.crouch) buttons |= MOVEMENT_BUTTON_CROUCH;
  if (input.sprint) buttons |= MOVEMENT_BUTTON_SPRINT;
  if (input.primaryFire) buttons |= MOVEMENT_BUTTON_PRIMARY_FIRE;
  if (input.secondaryFire) buttons |= MOVEMENT_BUTTON_SECONDARY_FIRE;
  if (input.reload) buttons |= MOVEMENT_BUTTON_RELOAD;
  if (input.ability1) buttons |= MOVEMENT_BUTTON_ABILITY_1;
  if (input.ability2) buttons |= MOVEMENT_BUTTON_ABILITY_2;
  if (input.ultimate) buttons |= MOVEMENT_BUTTON_ULTIMATE;
  if (input.interact) buttons |= MOVEMENT_BUTTON_INTERACT;
  if (extras.unstuck) buttons |= MOVEMENT_BUTTON_UNSTUCK;
  if (extras.crouchPressed) buttons |= MOVEMENT_BUTTON_CROUCH_PRESSED;
  return buttons;
}

export function movementButtonsForHeldCommand(buttons: number): number {
  return sanitizeMovementButtons(buttons) & ~MOVEMENT_HELD_COMMAND_CLEAR_MASK;
}

export function movementButtonsToInputState(buttons: number): InputState & { unstuck?: boolean; crouchPressed?: boolean } {
  const sanitized = sanitizeMovementButtons(buttons);
  return {
    moveForward: Boolean(sanitized & MOVEMENT_BUTTON_MOVE_FORWARD),
    moveBackward: Boolean(sanitized & MOVEMENT_BUTTON_MOVE_BACKWARD),
    moveLeft: Boolean(sanitized & MOVEMENT_BUTTON_MOVE_LEFT),
    moveRight: Boolean(sanitized & MOVEMENT_BUTTON_MOVE_RIGHT),
    jump: Boolean(sanitized & MOVEMENT_BUTTON_JUMP),
    crouch: Boolean(sanitized & MOVEMENT_BUTTON_CROUCH),
    sprint: Boolean(sanitized & MOVEMENT_BUTTON_SPRINT),
    primaryFire: Boolean(sanitized & MOVEMENT_BUTTON_PRIMARY_FIRE),
    secondaryFire: Boolean(sanitized & MOVEMENT_BUTTON_SECONDARY_FIRE),
    reload: Boolean(sanitized & MOVEMENT_BUTTON_RELOAD),
    ability1: Boolean(sanitized & MOVEMENT_BUTTON_ABILITY_1),
    ability2: Boolean(sanitized & MOVEMENT_BUTTON_ABILITY_2),
    ultimate: Boolean(sanitized & MOVEMENT_BUTTON_ULTIMATE),
    interact: Boolean(sanitized & MOVEMENT_BUTTON_INTERACT),
    unstuck: Boolean(sanitized & MOVEMENT_BUTTON_UNSTUCK),
    crouchPressed: Boolean(sanitized & MOVEMENT_BUTTON_CROUCH_PRESSED),
  };
}

export function isValidMovementCommand(command: MovementCommand): boolean {
  return (
    command !== null &&
    typeof command === 'object' &&
    Number.isFinite(command.seq) &&
    Number.isFinite(command.buttons) &&
    Number.isFinite(command.lookYaw) &&
    Number.isFinite(command.lookPitch) &&
    Number.isFinite(command.clientTimeMs) &&
    Number.isFinite(command.movementEpoch) &&
    command.seq >= 0 &&
    command.seq <= UINT32_MAX
  );
}

export function sanitizeMovementCommand(command: MovementCommand): MovementCommand {
  return {
    seq: normalizeMovementSeq(command.seq),
    buttons: sanitizeMovementButtons(command.buttons),
    lookYaw: normalizeLookYaw(command.lookYaw),
    lookPitch: clampLookPitch(command.lookPitch),
    clientTimeMs: Number.isFinite(command.clientTimeMs) ? command.clientTimeMs : 0,
    movementEpoch: Number.isFinite(command.movementEpoch) ? Math.max(0, Math.trunc(command.movementEpoch)) : 0,
    collisionRevision: Number.isFinite(command.collisionRevision)
      ? Math.max(0, Math.trunc(command.collisionRevision as number))
      : undefined,
  };
}
