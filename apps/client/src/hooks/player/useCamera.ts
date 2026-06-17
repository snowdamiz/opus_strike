/**
 * Camera Control Hook
 * 
 * Handles mouse look, camera rotation, and FOV adjustments.
 */

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
  MOUSE_SENSITIVITY,
  PITCH_LIMIT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  SLIDE_CAMERA_HEIGHT_OFFSET,
  SLIDE_CAMERA_PITCH_OFFSET,
} from '@voxel-strike/shared';
import type { CameraRefs } from './types';
import { consumeMobileLookDelta } from '../../store/mobileControlsStore';
import { useSettingsStore } from '../../store/settingsStore';

export interface UseCameraOptions {
  isPointerLocked: boolean;
}

export interface UseCameraReturn {
  refs: CameraRefs;
  updateCameraRotation: (camera: THREE.Camera, isSliding: boolean, isCrouching: boolean, dt: number) => void;
  startDeathCamera: (
    camera: THREE.Camera,
    bodyPosition: { x: number; y: number; z: number },
    options?: DeathCameraStartOptions
  ) => void;
  updateDeathCamera: (
    camera: THREE.Camera,
    bodyPosition: { x: number; y: number; z: number },
    dt: number,
    nowMs?: number
  ) => void;
  resetDeathCamera: (camera?: THREE.Camera) => void;
  isDeathCameraActive: () => boolean;
  getCameraPosition: (position: THREE.Vector3, crouchOffset: number) => THREE.Vector3;
}

interface DeathCameraStartOptions {
  nowMs?: number;
  sourceDirection?: { x: number; y: number; z: number } | null;
}

interface DeathCameraRuntime {
  startedAtMs: number;
  startCameraPosition: THREE.Vector3;
  startBodyPosition: THREE.Vector3;
  startYaw: number;
  startPitch: number;
  yawOffset: number;
  targetRoll: number;
  targetEyeHeight: number;
  floorY: number;
  fallNudge: THREE.Vector3;
  shakeSeed: number;
}

