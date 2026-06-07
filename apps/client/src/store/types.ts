import type {
  GamePhase,
  Player,
  Team,
  HeroId,
  Vec3,
  PlayerInput,
  BotDifficulty,
} from '@voxel-strike/shared';

// Re-export VisualState from visualStore for central type access
import type { VisualState } from './visualStore';
export type { VisualState };

// ============================================================================
// LOBBY TYPES
// ============================================================================

export interface LobbyInfo {
  roomId: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  humanCount?: number;
  botCount?: number;
  participantCount?: number;
  maxParticipants?: number;
  status: string;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  team: string;
  heroId?: HeroId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
}

export interface UserStats {
  totalGames: number;
  totalWins: number;
  totalKills: number;
  totalDeaths: number;
  totalCaptures: number;
}

export type AppPhase = 'menu' | 'browsing_lobbies' | 'in_lobby' | 'in_game';

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
  startTime: number;
  ownerId: string;
  ownerTeam?: Team | null;
}

export interface VoidRayData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
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
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

export interface BombData {
  id: string;
  targetPosition: { x: number; y: number; z: number };
  startPosition: { x: number; y: number; z: number };
  startTime: number;
  impactTime: number; // When the bomb lands
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  hasExploded: boolean;
}

// ============================================================================
// HOOKSHOT PROJECTILE TYPES
// ============================================================================

export interface HookProjectileData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
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

export interface SwingLineData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  attachPoint: { x: number; y: number; z: number };
  startTime: number;
  duration: number;
  ownerId: string;
  isActive: boolean;
  // Apex-style grapple state
  state: 'extending' | 'attached' | 'swinging' | 'done';
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
  wallSegments: { x: number; y: number; z: number; height: number }[]; // Legacy visual segment data
}

// ============================================================================
// GLACIER EFFECT TYPES
// ============================================================================

// Ice Mallet Swing - Glacier basic attack (melee swing in arc)
export interface IceMalletSwingData {
  id: string;
  position: { x: number; y: number; z: number }; // Player position when swinging
  direction: { x: number; y: number; z: number }; // Look direction (center of swing arc)
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  hasHit: boolean; // Track if we've already hit something this swing
  swingDirection: 1 | -1; // 1 = right-to-left, -1 = left-to-right (alternates)
}

// Ice Wall Rush - Glacier E ability (propels player forward while building ice wall behind)
export interface IceWallSegmentData {
  position: { x: number; y: number; z: number };
  height: number;
  width: number;
  rotation: number; // Y rotation to face perpendicular to travel direction
  createdAt: number;
  createdFrameAt?: number;
}

export interface IceWallRushData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  segments: IceWallSegmentData[]; // Wall segments created during rush
  isActive: boolean;
}

// ============================================================================
// RE-EXPORTS from shared
// ============================================================================

export type { GamePhase, Player, Team, HeroId, Vec3, PlayerInput };
