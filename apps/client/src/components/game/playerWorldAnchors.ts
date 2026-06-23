import * as THREE from 'three';
import {
  HERO_DEFINITIONS,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_SLIDE_HEIGHT,
  type HeroId,
  type PlayerMovementState,
} from '@voxel-strike/shared';

export const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
export const CROUCH_HEIGHT_RATIO = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
export const SLIDE_HEIGHT_RATIO = PLAYER_SLIDE_HEIGHT / PLAYER_HEIGHT;
export const CROUCH_BODY_POSTURE_SCALE_Y = 0.88;
export const SLIDE_BODY_POSTURE_SCALE_Y = 0.66;
export const DOWNED_HEIGHT_RATIO = 0.42;
export const DOWNED_BODY_POSTURE_SCALE_Y = 1;
export const NAMEPLATE_WORLD_OFFSET_Y = 0.58;
export const COMBAT_TEXT_NAMEPLATE_CLEARANCE_Y = 0.72;

export function getPlayerHeight(heroId: HeroId | null): number {
  return heroId ? HERO_DEFINITIONS[heroId].stats.size.height : PLAYER_HEIGHT;
}

function isDownedState(state?: string | null): boolean {
  return state === 'downed';
}

export function hasLoweredPlayerPosture(movement: PlayerMovementState, state?: string | null): boolean {
  return isDownedState(state) || movement.isCrouching || movement.isSliding;
}

export function getVisiblePlayerHeight(heroId: HeroId | null, movement: PlayerMovementState, state?: string | null): number {
  const playerHeight = getPlayerHeight(heroId);
  if (isDownedState(state)) {
    return Math.max(PLAYER_SLIDE_HEIGHT, playerHeight * DOWNED_HEIGHT_RATIO);
  }
  if (movement.isSliding) {
    return Math.max(PLAYER_SLIDE_HEIGHT, playerHeight * SLIDE_HEIGHT_RATIO);
  }
  return hasLoweredPlayerPosture(movement, state)
    ? Math.max(PLAYER_CROUCH_HEIGHT, playerHeight * CROUCH_HEIGHT_RATIO)
    : playerHeight;
}

export function getPlayerBodyPostureScaleY(movement: PlayerMovementState, state?: string | null): number {
  if (isDownedState(state)) return DOWNED_BODY_POSTURE_SCALE_Y;
  if (movement.isSliding) return SLIDE_BODY_POSTURE_SCALE_Y;
  if (movement.isCrouching) return CROUCH_BODY_POSTURE_SCALE_Y;
  return 1;
}

export function getPlayerFeetY(centerY: number): number {
  return centerY - PLAYER_CENTER_TO_FEET;
}

export function getNameplateWorldY(
  centerY: number,
  heroId: HeroId | null,
  movement: PlayerMovementState,
  state?: string | null
): number {
  return getPlayerFeetY(centerY) + getVisiblePlayerHeight(heroId, movement, state) + NAMEPLATE_WORLD_OFFSET_Y;
}

export function getCombatTextWorldY(
  centerY: number,
  heroId: HeroId | null,
  movement: PlayerMovementState,
  state?: string | null
): number {
  return getNameplateWorldY(centerY, heroId, movement, state) + COMBAT_TEXT_NAMEPLATE_CLEARANCE_Y;
}

export function setPlayerRenderOrigin(
  target: THREE.Vector3,
  position: { x: number; y: number; z: number }
): THREE.Vector3 {
  return target.set(position.x, getPlayerFeetY(position.y), position.z);
}
