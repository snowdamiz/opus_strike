/**
 * PlayerController - Refactored
 * 
 * Main player controller that orchestrates movement, camera, physics, and abilities.
 * Logic has been extracted into specialized hooks for better maintainability.
 * 
 * @see hooks/player/useCamera.ts - Camera control and mouse look
 * @see hooks/player/useMovement.ts - Movement, slide, and bunny hop physics
 * @see hooks/player/useAbilitySystem.ts - Cooldowns and charge management
 * @see hooks/player/usePlayerPhysics.ts - Ground detection and collision
 * @see hooks/player/abilities/ - Hero-specific ability handlers
 */

import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { useInput } from '../../hooks/useInput';
import { usePhysics, isPhysicsReady } from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { useAbilitySounds, useMovementSounds } from '../../hooks/useAudio';
import {
  useCamera,
  useMovement,
  useAbilitySystem,
  usePlayerPhysics,
  usePhantomAbilities,
  useBlazeAbilities,
  useGlacierAbilities,
  useHookshotAbilities,
  PLAYER_HEIGHT,
  EYE_HEIGHT,
} from '../../hooks/player';
import {
  TICK_RATE,
  getHeroStats,
  HERO_DEFINITIONS,
  type HeroId,
} from '@voxel-strike/shared';

// Component imports for targeting indicators
import { BombTargetingIndicator, AirStrikeTargetingIndicator } from './BlazeEffects';
import { GrappleTrapTargetingIndicator } from './HookshotEffects';
import { ShadowStepIndicator } from './phantom';

// ============================================================================
// PLAYER CONTROLLER COMPONENT
// ============================================================================

