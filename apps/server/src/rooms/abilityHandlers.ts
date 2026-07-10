import { Player } from './schema/Player';
import { AbilityStateSchema } from './schema/Components';
import { 
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE,
  CHRONOS_ASCENDANT_PARADOX_LIFT_POSITION_BOOST,
  CHRONOS_ASCENDANT_PARADOX_LIFT_VERTICAL_FORCE,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  PHANTOM_BLINK_DISTANCE,
  PHANTOM_VOID_ZONE_DAMAGE,
  PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS,
  PHANTOM_VOID_ZONE_DURATION_SECONDS,
  PHANTOM_VOID_ZONE_RADIUS,
  calculateBlazeAfterburnerVelocity,
  calculateBlazeRocketJumpVelocity,
  calculateLookDirection,
} from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';

const COOLDOWN_AFTER_ACTIVE_ABILITIES = new Set<string>([
  'phantom_personal_shield',
]);

export function deactivateActiveAbility(ability: AbilityStateSchema): void {
  ability.isActive = false;
  ability.activatedAt = 0;

  if (!COOLDOWN_AFTER_ACTIVE_ABILITIES.has(ability.abilityId) || ability.cooldownRemaining > 0) {
    return;
  }

  const abilityDef = ABILITY_DEFINITIONS[ability.abilityId];
  if (abilityDef) {
    ability.cooldownRemaining = abilityDef.cooldown;
  }
}

// ============================================================================
// VOID ZONE CONFIGURATION
// ============================================================================

export const VOID_ZONE_RADIUS = PHANTOM_VOID_ZONE_RADIUS;
export const VOID_ZONE_DAMAGE = PHANTOM_VOID_ZONE_DAMAGE;
export const VOID_ZONE_DURATION = PHANTOM_VOID_ZONE_DURATION_SECONDS;
export const VOID_ZONE_DAMAGE_INTERVAL = PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS;

export interface VoidZone {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  damage: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: Team;
  lastDamageTick: Map<string, number>;
}

export interface HeroAbilitySelection {
  ability1: string;
  ability2: string;
}

function createAbilityState(abilityId: string): AbilityStateSchema | null {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  if (!abilityDef) return null;

  const abilityState = new AbilityStateSchema();
  abilityState.abilityId = abilityId;
  abilityState.cooldownRemaining = 0;
  abilityState.charges = abilityDef.charges || 1;
  abilityState.isActive = false;
  return abilityState;
}

function getSelectedAbilityIds(
  heroId: HeroId,
  selection?: HeroAbilitySelection
): [string, string, string] {
  const heroDef = HERO_DEFINITIONS[heroId];
  return [
    selection?.ability1 ?? heroDef.ability1.abilityId,
    selection?.ability2 ?? heroDef.ability2.abilityId,
    heroDef.ultimate.abilityId,
  ];
}

// ============================================================================
// ABILITY INITIALIZATION
// ============================================================================

/**
 * Initializes all abilities for a player based on their hero
 */
export function initializePlayerAbilities(
  player: Player,
  heroId: HeroId,
  selection?: HeroAbilitySelection
): void {
  const heroDef = HERO_DEFINITIONS[heroId];
  if (!heroDef) return;

  // Clear existing abilities
  player.abilities.clear();

  for (const abilityId of getSelectedAbilityIds(heroId, selection)) {
    const abilityState = createAbilityState(abilityId);
    if (abilityState) player.abilities.set(abilityId, abilityState);
  }
}

export function reconcilePlayerAbilities(
  player: Player,
  heroId: HeroId,
  selection?: HeroAbilitySelection
): void {
  const desiredAbilityIds = new Set(getSelectedAbilityIds(heroId, selection));
  const currentAbilityIds = Array.from(player.abilities.keys());
  for (const abilityId of currentAbilityIds) {
    if (!desiredAbilityIds.has(abilityId)) player.abilities.delete(abilityId);
  }
  for (const abilityId of desiredAbilityIds) {
    if (player.abilities.has(abilityId)) continue;
    const abilityState = createAbilityState(abilityId);
    if (abilityState) player.abilities.set(abilityId, abilityState);
  }
}

/**
 * Resets ability cooldowns for a player (used on respawn/round start)
 */
export function resetAbilityCooldowns(player: Player): void {
  player.abilities.forEach(ability => {
    ability.cooldownRemaining = 0;
    ability.isActive = false;
    const def = ABILITY_DEFINITIONS[ability.abilityId];
    if (def) {
      ability.charges = def.charges || 1;
    }
  });
}

