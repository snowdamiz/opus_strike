/**
 * Player Physics Hook
 * 
 * Handles ground detection, wall collision, gravity, and step-up logic.
 */

import { useCallback } from 'react';
import * as THREE from 'three';
import { GRAVITY } from '@voxel-strike/shared';
import {
  checkGroundWithNormal,
  checkWallCollision,
  isPhysicsReady,
  type GroundInfo,
} from '../usePhysics';
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
  SMALL_BUMP_THRESHOLD,
  SMOOTH_SPEED_SMALL,
  SMOOTH_SPEED_LARGE,
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
  ) => { didStepUp: boolean; newSmoothedY: number | null };
  
  applyGravity: (velocity: THREE.Vector3, isGrounded: boolean, isGrappling: boolean, isSwinging: boolean, dt: number) => void;
  
  checkOutOfBounds: (position: THREE.Vector3, velocity: THREE.Vector3, isGrounded: boolean) => void;
  
  constrainToMapBoundary: (
    position: THREE.Vector3,
    previousPosition: { x: number; z: number }
  ) => void;
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

    // Close to or below ground
    if (distToGround <= 0.15 && velocity.y <= 0) {
      if (groundInfo.isWalkable) {
        // Calculate height change for smoothing
        const currentY = smoothedY ?? position.y;
        const heightChange = Math.abs(targetY - currentY);

        // Use smoothing for small bumps, snap for larger changes
        let newY: number;
        if (heightChange < SMALL_BUMP_THRESHOLD && smoothedY !== null) {
          const smoothSpeed = SMOOTH_SPEED_SMALL * dt;
          newY = currentY + (targetY - currentY) * Math.min(smoothSpeed, 1);
        } else {
          const smoothSpeed = SMOOTH_SPEED_LARGE * dt;
          newY = currentY + (targetY - currentY) * Math.min(smoothSpeed, 1);
        }

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
  ): { didStepUp: boolean; newSmoothedY: number | null } => {
    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    let didStepUp = false;
    let newSmoothedY = smoothedY;

    if (!isPhysicsReady() || (Math.abs(moveX) <= 0.001 && Math.abs(moveZ) <= 0.001)) {
      position.x += moveX;
      position.z += moveZ;
      return { didStepUp: false, newSmoothedY };
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
              // Step up!
              position.x = position.x + moveX * 2;
              position.z = position.z + moveZ * 2;
              position.y = targetGroundY + PLAYER_HEIGHT / 2;
              newSmoothedY = position.y;
              velocity.y = 0;
              didStepUp = true;
            }
          }
        }
      }
    }

    // Normal movement if didn't step up
    if (!didStepUp) {
      const moveDirX = Math.abs(moveX) > 0.001 ? Math.sign(moveX) : 0;
      const moveDirZ = Math.abs(moveZ) > 0.001 ? Math.sign(moveZ) : 0;

      let blockedX = false;
      let blockedZ = false;

      if (Math.abs(moveX) > 0.001) {
        const wallX = checkWallCollision(position.x, position.y, position.z, moveDirX, 0, PLAYER_RADIUS);
        blockedX = wallX.hit && wallX.distance < PLAYER_RADIUS + Math.abs(moveX) + 0.05;
      }

      if (Math.abs(moveZ) > 0.001) {
        const wallZ = checkWallCollision(position.x, position.y, position.z, 0, moveDirZ, PLAYER_RADIUS);
        blockedZ = wallZ.hit && wallZ.distance < PLAYER_RADIUS + Math.abs(moveZ) + 0.05;
      }

      if (blockedX) {
        velocity.x = 0;
      } else {
        position.x += moveX;
      }

      if (blockedZ) {
        velocity.z = 0;
      } else {
        position.z += moveZ;
      }
    }

    return { didStepUp, newSmoothedY };
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
    checkOutOfBounds,
    constrainToMapBoundary,
  };
}