export function PlayerController() {
  const { camera } = useThree();

  // Store state and actions
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const setShadowStepTargeting = useGameStore(state => state.setShadowStepTargeting);
  const setBombTargeting = useGameStore(state => state.setBombTargeting);
  const bombTargeting = useGameStore(state => state.bombTargeting);
  const setAirStrikeTargeting = useGameStore(state => state.setAirStrikeTargeting);
  const airStrikeTargeting = useGameStore(state => state.airStrikeTargeting);
  const setJetpackActive = useGameStore(state => state.setJetpackActive);
  const setJetpackFuel = useGameStore(state => state.setJetpackFuel);
  const setIceWallRushActive = useGameStore(state => state.setIceWallRushActive);
  const setIceWallRushFuel = useGameStore(state => state.setIceWallRushFuel);
  const addIceWallRush = useGameStore(state => state.addIceWallRush);
  const updateIceWallRush = useGameStore(state => state.updateIceWallRush);
  const gamePhase = useGameStore(state => state.gamePhase);
  const shadowStepTargeting = useGameStore(state => state.shadowStepTargeting);
  const grappleTrapTargeting = useGameStore(state => state.grappleTrapTargeting);
  const setGrappleTrapTargeting = useGameStore(state => state.setGrappleTrapTargeting);
  const localPlayerForInit = useGameStore(state => state.localPlayer);

  // Input and network
  const { inputState, isPointerLocked, requestPointerLock } = useInput();
  const { world, playerBody } = usePhysics();
  const { sendInput } = useNetwork();

  // Audio hooks
  const {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startJetpackSound, stopJetpackSound,
  } = useAbilitySounds();
  const { updateWalkingSound, preloadWalkingSound, startSlide, stopSlide } = useMovementSounds();

  // Player hooks
  const cameraControl = useCamera({ isPointerLocked });
  const movement = useMovement();
  const abilitySystem = useAbilitySystem();
  const physics = usePlayerPhysics();

  // Hero ability hooks
  const phantomAbilities = usePhantomAbilities();
  const blazeAbilities = useBlazeAbilities();
  const glacierAbilities = useGlacierAbilities();
  const hookshotAbilities = useHookshotAbilities();

  // Initialize refs
  const initializedRef = useRef(false);
  const tickRef = useRef(0);
  const lastSendRef = useRef(0);
  const positionRef = useRef(new THREE.Vector3());

  // Hero stats cache
  const cachedHeroStatsRef = useRef<{ heroId: string | null; stats: ReturnType<typeof getHeroStats> | null }>({
    heroId: null,
    stats: null,
  });

  // Preload walking sound on mount
  useEffect(() => {
    preloadWalkingSound();
  }, [preloadWalkingSound]);

  // Initialize camera position
  useEffect(() => {
    if (localPlayerForInit && !initializedRef.current) {
      const startY = localPlayerForInit.position.y < 20 ? 60 : localPlayerForInit.position.y;
      camera.position.set(localPlayerForInit.position.x, startY + EYE_HEIGHT, localPlayerForInit.position.z);

      if (localPlayerForInit.position.y < 20) {
        updateLocalPlayer({
          position: { x: localPlayerForInit.position.x, y: startY, z: localPlayerForInit.position.z },
        });
      }

      initializedRef.current = true;
    }
  }, [localPlayerForInit, camera, updateLocalPlayer]);

  // Create sound objects for passing to ability hooks
  const playerSounds = {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startJetpackSound, stopJetpackSound,
  };

  const movementSounds = {
    updateWalkingSound,
    startSlide,
    stopSlide,
  };

  // Handle targeting confirmations via click
  const handleClick = useCallback(() => {
    if (!isPointerLocked) {
      requestPointerLock();
    } else if (shadowStepTargeting && phantomAbilities.shadowStepValidRef.current && phantomAbilities.shadowStepTargetRef.current) {
      const localPlayer = useGameStore.getState().localPlayer;
      if (localPlayer) {
        const ctx = {
          position: new THREE.Vector3(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z),
          velocity: new THREE.Vector3(),
          yaw: cameraControl.refs.yaw.current,
          pitch: cameraControl.refs.pitch.current,
          heroId: localPlayer.heroId as HeroId,
          localPlayer: {
            id: localPlayer.id,
            team: localPlayer.team,
            position: localPlayer.position,
            ultimateCharge: localPlayer.ultimateCharge,
          },
          inputState,
          dt: 0,
          isGrounded: movement.refs.isGrounded.current,
        };
        phantomAbilities.executeShadowStepTeleport(
          ctx, playerSounds, abilitySystem.startClientCooldown, sendInput, updateLocalPlayer, camera
        );
      }
    } else if (bombTargeting && blazeAbilities.bombValidRef.current && blazeAbilities.bombTargetRef.current) {
      blazeAbilities.executeBombDrop(playerSounds);
    } else if (airStrikeTargeting && blazeAbilities.airStrikeValidRef.current && blazeAbilities.airStrikeTargetRef.current) {
      blazeAbilities.executeAirStrike(playerSounds, updateLocalPlayer);
    } else if (grappleTrapTargeting && hookshotAbilities.grappleTrapValidRef.current && hookshotAbilities.grappleTrapTargetRef.current) {
      const localPlayer = useGameStore.getState().localPlayer;
      if (localPlayer) {
        const ctx = {
          position: new THREE.Vector3(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z),
          velocity: movement.refs.velocity.current,
          yaw: cameraControl.refs.yaw.current,
          pitch: cameraControl.refs.pitch.current,
          heroId: localPlayer.heroId as HeroId,
          localPlayer: {
            id: localPlayer.id,
            team: localPlayer.team,
            position: localPlayer.position,
            ultimateCharge: localPlayer.ultimateCharge,
          },
          inputState,
          dt: 0,
          isGrounded: movement.refs.isGrounded.current,
        };
        hookshotAbilities.executeGrappleTrap(ctx, updateLocalPlayer);
        setGrappleTrapTargeting(false);
      }
    }
  }, [
    isPointerLocked, requestPointerLock, shadowStepTargeting, bombTargeting, airStrikeTargeting, grappleTrapTargeting,
    phantomAbilities, blazeAbilities, hookshotAbilities, playerSounds, abilitySystem, movement,
    cameraControl, sendInput, updateLocalPlayer, camera, inputState, setGrappleTrapTargeting,
  ]);

  // Canvas click listener
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', handleClick);
      return () => canvas.removeEventListener('click', handleClick);
    }
  }, [handleClick]);

  // Cancel targeting on right-click or Escape
  useEffect(() => {
    const handleCancel = (e: MouseEvent | KeyboardEvent) => {
      const store = useGameStore.getState();
      const isShadowStepTargeting = store.shadowStepTargeting;
      const isBombTargeting = store.bombTargeting;
      const isAirStrikeTargeting = store.airStrikeTargeting;
      const isGrappleTrapTargeting = store.grappleTrapTargeting;

      if (!isShadowStepTargeting && !isBombTargeting && !isAirStrikeTargeting && !isGrappleTrapTargeting) return;

      if ((e instanceof MouseEvent && e.button === 2) || (e instanceof KeyboardEvent && e.code === 'Escape')) {
        e.preventDefault();

        if (isShadowStepTargeting) {
          store.setShadowStepTargeting(false, false);
          phantomAbilities.shadowStepTargetRef.current = null;
          phantomAbilities.shadowStepValidRef.current = false;
          phantomAbilities.teleportingRef.current = false;
        }
        if (isBombTargeting) {
          store.setBombTargeting(false, false);
          blazeAbilities.bombTargetRef.current = null;
          blazeAbilities.bombValidRef.current = false;
        }
        if (isAirStrikeTargeting) {
          store.setAirStrikeTargeting(false, false);
          blazeAbilities.airStrikeTargetRef.current = null;
          blazeAbilities.airStrikeValidRef.current = false;
        }
        if (isGrappleTrapTargeting) {
          store.setGrappleTrapTargeting(false, false);
          hookshotAbilities.grappleTrapTargetRef.current = null;
          hookshotAbilities.grappleTrapValidRef.current = false;
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const store = useGameStore.getState();
      if (store.shadowStepTargeting || store.bombTargeting || store.airStrikeTargeting || store.grappleTrapTargeting) {
        e.preventDefault();
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
  }, [phantomAbilities, blazeAbilities, hookshotAbilities]);

  // Main game loop
  useFrame((_, delta) => {
    const localPlayer = useGameStore.getState().localPlayer;
    const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';

    if (!localPlayer) return;

    // Keep camera at player position even when not pointer locked
    if (!isPointerLocked) {
      camera.position.set(localPlayer.position.x, localPlayer.position.y + EYE_HEIGHT, localPlayer.position.z);
      return;
    }

    if (!isPlaying) return;

    const dt = Math.min(delta, 0.1);
    const now = Date.now();

    // Get hero stats (cached)
    const heroId = localPlayer.heroId as HeroId;
    if (cachedHeroStatsRef.current.heroId !== heroId) {
      cachedHeroStatsRef.current.heroId = heroId;
      cachedHeroStatsRef.current.stats = getHeroStats(heroId);
    }
    const heroStats = cachedHeroStatsRef.current.stats!;

    // Calculate movement
    const movementMultiplier = shadowStepTargeting ? 0.3 : 1;
    const moveDirection = movement.calculateMoveDirection(inputState, cameraControl.refs.yaw.current);

    // Update slide state
    const { isSliding, speed: modifiedSpeed } = movement.updateSlideState(
      inputState,
      movement.refs.isGrounded.current,
      cameraControl.refs.yaw.current,
      heroStats.moveSpeed * movementMultiplier,
      localPlayer.team,
      dt,
      movementSounds
    );

    // Apply ability speed boosts
    const { speedMultiplier } = abilitySystem.updateActiveAbilities(dt);
    const finalSpeed = modifiedSpeed * speedMultiplier;

    // Apply movement physics
    movement.applyMovement(
      movement.refs.velocity.current,
      moveDirection,
      finalSpeed,
      movement.refs.isGrounded.current,
      isSliding,
      dt
    );

    // Position from store
    const position = positionRef.current;
    position.set(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z);
    const velocity = movement.refs.velocity.current;

    // Create ability context
    const abilityCtx = {
      position,
      velocity,
      yaw: cameraControl.refs.yaw.current,
      pitch: cameraControl.refs.pitch.current,
      heroId,
      localPlayer: {
        id: localPlayer.id,
        team: localPlayer.team,
        position: localPlayer.position,
        ultimateCharge: localPlayer.ultimateCharge,
      },
      inputState,
      dt,
      isGrounded: movement.refs.isGrounded.current,
    };

    // Handle hero-specific abilities
    const heroDef = HERO_DEFINITIONS[heroId];
    if (heroDef) {
      // Handle ability input
      if (heroId !== 'blaze' && heroId !== 'glacier') {
        if (inputState.ability1 && !abilitySystem.abilityPressedRef.current.ability1) {
          if (!shadowStepTargeting && !grappleTrapTargeting && abilitySystem.canUseAbility(heroDef.ability1.abilityId, false, shadowStepTargeting)) {
            if (heroId === 'phantom') {
              phantomAbilities.executeBlink(abilityCtx, playerSounds, abilitySystem.useAbilityCharge);
            } else if (heroId === 'hookshot') {
              hookshotAbilities.executeGrapple(abilityCtx);
            }
          }
        }
        abilitySystem.abilityPressedRef.current.ability1 = inputState.ability1;
      }

      // Ability 2 (Q)
      if (inputState.ability2 && !abilitySystem.abilityPressedRef.current.ability2) {
        if (heroId === 'phantom' && shadowStepTargeting) {
          if (phantomAbilities.shadowStepValidRef.current && phantomAbilities.shadowStepTargetRef.current) {
            phantomAbilities.executeShadowStepTeleport(
              abilityCtx, playerSounds, abilitySystem.startClientCooldown, sendInput, updateLocalPlayer, camera
            );
          }
        } else if (abilitySystem.canUseAbility(heroDef.ability2.abilityId, false, shadowStepTargeting)) {
          if (heroId === 'phantom') {
            setShadowStepTargeting(true);
          } else if (heroId === 'blaze') {
            // Blaze Q is Rocket Jump
            blazeAbilities.executeRocketJump(abilityCtx, playerSounds);
            abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
          } else if (heroId === 'glacier') {
            glacierAbilities.executeIceSlide(abilityCtx, abilitySystem.setAbilityActive);
            abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
          } else if (heroId === 'hookshot') {
            hookshotAbilities.executeEarthWall(abilityCtx);
            abilitySystem.startClientCooldown(heroDef.ability2.abilityId);
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ability2 = inputState.ability2;

      // Ultimate (F)
      if (inputState.ultimate && !abilitySystem.abilityPressedRef.current.ultimate) {
        if (!shadowStepTargeting && abilitySystem.canUseAbility(heroDef.ultimate.abilityId, true, shadowStepTargeting)) {
          if (heroId === 'phantom') {
            phantomAbilities.executePhantomVeil(abilityCtx, playerSounds, updateLocalPlayer, abilitySystem.setAbilityActive);
          } else if (heroId === 'blaze') {
            setAirStrikeTargeting(true);
          } else if (heroId === 'glacier') {
            glacierAbilities.executeFrostStormShield(abilitySystem.setAbilityActive);
          } else if (heroId === 'hookshot') {
            hookshotAbilities.executeGrappleTrap(abilityCtx, updateLocalPlayer);
          }
        }
      }
      abilitySystem.abilityPressedRef.current.ultimate = inputState.ultimate;

      // Hero-specific primary/secondary fire and hold abilities
      if (heroId === 'phantom' && !shadowStepTargeting) {
        if (inputState.primaryFire) {
          phantomAbilities.fireDireBall(abilityCtx, playerSounds);
        }
        phantomAbilities.handleVoidRay(abilityCtx, playerSounds);
      }

      if (heroId === 'blaze') {
        if (inputState.primaryFire && !bombTargeting) {
          blazeAbilities.fireRocket(abilityCtx, playerSounds);
        }
        blazeAbilities.handleBombTargeting(abilityCtx, playerSounds);
        blazeAbilities.handleJetpack(abilityCtx, playerSounds, setJetpackActive, setJetpackFuel);
      }

      if (heroId === 'glacier') {
        glacierAbilities.handleIceMalletSwing(abilityCtx);
        glacierAbilities.handleIceShield(abilityCtx);
        glacierAbilities.handleIceWallRush(
          abilityCtx,
          movement.refs.smoothedY,
          setIceWallRushActive,
          setIceWallRushFuel,
          addIceWallRush,
          updateIceWallRush
        );
      }

      if (heroId === 'hookshot' && !grappleTrapTargeting) {
        if (inputState.primaryFire) {
          hookshotAbilities.fireChainHook(abilityCtx);
        }
        if (inputState.secondaryFire && !hookshotAbilities.secondaryFirePressedRef.current) {
          hookshotAbilities.fireDragHook(abilityCtx);
        }
        hookshotAbilities.secondaryFirePressedRef.current = inputState.secondaryFire;

        // Update grapple and swing physics
        hookshotAbilities.updateGrapplePhysics(abilityCtx);
        hookshotAbilities.updateSwingPhysics(abilityCtx);
      }
    }

    // Ground check
    const groundResult = physics.checkGround(
      position,
      velocity,
      movement.refs.smoothedY.current,
      movement.refs.wasGrounded.current,
      dt
    );

    movement.refs.isGrounded.current = groundResult.isGrounded;
    movement.refs.canJump.current = groundResult.canJump;
    if (groundResult.newSmoothedY !== null) {
      movement.refs.smoothedY.current = groundResult.newSmoothedY;
    }

    // Handle landing (bunny hop speed retention)
    const justLanded = movement.refs.isGrounded.current && !movement.refs.wasGrounded.current;
    movement.handleLanding(velocity, movement.refs.wasGrounded.current, movement.refs.isGrounded.current);
    movement.refs.wasGrounded.current = movement.refs.isGrounded.current;

    // Jump
    if (inputState.jump && movement.refs.canJump.current && movement.refs.isGrounded.current && !shadowStepTargeting) {
      velocity.y = heroStats.jumpForce;
      movement.refs.canJump.current = false;
      movement.refs.isGrounded.current = false;
    }

    // Gravity (reduced during grapple, skipped during swing)
    physics.applyGravity(
      velocity,
      hookshotAbilities.isGrapplingRef.current,
      hookshotAbilities.isSwingingRef.current,
      dt
    );

    // Horizontal movement with step-up
    const { didStepUp, newSmoothedY } = physics.applyHorizontalMovement(
      position,
      velocity,
      movement.refs.isGrounded.current,
      movement.refs.smoothedY.current,
      glacierAbilities.iceWallRushActiveRef.current,
      dt
    );

    if (newSmoothedY !== null) {
      movement.refs.smoothedY.current = newSmoothedY;
    }

    // Vertical movement (skip if stepped up)
    if (!didStepUp) {
      position.y += velocity.y * dt;
    }

    // Out of bounds check
    physics.checkOutOfBounds(position, velocity, movement.refs.isGrounded.current);

    // Map boundary constraint
    physics.constrainToMapBoundary(position, { x: localPlayer.position.x, z: localPlayer.position.z });

    // Update walking sound
    const walkingSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    updateWalkingSound(walkingSpeed, movement.refs.isGrounded.current, isSliding, heroStats.moveSpeed, justLanded);

    // Update camera
    cameraControl.updateCameraRotation(camera, isSliding, movement.refs.isCrouching.current, dt);
    camera.position.set(position.x, position.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, position.z);

    // Update store
    updateLocalPlayer({
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      lookYaw: cameraControl.refs.yaw.current,
      lookPitch: cameraControl.refs.pitch.current,
      movement: {
        ...localPlayer.movement,
        isGrounded: movement.refs.isGrounded.current,
        isSprinting: movement.refs.isSprinting.current,
        isCrouching: movement.refs.isCrouching.current,
        isSliding,
        slideTimeRemaining: movement.refs.slideTime.current,
      },
    });

    // Update slide intensity
    useGameStore.getState().setSlideIntensity(movement.getSlideIntensity());

    // Send input to server
    tickRef.current++;
    if (now - lastSendRef.current >= 1000 / TICK_RATE) {
      lastSendRef.current = now;
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
        ability2: currentTargeting ? false : inputState.ability2,
        ultimate: inputState.ultimate,
        interact: inputState.interact,
        lookYaw: cameraControl.refs.yaw.current,
        lookPitch: cameraControl.refs.pitch.current,
        timestamp: now,
        position: { x: position.x, y: position.y, z: position.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      });
    }
  });

  // Render targeting indicators
  return (
    <>
      <ShadowStepIndicator
        isActive={shadowStepTargeting}
        onTargetUpdate={phantomAbilities.handleShadowStepTargetUpdate}
      />
      <BombTargetingIndicator
        isActive={bombTargeting}
        onTargetUpdate={blazeAbilities.handleBombTargetUpdate}
      />
      <AirStrikeTargetingIndicator
        isActive={airStrikeTargeting}
        onTargetUpdate={blazeAbilities.handleAirStrikeTargetUpdate}
      />
      <GrappleTrapTargetingIndicator
        isActive={grappleTrapTargeting}
        onTargetUpdate={hookshotAbilities.handleGrappleTrapTargetUpdate}
      />
    </>
  );
}
