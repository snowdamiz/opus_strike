/**
 * Movement Hook
 * 
 * Handles player movement including WASD, sprinting, crouching, sliding,
 * and CS-style bunny hopping with Quake/Source engine acceleration.
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  SLIDE_DURATION,
  SLIDE_COOLDOWN,
  SLIDE_ENTRY_SPEED_CAP_MULTIPLIER,
  SLIDE_FRICTION,
  SLIDE_INITIAL_BOOST,
  SLIDE_JUMP_MAX_SPEED_MULTIPLIER,
  SLIDE_JUMP_SPEED_RETENTION,
  SLIDE_MAX_SPEED_MULTIPLIER,
  // CS-style bunny hop constants
  BHOP_GROUND_ACCEL,
  BHOP_AIR_ACCEL,
  BHOP_AIR_SPEED_CAP,
  BHOP_MAX_VELOCITY,
  BHOP_GROUND_FRICTION,
  BHOP_NO_INPUT_FRICTION_MULTIPLIER,
  BHOP_GROUND_STOP_THRESHOLD,
  BHOP_STOP_SPEED,
  BHOP_LANDING_SPEED_RETENTION,
} from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import type { MovementRefs, MovementSounds } from './types';

// ============================================================================
// QUAKE/SOURCE ENGINE ACCELERATION
// ============================================================================

/**
 * Quake/Source engine acceleration function
 * This is the magic that makes bunny hopping work!
 * 
 * The key insight: acceleration is based on the component of velocity
 * that's NOT in the wish direction. So if you're moving perpendicular
 * to your wish direction (strafing), you get full acceleration.
 */
function quakeAccelerate(
  velocity: THREE.Vector3,
  wishDir: { x: number; z: number },
  wishSpeed: number,
  accel: number,
  dt: number
): void {
  // No input = no acceleration
  if (wishDir.x === 0 && wishDir.z === 0) {
    return;
  }

  // Current speed in the wish direction (dot product)
  const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;

  // How much speed we want to add
  const addSpeed = wishSpeed - currentSpeed;

  // Can't accelerate if already going faster than wish speed in that direction
  if (addSpeed <= 0) {
    return;
  }

  // Calculate acceleration amount
  let accelSpeed = accel * dt * wishSpeed;

  // Cap acceleration to not overshoot
  if (accelSpeed > addSpeed) {
    accelSpeed = addSpeed;
  }

  // Apply acceleration in wish direction
  velocity.x += accelSpeed * wishDir.x;
  velocity.z += accelSpeed * wishDir.z;
}

function clampHorizontalSpeed(velocity: THREE.Vector3, maxSpeed: number): void {
  const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
  if (horizontalSpeed <= maxSpeed || horizontalSpeed <= 0.0001) {
    return;
  }

  const scale = maxSpeed / horizontalSpeed;
  velocity.x *= scale;
  velocity.z *= scale;
}

// ============================================================================
// MOVEMENT HOOK
// ============================================================================

export interface UseMovementReturn {
  refs: MovementRefs;
  calculateMoveDirection: (inputState: InputState, yaw: number) => THREE.Vector3;
  applyMovement: (
    velocity: THREE.Vector3,
    moveDirection: THREE.Vector3,
    speed: number,
    isGrounded: boolean,
    isSliding: boolean,
    dt: number
  ) => void;
  updateSlideState: (
    inputState: InputState,
    isGrounded: boolean,
    yaw: number,
    heroMoveSpeed: number,
    dt: number,
    sounds: MovementSounds
  ) => { isSliding: boolean; speed: number };
  handleLanding: (velocity: THREE.Vector3, wasGrounded: boolean, isGrounded: boolean) => void;
  getSlideIntensity: () => number;
}

