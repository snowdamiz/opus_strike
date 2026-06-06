/**
 * Player Physics Hook
 * 
 * Handles ground detection, wall collision, gravity, and step-up logic.
 */

import { useCallback } from 'react';
import * as THREE from 'three';
import { GRAVITY } from '@voxel-strike/shared';
import {
  checkPlayerBodyMovement,
  checkGroundWithNormal,
  hasPlayerBodyClearance,
  isPhysicsReady,
  raycastDirection,
  type GroundInfo,
} from '../usePhysics';
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
  SMOOTH_SPEED_LARGE,
  TERRAIN_RAMP_DOWN_SMOOTH_SPEED,
  TERRAIN_RAMP_UP_SMOOTH_SPEED,
  OUT_OF_BOUNDS_Y,
  RESPAWN_Y,
} from './constants';
import { isInsideBoundary, constrainToBoundary } from '../../config/mapBoundaries';

export interface GroundCheckResult {
  isGrounded: boolean;
  canJump: boolean;
  newY: number | null;
  groundInfo: GroundInfo | null;
}

export interface PhysicsUpdateResult {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  isGrounded: boolean;
  canJump: boolean;
  didStepUp: boolean;
}

export interface UsePlayerPhysicsReturn {
  checkGround: (
    position: THREE.Vector3, 
    velocity: THREE.Vector3, 
    smoothedY: number | null,
    wasGrounded: boolean,
    dt: number
  ) => {
    isGrounded: boolean;
    canJump: boolean;
    newSmoothedY: number | null;
    groundInfo: GroundInfo | null;
  };
  
  applyHorizontalMovement: (
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    isGrounded: boolean,
    smoothedY: number | null,
    isIceWallRushing: boolean,
    dt: number
  ) => { didStepUp: boolean; newSmoothedY: number | null; hitTerrain: boolean };
  
  applyGravity: (velocity: THREE.Vector3, isGrounded: boolean, isGrappling: boolean, isSwinging: boolean, dt: number) => void;

  applyVerticalMovement: (
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    dt: number
  ) => { hitCeiling: boolean };
  
  checkOutOfBounds: (position: THREE.Vector3, velocity: THREE.Vector3, isGrounded: boolean) => void;
  
  constrainToMapBoundary: (
    position: THREE.Vector3,
    previousPosition: { x: number; z: number }
  ) => void;
}

function smoothY(currentY: number, targetY: number, speed: number, dt: number): number {
  const t = 1 - Math.exp(-speed * dt);
  return currentY + (targetY - currentY) * t;
}

const MAX_GROUND_HIT_ABOVE_FEET = STEP_HEIGHT + 0.12;
const CEILING_CLEARANCE = 0.04;
const CEILING_PROBE_RADIUS = PLAYER_RADIUS * 0.65;
const CEILING_PROBE_OFFSETS = [
  { x: 0, z: 0 },
  { x: CEILING_PROBE_RADIUS, z: 0 },
  { x: -CEILING_PROBE_RADIUS, z: 0 },
  { x: 0, z: CEILING_PROBE_RADIUS },
  { x: 0, z: -CEILING_PROBE_RADIUS },
];

function isGroundHitAboveStepRange(position: THREE.Vector3, groundY: number): boolean {
  const playerFeetY = position.y - PLAYER_HEIGHT / 2;
  return groundY - playerFeetY > MAX_GROUND_HIT_ABOVE_FEET;
}

function getAllowedUpwardMoveBeforeCeiling(position: THREE.Vector3, upwardMove: number): number | null {
  if (upwardMove <= 0 || !isPhysicsReady()) return null;

  const headY = position.y + PLAYER_HEIGHT / 2;
  const castDistance = upwardMove + CEILING_CLEARANCE * 2;
  let nearestAllowedMove = Infinity;

  for (const offset of CEILING_PROBE_OFFSETS) {
    const hit = raycastDirection(
      position.x + offset.x,
      headY - CEILING_CLEARANCE,
      position.z + offset.z,
      0,
      1,
      0,
      castDistance
    );

    if (hit?.hit) {
      const allowedMove = Math.max(0, hit.distance - CEILING_CLEARANCE * 2);
      nearestAllowedMove = Math.min(nearestAllowedMove, allowedMove);
    }
  }

  return nearestAllowedMove === Infinity ? null : nearestAllowedMove;
}

function canMovePlayerBody(position: THREE.Vector3, moveX: number, moveZ: number): boolean {
  return !checkPlayerBodyMovement(
    position.x,
    position.y,
    position.z,
    moveX,
    moveZ,
    PLAYER_RADIUS,
    PLAYER_HEIGHT
  ).blocked;
}

