import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { useInput } from '../../hooks/useInput';
import { 
  usePhysics, 
  checkGroundWithNormal, 
  moveWithCollision,
  isPhysicsReady, 
  getColliderCount,
  type GroundInfo 
} from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { 
  MOUSE_SENSITIVITY, 
  PITCH_LIMIT,
  BASE_MOVE_SPEED,
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  AIR_CONTROL,
  GRAVITY,
  BASE_JUMP_FORCE,
  TICK_RATE,
} from '@voxel-strike/shared';

// Player collision constants
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;
const GROUND_SNAP_DISTANCE = 0.3; // How close to ground to snap
const STEP_HEIGHT = 0.3; // Max height player can step up

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

    // Calculate speed
    let speed = localPlayer.heroId ? BASE_MOVE_SPEED : BASE_MOVE_SPEED;
    if (inputState.sprint) speed *= SPRINT_MULTIPLIER;
    if (inputState.crouch) speed *= CROUCH_MULTIPLIER;

    // Apply movement
    const velocity = velocityRef.current;
    const control = isGroundedRef.current ? 1 : AIR_CONTROL;

    velocity.x += (moveDirection.x * speed - velocity.x) * control * 10 * dt;
    velocity.z += (moveDirection.z * speed - velocity.z) * control * 10 * dt;

    // Apply gravity
    velocity.y += GRAVITY * dt;

    // Current position
    const position = new THREE.Vector3(
      localPlayer.position.x,
      localPlayer.position.y,
      localPlayer.position.z
    );

    const physicsOk = isPhysicsReady();

    // Ground check with slope detection
    isGroundedRef.current = false;
    let groundInfo: GroundInfo | null = null;

    if (physicsOk) {
      // Check for ground below player (from player center)
      groundInfo = checkGroundWithNormal(position.x, position.y + 0.5, position.z, 50);

      // Debug logging (throttled)
      const now = Date.now();
      if (now - lastDebugTime > 2000) {
        lastDebugTime = now;
        const colliders = getColliderCount();
        const walkable = groundInfo ? (groundInfo.isWalkable ? 'yes' : 'STEEP') : 'n/a';
        console.log('[Player] Y:', position.y.toFixed(1), '| Ground:', groundInfo ? groundInfo.groundY.toFixed(1) : 'none', '| Walkable:', walkable);
      }
    }

    // Apply gravity
    velocity.y += GRAVITY * dt;

    // Wall collision for horizontal movement
    if (physicsOk && (Math.abs(velocity.x) > 0.01 || Math.abs(velocity.z) > 0.01)) {
      const moveResult = moveWithCollision(
        position.x, position.y, position.z,
        velocity.x, velocity.z,
        dt,
        PLAYER_RADIUS
      );
      position.x = moveResult.newX;
      position.z = moveResult.newZ;
      velocity.x = moveResult.velX;
      velocity.z = moveResult.velZ;
    } else {
      // No physics, just move
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;
    }

    // Update Y position
    position.y += velocity.y * dt;

    // Ground collision with slope handling
    if (groundInfo !== null) {
      const playerFeetY = position.y - PLAYER_HEIGHT / 2;
      const distanceToGround = playerFeetY - groundInfo.groundY;
      
      // If close to ground and falling
      if (distanceToGround <= GROUND_SNAP_DISTANCE && velocity.y <= 0) {
        if (groundInfo.isWalkable) {
          // Walkable slope - snap to ground
          position.y = groundInfo.groundY + PLAYER_HEIGHT / 2;
          velocity.y = 0;
          isGroundedRef.current = true;
          canJumpRef.current = true;
        } else {
          // Too steep - slide down
          // Push player away from steep surface based on normal
          const slideForce = 15 * dt;
          velocity.x += groundInfo.normal.x * slideForce;
          velocity.z += groundInfo.normal.z * slideForce;
          // Still snap to surface but not grounded (can't jump)
          if (distanceToGround < 0.1) {
            position.y = groundInfo.groundY + PLAYER_HEIGHT / 2;
            velocity.y = 0;
          }
          isGroundedRef.current = false;
          canJumpRef.current = false;
        }
      }
      // Step-up: if we're slightly below a walkable surface, step up
      else if (distanceToGround < 0 && distanceToGround > -STEP_HEIGHT && groundInfo.isWalkable && velocity.y <= 0) {
        position.y = groundInfo.groundY + PLAYER_HEIGHT / 2;
        velocity.y = 0;
        isGroundedRef.current = true;
        canJumpRef.current = true;
      }
    }

    // Fallback ground collision at y=-49 (safety net)
    const minY = -49 + PLAYER_HEIGHT / 2;
    if (position.y <= minY) {
      position.y = minY;
      velocity.y = 0;
      isGroundedRef.current = true;
      canJumpRef.current = true;
      console.log('[Player] Hit safety net floor');
    }

    // Jump
    if (inputState.jump && canJumpRef.current && isGroundedRef.current) {
      velocity.y = BASE_JUMP_FORCE;
      canJumpRef.current = false;
      isGroundedRef.current = false;
    }

    // Prevent falling through the world - respawn if too low
    if (position.y < -100) {
      console.log('[Player] Fell off map, respawning');
      position.set(0, 60, 0);
      velocity.set(0, 0, 0);
    }

    // Clamp to map bounds
    position.x = Math.max(-95, Math.min(95, position.x));
    position.z = Math.max(-95, Math.min(95, position.z));

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