// ============================================================================
// ABILITY USAGE
// ============================================================================

export interface AbilityUseResult {
  success: boolean;
  abilityId?: string;
  abilityDef?: any;
  abilityState?: AbilityStateSchema;
  reason?: string;
}

/**
 * Attempts to use an ability for a player
 * Returns the ability details if successful, null otherwise
 */
export function tryUseAbility(
  player: Player,
  slot: 'ability1' | 'ability2' | 'ultimate',
  selectedAbilityId?: string
): AbilityUseResult {
  const heroId = player.heroId as HeroId;
  if (!heroId) {
    return { success: false, reason: 'No hero selected' };
  }

  const heroDef = HERO_DEFINITIONS[heroId];
  if (!heroDef) {
    return { success: false, reason: 'Invalid hero' };
  }

  const abilityId = selectedAbilityId ?? heroDef[slot].abilityId;
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  if (!abilityDef) {
    return { success: false, reason: 'Invalid ability' };
  }

  const abilityState = player.abilities.get(abilityId);
  if (!abilityState) {
    return { success: false, reason: 'Ability not initialized' };
  }

  const hasMultipleCharges = Boolean(abilityDef.charges && abilityDef.charges > 1);
  const cooldownStartsAfterActive = COOLDOWN_AFTER_ACTIVE_ABILITIES.has(abilityId);

  if (abilityState.isActive) {
    return { success: false, reason: 'Active' };
  }

  // Check if on cooldown
  if (!hasMultipleCharges && abilityState.cooldownRemaining > 0) {
    return { success: false, reason: 'On cooldown' };
  }

  // Check charges for multi-charge abilities
  if (hasMultipleCharges) {
    if (abilityState.charges <= 0) {
      return { success: false, reason: 'No charges' };
    }
  }

  // Check ultimate charge
  if (slot === 'ultimate') {
    if (player.ultimateCharge < 100) {
      return { success: false, reason: 'Ultimate not ready' };
    }
    // Consume ultimate charge
    player.ultimateCharge = 0;
  }

  // Handle charges vs cooldown
  if (hasMultipleCharges) {
    abilityState.charges--;
    if (abilityState.charges <= 0) {
      abilityState.cooldownRemaining = abilityDef.chargeRegenTime || abilityDef.cooldown;
    }
  } else {
    abilityState.cooldownRemaining = cooldownStartsAfterActive ? 0 : abilityDef.cooldown;
  }

  return { success: true, abilityId, abilityDef, abilityState };
}

// ============================================================================
// ABILITY EXECUTION
// ============================================================================

