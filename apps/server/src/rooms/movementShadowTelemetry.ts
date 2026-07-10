import type { PlayerMovementState } from '@voxel-strike/shared';

interface MovementSnapshotPlayer {
  movement: {
    isGrounded: boolean;
    isSprinting: boolean;
    isCrouching: boolean;
    isSliding: boolean;
    slideTimeRemaining: number;
    isWallRunning: boolean;
    wallRunSide: string;
    isGrappling: boolean;
    isJetpacking: boolean;
    jetpackFuel: number;
    isGliding: boolean;
    chronosAscendantStartY: number;
  };
}

interface MovementShadowClassPlayer {
  hasFlag: boolean;
  heroId: string;
  afterburnerActive?: boolean;
  movement: {
    isGrounded: boolean;
    isGrappling: boolean;
    isSliding: boolean;
    isGliding: boolean;
    isWallRunning: boolean;
  };
}

interface MovementShadowInput {
  jump?: boolean;
  crouch?: boolean;
  sprint?: boolean;
  moveForward?: boolean;
  moveBackward?: boolean;
  moveLeft?: boolean;
  moveRight?: boolean;
  ability1?: boolean;
  ability2?: boolean;
  secondaryFire?: boolean;
  clientFrameRateBand?: string;
}

const VALID_MOVEMENT_SHADOW_FRAME_RATE_BANDS = new Set([
  '90fps+',
  '45-90fps',
  '30-45fps',
  'sub30fps',
]);

export function buildPlayerMovementSnapshot(player: MovementSnapshotPlayer): PlayerMovementState {
  return {
    isGrounded: player.movement.isGrounded,
    isSprinting: player.movement.isSprinting,
    isCrouching: player.movement.isCrouching,
    isSliding: player.movement.isSliding,
    slideTimeRemaining: player.movement.slideTimeRemaining,
    isWallRunning: player.movement.isWallRunning,
    wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
      ? player.movement.wallRunSide
      : null,
    isGrappling: player.movement.isGrappling,
    grapplePoint: null,
    isJetpacking: player.movement.isJetpacking,
    jetpackFuel: player.movement.jetpackFuel,
    isGliding: player.movement.isGliding,
    chronosAscendantStartY: player.movement.chronosAscendantStartY || undefined,
  };
}

export function getMovementShadowPingBand(pingMs: number | undefined): string {
  if (!Number.isFinite(pingMs)) return 'unknown';
  if ((pingMs as number) <= 50) return '0-50';
  if ((pingMs as number) <= 100) return '51-100';
  if ((pingMs as number) <= 180) return '101-180';
  return '181+';
}

export function getMovementShadowFrameRateBand(input: MovementShadowInput): string {
  const value = input.clientFrameRateBand;
  return value && VALID_MOVEMENT_SHADOW_FRAME_RATE_BANDS.has(value)
    ? value
    : 'unknown';
}

export function getMovementShadowClass(
  player: MovementShadowClassPlayer,
  input: MovementShadowInput
): string {
  if (player.hasFlag) return 'flag_route';
  if (player.movement.isGrappling) return 'grapple';
  if (player.movement.isSliding) return input.jump ? 'slide_jump' : 'slide';
  if (player.movement.isGliding) return 'glide';
  if (player.movement.isWallRunning) return 'wallrun';
  if (player.heroId === 'blaze' && player.afterburnerActive) return 'afterburner_dash';
  if (player.heroId === 'blaze' && input.ability2) return 'rocket_jump';
  if (player.heroId === 'phantom' && (input.ability1 || input.ability2)) return 'teleport_ability';
  if (player.heroId === 'chronos' && input.ability1) {
    return input.secondaryFire ? 'chronos_lifeline_self' : 'chronos_lifeline_allies';
  }
  if (player.heroId === 'chronos' && input.ability2) return 'chronos_tempo';
  if (input.jump && !player.movement.isGrounded) return 'bhop_air';
  if (input.crouch) return 'crouch';
  if (input.sprint) return 'sprint';
  if (input.moveForward || input.moveBackward || input.moveLeft || input.moveRight) return 'walk';
  return 'idle';
}
