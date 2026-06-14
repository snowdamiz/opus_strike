import type {
  GamePhase,
  Player,
  Team,
  HeroId,
  Vec3,
  PlayerInput,
  BotDifficulty,
  BlueprintPreview,
  MapTopologyId,
  PublicRankSnapshot,
  MatchMode,
  VoxelMapTheme,
} from '@voxel-strike/shared';

// Re-export VisualState from visualStore for central type access
import type { VisualState } from './visualStore';
export type { VisualState };

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  team: string;
  isObserver?: boolean;
  heroId?: HeroId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  paymentStatus?: WagerPaymentStatus;
  paymentWalletAddress?: string;
  depositSignature?: string;
  refundSignature?: string;
  rank?: PublicRankSnapshot;
}

export type WagerPaymentStatus =
  | ''
  | 'not_required'
  | 'unpaid'
  | 'intent_created'
  | 'submitted'
  | 'confirmed'
  | 'credited'
  | 'refunding'
  | 'refunded'
  | 'settled'
  | 'failed'
  | 'expired';

export interface LobbyWagerState {
  enabled: boolean;
  matchMode?: MatchMode;
  rankedEntryQuoteId?: string | null;
  rankedEntryQuoteExpiresAt?: string | null;
  status?: string;
  token?: 'SOL' | string;
  coverChargeLamports?: string;
  treasuryWallet?: string;
  platformFeeBps?: number;
  potLamports?: string;
  paidPlayerCount?: number;
}

export interface RankedEntryQuote {
  quoteId: string;
  usdCents: number;
  solUsdPrice?: string;
  solUsdPriceMicroUsd: string;
  coverChargeLamports: string;
  priceSource: string;
  expiresAt: string;
  cluster: string;
}

export interface WagerPaymentIntent {
  intentId: string;
  lobbyId: string;
  status: WagerPaymentStatus;
  token: 'SOL';
  amountLamports: string;
  treasuryWallet: string;
  walletAddress: string;
  memo: string;
  expiresAt: string;
  cluster: string;
}

export interface WagerPaymentTransaction {
  intentId: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cluster: string;
}

export interface MapVoteOption {
  id: string;
  seed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  name: string;
  themeId: string;
  themeName: string;
  topologyId?: MapTopologyId;
  preview?: BlueprintPreview;
  score?: number;
}

export interface MapVoteRecord {
  playerId: string;
  optionId: string;
}

export interface UserStats {
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCaptures: number;
  totalFlagReturns: number;
  totalScore: number;
  totalExperience: number;
  totalWagerGames: number;
  totalWagerWins: number;
  totalWagerLosses: number;
  totalWagerDraws: number;
  totalWageredLamports: string;
  totalWagerWonLamports: string;
  totalWagerLostLamports: string;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt: string | null;
}

export interface MatchmakingStatus {
  matchMode: MatchMode | null;
  rankBandId: number | null;
  rankBandLabel: string | null;
  averageCompetitiveRating: number | null;
  averageVisibleRank: string | null;
  rankSearchDistance: number | null;
  queuedHumanCount: number | null;
  provisionalHumanCount: number | null;
  requiredPlayers: number | null;
  rankedCoverChargeLamports: string | null;
  rankedEntryQuoteId: string | null;
}

export type AppPhase = 'menu' | 'matchmaking' | 'in_lobby' | 'map_vote' | 'in_game';

// ============================================================================
// PHANTOM PROJECTILE TYPES
// ============================================================================

export interface VoidZoneData {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

export interface DireBallData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam?: Team | null;
  launchSide?: -1 | 1;
  launchYaw?: number;
  viewmodelEventId?: string;
}

export interface VoidRayData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

// ============================================================================
// BLAZE PROJECTILE TYPES
// ============================================================================

export interface RocketData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

export interface BombData {
  id: string;
  targetPosition: { x: number; y: number; z: number };
  interceptPosition?: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startPosition: { x: number; y: number; z: number };
  startTime: number;
  impactTime: number; // When the bomb lands
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  hasExploded: boolean;
}

// ============================================================================
// CHRONOS PROJECTILE TYPES
// ============================================================================

export interface ChronosPulseData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  supercharged?: boolean;
  radius?: number;
}

// ============================================================================
// HOOKSHOT PROJECTILE TYPES
// ============================================================================

export interface HookProjectileData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  state: 'extending' | 'retracting';
  maxDistance: number;
  startPosition: { x: number; y: number; z: number };
  launchSide?: -1 | 1; // -1 = left hand, 1 = right hand
  launchYaw?: number; // Fallback orientation for resolving the launch socket
}

export interface DragHookData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  state: 'flying' | 'attached' | 'pulling';
  targetId?: string; // Player ID if hooked
  startPosition: { x: number; y: number; z: number };
  launchSide?: -1 | 1; // -1 = left hand, 1 = right hand
  launchYaw?: number; // Fallback orientation for resolving the launch socket
}

export interface GrappleTrapData {
  id: string;
  position: { x: number; y: number; z: number }; // Target/landing position
  startPosition?: { x: number; y: number; z: number }; // Where it was thrown from
  velocity?: { x: number; y: number; z: number }; // Initial throw velocity for grenade arc
  startTime: number;
  duration: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  radius: number;
  hookedPlayers: string[]; // IDs of players hooked
}

export interface GrappleLineData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  state: 'extending' | 'attached' | 'pulling' | 'retracting' | 'done';
  launchSide?: -1 | 1; // -1 = left hand, 1 = right hand
  launchYaw?: number; // Fallback orientation for resolving the launch socket
}

export interface EarthWallData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number }; // Horizontal direction of travel
  startTime: number;
  duration: number; // How long the anchor wall stays solid
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  maxDistance: number; // How far the hook travels
  hookProgress: number; // 0-1, how far the hook has traveled
}

// ============================================================================
// RE-EXPORTS from shared
// ============================================================================

export type { GamePhase, Player, Team, HeroId, Vec3, PlayerInput };
