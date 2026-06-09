import { Player } from './schema/Player';
import { AbilityStateSchema } from './schema/Components';
import { 
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
} from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';

const COOLDOWN_AFTER_ACTIVE_ABILITIES = new Set<string>();

// ============================================================================
// VOID ZONE CONFIGURATION
// ============================================================================

export const VOID_ZONE_RADIUS = 3;
export const VOID_ZONE_DAMAGE = 15;
export const VOID_ZONE_DURATION = 4; // seconds
export const VOID_ZONE_DAMAGE_INTERVAL = 500; // ms between damage ticks

export interface VoidZone {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  damage: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  lastDamageTick: Map<string, number>;
}

// ============================================================================
// ABILITY INITIALIZATION
// ============================================================================

/**
 * Initializes all abilities for a player based on their hero
 */
export function initializePlayerAbilities(player: Player, heroId: HeroId): void {
  const heroDef = HERO_DEFINITIONS[heroId];
  if (!heroDef) return;

  // Clear existing abilities
  player.abilities.clear();

  // Initialize ability 1
  const ability1Id = heroDef.ability1.abilityId;
  const ability1Def = ABILITY_DEFINITIONS[ability1Id];
  if (ability1Def) {
    const ability1State = new AbilityStateSchema();
    ability1State.abilityId = ability1Id;
    ability1State.cooldownRemaining = 0;
    ability1State.charges = ability1Def.charges || 1;
    ability1State.isActive = false;
    player.abilities.set(ability1Id, ability1State);
  }

  // Initialize ability 2
  const ability2Id = heroDef.ability2.abilityId;
  const ability2Def = ABILITY_DEFINITIONS[ability2Id];
  if (ability2Def) {
    const ability2State = new AbilityStateSchema();
    ability2State.abilityId = ability2Id;
    ability2State.cooldownRemaining = 0;
    ability2State.charges = ability2Def.charges || 1;
    ability2State.isActive = false;
    player.abilities.set(ability2Id, ability2State);
  }

  // Initialize ultimate
  const ultimateId = heroDef.ultimate.abilityId;
  const ultimateDef = ABILITY_DEFINITIONS[ultimateId];
  if (ultimateDef) {
    const ultimateState = new AbilityStateSchema();
    ultimateState.abilityId = ultimateId;
    ultimateState.cooldownRemaining = 0;
    ultimateState.charges = ultimateDef.charges || 1;
    ultimateState.isActive = false;
    player.abilities.set(ultimateId, ultimateState);
  }

  console.log(`Initialized abilities for ${player.name}: ${ability1Id}, ${ability2Id}, ${ultimateId}`);
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
  slot: 'ability1' | 'ability2' | 'ultimate'
): AbilityUseResult {
  const heroId = player.heroId as HeroId;
  if (!heroId) {
    return { success: false, reason: 'No hero selected' };
  }

  const heroDef = HERO_DEFINITIONS[heroId];
  if (!heroDef) {
    return { success: false, reason: 'Invalid hero' };
  }

  const abilitySlot = heroDef[slot];
  const abilityId = abilitySlot.abilityId;
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
    console.log(`${player.name} tried to use ${abilityDef.name} but it's already active`);
    return { success: false, reason: 'Active' };
  }

  // Check if on cooldown
  if (!hasMultipleCharges && abilityState.cooldownRemaining > 0) {
    console.log(`${player.name} tried to use ${abilityDef.name} but it's on cooldown (${abilityState.cooldownRemaining.toFixed(1)}s)`);
    return { success: false, reason: 'On cooldown' };
  }

  // Check charges for multi-charge abilities
  if (hasMultipleCharges) {
    if (abilityState.charges <= 0) {
      console.log(`${player.name} tried to use ${abilityDef.name} but has no charges`);
      return { success: false, reason: 'No charges' };
    }
  }

  // Check ultimate charge
  if (slot === 'ultimate') {
    if (player.ultimateCharge < 100) {
      console.log(`${player.name} tried to use ultimate but only has ${player.ultimateCharge.toFixed(0)}%`);
      return { success: false, reason: 'Ultimate not ready' };
    }
    // Consume ultimate charge
    player.ultimateCharge = 0;
  }

  // Use the ability
  console.log(`${player.name} used ${abilityDef.name}!`);

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
  createVoidZone: (position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: 'red' | 'blue') => void;
  resolvePhantomBlinkDestination?: (
    player: Player,
    distance: number
  ) => { x: number; y: number; z: number };
  markAuthoritativePosition?: (playerId: string, durationMs: number) => void;
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
      const distance = 8;
      const yaw = player.lookYaw;
      const fallbackDestination = {
        x: player.position.x + -Math.sin(yaw) * distance,
        y: player.position.y + (player.lookPitch < -0.3 ? 2 : 0),
        z: player.position.z + -Math.cos(yaw) * distance,
      };
      const destination = context.resolvePhantomBlinkDestination?.(player, distance) ?? fallbackDestination;

      player.position.x = destination.x;
      player.position.z = destination.z;
      player.position.y = destination.y;
      player.velocity.x = -Math.sin(yaw) * 2;
      player.velocity.z = -Math.cos(yaw) * 2;
      player.movement.isGrounded = false;
      context.markAuthoritativePosition?.(player.id, 450);

      context.createVoidZone(
        { x: destination.x, y: destination.y - 0.9, z: destination.z },
        player.id,
        player.team as 'red' | 'blue'
      );
      break;
    }

    case 'phantom_shadowstep': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      const distance = 12;
      const yaw = player.lookYaw;
      player.position.x += -Math.sin(yaw) * distance;
      player.position.z += -Math.cos(yaw) * distance;
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

    case 'hookshot_swing': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    case 'hookshot_anchor_wall': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    case 'hookshot_grapple_trap': {
      abilityState.isActive = true;
      abilityState.activatedAt = now;
      break;
    }

    // ===== BLAZE ABILITIES =====
    case 'blaze_flamethrower': {
      player.movement.isJetpacking = false;
      break;
    }

    case 'blaze_rocketjump': {
      player.velocity.y = BLAZE_ROCKET_JUMP_VERTICAL_FORCE;
      player.position.y += 0.5;
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
      ability.isActive = false;
      if (COOLDOWN_AFTER_ACTIVE_ABILITIES.has(ability.abilityId) && ability.cooldownRemaining <= 0) {
        ability.cooldownRemaining = abilityDef.cooldown;
      }
    }
  });
}
