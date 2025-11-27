import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { useInput } from '../../hooks/useInput';
import { 
  usePhysics, 
  checkGroundWithNormal,
  checkWallCollision,
  isPhysicsReady, 
  getColliderCount,
  validateTeleportDestination,
  type GroundInfo 
} from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { 
  MOUSE_SENSITIVITY, 
  PITCH_LIMIT,
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  GRAVITY,
  TICK_RATE,
  SLIDE_DURATION,
  SLIDE_COOLDOWN,
  SLIDE_FRICTION,
  SLIDE_INITIAL_BOOST,
  CROUCH_TRANSITION_SPEED,
  CROUCH_HEIGHT_OFFSET,
  SLIDE_CAMERA_PITCH_OFFSET,
  SLIDE_FOV_BOOST,
  SLIDE_CAMERA_ROLL,
  // CS-style bunny hop constants
  BHOP_GROUND_ACCEL,
  BHOP_AIR_ACCEL,
  BHOP_AIR_SPEED_CAP,
  BHOP_MAX_VELOCITY,
  BHOP_GROUND_FRICTION,
  BHOP_STOP_SPEED,
  BHOP_LANDING_SPEED_RETENTION,
  getHeroStats,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  type HeroId,
} from '@voxel-strike/shared';
import { isInsideBoundary, constrainToBoundary } from '../../config/mapBoundaries';
import { ShadowStepIndicator } from './ShadowStepIndicator';
import { triggerTeleportEffect } from '../ui/TeleportEffects';

// Player collision constants
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;
const GROUND_SNAP_DISTANCE = 0.3; // How close to ground to snap
const STEP_HEIGHT = 0.8; // Max height to auto-step up (handles most stair steps)

// Smoothing constants
const SMALL_BUMP_THRESHOLD = 0.15; // Height changes below this are "small bumps"
const SMOOTH_SPEED_SMALL = 8; // Smoothing speed for small bumps (lower = smoother)
const SMOOTH_SPEED_LARGE = 20; // Smoothing speed for larger steps (higher = snappier)

// Debug flag
let lastDebugTime = 0;