function canOccupyPlayerBody(x: number, y: number, z: number): boolean {
  return hasPlayerBodyClearance(x, y, z, PLAYER_RADIUS, PLAYER_HEIGHT);
}

export function usePlayerPhysics(): UsePlayerPhysicsReturn {
  // Check ground and handle landing
  const checkGround = useCallback((
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    smoothedY: number | null,
    _wasGrounded: boolean,
    dt: number
  ): {
    isGrounded: boolean;
    canJump: boolean;
    newSmoothedY: number | null;
    groundInfo: GroundInfo | null;
  } => {
    if (!isPhysicsReady()) {
      return { isGrounded: false, canJump: false, newSmoothedY: null, groundInfo: null };
    }

    const groundInfo = checkGroundWithNormal(position.x, position.y + 0.5, position.z, 50);

    if (!groundInfo) {
      return { isGrounded: false, canJump: false, newSmoothedY: null, groundInfo: null };
    }

    const targetY = groundInfo.groundY + PLAYER_HEIGHT / 2;
    const playerFeetY = position.y - PLAYER_HEIGHT / 2;
    const distToGround = playerFeetY - groundInfo.groundY;
    const snapDistance = distToGround >= 0 ? STEP_HEIGHT : 0.15;

    if (isGroundHitAboveStepRange(position, groundInfo.groundY)) {
      return {
        isGrounded: false,
        canJump: false,
        newSmoothedY: null,
        groundInfo
      };
    }

    // Close to or below ground
    if (distToGround <= snapDistance && velocity.y <= 0) {
      if (groundInfo.isWalkable) {
        // Calculate smoothed Y position for ground following
        const currentY = smoothedY ?? position.y;
        const heightDelta = targetY - currentY;
        const isTerrainFollow = Math.abs(heightDelta) <= STEP_HEIGHT + 0.1 && Math.abs(velocity.y) < 3;
        const smoothSpeed = isTerrainFollow
          ? heightDelta >= 0
            ? TERRAIN_RAMP_UP_SMOOTH_SPEED
            : TERRAIN_RAMP_DOWN_SMOOTH_SPEED
          : SMOOTH_SPEED_LARGE;
        const newY = smoothY(currentY, targetY, smoothSpeed, dt);

        position.y = newY;
        velocity.y = 0;

        return {
          isGrounded: true,
          canJump: true,
          newSmoothedY: newY,
          groundInfo
        };
      } else {
        // Too steep - slide
        const slideForce = 15 * dt;
        velocity.x += groundInfo.normal.x * slideForce;
        velocity.z += groundInfo.normal.z * slideForce;
        position.y = targetY;
        velocity.y = 0;

        return { 
          isGrounded: false, 
          canJump: false, 
          newSmoothedY: targetY,
          groundInfo 
        };
      }
    }

    return { 
      isGrounded: false, 
      canJump: false, 
      newSmoothedY: null,
      groundInfo 
    };
  }, []);

  // Apply horizontal movement with step-up logic
  const applyHorizontalMovement = useCallback((
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    isGrounded: boolean,
    smoothedY: number | null,
    isIceWallRushing: boolean,
    dt: number
  ): { didStepUp: boolean; newSmoothedY: number | null; hitTerrain: boolean } => {
    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    const targetX = position.x + moveX;
    const targetZ = position.z + moveZ;
    let didStepUp = false;
    let hitTerrain = false;
    let newSmoothedY = smoothedY;

    if (!isPhysicsReady() || (Math.abs(moveX) <= 0.001 && Math.abs(moveZ) <= 0.001)) {
      position.x += moveX;
      position.z += moveZ;
      return { didStepUp: false, newSmoothedY, hitTerrain: false };
    }

    // Step-up logic for stairs
    const effectivelyGrounded = isGrounded || (isIceWallRushing && velocity.y < 2);

    if (effectivelyGrounded) {
      const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (moveDist > 0) {
        const speedScale = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) / 10;
        const lookAheadDist = Math.max(moveDist * 3, 0.5, speedScale * 0.5);
        const aheadX = position.x + (moveX / moveDist) * lookAheadDist;
        const aheadZ = position.z + (moveZ / moveDist) * lookAheadDist;

        const groundAhead = checkGroundWithNormal(aheadX, position.y + STEP_HEIGHT + 1, aheadZ, STEP_HEIGHT + 3);

        if (groundAhead && groundAhead.isWalkable) {
          const currentFeetY = position.y - PLAYER_HEIGHT / 2;
          const targetGroundY = groundAhead.groundY;
          const heightDiff = targetGroundY - currentFeetY;

          const effectiveStepHeight = isIceWallRushing ? STEP_HEIGHT * 1.25 : STEP_HEIGHT;
          
          if (heightDiff > 0.1 && heightDiff <= effectiveStepHeight) {
            // Check ceiling clearance
            const ceilingCheck = checkGroundWithNormal(aheadX, targetGroundY + PLAYER_HEIGHT + 0.5, aheadZ, 1);
            const hasCeiling = ceilingCheck && ceilingCheck.groundY < targetGroundY + PLAYER_HEIGHT;

            if (!hasCeiling) {
              const targetY = targetGroundY + PLAYER_HEIGHT / 2;
              const hasBodyClearance = canOccupyPlayerBody(targetX, targetY, targetZ);

              if (hasBodyClearance) {
                const currentY = smoothedY ?? position.y;
                const smoothSpeed = isIceWallRushing
                  ? TERRAIN_RAMP_UP_SMOOTH_SPEED * 1.35
                  : TERRAIN_RAMP_UP_SMOOTH_SPEED;

                position.x += moveX;
                position.z += moveZ;
                position.y = smoothY(currentY, targetY, smoothSpeed, dt);
                newSmoothedY = position.y;
                velocity.y = 0;
                didStepUp = true;
                hitTerrain = true;
              } else {
                hitTerrain = true;
              }
            }
          }
        }
      }
    }

    // Normal movement if didn't step up
    if (!didStepUp) {
      if (canMovePlayerBody(position, moveX, moveZ)) {
        position.x += moveX;
        position.z += moveZ;
      } else {
        hitTerrain = true;

        if (Math.abs(moveX) > 0.001 && canMovePlayerBody(position, moveX, 0)) {
          position.x += moveX;
        } else {
          velocity.x = 0;
        }

        if (Math.abs(moveZ) > 0.001 && canMovePlayerBody(position, 0, moveZ)) {
          position.z += moveZ;
        } else {
          velocity.z = 0;
        }
      }
    }

    return { didStepUp, newSmoothedY, hitTerrain };
  }, []);

  // Apply gravity
  const applyGravity = useCallback((
    velocity: THREE.Vector3,
    isGrounded: boolean,
    isGrappling: boolean,
    isSwinging: boolean,
    dt: number
  ) => {
    // Skip gravity when grounded to prevent bounce-on-land
    // (ground check already handles positioning and zeroes velocity.y)
    if (isGrounded) return;

    // Reduced gravity during grapple, skipped during swing
    if (isSwinging) return;

    const gravityMult = isGrappling ? 0.1 : 1.0;
    velocity.y += GRAVITY * dt * gravityMult;
  }, []);

  const applyVerticalMovement = useCallback((
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    dt: number
  ): { hitCeiling: boolean } => {
    const verticalMove = velocity.y * dt;

    if (verticalMove <= 0) {
      position.y += verticalMove;
      return { hitCeiling: false };
    }

    const allowedMove = getAllowedUpwardMoveBeforeCeiling(position, verticalMove);
    if (allowedMove !== null && allowedMove <= verticalMove) {
      position.y += allowedMove;
      velocity.y = 0;
      return { hitCeiling: true };
    }

    position.y += verticalMove;
    return { hitCeiling: false };
  }, []);

  // Check and handle out of bounds
  const checkOutOfBounds = useCallback((
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    isGrounded: boolean
  ) => {
    // Respawn if below main terrain level
    if (position.y < OUT_OF_BOUNDS_Y && isGrounded) {
      position.set(-30, RESPAWN_Y, -20);
      velocity.set(0, 0, 0);
    }

    // Safety net - respawn if fell too far
    if (position.y < -50) {
      position.set(0, RESPAWN_Y, 0);
      velocity.set(0, 0, 0);
    }
  }, []);

  // Constrain position to map boundary
  const constrainToMapBoundary = useCallback((
    position: THREE.Vector3,
    previousPosition: { x: number; z: number }
  ) => {
    if (!isInsideBoundary(position.x, position.z)) {
      const constrained = constrainToBoundary(previousPosition.x, previousPosition.z, position.x, position.z);
      position.x = constrained.x;
      position.z = constrained.z;
    }
  }, []);

  return {
    checkGround,
    applyHorizontalMovement,
    applyGravity,
    applyVerticalMovement,
    checkOutOfBounds,
    constrainToMapBoundary,
  };
}
