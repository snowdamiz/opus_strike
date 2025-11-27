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
  type GroundInfo 
} from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { 
  MOUSE_SENSITIVITY, 
  PITCH_LIMIT,
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  AIR_CONTROL,
  GRAVITY,
  TICK_RATE,
  getHeroStats,
  type HeroId,
} from '@voxel-strike/shared';
import { isInsideBoundary, constrainToBoundary } from '../../config/mapBoundaries';

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

export function PlayerController() {
  const { camera } = useThree();
  const { localPlayer, updateLocalPlayer, gamePhase } = useGameStore();
  const { inputState, isPointerLocked, requestPointerLock } = useInput();
  const { world, playerBody } = usePhysics();
  const { sendInput } = useNetwork();

  const velocityRef = useRef(new THREE.Vector3());
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const isGroundedRef = useRef(true);
  const canJumpRef = useRef(true);
  const initializedRef = useRef(false);
  const tickRef = useRef(0);
  const lastSendRef = useRef(0);
  const smoothedYRef = useRef<number | null>(null); // For smooth camera over bumps

  // Initialize camera position - also check if we need to spawn higher
  useEffect(() => {
    if (localPlayer && !initializedRef.current) {
      // If spawning too low (under terrain), start high and fall down
      const startY = localPlayer.position.y < 20 ? 60 : localPlayer.position.y;
      camera.position.set(localPlayer.position.x, startY + 0.6, localPlayer.position.z);
      
      // Also update the player position in store
      if (localPlayer.position.y < 20) {
        updateLocalPlayer({
          position: { x: localPlayer.position.x, y: startY, z: localPlayer.position.z }
        });
        console.log('[Player] Spawning high at y=60 to fall onto terrain');
      }
      
      initializedRef.current = true;
    }
  }, [localPlayer, camera, updateLocalPlayer]);

  // Handle pointer lock on click
  const handleClick = useCallback(() => {
    if (!isPointerLocked) {
      requestPointerLock();
    }
  }, [isPointerLocked, requestPointerLock]);

  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);

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

  useFrame((_, delta) => {
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
    let speed = heroStats.moveSpeed;
    if (inputState.sprint) speed *= SPRINT_MULTIPLIER;
    if (inputState.crouch) speed *= CROUCH_MULTIPLIER;

    // Apply movement
    const velocity = velocityRef.current;
    const control = isGroundedRef.current ? 1 : AIR_CONTROL;

    velocity.x += (moveDirection.x * speed - velocity.x) * control * 10 * dt;
    velocity.z += (moveDirection.z * speed - velocity.z) * control * 10 * dt;

    // Current position
    const position = new THREE.Vector3(
      localPlayer.position.x,
      localPlayer.position.y,
      localPlayer.position.z
    );

    const physicsOk = isPhysicsReady();

    // Ground check with slope detection
    let groundInfo: GroundInfo | null = null;

    if (physicsOk) {
      // Check for ground below player
      groundInfo = checkGroundWithNormal(position.x, position.y + 0.5, position.z, 50);

      // Debug logging (throttled)
      const now = Date.now();
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

    // Jump - check AFTER ground detection
    if (inputState.jump && canJumpRef.current && isGroundedRef.current) {
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

    // Update camera (add eye height offset)
    camera.position.set(position.x, position.y + 0.6, position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;

    // Update store
    updateLocalPlayer({
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      lookYaw: yawRef.current,
      lookPitch: pitchRef.current,
      movement: {
        ...localPlayer.movement,
        isGrounded: isGroundedRef.current,
      },
    });

    // Send input to server at tick rate
    tickRef.current++;
    const now = Date.now();
    if (now - lastSendRef.current >= 1000 / TICK_RATE) {
      lastSendRef.current = now;
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
        ability2: inputState.ability2,
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

  return null;
}