/**
 * Quake/Source engine acceleration function
 * This is the magic that makes bunny hopping work!
 * 
 * The key insight: acceleration is based on the component of velocity
 * that's NOT in the wish direction. So if you're moving perpendicular
 * to your wish direction (strafing), you get full acceleration.
 * 
 * @param velocity Current velocity (mutated in place)
 * @param wishDir Normalized direction player wants to move { x, z }
 * @param wishSpeed Speed player wants to reach
 * @param accel Acceleration rate
 * @param dt Delta time
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

export function PlayerController() {
  const { camera } = useThree();
  // Get functions from store (these don't change)
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const setShadowStepTargeting = useGameStore(state => state.setShadowStepTargeting);
  const setClientCooldown = useGameStore(state => state.setClientCooldown);
  const setClientCharges = useGameStore(state => state.setClientCharges);
  // Get reactive state for React rendering
  const gamePhase = useGameStore(state => state.gamePhase);
  const shadowStepTargeting = useGameStore(state => state.shadowStepTargeting);
  // Note: localPlayer is read directly from store in useFrame to avoid stale closures
  const localPlayerForInit = useGameStore(state => state.localPlayer);
  
  const { inputState, isPointerLocked, requestPointerLock } = useInput();
  const { world, playerBody } = usePhysics();
  const { sendInput } = useNetwork();

  const velocityRef = useRef(new THREE.Vector3());
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const isGroundedRef = useRef(true);
  const wasGroundedRef = useRef(true); // For landing detection (bhop)
  const canJumpRef = useRef(true);
  const initializedRef = useRef(false);
  const tickRef = useRef(0);
  const lastSendRef = useRef(0);
  const smoothedYRef = useRef<number | null>(null); // For smooth camera over bumps

  // Sprint, crouch, and slide state
  const isSprintingRef = useRef(false);
  const isCrouchingRef = useRef(false);
  const isSliding = useRef(false);
  const slideTimeRef = useRef(0);
  const slideCooldownRef = useRef(0);
  const slideDirectionRef = useRef(new THREE.Vector3());
  const crouchHeightRef = useRef(0); // Current crouch camera offset (interpolated)
  const slidePitchRef = useRef(0); // Current slide camera pitch offset (interpolated)
  const slideFovRef = useRef(0); // Current slide FOV boost (interpolated)
  const slideRollRef = useRef(0); // Current slide camera roll (interpolated)
  const slideIntensityRef = useRef(0); // 0-1 intensity for visual effects
  const wasSprintingBeforeSlide = useRef(false); // Track if player was sprinting before slide

  // Ability state tracking
  const abilityPressedRef = useRef({ ability1: false, ability2: false, ultimate: false });
  const clientCooldownsRef = useRef<Record<string, number>>({}); // Client-side cooldown end times
  const clientChargesRef = useRef<Record<string, number>>({}); // Client-side charge tracking
  const abilityActiveRef = useRef<Record<string, { active: boolean; startTime: number }>>({});
  const teleportInProgressRef = useRef(false); // Prevent multiple teleports

  // Shadow Step targeting state
  const shadowStepTargetRef = useRef<THREE.Vector3 | null>(null);
  const shadowStepValidRef = useRef(false);

  // Initialize camera position - also check if we need to spawn higher
  useEffect(() => {
    if (localPlayerForInit && !initializedRef.current) {
      // If spawning too low (under terrain), start high and fall down
      const startY = localPlayerForInit.position.y < 20 ? 60 : localPlayerForInit.position.y;
      camera.position.set(localPlayerForInit.position.x, startY + 0.6, localPlayerForInit.position.z);
      
      // Also update the player position in store
      if (localPlayerForInit.position.y < 20) {
        updateLocalPlayer({
          position: { x: localPlayerForInit.position.x, y: startY, z: localPlayerForInit.position.z }
        });
        console.log('[Player] Spawning high at y=60 to fall onto terrain');
      }
      
      initializedRef.current = true;
    }
  }, [localPlayerForInit, camera, updateLocalPlayer]);

  // Get current charges for an ability (initializes to max if not set)
  const getClientCharges = useCallback((abilityId: string): number => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) return 1;
    
    const maxCharges = abilityDef.charges || 1;
    
    // Initialize charges if not set
    if (clientChargesRef.current[abilityId] === undefined) {
      clientChargesRef.current[abilityId] = maxCharges;
      setClientCharges(abilityId, maxCharges);
    }
    
    return clientChargesRef.current[abilityId];
  }, [setClientCharges]);

  // Use a charge of an ability (returns true if successful)
  const useAbilityCharge = useCallback((abilityId: string): boolean => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) return false;
    
    const maxCharges = abilityDef.charges || 1;
    // Force 10s cooldown for blink (shared package might have old cached value)
    const cooldownSeconds = abilityId === 'phantom_blink' ? 10 : (abilityDef.cooldown || 10);
    
    // Check if on cooldown (charges depleted)
    const cooldownEnd = clientCooldownsRef.current[abilityId];
    if (cooldownEnd && Date.now() < cooldownEnd) {
      console.log(`[Ability] ${abilityDef.name}: Still on cooldown`);
      return false;
    }
    
    // Get current charges (if cooldown just ended, charges might need reset)
    let currentCharges = clientChargesRef.current[abilityId];
    
    // If charges undefined or cooldown just ended, reset to max
    if (currentCharges === undefined || (cooldownEnd && Date.now() >= cooldownEnd && currentCharges === 0)) {
      currentCharges = maxCharges;
      clientChargesRef.current[abilityId] = maxCharges;
      setClientCharges(abilityId, maxCharges);
      // Clear the cooldown
      clientCooldownsRef.current[abilityId] = 0;
      setClientCooldown(abilityId, 0);
      console.log(`[Ability] ${abilityDef.name}: Charges reset to ${maxCharges}`);
    }
    
    if (currentCharges <= 0) {
      console.log(`[Ability] ${abilityDef.name}: No charges available`);
      return false;
    }
    
    // Consume a charge
    const newCharges = currentCharges - 1;
    clientChargesRef.current[abilityId] = newCharges;
    setClientCharges(abilityId, newCharges);
    
    console.log(`[Ability] ${abilityDef.name}: Used charge, ${newCharges}/${maxCharges} remaining`);
    
    // If no charges left, start cooldown to restore ALL charges
    if (newCharges === 0) {
      const cooldownMs = cooldownSeconds * 1000;
      const endTime = Date.now() + cooldownMs;
      clientCooldownsRef.current[abilityId] = endTime;
      setClientCooldown(abilityId, endTime);
      
      console.log(`[Ability] ${abilityDef.name}: All charges used, ${cooldownSeconds}s cooldown started`);
    }
    
    return true;
  }, [setClientCharges, setClientCooldown]);

  // Start a client-side cooldown for an ability (for non-charge abilities)
  const startClientCooldown = useCallback((abilityId: string) => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (abilityDef) {
      const cooldownMs = abilityDef.cooldown * 1000;
      const endTime = Date.now() + cooldownMs;
      clientCooldownsRef.current[abilityId] = endTime;
      // Also update store so HUD can display cooldown
      setClientCooldown(abilityId, endTime);
      console.log(`[Ability] Started cooldown for ${abilityDef.name}: ${abilityDef.cooldown}s`);
    }
  }, [setClientCooldown]);

  // Ref to prevent re-entry during teleport execution
  const teleportingRef = useRef(false);

  // Execute the Shadow Step teleport
  const executeShadowStepTeleport = useCallback(() => {
    // CRITICAL: Prevent re-entry (multiple clicks/keypresses)
    if (teleportingRef.current) {
      console.log('[Ability] Shadow Step blocked - already teleporting');
      return;
    }
    
    // Check cooldown to prevent using while on cooldown
    const cooldownEnd = clientCooldownsRef.current['phantom_shadowstep'];
    if (cooldownEnd && Date.now() < cooldownEnd) {
      const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
      console.log(`[Ability] Shadow Step on cooldown - ${remaining}s remaining`);
      // Use direct store access to ensure state update
      useGameStore.getState().setShadowStepTargeting(false, false);
      shadowStepTargetRef.current = null;
      shadowStepValidRef.current = false;
      teleportingRef.current = false;
      return;
    }
    
    if (!shadowStepTargetRef.current) {
      console.log('[Ability] Shadow Step failed - no target position');
      useGameStore.getState().setShadowStepTargeting(false, false);
      teleportingRef.current = false;
      return;
    }
    
    if (!shadowStepValidRef.current) {
      console.log('[Ability] Shadow Step failed - invalid target location');
      // Don't exit targeting mode, let user re-aim
      return;
    }
    
    // Set teleporting flag IMMEDIATELY to prevent re-entry
    teleportingRef.current = true;
    
    const target = shadowStepTargetRef.current.clone();
    // Read current position directly from store to avoid stale closure
    const currentPos = useGameStore.getState().localPlayer?.position;
    
    // Calculate initial teleport destination (target is ground level, add player height)
    let teleportX = target.x;
    let teleportY = target.y + PLAYER_HEIGHT / 2 + 0.1; // Slightly above to avoid clipping
    let teleportZ = target.z;
    
    // Check for walls between current position and target
    if (currentPos) {
      const dx = teleportX - currentPos.x;
      const dz = teleportZ - currentPos.z;
      const distToTarget = Math.sqrt(dx * dx + dz * dz);
      const dirX = dx / distToTarget;
      const dirZ = dz / distToTarget;
      
      const playerFeetY = currentPos.y - PLAYER_HEIGHT / 2;
      const elevationDiff = target.y - playerFeetY;
      const isElevatedTarget = elevationDiff > 0.3;
      
      let wallBlocking = false;
      
      if (!isElevatedTarget) {
        // Flat or lower target - check for walls normally
        const checkHeights = [0.9, 1.5]; // center, head
        for (const h of checkHeights) {
          const wallCheck = checkWallCollision(
            currentPos.x, currentPos.y - PLAYER_HEIGHT/2 + h, currentPos.z,
            dirX, dirZ,
            distToTarget
          );
          
          const normalY = Math.abs(wallCheck.normal.y);
          if (wallCheck.hit && wallCheck.distance < distToTarget - 1.5 && normalY < 0.5) {
            console.log(`[Ability] Shadow Step blocked by wall at height ${h}`);
            wallBlocking = true;
            break;
          }
        }
      } else {
        // Elevated target (stairs, ledges) - check from above the target height
        const elevatedCheckY = target.y + 1.0;
        const wallCheck = checkWallCollision(
          currentPos.x,
          elevatedCheckY,
          currentPos.z,
          dirX, dirZ,
          distToTarget
        );
        const normalY = Math.abs(wallCheck.normal.y);
        if (wallCheck.hit && wallCheck.distance < distToTarget - 2.0 && normalY < 0.3) {
          console.log(`[Ability] Shadow Step blocked by wall (elevated check)`);
          wallBlocking = true;
        }
      }
      
      if (wallBlocking) {
        teleportingRef.current = false;
        useGameStore.getState().setShadowStepTargeting(false, false);
        shadowStepTargetRef.current = null;
        shadowStepValidRef.current = false;
        return;
      }
    }
    
    // Validate the teleport destination
    const validation = validateTeleportDestination(teleportX, teleportY, teleportZ, PLAYER_HEIGHT, PLAYER_RADIUS);
    
    // Check if this is an elevated target (stairs, ledges)
    const playerFeetY = currentPos ? currentPos.y - PLAYER_HEIGHT / 2 : 0;
    const elevationDiff = target.y - playerFeetY;
    const isElevatedTarget = elevationDiff > 0.3;
    
    if (!validation.valid) {
      // For elevated targets, try a fallback - just check for walkable ground
      if (isElevatedTarget) {
        const groundRecheck = checkGroundWithNormal(teleportX, teleportY + 2, teleportZ, 5);
        if (groundRecheck && groundRecheck.isWalkable) {
          console.log(`[Ability] Shadow Step - using elevated fallback validation`);
          teleportY = groundRecheck.groundY + PLAYER_HEIGHT / 2 + 0.1;
        } else {
          console.log(`[Ability] Shadow Step blocked: ${validation.reason}`);
          teleportingRef.current = false;
          useGameStore.getState().setShadowStepTargeting(false, false);
          shadowStepTargetRef.current = null;
          shadowStepValidRef.current = false;
          return;
        }
      } else {
        console.log(`[Ability] Shadow Step blocked: ${validation.reason}`);
        teleportingRef.current = false;
        useGameStore.getState().setShadowStepTargeting(false, false);
        shadowStepTargetRef.current = null;
        shadowStepValidRef.current = false;
        return;
      }
    } else if (validation.adjustedPosition) {
      // Use adjusted position if provided
      teleportX = validation.adjustedPosition.x;
      teleportY = validation.adjustedPosition.y;
      teleportZ = validation.adjustedPosition.z;
    }
    
    console.log(`[Ability] Shadow Step executing:`);
    console.log(`  From: (${currentPos?.x.toFixed(1)}, ${currentPos?.y.toFixed(1)}, ${currentPos?.z.toFixed(1)})`);
    console.log(`  To: (${teleportX.toFixed(1)}, ${teleportY.toFixed(1)}, ${teleportZ.toFixed(1)})`);
    
    // Trigger visual effect
    triggerTeleportEffect('shadowstep');
    
    // EXIT TARGETING MODE FIRST (before any async operations)
    // Call directly from store to ensure we get the current action
    useGameStore.getState().setShadowStepTargeting(false, false);
    shadowStepTargetRef.current = null;
    shadowStepValidRef.current = false;
    
    console.log('[Ability] Targeting mode disabled');
    
    // Update local player position in store
    updateLocalPlayer({
      position: { x: teleportX, y: teleportY, z: teleportZ },
      velocity: { x: 0, y: 0, z: 0 },
    });
    
    // Also update camera immediately for instant feedback
    camera.position.set(teleportX, teleportY + 0.6, teleportZ);
    
    // Reset velocity and smoothing
    velocityRef.current.set(0, 0, 0);
    smoothedYRef.current = teleportY;
    isGroundedRef.current = false; // Let physics re-establish ground
    
    // Start client-side cooldown AFTER teleport completes
    startClientCooldown('phantom_shadowstep');
    
    // Send ability usage to server NOW (after teleport, for proper cooldown tracking)
    sendInput({
      tick: 0,
      ability2: true,
      timestamp: Date.now(),
      position: { x: target.x, y: teleportY, z: target.z },
      velocity: { x: 0, y: 0, z: 0 },
    } as any);
    
    // Reset teleporting flag after a short delay (prevents accidental re-triggers)
    setTimeout(() => {
      teleportingRef.current = false;
    }, 100);
    
    console.log(`[Ability] Shadow Step complete!`);
  }, [updateLocalPlayer, camera, startClientCooldown, sendInput]);

  // Handle pointer lock on click
  const handleClick = useCallback(() => {
    if (!isPointerLocked) {
      requestPointerLock();
    } else if (shadowStepTargeting && shadowStepValidRef.current && shadowStepTargetRef.current) {
      // Confirm Shadow Step teleport on click
      console.log('[Ability] Shadow Step confirmed!');
      executeShadowStepTeleport();
    }
  }, [isPointerLocked, requestPointerLock, shadowStepTargeting, executeShadowStepTeleport]);

  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);

  // Cancel Shadow Step on right click or Escape
  useEffect(() => {
    const handleCancel = (e: MouseEvent | KeyboardEvent) => {
      // Read fresh from store
      const isTargeting = useGameStore.getState().shadowStepTargeting;
      if (!isTargeting) return;
      
      if ((e instanceof MouseEvent && e.button === 2) || 
          (e instanceof KeyboardEvent && e.code === 'Escape')) {
        e.preventDefault();
        // Call directly from store
        useGameStore.getState().setShadowStepTargeting(false, false);
        shadowStepTargetRef.current = null;
        shadowStepValidRef.current = false;
        teleportingRef.current = false;
        console.log('[Ability] Shadow Step cancelled');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (shadowStepTargeting) {
        e.preventDefault();
        setShadowStepTargeting(false);
        shadowStepTargetRef.current = null;
        console.log('[Ability] Shadow Step cancelled');
      }
    };

    window.addEventListener('mousedown', handleCancel);
    window.addEventListener('keydown', handleCancel);
    window.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      window.removeEventListener('mousedown', handleCancel);
      window.removeEventListener('keydown', handleCancel);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [shadowStepTargeting, setShadowStepTargeting]);

  // Handle mouse movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked) return;

      yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
      pitchRef.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchRef.current));
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isPointerLocked]);

  // Handle Shadow Step target updates from indicator
  const handleShadowStepTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    shadowStepTargetRef.current = position;
    shadowStepValidRef.current = isValid;
    // Only update validity in store (for UI), don't touch targeting state
    const store = useGameStore.getState();
    if (store.shadowStepTargeting && store.shadowStepValid !== isValid) {
      store.setShadowStepTargeting(true, isValid);
    }
  }, []);

  // Execute ability effect on client
  const executeAbility = useCallback((abilityId: string, position: THREE.Vector3, velocity: THREE.Vector3) => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) return;

    console.log(`[Ability] Executing ${abilityDef.name}!`);
    
    // Start cooldown for abilities without special handling
    // - phantom_shadowstep: cooldown starts after teleport completes
    // - phantom_blink: uses charge system
    const hasSpecialHandling = ['phantom_shadowstep', 'phantom_blink'].includes(abilityId);
    if (!hasSpecialHandling) {
      startClientCooldown(abilityId);
    }

    switch (abilityId) {
      // ===== PHANTOM ABILITIES =====
      case 'phantom_blink': {
        // Calculate target position first
        const blinkDistance = 8;
        const yaw = yawRef.current;
        const pitch = pitchRef.current;
        
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);
        
        let targetX = position.x + dx * blinkDistance;
        let targetY = position.y;
        let targetZ = position.z + dz * blinkDistance;
        
        // Small upward boost if looking up
        if (pitch < -0.3) {
          targetY += 2;
        }
        
        // Check for walls between current position and target (only at mid/head height to avoid ground hits)
        const checkHeights = [0.9, 1.5]; // center, head (skip feet to avoid ground detection)
        let wallBlocking = false;
        const distToTarget = Math.sqrt(
          (targetX - position.x) ** 2 + 
          (targetZ - position.z) ** 2
        );
        
        for (const h of checkHeights) {
          const wallCheck = checkWallCollision(
            position.x, position.y - PLAYER_HEIGHT/2 + h, position.z,
            dx, dz,
            distToTarget
          );
          
          // Only count as blocking if wall is significantly closer than target
          // and the hit normal indicates a vertical surface (wall), not floor
          if (wallCheck.hit && wallCheck.distance < distToTarget - 1.0) {
            // Check if the normal indicates a wall (mostly horizontal normal = vertical surface)
            const normalY = Math.abs(wallCheck.normal.y);
            if (normalY < 0.5) { // Wall-like surface (normal is mostly horizontal)
              wallBlocking = true;
              console.log(`[Ability] Blink blocked by wall at height ${h}, distance ${wallCheck.distance.toFixed(1)}`);
              break;
            }
          }
        }
        
        if (wallBlocking) {
          // Find the maximum safe distance (minimum 3m to be useful)
          let safeDistance = 3;
          for (let testDist = blinkDistance - 1; testDist >= 3; testDist -= 1) {
            let blocked = false;
            for (const h of checkHeights) {
              const wallCheck = checkWallCollision(
                position.x, position.y - PLAYER_HEIGHT/2 + h, position.z,
                dx, dz,
                testDist
              );
              const normalY = Math.abs(wallCheck.normal.y);
              if (wallCheck.hit && wallCheck.distance < testDist - 0.5 && normalY < 0.5) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              safeDistance = testDist;
              break;
            }
          }
          
          // Adjust target to safe distance
          targetX = position.x + dx * safeDistance;
          targetZ = position.z + dz * safeDistance;
          console.log(`[Ability] Blink adjusted to safe distance: ${safeDistance}m`);
        }
        
        // Validate the teleport destination
        console.log(`[Ability] Blink validating: (${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)})`);
        const validation = validateTeleportDestination(targetX, targetY, targetZ, PLAYER_HEIGHT, PLAYER_RADIUS);
        console.log(`[Ability] Blink validation result: ${validation.valid ? 'VALID' : 'INVALID'} - ${validation.reason || 'ok'}`);
        
        if (!validation.valid) {
          // Try shorter distances until we find a valid spot
          let foundValid = false;
          for (let dist = blinkDistance - 1; dist >= 2; dist--) {
            const shorterX = position.x + dx * dist;
            const shorterZ = position.z + dz * dist;
            const shorterValidation = validateTeleportDestination(shorterX, targetY, shorterZ, PLAYER_HEIGHT, PLAYER_RADIUS);
            
            if (shorterValidation.valid) {
              targetX = shorterValidation.adjustedPosition?.x ?? shorterX;
              targetY = shorterValidation.adjustedPosition?.y ?? targetY;
              targetZ = shorterValidation.adjustedPosition?.z ?? shorterZ;
              foundValid = true;
              console.log(`[Ability] Blink shortened to ${dist}m (original: ${validation.reason})`);
              break;
            }
          }
          
          if (!foundValid) {
            console.log(`[Ability] Blink BLOCKED - no valid position found: ${validation.reason}`);
            // Don't consume charge if blink is completely blocked
            return;
          }
        } else if (validation.adjustedPosition) {
          // Use adjusted position (snapped to ground)
          targetX = validation.adjustedPosition.x;
          targetY = validation.adjustedPosition.y;
          targetZ = validation.adjustedPosition.z;
        }
        
        // Use a charge (handles cooldown when charges depleted)
        if (!useAbilityCharge(abilityId)) {
          console.log('[Ability] Blink - no charges available');
          return;
        }
        
        // Trigger visual effect
        triggerTeleportEffect('blink');
        
        // Apply the validated teleport
        position.x = targetX;
        position.y = targetY;
        position.z = targetZ;
        
        // Reset velocity for clean teleport
        velocity.x = dx * 2;
        velocity.z = dz * 2;
        
        // Create void zone at the destination for instant client-side feedback
        // (Server will also broadcast this, but we create it immediately for responsiveness)
        const voidZoneId = `local_void_${Date.now()}`;
        const currentPlayer = useGameStore.getState().localPlayer;
        useGameStore.getState().addVoidZone({
          id: voidZoneId,
          position: { x: targetX, y: targetY - 0.9, z: targetZ }, // Ground level
          radius: 3, // VOID_ZONE_RADIUS
          duration: 4, // VOID_ZONE_DURATION
          startTime: Date.now(),
          ownerId: currentPlayer?.id || '',
          ownerTeam: (currentPlayer?.team || 'red') as 'red' | 'blue',
        });
        
        console.log(`[Ability] Blinked to (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}) - Void zone created`);
        break;
      }

      case 'phantom_shadowstep': {
        // Enter targeting mode instead of instant teleport
        setShadowStepTargeting(true);
        console.log('[Ability] Shadow Step targeting mode activated - aim and click to teleport');
        break;
      }

      case 'phantom_veil': {
        // Become invisible - mark as active
        const duration = ABILITY_DEFINITIONS[abilityId]?.duration ?? 6;
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        
        // Consume ultimate charge
        updateLocalPlayer({ ultimateCharge: 0 });
        
        // Activate visual effect
        useGameStore.getState().setUltimateEffect(true, 'phantom_veil', Date.now() + duration * 1000);
        
        console.log(`[Ability] Phantom Veil activated! (30% speed boost for ${duration}s)`);
        break;
      }

      // ===== HOOKSHOT ABILITIES =====
      case 'hookshot_grapple': {
        // Grapple pull - launch toward look direction
        const distance = 15;
        const yaw = yawRef.current;
        const pitch = pitchRef.current;
        
        velocity.x = -Math.sin(yaw) * Math.cos(pitch) * distance;
        velocity.y = -Math.sin(pitch) * distance * 0.5 + 5;
        velocity.z = -Math.cos(yaw) * Math.cos(pitch) * distance;
        
        console.log('[Ability] Grapple launched!');
        break;
      }

      case 'hookshot_swing': {
        // Swing momentum boost
        const boost = 12;
        const yaw = yawRef.current;
        
        velocity.x += -Math.sin(yaw) * boost;
        velocity.y += 6;
        velocity.z += -Math.cos(yaw) * boost;
        
        console.log('[Ability] Swing Line activated!');
        break;
      }

      // ===== BLAZE ABILITIES =====
      case 'blaze_rocketjump': {
        // Explosive jump
        velocity.y = 18;
        position.y += 0.5;
        
        // Small horizontal push in look direction
        const yaw = yawRef.current;
        velocity.x += -Math.sin(yaw) * 5;
        velocity.z += -Math.cos(yaw) * 5;
        
        console.log('[Ability] Rocket Jump!');
        break;
      }

      // ===== GLACIER ABILITIES =====
      case 'glacier_iceslide': {
        // Speed boost in movement direction
        const boost = 15;
        const yaw = yawRef.current;
        
        velocity.x = -Math.sin(yaw) * boost;
        velocity.z = -Math.cos(yaw) * boost;
        
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Ice Slide activated!');
        break;
      }

      case 'glacier_wallclimb': {
        // Wall climb - boost upward
        velocity.y = 12;
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Frost Climb activated!');
        break;
      }

      // ===== PULSE ABILITIES =====
      case 'pulse_speedboost': {
        // Speed aura - mark as active
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Speed Aura activated!');
        break;
      }

      case 'pulse_dash': {
        // Quick dash
        const distance = 10;
        const yaw = yawRef.current;
        
        position.x += -Math.sin(yaw) * distance;
        position.z += -Math.cos(yaw) * distance;
        
        velocity.x = -Math.sin(yaw) * 8;
        velocity.z = -Math.cos(yaw) * 8;
        
        console.log('[Ability] Quick Dash!');
        break;
      }

      case 'pulse_haste': {
        // Team haste - mark as active
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Team Haste activated!');
        break;
      }

      // ===== SENTINEL ABILITIES =====
      case 'sentinel_fortify': {
        // Fortify - plant in place
        velocity.x = 0;
        velocity.z = 0;
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Fortify activated!');
        break;
      }

      case 'sentinel_barrier': {
        // Deploy barrier in front
        console.log('[Ability] Energy Barrier deployed!');
        break;
      }

      case 'sentinel_dome': {
        // Shield dome
        abilityActiveRef.current[abilityId] = { active: true, startTime: Date.now() };
        console.log('[Ability] Shield Dome activated!');
        break;
      }
    }
  }, [startClientCooldown]);

  // Check if ability can be used (client-side check using server cooldown data)
  const canUseAbility = useCallback((abilityId: string, isUltimate: boolean) => {
    // Read directly from store for fresh data
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) return false;

    // Don't allow using abilities while Shadow Step targeting is active
    if (shadowStepTargeting && abilityId !== 'phantom_shadowstep') return false;

    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    const maxCharges = abilityDef?.charges || 1;
    const hasCharges = maxCharges > 1;

    // Check client-side cooldown first (for immediate feedback)
    const clientCooldownEnd = clientCooldownsRef.current[abilityId];
    const now = Date.now();
    
    // If on cooldown, can't use
    if (clientCooldownEnd && clientCooldownEnd > 0 && now < clientCooldownEnd) {
      return false;
    }

    // For multi-charge abilities, use CLIENT-SIDE charge tracking (more responsive)
    if (hasCharges) {
      const clientCharges = clientChargesRef.current[abilityId];
      
      // If cooldown ended (or cleared), ability is available
      // Charges will reset when useAbilityCharge is called
      if (clientCooldownEnd === 0 || (clientCooldownEnd && now >= clientCooldownEnd)) {
        // If we had 0 charges but cooldown ended, we can use (charges will reset)
        if (clientCharges === 0) {
          return true;
        }
      }
      
      // If client charges are tracked
      if (clientCharges !== undefined) {
        // If we have charges, can use
        if (clientCharges > 0) {
          return true;
        }
        // If no charges and still on cooldown, can't use
        return false;
      }
      
      // If not tracked yet, allow (will initialize)
      return true;
    }

    // For non-charge abilities, check server state as fallback
    const abilityState = localPlayer.abilities?.[abilityId];
    if (abilityState) {
      if (abilityState.cooldownRemaining > 0) return false;
    }

    // Check ultimate charge
    if (isUltimate && (localPlayer.ultimateCharge ?? 0) < 100) {
      return false;
    }

    return true;
  }, [shadowStepTargeting]);

  useFrame((_, delta) => {
    // Read localPlayer directly from store to get latest state (avoids stale closures)
    const localPlayer = useGameStore.getState().localPlayer;
    
    // Only run movement during active gameplay
    const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
    
    if (!localPlayer) {
      return;
    }
    
    // If not pointer locked but playing, still update camera to player position
    if (!isPointerLocked) {
      // Keep camera at player position looking forward
      camera.position.set(localPlayer.position.x, localPlayer.position.y + 0.6, localPlayer.position.z);
      return;
    }

    if (!isPlaying) return;

    // Clamp delta to prevent huge jumps
    const dt = Math.min(delta, 0.1);

    // Get movement direction from input
    const moveDirection = new THREE.Vector3();
    
    // Reduce movement speed while in Shadow Step targeting mode
    const movementMultiplier = shadowStepTargeting ? 0.3 : 1;
    
    if (inputState.moveForward) moveDirection.z -= 1;
    if (inputState.moveBackward) moveDirection.z += 1;
    if (inputState.moveLeft) moveDirection.x -= 1;
    if (inputState.moveRight) moveDirection.x += 1;
    
    moveDirection.normalize();

    // Apply rotation to movement direction
    const euler = new THREE.Euler(0, yawRef.current, 0, 'YXZ');
    moveDirection.applyEuler(euler);

    // Calculate speed from hero stats
    const heroStats = getHeroStats(localPlayer.heroId as HeroId);
    let speed = heroStats.moveSpeed * movementMultiplier;
    
    // Update slide cooldown
    slideCooldownRef.current = Math.max(0, slideCooldownRef.current - dt);
    
    // Calculate horizontal speed for slide detection
    const currentHorizontalSpeed = Math.sqrt(
      velocityRef.current.x * velocityRef.current.x + 
      velocityRef.current.z * velocityRef.current.z
    );
    
    // Check if player is providing movement input
    const hasMovementInput = inputState.moveForward || inputState.moveBackward || inputState.moveLeft || inputState.moveRight;
    
    // Sprint state - only when grounded, moving, and not crouching/sliding
    const canSprint = inputState.sprint && 
                      !shadowStepTargeting && 
                      isGroundedRef.current && 
                      !isSliding.current &&
                      !isCrouchingRef.current &&
                      hasMovementInput;
    isSprintingRef.current = canSprint;
    
    // Handle slide initiation: Sprint + Crouch while moving
    // We check if player is sprinting AND has movement input (don't require high speed - sprint speed will be applied)
    // Note: We DON'T check isCrouchingRef because we want sprint+crouch to always trigger slide
    const shouldStartSlide = inputState.crouch && 
                             inputState.sprint &&  // Player is holding sprint
                             hasMovementInput &&   // Player is moving
                             isGroundedRef.current && 
                             !isSliding.current && 
                             slideCooldownRef.current <= 0;
    
    // Debug: Log when crouch is pressed while sprinting
    if (inputState.crouch && inputState.sprint && hasMovementInput) {
      console.log('[Slide Debug] Crouch+Sprint pressed. Grounded:', isGroundedRef.current, 
                  'Already sliding:', isSliding.current, 
                  'Cooldown:', slideCooldownRef.current.toFixed(2),
                  'Should slide:', shouldStartSlide);
    }
    
    if (shouldStartSlide) {
      // Start sliding!
      isSliding.current = true;
      slideTimeRef.current = SLIDE_DURATION;
      wasSprintingBeforeSlide.current = true;
      isSprintingRef.current = false; // Stop sprinting when sliding
      
      // Calculate slide direction from look direction and movement input
      const slideDir = new THREE.Vector3();
      if (inputState.moveForward) slideDir.z -= 1;
      if (inputState.moveBackward) slideDir.z += 1;
      if (inputState.moveLeft) slideDir.x -= 1;
      if (inputState.moveRight) slideDir.x += 1;
      slideDir.normalize();
      
      // Apply rotation to get world-space slide direction
      const euler = new THREE.Euler(0, yawRef.current, 0, 'YXZ');
      slideDir.applyEuler(euler);
      slideDirectionRef.current.copy(slideDir);
      
      // Set initial slide velocity (sprint speed with boost)
      const slideSpeed = heroStats.moveSpeed * SPRINT_MULTIPLIER * SLIDE_INITIAL_BOOST;
      velocityRef.current.x = slideDir.x * slideSpeed;
      velocityRef.current.z = slideDir.z * slideSpeed;
      
      console.log('[Movement] Started slide! Speed:', slideSpeed.toFixed(1), 'Duration:', SLIDE_DURATION);
    }
    
    // Update slide state
    if (isSliding.current) {
      slideTimeRef.current -= dt;
      
      // Apply slide friction
      const friction = Math.pow(SLIDE_FRICTION, dt * 60);
      velocityRef.current.x *= friction;
      velocityRef.current.z *= friction;
      
      // Check for slide end conditions
      const slideSpeed = Math.sqrt(
        velocityRef.current.x * velocityRef.current.x + 
        velocityRef.current.z * velocityRef.current.z
      );
      
      // Slide ends when: timer expires, speed too low, or player jumps
      if (slideTimeRef.current <= 0 || slideSpeed < 2 || inputState.jump) {
        isSliding.current = false;
        slideCooldownRef.current = SLIDE_COOLDOWN;
        wasSprintingBeforeSlide.current = false;
        isCrouchingRef.current = false; // Auto-uncrouch at end of slide
        console.log('[Movement] Slide ended, auto-uncrouching');
      }
    }
    
    // Crouch state - not while sliding, not while sprinting
    // Player can crouch ONLY if: pressing crouch AND not sliding AND not holding sprint
    // (If holding sprint + crouch, that triggers slide instead)
    if (isSliding.current) {
      // During slide, maintain crouched visual but don't set crouch state
      // (slide handles its own camera lowering)
    } else if (inputState.crouch && !inputState.sprint) {
      // Normal crouch - only when NOT holding sprint
      isCrouchingRef.current = true;
    } else {
      // Release crouch when: not pressing crouch key, OR pressing sprint
      isCrouchingRef.current = false;
    }
    
    // Apply movement speed modifiers
    if (isSliding.current) {
      // During slide, don't apply normal movement - momentum carries player
      // But allow slight steering
      const steerStrength = 0.15;
      speed = heroStats.moveSpeed * steerStrength;
    } else if (isSprintingRef.current) {
      speed *= SPRINT_MULTIPLIER;
    } else if (isCrouchingRef.current) {
      speed *= CROUCH_MULTIPLIER;
    }

    // Check for active ability speed boosts
    const now = Date.now();
    for (const [abilityId, state] of Object.entries(abilityActiveRef.current)) {
      if (!state.active) continue;
      
      const abilityDef = ABILITY_DEFINITIONS[abilityId];
      const duration = (abilityDef?.duration ?? 0) * 1000;
      
      // Check if ability has expired
      if (now - state.startTime >= duration) {
        state.active = false;
        console.log(`[Ability] ${abilityDef?.name} ended`);
        continue;
      }

      // Apply speed boosts for active abilities
      if (abilityId === 'phantom_veil') speed *= 1.3;
      if (abilityId === 'pulse_speedboost') speed *= 1.3;
      if (abilityId === 'pulse_haste') speed *= 1.5;
      if (abilityId === 'glacier_iceslide') speed *= 1.5;
    }

    // ===== CS-STYLE BUNNY HOP / STRAFE MOVEMENT =====
    const velocity = velocityRef.current;

    // When sliding, only apply slight steering - don't overwrite slide velocity
    if (isSliding.current) {
      // Allow slight steering during slide (just add small movement influence)
      const steerForce = 3 * dt;
      velocity.x += moveDirection.x * speed * steerForce;
      velocity.z += moveDirection.z * speed * steerForce;
    } else {
      // Calculate wish direction (the direction player wants to move)
      const wishDirLen = Math.sqrt(moveDirection.x * moveDirection.x + moveDirection.z * moveDirection.z);
      const wishDir = wishDirLen > 0 ? {
        x: moveDirection.x / wishDirLen,
        z: moveDirection.z / wishDirLen,
      } : { x: 0, z: 0 };
      
      // Wish speed is the target speed
      const wishSpeed = speed;
      
      if (isGroundedRef.current) {
        // === GROUND MOVEMENT WITH FRICTION ===
        // Apply friction first (like Source engine)
        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        
        if (currentSpeed > 0) {
          // Calculate friction drop
          const control = currentSpeed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : currentSpeed;
          const drop = control * BHOP_GROUND_FRICTION * dt;
          
          // Scale velocity by friction
          let newSpeed = currentSpeed - drop;
          if (newSpeed < 0) newSpeed = 0;
          
          if (newSpeed !== currentSpeed) {
            const ratio = newSpeed / currentSpeed;
            velocity.x *= ratio;
            velocity.z *= ratio;
          }
        }
        
        // Then accelerate if there's input
        if (wishDir.x !== 0 || wishDir.z !== 0) {
          quakeAccelerate(velocity, wishDir, wishSpeed, BHOP_GROUND_ACCEL, dt);
        }
      } else {
        // === AIR MOVEMENT WITH STRAFE ACCELERATION ===
        // This is the core of CS-style bunny hopping!
        // Air acceleration uses a capped wish speed, but actual velocity can exceed this
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
    }

    // Current position
    const position = new THREE.Vector3(
      localPlayer.position.x,
      localPlayer.position.y,
      localPlayer.position.z
    );

    // ===== ABILITY INPUT HANDLING =====
    const heroId = localPlayer.heroId as HeroId;
    if (heroId) {
      const heroDef = HERO_DEFINITIONS[heroId];
      if (heroDef) {
        // Ability 1 (E) - Blink
        if (inputState.ability1 && !abilityPressedRef.current.ability1) {
          if (!shadowStepTargeting && canUseAbility(heroDef.ability1.abilityId, false)) {
            executeAbility(heroDef.ability1.abilityId, position, velocity);
          }
        }
        abilityPressedRef.current.ability1 = inputState.ability1;

        // Ability 2 (Q) - Shadow Step
        if (inputState.ability2 && !abilityPressedRef.current.ability2) {
          if (shadowStepTargeting) {
            // If already targeting, Q confirms the teleport (like click)
            if (shadowStepValidRef.current && shadowStepTargetRef.current) {
              executeShadowStepTeleport();
            }
          } else if (canUseAbility(heroDef.ability2.abilityId, false)) {
            executeAbility(heroDef.ability2.abilityId, position, velocity);
          }
        }
        abilityPressedRef.current.ability2 = inputState.ability2;

        // Ultimate (F)
        if (inputState.ultimate && !abilityPressedRef.current.ultimate) {
          if (!shadowStepTargeting && canUseAbility(heroDef.ultimate.abilityId, true)) {
            executeAbility(heroDef.ultimate.abilityId, position, velocity);
          }
        }
        abilityPressedRef.current.ultimate = inputState.ultimate;
      }
    }

    const physicsOk = isPhysicsReady();

    // Ground check with slope detection
    let groundInfo: GroundInfo | null = null;

    if (physicsOk) {
      // Check for ground below player
      groundInfo = checkGroundWithNormal(position.x, position.y + 0.5, position.z, 50);

      // Debug logging (throttled)
      if (now - lastDebugTime > 2000) {
        lastDebugTime = now;
        const colliders = getColliderCount();
        const walkable = groundInfo ? (groundInfo.isWalkable ? 'yes' : 'STEEP') : 'n/a';
        console.log('[Player] Y:', position.y.toFixed(1), '| Ground:', groundInfo ? groundInfo.groundY.toFixed(1) : 'none', '| Walkable:', walkable, '| Grounded:', isGroundedRef.current);
      }
    }

    // Ground collision FIRST - determine if grounded before applying physics
    if (groundInfo !== null) {
      const targetY = groundInfo.groundY + PLAYER_HEIGHT / 2;
      const playerFeetY = position.y - PLAYER_HEIGHT / 2;
      const distToGround = playerFeetY - groundInfo.groundY;
      
      // Close to or below ground
      if (distToGround <= 0.15 && velocity.y <= 0) {
        if (groundInfo.isWalkable) {
          // BHOP: Apply landing speed retention when transitioning from air to ground
          if (!wasGroundedRef.current) {
            // Just landed! Apply speed retention for bunny hop chaining
            const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
            if (horizontalSpeed > 0) {
              const retainedSpeed = horizontalSpeed * BHOP_LANDING_SPEED_RETENTION;
              const ratio = retainedSpeed / horizontalSpeed;
              velocity.x *= ratio;
              velocity.z *= ratio;
            }
          }
          
          // Calculate height change from current smoothed position
          const currentY = smoothedYRef.current ?? position.y;
          const heightChange = Math.abs(targetY - currentY);
          
          // Use smoothing for small bumps, snap for larger changes
          if (heightChange < SMALL_BUMP_THRESHOLD && isGroundedRef.current) {
            // Small bump - smooth over it
            const smoothSpeed = SMOOTH_SPEED_SMALL * dt;
            position.y = currentY + (targetY - currentY) * Math.min(smoothSpeed, 1);
          } else {
            // Larger step or first contact - snap or use faster smoothing
            const smoothSpeed = SMOOTH_SPEED_LARGE * dt;
            position.y = currentY + (targetY - currentY) * Math.min(smoothSpeed, 1);
          }
          
          smoothedYRef.current = position.y;
          velocity.y = 0;
          isGroundedRef.current = true;
          canJumpRef.current = true;
        } else {
          // Too steep - slide
          const slideForce = 15 * dt;
          velocity.x += groundInfo.normal.x * slideForce;
          velocity.z += groundInfo.normal.z * slideForce;
          position.y = targetY;
          smoothedYRef.current = position.y;
          velocity.y = 0;
          isGroundedRef.current = false;
          canJumpRef.current = false;
        }
      } else {
        isGroundedRef.current = false;
        smoothedYRef.current = null; // Reset smoothing when airborne
      }
    } else {
      isGroundedRef.current = false;
      smoothedYRef.current = null;
    }

    // Jump - check AFTER ground detection (disabled during targeting)
    if (inputState.jump && canJumpRef.current && isGroundedRef.current && !shadowStepTargeting) {
      velocity.y = heroStats.jumpForce;
      canJumpRef.current = false;
      isGroundedRef.current = false;
    }

    // Apply gravity (only once!)
    velocity.y += GRAVITY * dt;

    // Horizontal movement with step-up for stairs
    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    let didStepUp = false;
    
    if (physicsOk && (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001)) {
      const targetX = position.x + moveX;
      const targetZ = position.z + moveZ;
      
      // STEP-UP LOGIC: Check ground at target position and ahead
      // This handles stairs without relying on wall detection
      if (isGroundedRef.current) {
        // Check ground further ahead for stairs (not just at target position)
        const moveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
        const lookAheadDist = Math.max(moveDist * 3, 0.5); // Look ahead more
        const aheadX = position.x + (moveX / moveDist) * lookAheadDist;
        const aheadZ = position.z + (moveZ / moveDist) * lookAheadDist;
        
        const groundAhead = checkGroundWithNormal(aheadX, position.y + STEP_HEIGHT + 1, aheadZ, STEP_HEIGHT + 3);
        
        if (groundAhead && groundAhead.isWalkable) {
          const currentFeetY = position.y - PLAYER_HEIGHT / 2;
          const targetGroundY = groundAhead.groundY;
          const heightDiff = targetGroundY - currentFeetY;
          
          // If target ground is higher (but within step height), step up
          if (heightDiff > 0.1 && heightDiff <= STEP_HEIGHT) {
            // Check ceiling clearance
            const ceilingCheck = checkGroundWithNormal(aheadX, targetGroundY + PLAYER_HEIGHT + 0.5, aheadZ, 1);
            const hasCeiling = ceilingCheck && ceilingCheck.groundY < targetGroundY + PLAYER_HEIGHT;
            
            if (!hasCeiling) {
              // Step up! Move to a point between current and ahead
              const stepX = position.x + moveX * 2;
              const stepZ = position.z + moveZ * 2;
              position.x = stepX;
              position.z = stepZ;
              position.y = targetGroundY + PLAYER_HEIGHT / 2;
              smoothedYRef.current = position.y; // Update smoothed Y for stairs
              velocity.y = 0;
              didStepUp = true;
              isGroundedRef.current = true;
              canJumpRef.current = true;
            }
          }
        }
      }
      
      // If didn't step up, do normal movement with wall collision
      if (!didStepUp) {
        // Check walls
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
    } else {
      position.x += moveX;
      position.z += moveZ;
    }
    
    // Apply vertical movement (skip if we just stepped up)
    if (!didStepUp) {
      position.y += velocity.y * dt;
    }

    // Out of bounds detection - respawn if player falls below main terrain level
    const OUT_OF_BOUNDS_Y = 5;
    if (position.y < OUT_OF_BOUNDS_Y && isGroundedRef.current) {
      console.log('[Player] Out of bounds! Respawning...');
      position.set(-30, 60, -20); // Spawn in center of playable area
      velocity.set(0, 0, 0);
      smoothedYRef.current = null;
      isGroundedRef.current = false;
    }

    // Safety net - respawn if fell too far
    if (position.y < -50) {
      position.set(0, 60, 0);
      velocity.set(0, 0, 0);
      smoothedYRef.current = null;
    }

    // Constrain to polygon map boundary (slide along edges instead of pushing)
    const prevX = localPlayer.position.x;
    const prevZ = localPlayer.position.z;
    if (!isInsideBoundary(position.x, position.z)) {
      const constrained = constrainToBoundary(prevX, prevZ, position.x, position.z);
      position.x = constrained.x;
      position.z = constrained.z;
    }

    // Interpolate crouch camera height
    const targetCrouchOffset = (isCrouchingRef.current || isSliding.current) ? CROUCH_HEIGHT_OFFSET : 0;
    crouchHeightRef.current += (targetCrouchOffset - crouchHeightRef.current) * Math.min(CROUCH_TRANSITION_SPEED * dt, 1);
    
    // Interpolate slide camera effects
    const targetSlidePitch = isSliding.current ? SLIDE_CAMERA_PITCH_OFFSET : 0;
    const targetSlideFov = isSliding.current ? SLIDE_FOV_BOOST : 0;
    const targetSlideRoll = isSliding.current ? SLIDE_CAMERA_ROLL : 0;
    const targetSlideIntensity = isSliding.current ? 1 : 0;
    
    const slideTransitionSpeed = CROUCH_TRANSITION_SPEED * dt;
    slidePitchRef.current += (targetSlidePitch - slidePitchRef.current) * Math.min(slideTransitionSpeed, 1);
    slideFovRef.current += (targetSlideFov - slideFovRef.current) * Math.min(slideTransitionSpeed, 1);
    slideRollRef.current += (targetSlideRoll - slideRollRef.current) * Math.min(slideTransitionSpeed, 1);
    slideIntensityRef.current += (targetSlideIntensity - slideIntensityRef.current) * Math.min(slideTransitionSpeed * 1.5, 1);
    
    // Apply FOV change
    const baseFov = 75;
    camera.fov = baseFov + slideFovRef.current;
    camera.updateProjectionMatrix();
    
    // Update camera (add eye height offset + crouch offset)
    const eyeHeight = 0.6 + crouchHeightRef.current;
    camera.position.set(position.x, position.y + eyeHeight, position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current + slidePitchRef.current;
    camera.rotation.z = slideRollRef.current; // Add roll for dynamic feel

    // Update store (including slide intensity for visual effects)
    updateLocalPlayer({
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      lookYaw: yawRef.current,
      lookPitch: pitchRef.current,
      movement: {
        ...localPlayer.movement,
        isGrounded: isGroundedRef.current,
        isSprinting: isSprintingRef.current,
        isCrouching: isCrouchingRef.current,
        isSliding: isSliding.current,
        slideTimeRemaining: slideTimeRef.current,
      },
    });
    
    // Track grounded state for landing detection (bunny hop)
    wasGroundedRef.current = isGroundedRef.current;
    
    // Update slide intensity in store for UI effects
    useGameStore.getState().setSlideIntensity(slideIntensityRef.current);

    // Send input to server at tick rate
    tickRef.current++;
    if (now - lastSendRef.current >= 1000 / TICK_RATE) {
      lastSendRef.current = now;
      
      // Get current targeting state from store
      const currentTargeting = useGameStore.getState().shadowStepTargeting;
      
      sendInput({
        tick: tickRef.current,
        moveForward: inputState.moveForward,
        moveBackward: inputState.moveBackward,
        moveLeft: inputState.moveLeft,
        moveRight: inputState.moveRight,
        jump: inputState.jump,
        crouch: inputState.crouch,
        sprint: inputState.sprint,
        primaryFire: inputState.primaryFire,
        secondaryFire: inputState.secondaryFire,
        ability1: inputState.ability1,
        // Don't send ability2 while in Shadow Step targeting mode (wait for actual teleport)
        ability2: currentTargeting ? false : inputState.ability2,
        ultimate: inputState.ultimate,
        interact: inputState.interact,
        lookYaw: yawRef.current,
        lookPitch: pitchRef.current,
        timestamp: now,
        // Include client position for sync (server-authoritative games would validate this)
        position: { x: position.x, y: position.y, z: position.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      });
    }
  });

  return (
    <ShadowStepIndicator 
      isActive={shadowStepTargeting} 
      onTargetUpdate={handleShadowStepTargetUpdate}
    />
  );
}