export interface AbilityExecutionContext {
  createVoidZone: (position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: Team) => void;
  resolvePhantomBlinkDestination?: (
    player: Player,
    distance: number
  ) => { x: number; y: number; z: number };
  clampPosition?: (position: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  markAuthoritativePosition?: (playerId: string, durationMs: number, reason?: 'teleport' | 'knockback') => void;
}

function clampPlayerPosition(
  player: Player,
  context: AbilityExecutionContext
): { clampedY: boolean } {
  const clampedPosition = context.clampPosition?.({
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
  });
  if (!clampedPosition) return { clampedY: false };

  const clampedY = clampedPosition.y < player.position.y;
  player.position.x = clampedPosition.x;
  player.position.y = clampedPosition.y;
  player.position.z = clampedPosition.z;
  return { clampedY };
}

function stopUpwardVelocityAtCeiling(player: Player, clampedY: boolean): void {
  if (clampedY && player.velocity.y > 0) {
    player.velocity.y = 0;
  }
}

/**
 * Executes the effect of an ability
 */
export function executeAbility(
  player: Player,
  abilityId: string,
  abilityState: AbilityStateSchema,
  _abilityDef: any,
  context: AbilityExecutionContext
): void {
  const now = Date.now();

  switch (abilityId) {
    // ===== PHANTOM ABILITIES =====
    case 'phantom_blink': {
      const distance = PHANTOM_BLINK_DISTANCE;
      const yaw = player.lookYaw;
      const blinkDirection = calculateLookDirection(yaw, player.lookPitch);
      const fallbackDestination = {
        x: player.position.x + blinkDirection.x * distance,
        y: player.position.y + blinkDirection.y * distance,
        z: player.position.z + blinkDirection.z * distance,
      };
      const destination = context.resolvePhantomBlinkDestination?.(player, distance) ?? fallbackDestination;

      player.position.x = destination.x;
      player.position.z = destination.z;
      player.position.y = destination.y;
      player.velocity.x = blinkDirection.x * 2;
      player.velocity.z = blinkDirection.z * 2;
      player.movement.isGrounded = false;
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
      context.markAuthoritativePosition?.(player.id, 450, 'teleport');

      context.createVoidZone(
        { x: destination.x, y: destination.y - 0.9, z: destination.z },
        player.id,
        player.team as Team
      );
      break;
    }

    case 'phantom_personal_shield': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    case 'phantom_veil': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    // ===== HOOKSHOT ABILITIES =====
    case 'hookshot_grapple': {
      abilityState.activatedAt = now;
      break;
    }

    case 'hookshot_anchor_wall': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    case 'hookshot_ground_hooks': {
      abilityState.isActive = false;
      abilityState.activatedAt = now;
      break;
    }

    // ===== BLAZE ABILITIES =====
    case 'blaze_flamethrower': {
      player.movement.isJetpacking = false;
      break;
    }

    case 'blaze_rocketjump': {
      const velocity = calculateBlazeRocketJumpVelocity(player.velocity, player.lookYaw);
      player.velocity.x = velocity.x;
      player.velocity.y = velocity.y;
      player.velocity.z = velocity.z;
      player.position.y += 0.5;
      stopUpwardVelocityAtCeiling(player, clampPlayerPosition(player, context).clampedY);
      player.movement.isGrounded = false;
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
      context.markAuthoritativePosition?.(player.id, 550, 'knockback');
      break;
    }

    case 'blaze_afterburner': {
      const velocity = calculateBlazeAfterburnerVelocity(player.velocity, player.lookYaw);
      player.velocity.x = velocity.x;
      player.velocity.y = velocity.y;
      player.velocity.z = velocity.z;
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
      context.markAuthoritativePosition?.(player.id, 450, 'knockback');
      break;
    }

    case 'blaze_airstrike': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    // ===== CHRONOS ABILITIES =====
    case 'chronos_timebreak': {
      abilityState.activatedAt = now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS;
      break;
    }

    case 'chronos_ascendant_paradox': {
      const forwardX = -Math.sin(player.lookYaw);
      const forwardZ = -Math.cos(player.lookYaw);
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      player.movement.chronosAscendantStartY = player.position.y;
      player.position.y += CHRONOS_ASCENDANT_PARADOX_LIFT_POSITION_BOOST;
      player.velocity.x += forwardX * CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE;
      player.velocity.y = Math.max(player.velocity.y, CHRONOS_ASCENDANT_PARADOX_LIFT_VERTICAL_FORCE);
      player.velocity.z += forwardZ * CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE;
      stopUpwardVelocityAtCeiling(player, clampPlayerPosition(player, context).clampedY);
      player.movement.isGrounded = false;
      player.movement.isSliding = false;
      player.movement.slideTimeRemaining = 0;
      player.movement.isJetpacking = true;
      player.movement.isGliding = true;
      context.markAuthoritativePosition?.(player.id, 650, 'knockback');
      break;
    }

  }
}

// ============================================================================
// COOLDOWN UPDATES
// ============================================================================

/**
 * Updates ability cooldowns for a player
 */
export function updateAbilityCooldowns(player: Player, dt: number, tempoMultiplier = 1): void {
  const scaledDt = dt * Math.max(0.01, tempoMultiplier);
  player.abilities.forEach((ability) => {
    const def = ABILITY_DEFINITIONS[ability.abilityId];
    if (ability.cooldownRemaining > 0) {
      ability.cooldownRemaining = Math.max(0, ability.cooldownRemaining - scaledDt);
      if (ability.cooldownRemaining <= 0 && def?.charges && ability.charges < def.charges) {
        ability.charges = def.charges;
      }
    }
  });
}

/**
 * Updates active ability states (checks for duration expiration)
 */
export function updateActiveAbilities(player: Player, now: number): void {
  player.abilities.forEach((ability) => {
    if (!ability.isActive) return;

    const abilityDef = ABILITY_DEFINITIONS[ability.abilityId];
    if (!abilityDef || !abilityDef.duration) return;

    const elapsedMs = now - ability.activatedAt;
    if (elapsedMs >= abilityDef.duration * 1000) {
      deactivateActiveAbility(ability);
    }
  });
}
