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
import { visualStore, setPlayerVisualPosition, setPlayerVisualRotation } from '../../store/visualStore';
import { useInput } from '../../hooks/useInput';
import { usePhysics, isPhysicsReady } from '../../hooks/usePhysics';
import { useNetwork } from '../../contexts/NetworkContext';
import { useAbilitySounds, useMovementSounds } from '../../hooks/useAudio';
import { isDevFlyMode } from '../ui/GameConsole';
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
  PLAYER_CROUCH_HEIGHT,
  EYE_HEIGHT,
} from '../../hooks/player';
import {
  CROUCH_MULTIPLIER,
  TICK_RATE,
  createEmptyInputState,
  getHeroStats,
  HERO_DEFINITIONS,
  type HeroId,
} from '@voxel-strike/shared';

// Component imports for targeting indicators
import { BombTargetingIndicator, AirStrikeTargetingIndicator } from './BlazeEffects';
import { GrappleTrapTargetingIndicator } from './HookshotEffects';
import { ShadowStepIndicator } from './phantom';

const INACTIVE_INPUT_STATE = createEmptyInputState();
const DEV_FLY_SPEED = 14;
const DEV_FLY_FAST_MULTIPLIER = 1.8;
const DEV_FLY_VERTICAL_SPEED = 10;

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
  const setFlamethrowerActive = useGameStore(state => state.setFlamethrowerActive);
  const setFlamethrowerFuel = useGameStore(state => state.setFlamethrowerFuel);
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
  const { inputState, isPointerLocked, isControlPressed, requestPointerLock } = useInput();
  const { world, playerBody } = usePhysics();
  const { sendInput } = useNetwork();

  // Audio hooks
  const {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startFlamethrowerSound, stopFlamethrowerSound,
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
  const lastHeroIdRef = useRef<string | null>(null);
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
      // Trust the server's spawn position - it uses configured map positions
      const startY = localPlayerForInit.position.y;
      camera.position.set(localPlayerForInit.position.x, startY + EYE_HEIGHT, localPlayerForInit.position.z);

      initializedRef.current = true;
    }
  }, [localPlayerForInit, camera]);

  // Create sound objects for passing to ability hooks
  const playerSounds = {
    playPhantomBlink, playPhantomShadowStep, playPhantomVeil, playPhantomBasic, playPhantomVoidRay,
    playBlazeRocket, playBlazeBombTarget, playBlazeBombExplode, playBlazeRocketJump, playBlazeAirstrike,
    startFlamethrowerSound, stopFlamethrowerSound,
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

    if (lastHeroIdRef.current !== localPlayer.heroId) {
      lastHeroIdRef.current = localPlayer.heroId;
      abilitySystem.abilityPressedRef.current = { ability1: false, ability2: false, ultimate: false };
      abilitySystem.clientCooldownsRef.current = {};
      abilitySystem.clientChargesRef.current = {};
      abilitySystem.abilityActiveRef.current = {};
      hookshotAbilities.secondaryFirePressedRef.current = false;
      setShadowStepTargeting(false, false);
      setBombTargeting(false, false);
      setAirStrikeTargeting(false, false);
      setGrappleTrapTargeting(false, false);
      setFlamethrowerActive(false);
      setIceWallRushActive(false);
      stopFlamethrowerSound();
    }

    const dt = Math.min(delta, 0.1);
    const now = Date.now();
    // ESC/menu releases pointer lock, but local physics still needs to keep
    // grounding and server position sync alive instead of replaying stale input.
    const frameInput = isPointerLocked ? inputState : INACTIVE_INPUT_STATE;
    const devFlyMode = isDevFlyMode();

    if (!isPlaying || localPlayer.state !== 'alive') {
      const visualPos = visualStore.getState().playerPositions.get(localPlayer.id) || localPlayer.position;
      cameraControl.updateCameraRotation(camera, false, false, dt);
      camera.position.set(visualPos.x, visualPos.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, visualPos.z);
      setPlayerVisualPosition(localPlayer.id, visualPos);
      setPlayerVisualRotation(localPlayer.id, cameraControl.refs.yaw.current);
      return;
    }

    if (devFlyMode) {
      const position = positionRef.current;
      const visualPos = visualStore.getState().playerPositions.get(localPlayer.id);
      if (visualPos) {
        position.set(visualPos.x, visualPos.y, visualPos.z);
      } else {
        position.set(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z);
      }

      const moveDirection = movement.calculateMoveDirection(frameInput, cameraControl.refs.yaw.current);
      const flySpeed = DEV_FLY_SPEED * (frameInput.sprint ? DEV_FLY_FAST_MULTIPLIER : 1);
      const verticalInput = (frameInput.jump ? 1 : 0) - (frameInput.crouch || isControlPressed ? 1 : 0);
      const velocity = movement.refs.velocity.current;

      velocity.set(
        moveDirection.x * flySpeed,
        verticalInput * DEV_FLY_VERTICAL_SPEED,
        moveDirection.z * flySpeed
      );
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      position.z += velocity.z * dt;

      movement.refs.isGrounded.current = false;
      movement.refs.wasGrounded.current = false;
      movement.refs.canJump.current = false;
      movement.refs.isSliding.current = false;
      movement.refs.slideTime.current = 0;
      movement.refs.smoothedY.current = null;

      abilitySystem.abilityPressedRef.current.ability1 = frameInput.ability1;
      abilitySystem.abilityPressedRef.current.ability2 = frameInput.ability2;
      abilitySystem.abilityPressedRef.current.ultimate = frameInput.ultimate;
      abilitySystem.abilityActiveRef.current = {};
      hookshotAbilities.secondaryFirePressedRef.current = frameInput.secondaryFire;

      cameraControl.updateCameraRotation(camera, false, false, dt);
      camera.position.set(position.x, position.y + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, position.z);

      updateLocalPlayer({
        movement: {
          ...localPlayer.movement,
          isGrounded: false,
          isSprinting: frameInput.sprint,
          isCrouching: frameInput.crouch || isControlPressed,
          isSliding: false,
          slideTimeRemaining: 0,
          isGrappling: false,
          grapplePoint: null,
          isJetpacking: false,
          isGliding: false,
        },
      });

      setPlayerVisualPosition(localPlayer.id, { x: position.x, y: position.y, z: position.z });
      setPlayerVisualRotation(localPlayer.id, cameraControl.refs.yaw.current);
      useGameStore.getState().setSlideIntensity(0);
      updateWalkingSound(0, false, false, DEV_FLY_SPEED, false);

      tickRef.current++;
      if (now - lastSendRef.current >= 1000 / TICK_RATE) {
        lastSendRef.current = now;
        sendInput({
          tick: tickRef.current,
          moveForward: frameInput.moveForward,
          moveBackward: frameInput.moveBackward,
          moveLeft: frameInput.moveLeft,
          moveRight: frameInput.moveRight,
          jump: frameInput.jump,
          crouch: frameInput.crouch || isControlPressed,
          sprint: frameInput.sprint,
          primaryFire: false,
          secondaryFire: false,
          ability1: false,
          ability2: false,
          ultimate: false,
          interact: frameInput.interact,
          lookYaw: cameraControl.refs.yaw.current,
          lookPitch: cameraControl.refs.pitch.current,
          timestamp: now,
          position: { x: position.x, y: position.y, z: position.z },
          velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
          devFly: true,
        });
      }
      return;
    }

    // Get hero stats (cached)
    const heroId = localPlayer.heroId as HeroId;
    if (cachedHeroStatsRef.current.heroId !== heroId) {
      cachedHeroStatsRef.current.heroId = heroId;
      cachedHeroStatsRef.current.stats = getHeroStats(heroId);
    }
    const heroStats = cachedHeroStatsRef.current.stats!;

    // Position from visualStore (client-predicted) with fallback to gameStore (server spawn)
    const position = positionRef.current;
    const visualPos = visualStore.getState().playerPositions.get(localPlayer.id);
    if (visualPos) {
      position.set(visualPos.x, visualPos.y, visualPos.z);
    } else {
      // First frame - use server position
      position.set(localPlayer.position.x, localPlayer.position.y, localPlayer.position.z);
    }
    const velocity = movement.refs.velocity.current;
    if (
      movement.refs.smoothedY.current !== null &&
      Math.abs(position.y - movement.refs.smoothedY.current) > 1.5
    ) {
      movement.refs.smoothedY.current = null;
      movement.refs.wasGrounded.current = false;
      movement.refs.isGrounded.current = false;
      movement.refs.canJump.current = false;
    }

    const movementMultiplier = shadowStepTargeting ? 0.3 : 1;
    const moveDirection = movement.calculateMoveDirection(frameInput, cameraControl.refs.yaw.current);

    // Update slide state
    let { isSliding, speed: modifiedSpeed } = movement.updateSlideState(
      frameInput,
      movement.refs.isGrounded.current,
      cameraControl.refs.yaw.current,
      heroStats.moveSpeed * movementMultiplier,
      localPlayer.team,
      dt,
      movementSounds
    );

    if (!isSliding && !movement.refs.isCrouching.current && !physics.canStandAtPosition(position)) {
      movement.refs.isCrouching.current = true;
      movement.refs.isSprinting.current = false;
      modifiedSpeed = heroStats.moveSpeed * movementMultiplier * CROUCH_MULTIPLIER;
    }
    const playerBodyHeight = (isSliding || movement.refs.isCrouching.current)
      ? PLAYER_CROUCH_HEIGHT
      : PLAYER_HEIGHT;

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
      inputState: frameInput,
      dt,
      isGrounded: movement.refs.isGrounded.current,
    };

    // Handle hero-specific abilities
    const heroDef = HERO_DEFINITIONS[heroId];
    if (heroDef) {
      // Handle ability input
      if (heroId !== 'blaze' && heroId !== 'glacier') {
        if (frameInput.ability1 && !abilitySystem.abilityPressedRef.current.ability1) {
          if (!shadowStepTargeting && !grappleTrapTargeting && abilitySystem.canUseAbility(heroDef.ability1.abilityId, false, shadowStepTargeting)) {
            if (heroId === 'phantom') {
              phantomAbilities.executeBlink(abilityCtx, playerSounds, abilitySystem.useAbilityCharge);
            } else if (heroId === 'hookshot') {
              if (hookshotAbilities.executeGrapple(abilityCtx)) {
                abilitySystem.startClientCooldown(heroDef.ability1.abilityId);
              }
            }
          }
        }
        abilitySystem.abilityPressedRef.current.ability1 = frameInput.ability1;
      }

      // Ability 2 (Q)
      if (frameInput.ability2 && !abilitySystem.abilityPressedRef.current.ability2) {
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
      abilitySystem.abilityPressedRef.current.ability2 = frameInput.ability2;

      // Ultimate (F)
      if (frameInput.ultimate && !abilitySystem.abilityPressedRef.current.ultimate) {
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
      abilitySystem.abilityPressedRef.current.ultimate = frameInput.ultimate;

      // Hero-specific primary/secondary fire and hold abilities
      if (heroId === 'phantom' && !shadowStepTargeting) {
        if (frameInput.primaryFire) {
          phantomAbilities.fireDireBall(abilityCtx, playerSounds);
        }
        phantomAbilities.handleVoidRay(abilityCtx, playerSounds);
      }

      if (heroId === 'blaze') {
        if (frameInput.primaryFire && !bombTargeting) {
          blazeAbilities.fireRocket(abilityCtx, playerSounds);
        }
        blazeAbilities.handleBombTargeting(abilityCtx, playerSounds);
        blazeAbilities.handleFlamethrower(
          abilityCtx,
          playerSounds,
          setFlamethrowerActive,
          setFlamethrowerFuel
        );
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
        if (frameInput.primaryFire) {
          hookshotAbilities.fireChainHook(abilityCtx);
        }
        if (frameInput.secondaryFire && !hookshotAbilities.secondaryFirePressedRef.current) {
          hookshotAbilities.fireDragHook(abilityCtx);
        }
        hookshotAbilities.secondaryFirePressedRef.current = frameInput.secondaryFire;

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
    if (heroId === 'hookshot' && (groundResult.isGrounded || groundResult.newSmoothedY !== null)) {
      hookshotAbilities.handleSwingTerrainContact();
    }

    // Reset smoothedY when becoming airborne to prevent bounce-on-land from height
    // Without this, smoothedY retains the old ground level, causing the player to be
    // "pulled up" toward the old height when landing at a lower elevation
    const justBecameAirborne = !movement.refs.isGrounded.current && movement.refs.wasGrounded.current;
    if (justBecameAirborne) {
      movement.refs.smoothedY.current = null;
    }

    // Handle landing (bunny hop speed retention)
    const justLanded = movement.refs.isGrounded.current && !movement.refs.wasGrounded.current;
    movement.handleLanding(velocity, movement.refs.wasGrounded.current, movement.refs.isGrounded.current);
    movement.refs.wasGrounded.current = movement.refs.isGrounded.current;

    const willJumpThisFrame = frameInput.jump && movement.refs.canJump.current && movement.refs.isGrounded.current && !shadowStepTargeting;

    // Horizontal movement with step-up
    const { didFollowTerrain, newSmoothedY, hitTerrain } = physics.applyHorizontalMovement(
      position,
      velocity,
      movement.refs.isGrounded.current,
      movement.refs.smoothedY.current,
      glacierAbilities.iceWallRushActiveRef.current,
      dt,
      playerBodyHeight,
      willJumpThisFrame
    );

    if (newSmoothedY !== null) {
      movement.refs.smoothedY.current = newSmoothedY;
    }
    if (heroId === 'hookshot' && hitTerrain) {
      hookshotAbilities.handleSwingTerrainContact();
    }

    let didJumpThisFrame = false;
    if (willJumpThisFrame) {
      velocity.y = heroStats.jumpForce;
      movement.refs.canJump.current = false;
      movement.refs.isGrounded.current = false;
      movement.refs.wasGrounded.current = false;
      movement.refs.smoothedY.current = null;
      didJumpThisFrame = true;
    }

    // Gravity (reduced during grapple, skipped during swing, skipped when grounded)
    physics.applyGravity(
      velocity,
      movement.refs.isGrounded.current,
      hookshotAbilities.isGrapplingRef.current,
      hookshotAbilities.isSwingingRef.current,
      dt
    );

    // Vertical movement (skip when terrain following already placed the body)
    if (!didFollowTerrain || didJumpThisFrame) {
      const { hitCeiling } = physics.applyVerticalMovement(position, velocity, dt, playerBodyHeight);
      if (hitCeiling && heroId === 'hookshot') {
        hookshotAbilities.handleSwingTerrainContact();
      }
    }

    // Out of bounds check
    physics.checkOutOfBounds(position, velocity, movement.refs.isGrounded.current);

    // Map boundary constraint - use visualPos (frame start position) as previous
    const prevPos = visualPos || localPlayer.position;
    physics.constrainToMapBoundary(position, { x: prevPos.x, z: prevPos.z });

    // Update walking sound
    const walkingSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    updateWalkingSound(walkingSpeed, movement.refs.isGrounded.current, isSliding, heroStats.moveSpeed, justLanded);

    // Update camera
    cameraControl.updateCameraRotation(camera, isSliding, movement.refs.isCrouching.current, dt);
    const cameraBodyY = movement.refs.smoothedY.current ?? position.y;
    camera.position.set(position.x, cameraBodyY + EYE_HEIGHT + cameraControl.refs.crouchHeight.current, position.z);

    // Update game store with movement state ONLY (position/rotation go to visualStore below)
    // Position/velocity/rotation data flows ONLY to visualStore (non-reactive) to avoid React re-renders
    // Game state tracks only game events: movement flags, abilities, damage, etc.
    updateLocalPlayer({
      movement: {
        ...localPlayer.movement,
        isGrounded: movement.refs.isGrounded.current,
        isSprinting: movement.refs.isSprinting.current,
        isCrouching: movement.refs.isCrouching.current,
        isSliding,
        slideTimeRemaining: movement.refs.slideTime.current,
      },
    });

    // Update visual store for non-reactive position access
    setPlayerVisualPosition(localPlayer.id, { x: position.x, y: position.y, z: position.z });
    setPlayerVisualRotation(localPlayer.id, cameraControl.refs.yaw.current);

    // Update slide intensity
    useGameStore.getState().setSlideIntensity(movement.getSlideIntensity());

    // Send input to server
    tickRef.current++;
    if (now - lastSendRef.current >= 1000 / TICK_RATE) {
      lastSendRef.current = now;
      const currentTargeting = useGameStore.getState().shadowStepTargeting;

      sendInput({
        tick: tickRef.current,
        moveForward: frameInput.moveForward,
        moveBackward: frameInput.moveBackward,
        moveLeft: frameInput.moveLeft,
        moveRight: frameInput.moveRight,
        jump: frameInput.jump,
        crouch: frameInput.crouch || movement.refs.isCrouching.current,
        sprint: frameInput.sprint,
        primaryFire: frameInput.primaryFire,
        secondaryFire: frameInput.secondaryFire,
        ability1: frameInput.ability1,
        ability2: currentTargeting ? false : frameInput.ability2,
        ultimate: frameInput.ultimate,
        interact: frameInput.interact,
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
