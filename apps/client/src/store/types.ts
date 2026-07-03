import type {
  GamePhase,
  Player,
  Team,
  HeroId,
  HeroSkinId,
  Vec3,
  PlayerInput,
  BotDifficulty,
  BlueprintPreview,
  MapProfileId,
  MapTopologyId,
  MatchMode,
  PregeneratedMapStats,
  PublicRankSnapshot,
  PowerupPickupRuntimeState,
  SafeZoneSnapshot,
  VoxelMapSizeId,
  VoxelMapTheme,
  GameplayMode,
  MatchPerspective,
  PlayerRole,
} from '@voxel-strike/shared';

export type { PowerupPickupRuntimeState, SafeZoneSnapshot };

// Re-export VisualState from visualStore for central type access
import type { VisualState } from './visualStore';
export type { VisualState };

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  role?: PlayerRole;
  team: string;
  heroId?: HeroId | '';
  skinId?: HeroSkinId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  rank?: PublicRankSnapshot;
}

export interface MapVoteOption {
  id: string;
  seed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize: VoxelMapSizeId;
  mapSizeLabel?: string;
  mapProfileId?: MapProfileId | null;
  name: string;
  themeId: string;
  themeName: string;
  topologyId?: MapTopologyId;
  preview?: BlueprintPreview;
  score?: number;
  pregeneratedMapId?: string | null;
  mapArtifactId?: string | null;
  catalogTags?: string[];
  stats?: PregeneratedMapStats;
  generatorVersion?: number | null;
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
  gameplayMode: GameplayMode | null;
  botFillMode: 'manual' | 'fill_even' | null;
  matchPerspective: MatchPerspective | null;
  rankBandId: number | null;
  rankBandLabel: string | null;
  averageCompetitiveRating: number | null;
  averageVisibleRank: string | null;
  rankSearchDistance: number | null;
  queuedHumanCount: number | null;
  provisionalHumanCount: number | null;
  requiredPlayers: number | null;
  botFillGraceEndsAt: number | null;
  capacityBlocked: boolean;
  capacityMaxPlayers: number | null;
}

export type AppPhase = 'menu' | 'matchmaking' | 'in_lobby' | 'map_vote' | 'match_loading' | 'streamer_loading' | 'in_game';

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
  ownerTeam: Team;
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
  ownerTeam: Team;
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
  ownerTeam: Team;
}

export interface BombData {
  id: string;
  targetPosition: { x: number; y: number; z: number };
  interceptPosition?: { x: number; y: number; z: number };
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
  startPosition: { x: number; y: number; z: number };
  warningStartTime?: number;
  startTime: number;
  impactTime: number; // When the bomb lands
  radius: number;
  ownerId: string;
  ownerTeam: Team;
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
  ownerTeam: Team;
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
  ownerTeam: Team;
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
  ownerTeam: Team;
  state: 'flying' | 'attached' | 'pulling';
  targetId?: string; // Player ID if hooked
  startPosition: { x: number; y: number; z: number };
  launchSide?: -1 | 1; // -1 = left hand, 1 = right hand
  launchYaw?: number; // Fallback orientation for resolving the launch socket
}

export interface HookshotGroundHooksTargetData {
  targetId: string;
  position: { x: number; y: number; z: number };
  rootUntil: number;
}

export interface HookshotGroundHooksData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
  duration: number;
  ownerId: string;
  ownerTeam: Team;
  radius: number;
  rootUntil: number;
  targets: HookshotGroundHooksTargetData[];
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
  ownerTeam: Team;
  maxDistance: number; // How far the hook travels
  hookProgress: number; // 0-1, how far the hook has traveled
}

// ============================================================================
// RE-EXPORTS from shared
// ============================================================================

export type { GamePhase, Player, Team, HeroId, Vec3, PlayerInput };
