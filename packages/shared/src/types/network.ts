import type { BotDifficulty, PlayerSnapshot, PlayerStats, PlayerVisibilityState, Team } from './player.js';
import type { HeroId } from './hero.js';
import type { GamePhase, MatchOutcome } from './game.js';
import type { Vec3 } from './vector.js';
import type { AbilityCast } from './ability.js';
import type { MovementCommandPacket, SelfMovementAuthority } from './movementPrediction.js';
import type { VoiceTokenRequest, VoiceTokenResponse, VoiceTeamChangedMessage } from './voice.js';
import type { PublicRankSnapshot } from '../progression/ranking.js';
import type { MatchMode } from './matchMode.js';
import type { VoxelMapTheme } from '../maps/procedural/types.js';

// Client -> Server Messages
export type ClientMessage = 
  | { type: 'movementCommands'; payload: MovementCommandPacket }
  | { type: 'playerPingResponse'; payload: PlayerPingResponseMessage }
  | { type: 'selectHero'; payload: { heroId: HeroId } }
  | { type: 'devSetHero'; payload: { heroId: HeroId } }
  | { type: 'devFillUltimate'; payload: Record<string, never> }
  | { type: 'devEndGame'; payload: Record<string, never> }
  | { type: 'setDevImmune'; payload: { enabled: boolean } }
  | { type: 'setDevTimeFrozen'; payload: { enabled: boolean } }
  | { type: 'selectTeam'; payload: { team: Team } }
  | { type: 'chat'; payload: { message: string; teamOnly: boolean } }
  | { type: 'ready'; payload: { ready: boolean } }
  | { type: 'matchSceneReady'; payload: MatchSceneReadyMessage }
  | { type: 'requestVoiceToken'; payload: VoiceTokenRequest }
  | { type: 'ability'; payload: AbilityCast };

// Server -> Client Messages
export type ServerMessage = 
  | { type: 'playerTransformsV2'; payload: PlayerTransformsV2Message }
  | { type: 'playerInterest'; payload: PlayerInterestMessage }
  | { type: 'selfMovementAuthority'; payload: SelfMovementAuthority }
  | { type: 'playerVitals'; payload: PlayerVitalsMessage }
  | { type: 'playerPingRequest'; payload: PlayerPingRequestMessage }
  | { type: 'playerPings'; payload: PlayerPingsMessage }
  | { type: 'matchSnapshot'; payload: MatchSnapshotMessage }
  | { type: 'matchStartGate'; payload: MatchStartGateMessage }
  | { type: 'matchCancelled'; payload: MatchCancelledMessage }
  | { type: 'playerJoined'; payload: { playerId: string; playerName: string } }
  | { type: 'playerLeft'; payload: { playerId: string } }
  | { type: 'playerKilled'; payload: PlayerDeathEvent }
  | { type: 'flagPickup'; payload: FlagEvent }
  | { type: 'flagDrop'; payload: FlagEvent }
  | { type: 'flagCapture'; payload: FlagEvent }
  | { type: 'flagReturn'; payload: FlagEvent }
  | { type: 'phaseChange'; payload: { phase: GamePhase; endTime: number } }
  | { type: 'roundEnd'; payload: RoundEndEvent }
  | { type: 'gameEnd'; payload: GameEndEvent }
  | { type: 'chat'; payload: ChatMessage }
  | { type: 'voiceToken'; payload: VoiceTokenResponse }
  | { type: 'voiceTeamChanged'; payload: VoiceTeamChangedMessage }
  | { type: 'devHeroChanged'; payload: { heroId: HeroId; health: number; maxHealth: number } }
  | { type: 'devCommandError'; payload: { message: string } }
  | { type: 'abilityEffect'; payload: AbilityEffectEvent }
  | { type: 'playerHealed'; payload: PlayerHealedEvent }
  | { type: 'chronosAegisDamaged'; payload: ChronosAegisDamagedEvent }
  | { type: 'chronosAegisBroken'; payload: ChronosAegisBrokenEvent }
  | { type: 'phantomShieldBroken'; payload: PhantomShieldBrokenEvent }
  | { type: 'damage'; payload: DamageEvent };

export interface ChronosAegisDamagedEvent {
  playerId: string;
  sourceId: string | null;
  damage: number;
  damageType: string;
  shieldHp: number;
  shieldRatio: number;
  position: Vec3;
  direction: Vec3;
  serverTime: number;
}

export interface ChronosAegisBrokenEvent {
  playerId: string;
  position: Vec3;
  direction: Vec3;
  serverTime: number;
}

export interface PhantomShieldBrokenEvent {
  playerId: string;
  position: Vec3;
  direction: Vec3;
  serverTime: number;
}

export type PackedPlayerTransform = [
  netId: number,
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  yaw: number,
  pitch: number,
  movementBits: number,
  wallRunSide: -1 | 0 | 1,
  movementEpoch: number,
  chronosAegisShield: number,
];

export interface PlayerTransformsV2Message {
  version: 2;
  tick: number;
  serverTime: number;
  streamEpoch?: number;
  full?: boolean;
  players: PackedPlayerTransform[];
  hiddenPlayerIds?: string[];
}

export interface PlayerInterestSnapshot {
  playerId: string;
  state: PlayerVisibilityState;
  reason?: string;
  lastKnownPosition?: Vec3;
  expiresAt?: number;
}

export interface PlayerInterestMessage {
  tick: number;
  serverTime: number;
  players: PlayerInterestSnapshot[];
}

export interface PlayerVitalsAbilitySnapshot {
  abilityId: string;
  cooldownUntil: number;
  charges: number;
  isActive: boolean;
  activatedAt?: number;
}

