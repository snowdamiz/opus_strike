import type { Vec3, Quaternion } from './vector.js';
import type { HeroId } from './hero.js';
import type { HeroSkinId } from './skins.js';
import type { AbilityCastOriginHint, AbilityState } from './ability.js';
import type { PublicRankSnapshot } from '../progression/ranking.js';
import type { Team } from './team.js';

export type { Team } from './team.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export type PlayerState = 
  | 'spectating'
  | 'selecting'     // Hero select
  | 'spawning'
  | 'dropping'
  | 'alive'
  | 'downed'
  | 'dead';

export type PlayerVisibilityState = 'visible' | 'audible' | 'last_known' | 'hidden';

export interface PlayerMovementState {
  isGrounded: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  slideTimeRemaining: number;
  isWallRunning: boolean;
  wallRunSide: 'left' | 'right' | null;
  isGrappling: boolean;
  grapplePoint: Vec3 | null;
  isJetpacking: boolean;
  jetpackFuel: number;
  isGliding: boolean;
  chronosAscendantStartY?: number;
}

export function createDefaultPlayerMovementState(
  overrides: Partial<PlayerMovementState> = {}
): PlayerMovementState {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    isJetpacking: false,
    jetpackFuel: 100,
    isGliding: false,
    ...overrides,
    grapplePoint: overrides.grapplePoint ? { ...overrides.grapplePoint } : overrides.grapplePoint ?? null,
  };
}

export interface PlayerInput {
  tick: number;
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  jump: boolean;
  crouch: boolean;
  crouchPressed?: boolean;
  sprint: boolean;
  primaryFire: boolean;
  secondaryFire: boolean;
  reload: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
  interact: boolean;
  lookYaw: number;
  lookPitch: number;
  timestamp: number;
  clientFrameRateBand?: string;
  abilityCastHints?: AbilityCastOriginHint[];
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

export interface Player {
  id: string;
  name: string;
  team: Team;
  heroId: HeroId | null;
  skinId?: HeroSkinId | null;
  state: PlayerState;
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
  
  // Transform
  position: Vec3;
  velocity: Vec3;
  rotation?: Quaternion;
  lookYaw: number;
  lookPitch: number;
  
  // Health
  health: number;
  maxHealth: number;
  downedHealth?: number | null;
  downedMaxHealth?: number | null;
  downedStartedAt?: number | null;
  downedRemainingMs?: number | null;
  downedExpiresAt?: number | null;
  reviveStartedAt?: number | null;
  reviveCompletesAt?: number | null;
  reviveByPlayerId?: string | null;
  ultimateCharge: number;
  onFireUntil?: number | null;
  powerupBoostUntil?: number | null;
  
  // Movement state
  movement: PlayerMovementState;
  
  // Abilities
  abilities: Record<string, AbilityState>;
  
  // CTF
  hasFlag: boolean;
  
  // Respawn
  respawnTime: number | null;
  spawnProtectionUntil: number | null;
  
  // Match stats
  stats: PlayerStats;
  rank?: PublicRankSnapshot;
  visibility?: PlayerVisibilityState;
}

export interface PlayerSnapshot {
  id: string;
  name?: string;
  team?: Team;
  heroId?: HeroId | null;
  skinId?: HeroSkinId | null;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  health: number;
  maxHealth?: number;
  downedHealth?: number | null;
  downedMaxHealth?: number | null;
  downedStartedAt?: number | null;
  downedRemainingMs?: number | null;
  downedExpiresAt?: number | null;
  reviveStartedAt?: number | null;
  reviveCompletesAt?: number | null;
  reviveByPlayerId?: string | null;
  powerupBoostUntil?: number | null;
  state: PlayerState;
  movement: PlayerMovementState;
  abilities: Record<string, AbilityState>;
  hasFlag: boolean;
  isBot?: boolean;
  rank?: PublicRankSnapshot;
  stats?: PlayerStats;
}

export function isPlayerAlive(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive';
}

export function isPlayerDowned(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'downed';
}

export function isPlayerAliveOrDowned(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive' || player.state === 'downed';
}

export function isBattleRoyalContestant(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return (
    player.state === 'alive' ||
    player.state === 'downed' ||
    player.state === 'dropping' ||
    player.state === 'spawning'
  );
}

export function canReceiveLiveTransform(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive' || player.state === 'downed' || player.state === 'spawning';
}

export function canUseCombatInput(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive';
}

export function canUseMovementInput(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive' || player.state === 'downed';
}

export function canUseAbilityInput(player: Pick<Player, 'state'> | { state?: string | null }): boolean {
  return player.state === 'alive';
}