export function useMovement(): UseMovementReturn {
  // Movement state refs
  const velocityRef = useRef(new THREE.Vector3());
  const isGroundedRef = useRef(true);
  const wasGroundedRef = useRef(true);
  const canJumpRef = useRef(true);
  const isSprintingRef = useRef(false);
  const isCrouchingRef = useRef(false);
  const isSliding = useRef(false);
  const slideTimeRef = useRef(0);
  const slideCooldownRef = useRef(0);
  const slideDirectionRef = useRef(new THREE.Vector3());
  const slideIntensityRef = useRef(0);
  const slideMaxSpeedRef = useRef(0);
  const slideJumpMaxSpeedRef = useRef(0);
  const wasSprintingBeforeSlide = useRef(false);
  const smoothedYRef = useRef<number | null>(null);

  // Pre-allocated objects for performance
  const moveDirectionRef = useRef(new THREE.Vector3());
  const eulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const slideEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));

  // Calculate movement direction from input
  const calculateMoveDirection = useCallback((inputState: InputState, yaw: number): THREE.Vector3 => {
    const moveDirection = moveDirectionRef.current;
    moveDirection.set(0, 0, 0);

    if (inputState.moveForward) moveDirection.z -= 1;
    if (inputState.moveBackward) moveDirection.z += 1;
    if (inputState.moveLeft) moveDirection.x -= 1;
    if (inputState.moveRight) moveDirection.x += 1;

    moveDirection.normalize();

    // Apply yaw rotation
    const euler = eulerRef.current;
    euler.set(0, yaw, 0);
    moveDirection.applyEuler(euler);

    return moveDirection;
  }, []);

  // Apply movement with Quake-style physics
  const applyMovement = useCallback((
    velocity: THREE.Vector3,
    moveDirection: THREE.Vector3,
    speed: number,
    isGrounded: boolean,
    currentlySliding: boolean,
    dt: number
  ) => {
    // When sliding, only apply slight steering
    if (currentlySliding) {
      const steerForce = 3 * dt;
      velocity.x += moveDirection.x * speed * steerForce;
      velocity.z += moveDirection.z * speed * steerForce;
      if (slideMaxSpeedRef.current > 0) {
        clampHorizontalSpeed(velocity, slideMaxSpeedRef.current);
      }
      return;
    }

    // Calculate wish direction
    const wishDirLen = Math.sqrt(moveDirection.x * moveDirection.x + moveDirection.z * moveDirection.z);
    const wishDir = wishDirLen > 0 ? {
      x: moveDirection.x / wishDirLen,
      z: moveDirection.z / wishDirLen,
    } : { x: 0, z: 0 };

    const wishSpeed = speed;
    const hasMovementInput = wishDir.x !== 0 || wishDir.z !== 0;

    if (isGrounded) {
      // === GROUND MOVEMENT WITH FRICTION ===
      const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

      if (currentSpeed > 0) {
        const friction = hasMovementInput
          ? BHOP_GROUND_FRICTION
          : BHOP_GROUND_FRICTION * BHOP_NO_INPUT_FRICTION_MULTIPLIER;
        const control = currentSpeed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : currentSpeed;
        const drop = control * friction * dt;

        let newSpeed = currentSpeed - drop;
        if (newSpeed < 0) newSpeed = 0;

        if (!hasMovementInput && newSpeed < BHOP_GROUND_STOP_THRESHOLD) {
          newSpeed = 0;
        }

        if (newSpeed !== currentSpeed) {
          const ratio = newSpeed / currentSpeed;
          velocity.x *= ratio;
          velocity.z *= ratio;
        }
      }

      // Accelerate if there's input
      if (hasMovementInput) {
        quakeAccelerate(velocity, wishDir, wishSpeed, BHOP_GROUND_ACCEL, dt);
      }
    } else {
      // === AIR MOVEMENT WITH STRAFE ACCELERATION ===
      const airWishSpeed = Math.min(wishSpeed, BHOP_AIR_SPEED_CAP);

      if (wishDir.x !== 0 || wishDir.z !== 0) {
        quakeAccelerate(velocity, wishDir, airWishSpeed, BHOP_AIR_ACCEL, dt);
      }
    }

    // Clamp maximum horizontal velocity
    const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (horizontalSpeed > BHOP_MAX_VELOCITY) {
      const scale = BHOP_MAX_VELOCITY / horizontalSpeed;
      velocity.x *= scale;
      velocity.z *= scale;
    }
  }, []);

  // Update slide state
  const updateSlideState = useCallback((
    inputState: InputState,
    isGrounded: boolean,
    yaw: number,
    heroMoveSpeed: number,
    dt: number,
    sounds: MovementSounds
  ): { isSliding: boolean; speed: number } => {
    // Update slide cooldown
    slideCooldownRef.current = Math.max(0, slideCooldownRef.current - dt);

    // Check if has movement input
    const hasMovementInput = inputState.moveForward || inputState.moveBackward || 
                             inputState.moveLeft || inputState.moveRight;

    // Sprint state
    const canSprint = inputState.sprint && isGrounded && !isSliding.current && 
                      !isCrouchingRef.current && hasMovementInput;
    isSprintingRef.current = canSprint;

    // Check for slide initiation
    const shouldStartSlide = inputState.crouch && inputState.sprint && hasMovementInput &&
                             isGrounded && !isSliding.current && slideCooldownRef.current <= 0;

    if (shouldStartSlide) {
      isSliding.current = true;
      slideTimeRef.current = SLIDE_DURATION;

      wasSprintingBeforeSlide.current = true;
      isSprintingRef.current = false;

      // Play slide sound
      sounds.startSlide();

      // Calculate slide direction
      const slideDir = moveDirectionRef.current;
      slideDir.set(0, 0, 0);
      if (inputState.moveForward) slideDir.z -= 1;
      if (inputState.moveBackward) slideDir.z += 1;
      if (inputState.moveLeft) slideDir.x -= 1;
      if (inputState.moveRight) slideDir.x += 1;
      slideDir.normalize();

      const slideEuler = slideEulerRef.current;
      slideEuler.set(0, yaw, 0);
      slideDir.applyEuler(slideEuler);
      slideDirectionRef.current.copy(slideDir);

      // Set initial slide velocity
      const sprintSpeed = heroMoveSpeed * SPRINT_MULTIPLIER;
      slideMaxSpeedRef.current = sprintSpeed * SLIDE_MAX_SPEED_MULTIPLIER;
      slideJumpMaxSpeedRef.current = sprintSpeed * SLIDE_JUMP_MAX_SPEED_MULTIPLIER;
      const currentHorizontalSpeed = Math.sqrt(
        velocityRef.current.x * velocityRef.current.x +
        velocityRef.current.z * velocityRef.current.z
      );
      const slideEntrySpeed = Math.min(
        Math.max(currentHorizontalSpeed, sprintSpeed),
        sprintSpeed * SLIDE_ENTRY_SPEED_CAP_MULTIPLIER
      );
      const slideSpeed = Math.min(slideEntrySpeed * SLIDE_INITIAL_BOOST, slideMaxSpeedRef.current);
      velocityRef.current.x = slideDir.x * slideSpeed;
      velocityRef.current.z = slideDir.z * slideSpeed;
    }

    // Update active slide
    if (isSliding.current) {
      slideTimeRef.current -= dt;

      // Apply slide friction
      const friction = Math.pow(SLIDE_FRICTION, dt * 60);
      velocityRef.current.x *= friction;
      velocityRef.current.z *= friction;
      if (slideMaxSpeedRef.current > 0) {
        clampHorizontalSpeed(velocityRef.current, slideMaxSpeedRef.current);
      }

      // Check for slide end
      const slideSpeed = Math.sqrt(
        velocityRef.current.x * velocityRef.current.x +
        velocityRef.current.z * velocityRef.current.z
      );

      const slideJumpRequested = inputState.jump;
      if (slideTimeRef.current <= 0 || slideSpeed < 2 || slideJumpRequested) {
        if (slideJumpRequested) {
          velocityRef.current.x *= SLIDE_JUMP_SPEED_RETENTION;
          velocityRef.current.z *= SLIDE_JUMP_SPEED_RETENTION;
          if (slideJumpMaxSpeedRef.current > 0) {
            clampHorizontalSpeed(velocityRef.current, slideJumpMaxSpeedRef.current);
          }
        }
        isSliding.current = false;
        slideCooldownRef.current = SLIDE_COOLDOWN;
        slideMaxSpeedRef.current = 0;
        slideJumpMaxSpeedRef.current = 0;
        wasSprintingBeforeSlide.current = false;
        isCrouchingRef.current = false;
        sounds.stopSlide();
      }
    }

    // Update crouch state (not while sliding, not while sprinting)
    if (!isSliding.current) {
      if (inputState.crouch && !inputState.sprint) {
        isCrouchingRef.current = true;
      } else {
        isCrouchingRef.current = false;
      }
    }

    // Calculate speed modifier
    let speed = heroMoveSpeed;
    if (isSliding.current) {
      speed = heroMoveSpeed * 0.15; // Steering only during slide
    } else if (isSprintingRef.current) {
      speed *= SPRINT_MULTIPLIER;
    } else if (isCrouchingRef.current) {
      speed *= CROUCH_MULTIPLIER;
    }

    // Update slide intensity for visual effects
    const targetSlideIntensity = isSliding.current ? 1 : 0;
    const transitionSpeed = 12 * dt;
    slideIntensityRef.current += (targetSlideIntensity - slideIntensityRef.current) * 
                                  Math.min(transitionSpeed * 1.5, 1);

    return { isSliding: isSliding.current, speed };
  }, []);

  // Handle landing (for bunny hop speed retention)
  const handleLanding = useCallback((
    velocity: THREE.Vector3,
    wasGrounded: boolean,
    isGrounded: boolean
  ) => {
    if (isGrounded && !wasGrounded) {
      // Just landed! Apply speed retention for bunny hop chaining
      const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      if (horizontalSpeed > 0) {
        const retainedSpeed = horizontalSpeed * BHOP_LANDING_SPEED_RETENTION;
        const ratio = retainedSpeed / horizontalSpeed;
        velocity.x *= ratio;
        velocity.z *= ratio;
      }
    }
  }, []);

  const getSlideIntensity = useCallback(() => slideIntensityRef.current, []);

  return {
    refs: {
      velocity: velocityRef,
      isGrounded: isGroundedRef,
      wasGrounded: wasGroundedRef,
      canJump: canJumpRef,
      isSprinting: isSprintingRef,
      isCrouching: isCrouchingRef,
      isSliding,
      slideTime: slideTimeRef,
      slideCooldown: slideCooldownRef,
      slideDirection: slideDirectionRef,
      slideIntensity: slideIntensityRef,
      wasSprintingBeforeSlide,
      smoothedY: smoothedYRef,
    },
    calculateMoveDirection,
    applyMovement,
    updateSlideState,
    handleLanding,
    getSlideIntensity,
  };
}
