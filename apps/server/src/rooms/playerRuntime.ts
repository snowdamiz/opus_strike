import {
  BLAZE_FLAMETHROWER_MAX_FUEL,
  type PlayerInput,
} from '@voxel-strike/shared';
import { Player } from './schema/Player';

export interface PlayerAliveRuntimeResetInput {
  now: number;
  spawnProtectionMs: number;
  resetRespawnTime?: boolean;
}

export interface PlayerAliveRuntimeResetPlan {
  resetAbilityCooldowns: boolean;
  resetBotBrain: boolean;
  resetPrimaryMagazine: boolean;
  clearChronosAegisShield: boolean;
}

export function applyPlayerAliveRuntimeReset(
  player: Player,
  input: PlayerAliveRuntimeResetInput
): PlayerAliveRuntimeResetPlan {
  player.state = 'alive';
  player.health = player.maxHealth;
  player.spawnProtectionUntil = input.now + input.spawnProtectionMs;
  if (input.resetRespawnTime) {
    player.respawnTime = 0;
  }
  if (player.heroId === 'blaze') {
    player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
  }

  return {
    resetAbilityCooldowns: true,
    resetBotBrain: player.isBot,
    resetPrimaryMagazine: player.heroId === 'phantom' || player.heroId === 'blaze' || player.heroId === 'chronos',
    clearChronosAegisShield: player.heroId === 'chronos',
  };
}

export function createEmptyPlayerInput(tick: number, player: Player, now: number): PlayerInput {
  return {
    tick,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: player.lookYaw,
    lookPitch: player.lookPitch,
    timestamp: now,
  };
}

export function createEmptyBotInput(tick: number, bot: Player, now: number): PlayerInput {
  return createEmptyPlayerInput(tick, bot, now);
}

export function stopBotMovement(bot: Player, options: { vertical: boolean }): void {
  bot.velocity.x = 0;
  if (options.vertical) {
    bot.velocity.y = 0;
  }
  bot.velocity.z = 0;
  bot.movement.isSprinting = false;
  bot.movement.isCrouching = false;
  bot.movement.isWallRunning = false;
  bot.movement.wallRunSide = '';
}

export function resetPlayerMovementRuntime(player: Player): void {
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.movement.isGrounded = true;
  player.movement.isSprinting = false;
  player.movement.isCrouching = false;
  player.movement.isSliding = false;
  player.movement.slideTimeRemaining = 0;
  player.movement.isWallRunning = false;
  player.movement.wallRunSide = '';
  player.movement.isGrappling = false;
  player.movement.isJetpacking = false;
  player.movement.isGliding = false;
  player.movement.chronosAscendantStartY = 0;
}
