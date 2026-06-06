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
  PLAYER_CROUCH_HEIGHT,
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
    _wasGrounded: boolean,
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
    dt: number,
    playerHeight?: number,
    isJumpingFromGround?: boolean
  ) => {
    didStepUp: boolean;
    didFollowTerrain: boolean;
    newSmoothedY: number | null;
    hitTerrain: boolean;
  };
  
  applyGravity: (velocity: THREE.Vector3, isGrounded: boolean, isGrappling: boolean, isSwinging: boolean, dt: number) => void;

  applyVerticalMovement: (
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    dt: number,
    playerHeight?: number
  ) => { hitCeiling: boolean };

  canStandAtPosition: (position: THREE.Vector3) => boolean;
  
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
const GROUND_PROBE_RADIUS = PLAYER_RADIUS * 0.45;
const STEP_UP_MIN_HEIGHT = 0.08;
const STEP_UP_PROBE_SIDE_OFFSETS = [0, -PLAYER_RADIUS * 0.72, PLAYER_RADIUS * 0.72];
const MAX_STEP_DOWN_HEIGHT = STEP_HEIGHT + 0.1;
const JUMP_EDGE_ASSIST_HEIGHT = 0.62;
const GROUND_PROBE_OFFSETS = [
  { x: 0, z: 0 },
  { x: GROUND_PROBE_RADIUS, z: 0 },
  { x: -GROUND_PROBE_RADIUS, z: 0 },
  { x: 0, z: GROUND_PROBE_RADIUS },
  { x: 0, z: -GROUND_PROBE_RADIUS },
];
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

function getBodyCenterY(positionY: number, playerHeight: number): number {
  return positionY - PLAYER_HEIGHT / 2 + playerHeight / 2;
}

function getBodyTopY(positionY: number, playerHeight: number): number {
  return positionY - PLAYER_HEIGHT / 2 + playerHeight;
}

function getAllowedUpwardMoveBeforeCeiling(
  position: THREE.Vector3,
  upwardMove: number,
  playerHeight: number = PLAYER_HEIGHT
): number | null {
  if (upwardMove <= 0 || !isPhysicsReady()) return null;

  const headY = getBodyTopY(position.y, playerHeight);
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

function canMovePlayerBody(
  position: THREE.Vector3,
  moveX: number,
  moveZ: number,
  playerHeight: number = PLAYER_HEIGHT
): boolean {
  return canMovePlayerBodyAt(position.x, position.y, position.z, moveX, moveZ, playerHeight);
}

function canMovePlayerBodyAt(
  x: number,
  y: number,
  z: number,
  moveX: number,
  moveZ: number,
  playerHeight: number = PLAYER_HEIGHT
): boolean {
  return !checkPlayerBodyMovement(
    x,
    getBodyCenterY(y, playerHeight),
    z,
    moveX,
    moveZ,
    PLAYER_RADIUS,
    playerHeight
  ).blocked;
}

function canOccupyPlayerBody(
  x: number,
  y: number,
  z: number,
  playerHeight: number = PLAYER_HEIGHT
): boolean {
  return hasPlayerBodyClearance(x, getBodyCenterY(y, playerHeight), z, PLAYER_RADIUS, playerHeight);
}

function canJumpClearLowTerrainEdge(
  position: THREE.Vector3,
  moveX: number,
  moveZ: number,
  playerHeight: number = PLAYER_HEIGHT
): boolean {
  const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveDist <= 0.0001) return false;

  const assistedY = position.y + JUMP_EDGE_ASSIST_HEIGHT;
  const hasClearStart = canOccupyPlayerBody(position.x, assistedY, position.z, playerHeight);
  if (!hasClearStart) return false;

  const hasClearRaisedMove = canMovePlayerBodyAt(
    position.x,
    assistedY,
    position.z,
    moveX,
    moveZ,
    playerHeight
  );
  if (!hasClearRaisedMove) return false;

  const currentFeetY = position.y - PLAYER_HEIGHT / 2;
  const targetGround = getWalkableGroundAt(
    position.x + moveX,
    position.y + STEP_HEIGHT + 1,
    position.z + moveZ,
    STEP_HEIGHT + MAX_STEP_DOWN_HEIGHT + 2
  );

  if (!targetGround) return true;

  const heightDiff = targetGround.groundY - currentFeetY;
  return heightDiff <= STEP_HEIGHT && heightDiff >= -MAX_STEP_DOWN_HEIGHT;
}

