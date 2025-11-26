import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { useInput } from '../../hooks/useInput';
import { usePhysics } from '../../hooks/usePhysics';
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

  // Initialize camera position
  useEffect(() => {
    if (localPlayer && !initializedRef.current) {
      camera.position.set(localPlayer.position.x, localPlayer.position.y + 0.6, localPlayer.position.z);
      initializedRef.current = true;
    }
  }, [localPlayer, camera]);

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

    // Ground check (simple for now)
    const position = new THREE.Vector3(
      localPlayer.position.x,
      localPlayer.position.y,
      localPlayer.position.z
    );

    // Simple ground collision at y=0
    if (position.y + velocity.y * dt < 0.9) {
      position.y = 0.9;
      velocity.y = 0;
      isGroundedRef.current = true;
      canJumpRef.current = true;
    } else {
      isGroundedRef.current = false;
    }

    // Jump
    if (inputState.jump && canJumpRef.current && isGroundedRef.current) {
      velocity.y = BASE_JUMP_FORCE;
      canJumpRef.current = false;
      isGroundedRef.current = false;
    }

    // Update position
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    position.z += velocity.z * dt;

    // Clamp to bounds
    position.x = Math.max(-48, Math.min(48, position.x));
    position.z = Math.max(-48, Math.min(48, position.z));

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

