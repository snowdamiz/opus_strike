/**
 * Camera Control Hook
 * 
 * Handles mouse look, camera rotation, and FOV adjustments.
 */

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { MOUSE_SENSITIVITY, PITCH_LIMIT, PLAYER_EYE_HEIGHT } from '@voxel-strike/shared';
import type { CameraRefs } from './types';
import { consumeMobileLookDelta } from '../../store/mobileControlsStore';
import { useSettingsStore } from '../../store/settingsStore';

export interface UseCameraOptions {
  isPointerLocked: boolean;
}

export interface UseCameraReturn {
  refs: CameraRefs;
  updateCameraRotation: (camera: THREE.Camera, isSliding: boolean, isCrouching: boolean, dt: number) => void;
  getCameraPosition: (position: THREE.Vector3, crouchOffset: number) => THREE.Vector3;
}

// Camera effect constants
const SLIDE_CAMERA_PITCH_OFFSET = -0.08; // Slight look down during slide
const SLIDE_FOV_BOOST = 8; // Increased FOV during slide
const SLIDE_CAMERA_ROLL = 0.03; // Subtle roll during slide
const CROUCH_HEIGHT_OFFSET = -0.3;
const CROUCH_TRANSITION_SPEED = 12;
const EYE_HEIGHT = PLAYER_EYE_HEIGHT;

export function useCamera(options: UseCameraOptions): UseCameraReturn {
  const { isPointerLocked } = options;
  const fov = useSettingsStore(state => state.settings.fov);
  const sensitivity = useSettingsStore(state => state.settings.sensitivity);
  const invertY = useSettingsStore(state => state.settings.invertY);

  // Camera rotation state
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  // Slide/crouch camera effect state
  const crouchHeightRef = useRef(0);
  const slidePitchRef = useRef(0);
  const slideFovRef = useRef(0);
  const slideRollRef = useRef(0);

  // Handle mouse movement
  const applyLookDelta = useCallback((deltaX: number, deltaY: number) => {
    const sensitivityMultiplier = sensitivity / 50;
    yawRef.current -= deltaX * MOUSE_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current += (invertY ? 1 : -1) * deltaY * MOUSE_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchRef.current));
  }, [invertY, sensitivity]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked) return;

      applyLookDelta(e.movementX, e.movementY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [applyLookDelta, isPointerLocked]);

  // Update camera rotation with slide/crouch effects
  const updateCameraRotation = useCallback((
    camera: THREE.Camera,
    isSliding: boolean,
    isCrouching: boolean,
    dt: number
  ) => {
    const touchLookDelta = consumeMobileLookDelta();
    if (touchLookDelta.x !== 0 || touchLookDelta.y !== 0) {
      applyLookDelta(touchLookDelta.x, touchLookDelta.y);
    }

    // Interpolate crouch camera height
    const targetCrouchOffset = (isCrouching || isSliding) ? CROUCH_HEIGHT_OFFSET : 0;
    crouchHeightRef.current += (targetCrouchOffset - crouchHeightRef.current) * Math.min(CROUCH_TRANSITION_SPEED * dt, 1);

    // Interpolate slide camera effects
    const targetSlidePitch = isSliding ? SLIDE_CAMERA_PITCH_OFFSET : 0;
    const targetSlideFov = isSliding ? SLIDE_FOV_BOOST : 0;
    const targetSlideRoll = isSliding ? SLIDE_CAMERA_ROLL : 0;

    const slideTransitionSpeed = CROUCH_TRANSITION_SPEED * dt;
    slidePitchRef.current += (targetSlidePitch - slidePitchRef.current) * Math.min(slideTransitionSpeed, 1);
    slideFovRef.current += (targetSlideFov - slideFovRef.current) * Math.min(slideTransitionSpeed, 1);
    slideRollRef.current += (targetSlideRoll - slideRollRef.current) * Math.min(slideTransitionSpeed, 1);

    // Apply FOV change (only for perspective camera)
    if ('fov' in camera) {
      const baseFov = fov;
      (camera as THREE.PerspectiveCamera).fov = baseFov + slideFovRef.current;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    // Apply rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current + slidePitchRef.current;
    camera.rotation.z = slideRollRef.current;
  }, [applyLookDelta, fov]);

  // Get camera position with eye height and crouch offset
  const getCameraPosition = useCallback((position: THREE.Vector3, _crouchOffset?: number): THREE.Vector3 => {
    const eyeHeight = EYE_HEIGHT + crouchHeightRef.current;
    return new THREE.Vector3(position.x, position.y + eyeHeight, position.z);
  }, []);

  return {
    refs: {
      yaw: yawRef,
      pitch: pitchRef,
      crouchHeight: crouchHeightRef,
      slidePitch: slidePitchRef,
      slideFov: slideFovRef,
      slideRoll: slideRollRef,
    },
    updateCameraRotation,
    getCameraPosition,
  };
}