function hasStandingHeadroom(position: THREE.Vector3): boolean {
  if (!isPhysicsReady()) return true;

  const crouchedHeadY = getBodyTopY(position.y, PLAYER_CROUCH_HEIGHT);
  const castDistance = PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT + CEILING_CLEARANCE * 2;

  for (const offset of CEILING_PROBE_OFFSETS) {
    const hit = raycastDirection(
      position.x + offset.x,
      crouchedHeadY - CEILING_CLEARANCE,
      position.z + offset.z,
      0,
      1,
      0,
      castDistance
    );

    if (hit?.hit) {
      return false;
    }
  }

  return true;
}

function getWalkableGroundAt(x: number, y: number, z: number, maxDist: number): GroundInfo | null {
  const ground = checkGroundWithNormal(x, y, z, maxDist);
  return ground?.isWalkable ? ground : null;
}

function getCurrentPlayerGround(position: THREE.Vector3, maxDist: number): GroundInfo | null {
  const originY = position.y + 0.5;
  const centerGround = getWalkableGroundAt(position.x, originY, position.z, maxDist);
  if (centerGround) return centerGround;

  let fallbackGround: GroundInfo | null = null;

  for (let i = 1; i < GROUND_PROBE_OFFSETS.length; i++) {
    const offset = GROUND_PROBE_OFFSETS[i];
    const ground = getWalkableGroundAt(position.x + offset.x, originY, position.z + offset.z, maxDist);
    if (!ground) continue;

    if (!fallbackGround || ground.groundY > fallbackGround.groundY) {
      fallbackGround = ground;
    }
  }

  return fallbackGround;
}

