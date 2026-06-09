import type { BotDifficulty, PlayerInput, PlayerSnapshot, Team } from './player.js';
import type { HeroId } from './hero.js';
import type { GamePhase } from './game.js';
import type { Vec3 } from './vector.js';
import type { AbilityCast } from './ability.js';

// Client -> Server Messages
export type ClientMessage = 
  | { type: 'input'; payload: PlayerInput }
  | { type: 'selectHero'; payload: { heroId: HeroId } }
  | { type: 'devSetHero'; payload: { heroId: HeroId } }
  | { type: 'devFillUltimate'; payload: Record<string, never> }
  | { type: 'setDevFly'; payload: { enabled: boolean } }
  | { type: 'setDevImmune'; payload: { enabled: boolean } }
  | { type: 'selectTeam'; payload: { team: Team } }
  | { type: 'chat'; payload: { message: string; teamOnly: boolean } }
  | { type: 'ready'; payload: { ready: boolean } }
  | { type: 'ability'; payload: AbilityCast };

// Server -> Client Messages
export type ServerMessage = 
  | { type: 'gameState'; payload: GameStateSync }
  | { type: 'playerTransforms'; payload: PlayerTransformsMessage }
  | { type: 'playerVitals'; payload: PlayerVitalsMessage }
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
  | { type: 'devHeroChanged'; payload: { heroId: HeroId; health: number; maxHealth: number } }
  | { type: 'devCommandError'; payload: { message: string } }
  | { type: 'abilityEffect'; payload: AbilityEffectEvent }
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
}

export interface PlayerTransformsMessage {
  tick: number;
  serverTime: number;
  players: QuantizedPlayerTransform[];
}

export interface PlayerVitalsSnapshot {
  id: string;
  name: string;
  team: Team;
  heroId: HeroId | null;
  state: PlayerSnapshot['state'];
  isReady: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
  health: number;
  maxHealth: number;
  ultimateCharge: number;
  hasFlag: boolean;
  movement: PlayerSnapshot['movement'];
  abilities: PlayerSnapshot['abilities'];
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
  winningTeam: Team;
  finalScore: { red: number; blue: number };
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
}
