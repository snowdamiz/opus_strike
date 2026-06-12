import type { BotDifficulty, PlayerSnapshot, PlayerStats, Team } from './player.js';
import type { HeroId } from './hero.js';
import type { GamePhase, MatchOutcome } from './game.js';
import type { Vec3 } from './vector.js';
import type { AbilityCast } from './ability.js';
import type { MovementCommandPacket, SelfMovementAuthority } from './movementPrediction.js';
import type { VoiceTokenRequest, VoiceTokenResponse, VoiceTeamChangedMessage } from './voice.js';
import type { PublicRankSnapshot } from '../progression/ranking.js';
import type { MatchMode } from './matchMode.js';

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
  | { type: 'requestVoiceToken'; payload: VoiceTokenRequest }
  | { type: 'ability'; payload: AbilityCast };

// Server -> Client Messages
export type ServerMessage = 
  | { type: 'gameState'; payload: GameStateSync }
  | { type: 'playerTransforms'; payload: PlayerTransformsMessage }
  | { type: 'playerTransformsV2'; payload: PlayerTransformsV2Message }
  | { type: 'selfMovementAuthority'; payload: SelfMovementAuthority }
  | { type: 'playerVitals'; payload: PlayerVitalsMessage }
  | { type: 'playerPingRequest'; payload: PlayerPingRequestMessage }
  | { type: 'playerPings'; payload: PlayerPingsMessage }
  | { type: 'matchSnapshot'; payload: MatchSnapshotMessage }
  | { type: 'playerJoined'; payload: { playerId: string; playerName: string } }
  | { type: 'playerLeft'; payload: { playerId: string } }
  | { type: 'playerDied'; payload: PlayerDeathEvent }
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
  | { type: 'damage'; payload: DamageEvent };

export interface GameStateSync {
  tick: number;
  serverTime: number;
  phase: GamePhase;
  mapSeed: number;
  players: PlayerSnapshot[];
  redScore: number;
  blueScore: number;
  redFlag: FlagSync;
  blueFlag: FlagSync;
  roundTimeRemaining: number;
}

export interface QuantizedPlayerTransform {
  id: string;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  movementBits: number;
  wallRunSide: -1 | 0 | 1;
  movementEpoch: number;
}

export interface PlayerTransformsMessage {
  tick: number;
  serverTime: number;
  players: QuantizedPlayerTransform[];
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
];

export interface PlayerTransformsV2Message {
  version: 2;
  tick: number;
  serverTime: number;
  streamEpoch?: number;
  full?: boolean;
  players: PackedPlayerTransform[];
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
  hasFlag: boolean;
  movement: PlayerSnapshot['movement'];
  abilities: Record<string, PlayerVitalsAbilitySnapshot>;
  stats: NonNullable<PlayerSnapshot['stats']>;
  respawnTime: number | null;
  spawnProtectionUntil: number | null;
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
  redScore: number;
  blueScore: number;
  redFlag: FlagSync;
  blueFlag: FlagSync;
  roundTimeRemaining: number;
  phaseEndTime: number | null;
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
  players: MatchSummaryPlayer[];
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
