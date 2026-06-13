/**
 * Player Controller Types
 */

import * as THREE from 'three';
import type { InputState, HeroId } from '@voxel-strike/shared';

// ============================================================================
// MOVEMENT STATE
// ============================================================================

export interface MovementState {
  velocity: THREE.Vector3;
  isGrounded: boolean;
  wasGrounded: boolean;
  canJump: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  slideTime: number;
  slideCooldown: number;
  slideDirection: THREE.Vector3;
  slideIntensity: number;
}

export interface MovementRefs {
  velocity: React.MutableRefObject<THREE.Vector3>;
  isGrounded: React.MutableRefObject<boolean>;
  wasGrounded: React.MutableRefObject<boolean>;
  canJump: React.MutableRefObject<boolean>;
  isSprinting: React.MutableRefObject<boolean>;
  isCrouching: React.MutableRefObject<boolean>;
  isSliding: React.MutableRefObject<boolean>;
  slideTime: React.MutableRefObject<number>;
  slideCooldown: React.MutableRefObject<number>;
  slideDirection: React.MutableRefObject<THREE.Vector3>;
  slideIntensity: React.MutableRefObject<number>;
  wasSprintingBeforeSlide: React.MutableRefObject<boolean>;
  smoothedY: React.MutableRefObject<number | null>;
}

// ============================================================================
// CAMERA STATE
// ============================================================================

export interface CameraState {
  yaw: number;
  pitch: number;
  crouchHeight: number;
  slidePitch: number;
  slideFov: number;
  slideRoll: number;
}

export interface CameraRefs {
  yaw: React.MutableRefObject<number>;
  pitch: React.MutableRefObject<number>;
  crouchHeight: React.MutableRefObject<number>;
  slidePitch: React.MutableRefObject<number>;
  slideFov: React.MutableRefObject<number>;
  slideRoll: React.MutableRefObject<number>;
}

// ============================================================================
// ABILITY STATE
// ============================================================================

export interface AbilityActiveState {
  active: boolean;
  startTime: number;
  startCooldownOnEnd?: boolean;
}

export interface AbilityRefs {
  pressed: React.MutableRefObject<{ ability1: boolean; ability2: boolean; ultimate: boolean }>;
  cooldowns: React.MutableRefObject<Record<string, number>>;
  charges: React.MutableRefObject<Record<string, number>>;
  active: React.MutableRefObject<Record<string, AbilityActiveState>>;
  teleportInProgress: React.MutableRefObject<boolean>;
}

// ============================================================================
// TARGETING STATE
// ============================================================================

export interface TargetingState {
  target: THREE.Vector3 | null;
  isValid: boolean;
}

export interface TargetingRefs {
  target: React.MutableRefObject<THREE.Vector3 | null>;
  isValid: React.MutableRefObject<boolean>;
}

// ============================================================================
// HERO-SPECIFIC STATE
// ============================================================================

export interface PhantomState {
  lastFireTime: number;
  direBallId: number;
  voidRayCharging: boolean;
  voidRayChargeStart: number;
  voidRayId: number;
}

export interface BlazeState {
  lastRocketTime: number;
  rocketId: number;
  lastBombTime: number;
  bombId: number;
  flamethrowerFuel: number;
  flamethrowerActive: boolean;
}

export interface HookshotState {
  hookProjectileId: number;
  dragHookId: number;
  grappleTrapId: number;
  grappleLineId: number;
  earthWallId: number;
  lastHookTime: number;
  lastDragHookTime: number;
}

// ============================================================================
// SHARED HERO ABILITY CONTEXT
// ============================================================================

export interface AbilityContext {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  heroId: HeroId;
  localPlayer: {
    id: string;
    team?: string;
    position: { x: number; y: number; z: number };
    ultimateCharge?: number;
  };
  inputState: InputState;
  dt: number;
  isGrounded: boolean;
  camera?: THREE.Camera;
  viewmodelElapsedSeconds?: number;
  viewmodelNowMs?: number;
}

// ============================================================================
// CALLBACK TYPES
// ============================================================================

export type TargetUpdateCallback = (position: THREE.Vector3 | null, isValid: boolean) => void;

export interface PlayerSounds {
  playPhantomBlink: () => void;
  playPhantomVeil: () => void;
  playPhantomBasic: () => void;
  playPhantomVoidRay: () => void;
  startPhantomVoidRayCharge: (durationMs: number) => void;
  stopPhantomVoidRayCharge: () => void;
  playBlazeRocket: () => void;
  playBlazeBombTarget: () => void;
  playBlazeBombRelease: () => void;
  playBlazeBombFall: () => void;
  playBlazeBombExplode: () => void;
  playBlazeRocketJump: () => void;
  startFlamethrowerSound: () => void;
  stopFlamethrowerSound: () => void;
}

export interface MovementSounds {
  updateWalkingSound: (speed: number, grounded: boolean, sliding: boolean, baseSpeed: number, justLanded: boolean) => void;
  startSlide: () => void;
  stopSlide: () => void;
}