// Camera effect constants
const SLIDE_FOV_BOOST = 8; // Increased FOV during slide
const SLIDE_CAMERA_ROLL = 0.03; // Subtle roll during slide
const CROUCH_HEIGHT_OFFSET = -0.3;
const CROUCH_TRANSITION_SPEED = 12;
const EYE_HEIGHT = PLAYER_EYE_HEIGHT;
const DEATH_PRESERVE_MS = 150;
const DEATH_FALL_MS = 780;
const DEATH_LOOK_UNLOCK_MS = 620;
const DEATH_MAX_YAW_OFFSET = 0.52;
const DEATH_YAW_SENSITIVITY_SCALE = 0.28;
const DEATH_FOV_PULSE = 7;
const DEATH_TARGET_EYE_HEIGHT = 0.36;
const DEATH_ROLL_RADIANS = THREE.MathUtils.degToRad(86);
const DEATH_PITCH_DOWN = 0.24;

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
  const deathCameraRef = useRef<DeathCameraRuntime | null>(null);

  // Handle mouse movement
  const applyLookDelta = useCallback((deltaX: number, deltaY: number) => {
    const sensitivityMultiplier = sensitivity / 50;
    yawRef.current -= deltaX * MOUSE_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current += (invertY ? 1 : -1) * deltaY * MOUSE_SENSITIVITY * sensitivityMultiplier;
    pitchRef.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchRef.current));
  }, [invertY, sensitivity]);

  const applyDeathLookDelta = useCallback((deltaX: number) => {
    const deathCamera = deathCameraRef.current;
    if (!deathCamera) return;

    const elapsedMs = Date.now() - deathCamera.startedAtMs;
    if (elapsedMs < DEATH_LOOK_UNLOCK_MS) return;

    const sensitivityMultiplier = sensitivity / 50;
    deathCamera.yawOffset = THREE.MathUtils.clamp(
      deathCamera.yawOffset - deltaX * MOUSE_SENSITIVITY * sensitivityMultiplier * DEATH_YAW_SENSITIVITY_SCALE,
      -DEATH_MAX_YAW_OFFSET,
      DEATH_MAX_YAW_OFFSET
    );
  }, [sensitivity]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked) return;

      if (deathCameraRef.current) {
        applyDeathLookDelta(e.movementX);
        return;
      }

      applyLookDelta(e.movementX, e.movementY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [applyDeathLookDelta, applyLookDelta, isPointerLocked]);

  const isDeathCameraActive = useCallback(() => deathCameraRef.current !== null, []);

  const resetDeathCamera = useCallback((camera?: THREE.Camera) => {
    deathCameraRef.current = null;
    crouchHeightRef.current = 0;
    slidePitchRef.current = 0;
    slideFovRef.current = 0;
    slideRollRef.current = 0;

    if (camera && 'fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    if (camera) {
      camera.rotation.order = 'YXZ';
      camera.rotation.z = 0;
    }
  }, [fov]);

  const startDeathCamera = useCallback((
    camera: THREE.Camera,
    bodyPosition: { x: number; y: number; z: number },
    options: DeathCameraStartOptions = {}
  ) => {
    if (deathCameraRef.current) return;

    const startedAtMs = options.nowMs ?? Date.now();
    const sourceDirection = options.sourceDirection
      ? new THREE.Vector3(options.sourceDirection.x, options.sourceDirection.y, options.sourceDirection.z)
      : null;
    if (sourceDirection && sourceDirection.lengthSq() > 0.0001) {
      sourceDirection.normalize();
    }
    const right = new THREE.Vector3(Math.cos(yawRef.current), 0, -Math.sin(yawRef.current));
    const lateralHit = sourceDirection ? sourceDirection.dot(right) : 0;
    const deterministicSide = Math.sin(bodyPosition.x * 12.9898 + bodyPosition.z * 78.233 + startedAtMs * 0.001) >= 0 ? 1 : -1;
    const side = Math.abs(lateralHit) > 0.08 ? (lateralHit > 0 ? -1 : 1) : deterministicSide;
    const fallNudge = sourceDirection
      ? sourceDirection.clone().multiplyScalar(0.18)
      : right.multiplyScalar(side * 0.12);
    fallNudge.y = 0;

    deathCameraRef.current = {
      startedAtMs,
      startCameraPosition: camera.position.clone(),
      startBodyPosition: new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z),
      startYaw: yawRef.current,
      startPitch: pitchRef.current,
      yawOffset: 0,
      targetRoll: side * DEATH_ROLL_RADIANS,
      targetEyeHeight: DEATH_TARGET_EYE_HEIGHT,
      floorY: Math.max(0, bodyPosition.y - PLAYER_HEIGHT / 2),
      fallNudge,
      shakeSeed: Math.sin(startedAtMs * 0.017 + bodyPosition.x * 3.1 + bodyPosition.z * 5.7),
    };
    crouchHeightRef.current = 0;
    slidePitchRef.current = 0;
    slideFovRef.current = 0;
    slideRollRef.current = 0;
  }, []);

  const updateDeathCamera = useCallback((
    camera: THREE.Camera,
    bodyPosition: { x: number; y: number; z: number },
    _dt: number,
    nowMs = Date.now()
  ) => {
    const deathCamera = deathCameraRef.current;
    if (!deathCamera) {
      startDeathCamera(camera, bodyPosition, { nowMs });
      return;
    }

    const touchLookDelta = consumeMobileLookDelta();
    if (touchLookDelta.x !== 0) {
      applyDeathLookDelta(touchLookDelta.x);
    }

    const elapsedMs = Math.max(0, nowMs - deathCamera.startedAtMs);
    const fallProgress = THREE.MathUtils.clamp((elapsedMs - DEATH_PRESERVE_MS) / DEATH_FALL_MS, 0, 1);
    const easedFall = 1 - Math.pow(1 - fallProgress, 3);
    const settleBounce = Math.sin(fallProgress * Math.PI) * 0.055 * (1 - fallProgress);
    const targetX = deathCamera.startBodyPosition.x + deathCamera.fallNudge.x;
    const targetY = deathCamera.floorY + deathCamera.targetEyeHeight + settleBounce;
    const targetZ = deathCamera.startBodyPosition.z + deathCamera.fallNudge.z;

    camera.position.set(
      THREE.MathUtils.lerp(deathCamera.startCameraPosition.x, targetX, easedFall),
      THREE.MathUtils.lerp(deathCamera.startCameraPosition.y, targetY, easedFall),
      THREE.MathUtils.lerp(deathCamera.startCameraPosition.z, targetZ, easedFall)
    );

    const pitchTarget = THREE.MathUtils.clamp(
      deathCamera.startPitch - DEATH_PITCH_DOWN,
      -PITCH_LIMIT,
      PITCH_LIMIT
    );
    const rollOvershoot = Math.sin(fallProgress * Math.PI) * 0.08;
    const roll = deathCamera.targetRoll * THREE.MathUtils.clamp(easedFall + rollOvershoot, 0, 1.08);
    const shakeProgress = THREE.MathUtils.clamp(1 - elapsedMs / 260, 0, 1);
    const shake = shakeProgress * shakeProgress;
    const shakeYaw = Math.sin(elapsedMs * 0.061 + deathCamera.shakeSeed) * shake * 0.014;
    const shakePitch = Math.cos(elapsedMs * 0.053 + deathCamera.shakeSeed * 2) * shake * 0.012;

    yawRef.current = deathCamera.startYaw + deathCamera.yawOffset;
    pitchRef.current = THREE.MathUtils.lerp(deathCamera.startPitch, pitchTarget, easedFall);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current + shakeYaw;
    camera.rotation.x = pitchRef.current + shakePitch;
    camera.rotation.z = roll;

    if ('fov' in camera) {
      const pulse = DEATH_FOV_PULSE * Math.exp(-elapsedMs / 420);
      (camera as THREE.PerspectiveCamera).fov = fov + pulse;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }, [applyDeathLookDelta, fov, startDeathCamera]);

  // Update camera rotation with slide/crouch effects
  const updateCameraRotation = useCallback((
    camera: THREE.Camera,
    isSliding: boolean,
    isCrouching: boolean,
    dt: number
  ) => {
    if (deathCameraRef.current) return;

    const touchLookDelta = consumeMobileLookDelta();
    if (touchLookDelta.x !== 0 || touchLookDelta.y !== 0) {
      applyLookDelta(touchLookDelta.x, touchLookDelta.y);
    }

    // Interpolate crouch camera height
    const targetCrouchOffset = isSliding ? SLIDE_CAMERA_HEIGHT_OFFSET : isCrouching ? CROUCH_HEIGHT_OFFSET : 0;
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
    startDeathCamera,
    updateDeathCamera,
    resetDeathCamera,
    isDeathCameraActive,
    getCameraPosition,
  };
}