export interface PlayerVitalsSnapshot {
  id: string;
  netId: number;
  name: string;
  team: Team;
  heroId: HeroId | null;
  state: PlayerSnapshot['state'];
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
  rank?: PublicRankSnapshot;
  health: number;
  maxHealth: number;
  ultimateCharge: number;
  onFireUntil?: number | null;
  hasFlag: boolean;
  movement: PlayerSnapshot['movement'];
  abilities: Record<string, PlayerVitalsAbilitySnapshot>;
  stats: NonNullable<PlayerSnapshot['stats']>;
  respawnTime: number | null;
  spawnProtectionUntil: number | null;
  visibility?: PlayerVisibilityState;
}

export interface PlayerVitalsMessage {
  tick: number;
  serverTime: number;
  players: PlayerVitalsSnapshot[];
  removedPlayerIds?: string[];
}

export interface PlayerPingRequestMessage {
  nonce: string;
}

export interface PlayerPingResponseMessage {
  nonce: string;
}

export interface MatchSceneReadyMessage {
  key: number;
}

export interface MatchStartGateMessage {
  key: number;
  serverTime: number;
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  position: Vec3;
  movementEpoch: number;
  ackSeq: number;
  collisionRevision?: number;
}

export interface MatchCancelledMessage {
  reason: string;
  message: string;
  roomId: string;
  requiredHumanPlayers: number;
  connectedHumanPlayers: number;
  deadlineAt: number;
  refundedWager: boolean;
  serverTime: number;
  blockedPlayerId?: string;
  blockedPlayerName?: string;
  networkQuality?: {
    reason?: string | null;
    sampleCount?: number;
    successfulSamples?: number;
    timeoutCount?: number;
    consecutiveTimeouts?: number;
    timeoutRatio?: number;
    averagePingMs?: number | null;
    peakPingMs?: number | null;
    jitterMs?: number | null;
    observationMs?: number;
    windowMs?: number;
  };
}

export interface PlayerPingSnapshot {
  playerId: string;
  pingMs: number | null;
}

export interface PlayerPingsMessage {
  serverTime: number;
  players: PlayerPingSnapshot[];
}

export interface MatchSnapshotMessage {
  tick: number;
  serverTime: number;
  phase: GamePhase;
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  redScore: number;
  blueScore: number;
  redFlag: FlagSync;
  blueFlag: FlagSync;
  roundTimeRemaining: number;
  phaseEndTime: number | null;
  gameClockFrozen?: boolean;
}

export interface FlagSync {
  position: Vec3;
  carrierId: string | null;
  isAtBase: boolean;
}

export interface PlayerDeathEvent {
  victimId: string;
  killerId: string | null;
  assistIds: string[];
  abilityId?: string;
  position: Vec3;
  velocity?: Vec3;
  sourcePosition?: Vec3 | null;
  sourceDirection?: Vec3 | null;
  damageType?: string;
  occurredAt?: number;
  respawnTime?: number | null;
}

export interface FlagEvent {
  team: Team;
  playerId: string;
  position: Vec3;
}

export interface RoundEndEvent {
  winningTeam: Team | null;
  redScore: number;
  blueScore: number;
  nextPhase: GamePhase;
}

export interface GameEndEvent {
  matchMode: MatchMode;
  winningTeam: Team | null;
  finalScore: { red: number; blue: number };
  matchId: string | null;
  endedAt: number;
  durationMs: number;
  forcedByPlayerId?: string;
  matchIntegrity?: MatchIntegritySummary;
  goldenBiomeReward?: GoldenBiomeRewardSummary;
  players: MatchSummaryPlayer[];
}

export interface GoldenBiomeRewardSummary {
  rewardUsdCents: number;
  rewardToken: 'SOL';
  winningTeam: Team | null;
  eligiblePlayerIds: string[];
  status: 'pending' | 'not_applicable';
}

export interface MatchIntegritySummary {
  status: 'clean' | 'suspicious' | 'compromised' | 'no_contest';
  reviewRequired: boolean;
  rankedOutcome: 'normal' | 'review_required';
  wagerOutcome: 'normal' | 'review_required';
  message: string;
}

export interface MatchSummaryPlayer {
  playerId: string;
  userId: string | null;
  playerName: string;
  team: Team;
  heroId: HeroId | null;
  isBot: boolean;
  outcome: MatchOutcome;
  stats: PlayerStats;
  score: number;
  experienceGained: number;
  rank?: PublicRankSnapshot;
  ratingDelta?: number | null;
  rankBefore?: PublicRankSnapshot | null;
  rankAfter?: PublicRankSnapshot | null;
}

export interface ChatMessage {
  playerId: string;
  playerName: string;
  message: string;
  teamOnly: boolean;
  timestamp: number;
}

export interface AbilityEffectEvent {
  abilityId: string;
  casterId: string;
  position: Vec3;
  direction?: Vec3;
  targetIds?: string[];
}

export interface DamageEvent {
  targetId: string;
  sourceId: string | null;
  amount: number;
  abilityId?: string;
  position: Vec3;
}

export interface PlayerHealedEvent {
  sourceId: string;
  abilityId: string;
  sourcePosition: Vec3;
  targets: Array<{
    targetId: string;
    amount: number;
    newHealth: number;
    position: Vec3;
  }>;
  timestamp: number;
}

// Room state for Colyseus
export interface RoomOptions {
  roomName?: string;
  maxPlayers?: number;
  isPrivate?: boolean;
  password?: string;
}

export interface JoinOptions {
  playerName: string;
  preferredTeam?: Team;
  clientId?: string;
  entryTicket?: string;
  authToken?: string;
}