function findGroundedTerrainMove(
  position: THREE.Vector3,
  moveX: number,
  moveZ: number,
  effectiveStepHeight: number
): { ground: GroundInfo; heightDiff: number } | null {
  const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveDist <= 0.0001) return null;

  const dirX = moveX / moveDist;
  const dirZ = moveZ / moveDist;
  const sideX = -dirZ;
  const sideZ = dirX;
  const currentFeetY = position.y - PLAYER_HEIGHT / 2;
  const probeOriginY = position.y + effectiveStepHeight + 1;
  const probeMaxDistance = effectiveStepHeight + MAX_STEP_DOWN_HEIGHT + 2;
  let best: { ground: GroundInfo; heightDiff: number } | null = null;

  const targetSample = { x: position.x + moveX, z: position.z + moveZ };
  const samples = [
    targetSample,
    ...STEP_UP_PROBE_SIDE_OFFSETS.map((sideOffset) => ({
      x: position.x + dirX * (PLAYER_RADIUS + Math.max(moveDist, 0.04)) + sideX * sideOffset,
      z: position.z + dirZ * (PLAYER_RADIUS + Math.max(moveDist, 0.04)) + sideZ * sideOffset,
    })),
  ];

  const targetGround = getWalkableGroundAt(targetSample.x, probeOriginY, targetSample.z, probeMaxDistance);
  if (targetGround) {
    const heightDiff = targetGround.groundY - currentFeetY;
    if (heightDiff <= STEP_UP_MIN_HEIGHT && heightDiff >= -MAX_STEP_DOWN_HEIGHT) {
      return { ground: targetGround, heightDiff };
    }
  }

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    const ground = getWalkableGroundAt(sample.x, probeOriginY, sample.z, probeMaxDistance);
    if (!ground) continue;

    const heightDiff = ground.groundY - currentFeetY;
    if (heightDiff > effectiveStepHeight || heightDiff < -MAX_STEP_DOWN_HEIGHT) continue;

    if (!best || heightDiff > best.heightDiff) {
      best = { ground, heightDiff };
    }
  }

  return best;
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

    const groundInfo = getCurrentPlayerGround(position, 50);

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

        position.y = targetY;
        velocity.y = 0;

        return {
          isGrounded: true,
          canJump: true,
          newSmoothedY: newY,
          groundInfo
        };
      } else {
        return {
          isGrounded: false,
          canJump: false,
          newSmoothedY: null,
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
    dt: number,
    playerHeight: number = PLAYER_HEIGHT,
    isJumpingFromGround: boolean = false
  ): {
    didStepUp: boolean;
    didFollowTerrain: boolean;
    newSmoothedY: number | null;
    hitTerrain: boolean;
  } => {
    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    const targetX = position.x + moveX;
    const targetZ = position.z + moveZ;
    let didStepUp = false;
    let didFollowTerrain = false;
    let hitTerrain = false;
    let newSmoothedY = smoothedY;

    if (!isPhysicsReady() || (Math.abs(moveX) <= 0.001 && Math.abs(moveZ) <= 0.001)) {
      position.x += moveX;
      position.z += moveZ;
      return { didStepUp: false, didFollowTerrain: false, newSmoothedY, hitTerrain: false };
    }

    // Step-up logic for stairs and low terrain ledges.
    const effectivelyGrounded = isGrounded || (isIceWallRushing && velocity.y < 2);
    const canUseAirborneStepAssist = isJumpingFromGround || (!isGrounded && velocity.y > 0);

    if (effectivelyGrounded || canUseAirborneStepAssist) {
      const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (moveDist > 0) {
        const effectiveStepHeight = isIceWallRushing ? STEP_HEIGHT * 1.25 : STEP_HEIGHT;
        const terrainMove = findGroundedTerrainMove(position, moveX, moveZ, effectiveStepHeight);

        if (terrainMove) {
          const currentFeetY = position.y - PLAYER_HEIGHT / 2;
          const targetGroundY = terrainMove.ground.groundY;
          const heightDiff = targetGroundY - currentFeetY;
          const isStepUp = heightDiff > STEP_UP_MIN_HEIGHT;
          const isStepDown = heightDiff < -0.02;
          const canTraverseWithoutSweep = isStepDown || Math.abs(heightDiff) <= STEP_UP_MIN_HEIGHT;
          let canTraverse = canTraverseWithoutSweep;
          
          if (isStepUp) {
            const targetY = targetGroundY + PLAYER_HEIGHT / 2;
            const upwardMove = targetY - position.y;
            const ceilingAllowance = getAllowedUpwardMoveBeforeCeiling(position, upwardMove, playerHeight);
            const hasCeilingClearance = ceilingAllowance === null || ceilingAllowance >= upwardMove - CEILING_CLEARANCE;

            canTraverse = hasCeilingClearance;
          }

          if (canTraverse && (!canUseAirborneStepAssist || isStepUp)) {
            const targetY = targetGroundY + PLAYER_HEIGHT / 2;
            const shouldPreserveJumpAscent = canUseAirborneStepAssist && isStepUp;

            if (shouldPreserveJumpAscent) {
              position.x += moveX;
              position.z += moveZ;
              position.y = Math.max(position.y, targetY);
              didStepUp = true;

              return {
                didStepUp,
                didFollowTerrain: false,
                newSmoothedY: null,
                hitTerrain: false,
              };
            }

            const currentY = smoothedY ?? position.y;
            const smoothSpeed = isStepUp
              ? isIceWallRushing
                ? TERRAIN_RAMP_UP_SMOOTH_SPEED * 1.35
                : TERRAIN_RAMP_UP_SMOOTH_SPEED
              : TERRAIN_RAMP_DOWN_SMOOTH_SPEED;

            const newY = smoothY(currentY, targetY, smoothSpeed, dt);

            position.x += moveX;
            position.z += moveZ;
            position.y = targetY;
            newSmoothedY = newY;
            velocity.y = 0;
            didStepUp = isStepUp;
            didFollowTerrain = true;
            hitTerrain = isStepUp;

            return { didStepUp, didFollowTerrain, newSmoothedY, hitTerrain };
          }
        }
      }
    }

    // Normal movement if didn't step up
    if (!didStepUp) {
      if (canMovePlayerBody(position, moveX, moveZ, playerHeight)) {
        position.x += moveX;
        position.z += moveZ;
      } else {
        if (canUseAirborneStepAssist && canJumpClearLowTerrainEdge(position, moveX, moveZ, playerHeight)) {
          position.x += moveX;
          position.z += moveZ;
          return { didStepUp, didFollowTerrain, newSmoothedY, hitTerrain: false };
        }

        hitTerrain = true;

        if (Math.abs(moveX) > 0.001 && canMovePlayerBody(position, moveX, 0, playerHeight)) {
          position.x += moveX;
        } else {
          velocity.x = 0;
        }

        if (Math.abs(moveZ) > 0.001 && canMovePlayerBody(position, 0, moveZ, playerHeight)) {
          position.z += moveZ;
        } else {
          velocity.z = 0;
        }
      }
    }

    return { didStepUp, didFollowTerrain, newSmoothedY, hitTerrain };
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
    dt: number,
    playerHeight: number = PLAYER_HEIGHT
  ): { hitCeiling: boolean } => {
    const verticalMove = velocity.y * dt;

    if (verticalMove <= 0) {
      position.y += verticalMove;
      return { hitCeiling: false };
    }

    const allowedMove = getAllowedUpwardMoveBeforeCeiling(position, verticalMove, playerHeight);
    if (allowedMove !== null && allowedMove <= verticalMove) {
      position.y += allowedMove;
      velocity.y = 0;
      return { hitCeiling: true };
    }

    position.y += verticalMove;
    return { hitCeiling: false };
  }, []);

  const canStandAtPosition = useCallback((position: THREE.Vector3): boolean => {
    return hasStandingHeadroom(position);
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
    canStandAtPosition,
    checkOutOfBounds,
    constrainToMapBoundary,
  };
}
