import { useRef } from 'react';
import * as THREE from 'three';
import type { MovementRefs } from './types';

export interface UseMovementReturn {
  refs: MovementRefs;
}

export function useMovement(): UseMovementReturn {
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
  const wasSprintingBeforeSlide = useRef(false);
  const smoothedYRef = useRef<number | null>(null);

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
  };
}
