import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import {
  getPlayerVisualLookPitch,
  sampleRemoteTransformInto,
  useVisualStore,
  type SampledRemoteTransform,
  visualStore,
} from '../../store/visualStore';
import { useShallow } from 'zustand/shallow';
import type { Player, PlayerMovementState, Team, Vec3, VoxelMapTheme } from '@voxel-strike/shared';
import { HeroVoxelBody } from './HeroVoxelBody';
import type { HeroMovementPose, HeroWalkDirection } from './HeroVoxelBody';
import type { EffectQualityConfig, RemotePlayerQualityConfig } from './visualQuality';
import { RemoteHeroBatchRenderer } from './RemoteHeroBatchRenderer';
import { RemoteMovementEffects } from './RemoteMovementEffects';
import {
  getPlayerBodyPostureScaleY,
  getPlayerHeight,
  getVisiblePlayerHeight,
  hasLoweredPlayerPosture,
  NAMEPLATE_WORLD_OFFSET_Y,
  setPlayerRenderOrigin,
} from './playerWorldAnchors';
import { gameplayFrameScheduler } from './systems/gameplayFrameScheduler';

interface OtherPlayersProps {
  config: RemotePlayerQualityConfig;
  effectConfig: Pick<
    EffectQualityConfig,
    | 'maxActiveParticles'
    | 'maxRemoteMovementEffectDistance'
    | 'remoteMovementEffectDensityScale'
    | 'remoteMovementEffectBotDistanceScale'
  >;
  theme: VoxelMapTheme;
  hiddenPlayerId?: string | null;
}

export function OtherPlayers({ config, effectConfig, theme, hiddenPlayerId = null }: OtherPlayersProps) {
  // NOTE: This component subscribes to gameStore.players but does NOT re-render on
  // v2 transform position updates because remote player entries are mutated in-place.
  // The Map reference only changes when players are added/removed. Position interpolation
  // reads from visualStore in the frame scheduler (non-reactive, 60fps).
  const { players, playerId, localPlayerId, localPlayerTeam, gamePhase, gameplayMode, matchPerspective } = useGameStore(
    useShallow(state => ({
      players: state.players,
      playerId: state.playerId,
      localPlayerId: state.localPlayer?.id ?? null,
      localPlayerTeam: state.localPlayer?.team ?? null,
      gamePhase: state.gamePhase,
      gameplayMode: state.gameplayMode,
      matchPerspective: state.matchPerspective,
    }))
  );
  const firstPersonDropBodyVisibleUntilMs = useVisualStore(
    (state) => state.battleRoyalFirstPersonDropBodyVisibleUntilMs
  );
  const [dropBodyVisibilityNowMs, setDropBodyVisibilityNowMs] = useState(() => Date.now());
  const isBattleRoyal = gameplayMode === 'battle_royal';
  const showFirstPersonDropBody = matchPerspective === 'first_person' &&
    firstPersonDropBodyVisibleUntilMs > dropBodyVisibilityNowMs;
  const showLocalPlayerBody = matchPerspective === 'third_person' || showFirstPersonDropBody;
  const nameplateAnchorPosition = getNameplateAnchorPosition(localPlayerId ?? playerId, players);

  useEffect(() => {
    if (firstPersonDropBodyVisibleUntilMs <= 0) return;

    const delayMs = firstPersonDropBodyVisibleUntilMs - Date.now();
    if (delayMs <= 0) {
      setDropBodyVisibilityNowMs(Date.now());
      return;
    }

    const timeout = window.setTimeout(() => {
      setDropBodyVisibilityNowMs(Date.now());
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [firstPersonDropBodyVisibleUntilMs]);

  const { otherPlayers, remoteBatchResourcePlayers } = useMemo(() => {
    const nextPlayers: Player[] = [];
    const nextResourcePlayers: Player[] = [];
    const hideDeadPlayers = gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'deployment';

    for (const player of players.values()) {
      if (player.id === hiddenPlayerId) continue;
      if (player.role === 'observer') continue;
      const isLocalPlayer = player.id === playerId || player.id === localPlayerId;
      if (isLocalPlayer && !showLocalPlayerBody) continue;
      if (hideDeadPlayers && player.state === 'dead') continue;
      if (isBattleRoyal && gamePhase === 'countdown' && player.state === 'spawning') continue;
      if (player.state === 'dropping' && !(isLocalPlayer && showFirstPersonDropBody)) continue;

      const isHiddenFromRemoteRender = player.visibility === 'hidden' ||
        player.visibility === 'last_known' ||
        player.visibility === 'audible';

      if (isBattleRoyal) {
        nextResourcePlayers.push(player);
        if (!isHiddenFromRemoteRender) nextPlayers.push(player);
      } else if (!isHiddenFromRemoteRender) {
        nextPlayers.push(player);
      }
    }

    return {
      otherPlayers: nextPlayers,
      remoteBatchResourcePlayers: isBattleRoyal ? nextResourcePlayers : nextPlayers,
    };
  }, [gamePhase, hiddenPlayerId, isBattleRoyal, localPlayerId, playerId, players, showFirstPersonDropBody, showLocalPlayerBody]);

  useEffect(() => {
    for (const player of otherPlayers) {
      if (player.id === playerId || player.id === localPlayerId) continue;
      const statusPlateMode = getRemoteStatusPlateMode(
        player,
        config,
        isBattleRoyal,
        localPlayerTeam,
        nameplateAnchorPosition
      );
      if (!statusPlateMode) continue;
      prewarmStatusPlateTexture(
        statusPlateMode,
        player.name,
        getStatusPlateHealth(player, statusPlateMode),
        getStatusPlateMaxHealth(player, statusPlateMode)
      );
    }
  }, [config.showNameplates, config.nameplateDistance, isBattleRoyal, localPlayerId, localPlayerTeam, nameplateAnchorPosition, otherPlayers, playerId]);

  return (
    <group>
      <RemoteHeroBatchRenderer
        players={otherPlayers}
        resourcePlayers={remoteBatchResourcePlayers}
        isBattleRoyal={isBattleRoyal}
        localPlayerId={showLocalPlayerBody ? (localPlayerId ?? playerId) : null}
        localPlayerTeam={localPlayerTeam}
        config={config}
      />
      <RemoteMovementEffects players={otherPlayers} theme={theme} config={effectConfig} />
      {otherPlayers.map((player) => {
        const statusPlateMode = player.id !== playerId
          && player.id !== localPlayerId
          ? getRemoteStatusPlateMode(player, config, isBattleRoyal, localPlayerTeam, nameplateAnchorPosition)
          : null;
        const showFlagIndicator = !isBattleRoyal && player.hasFlag;
        return shouldRenderRemotePlayerFallback(player, statusPlateMode, showFlagIndicator) ? (
          <OtherPlayer
            key={player.id}
            player={player}
            localPlayerId={showLocalPlayerBody ? (localPlayerId ?? playerId) : null}
            statusPlateMode={statusPlateMode}
            showFlagIndicator={showFlagIndicator}
          />
        ) : null;
      })}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
  localPlayerId?: string | null;
  statusPlateMode: RemoteStatusPlateMode | null;
  showFlagIndicator: boolean;
}

const NETWORK_MOVING_SPEED = 0.45;
const VISUAL_MOVING_SPEED = 0.18;
const AIRBORNE_IDLE_VERTICAL_SPEED = 0.2;
const REMOTE_SAMPLE_POSITION_SMOOTHING = 28;
const REMOTE_SAMPLE_ROTATION_SMOOTHING = 32;
const REMOTE_SAMPLE_SNAP_DISTANCE = 3.5;
const REMOTE_SAMPLE_SNAP_DISTANCE_SQ = REMOTE_SAMPLE_SNAP_DISTANCE * REMOTE_SAMPLE_SNAP_DISTANCE;
const REMOTE_ATTACK_STATE_RETENTION_MS = 3200;
const REMOTE_ATTACK_STATE_CLEANUP_MS = 5000;
const PHANTOM_VEIL_ABILITY_ID = 'phantom_veil';
const PHANTOM_VEIL_BODY_OPACITY = 0.12;
const PHANTOM_VEIL_OPACITY_DAMP_RATE = 12;
const BATTLE_ROYAL_TEAMMATE_NAMEPLATE_MIN_DISTANCE = 180;

function getHorizontalSpeed(velocity: { x: number; z: number }): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function smoothingFactor(rate: number, delta: number): number {
  return Math.max(0, Math.min(1, 1 - Math.exp(-rate * delta)));
}

function lerpAngle(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2;
  const delta = ((b - a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return a + delta * t;
}

function setWalkDirectionFromVelocity(
  target: HeroWalkDirection,
  velocity: { x: number; z: number },
  yaw: number
): void {
  setWalkDirectionFromComponents(target, velocity.x, velocity.z, yaw);
}

function setWalkDirectionFromComponents(
  target: HeroWalkDirection,
  velocityX: number,
  velocityZ: number,
  yaw: number
): void {
  const speed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
  if (speed <= 0.001) {
    target.forward = 1;
    target.right = 0;
    return;
  }

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  target.forward = (velocityX * forwardX + velocityZ * forwardZ) / speed;
  target.right = (velocityX * rightX + velocityZ * rightZ) / speed;
}

function isPlayerMovingForAnimation(
  player: Player,
  visualHorizontalSpeed = 0,
  movement: PlayerMovementState = player.movement
): boolean {
  if (player.state !== 'alive' && player.state !== 'downed' && player.state !== 'dropping') return false;
  if (player.state === 'downed' && player.reviveByPlayerId) return false;

  const networkHorizontalSpeed = getHorizontalSpeed(player.velocity);

  return (
    networkHorizontalSpeed > NETWORK_MOVING_SPEED ||
    visualHorizontalSpeed > VISUAL_MOVING_SPEED ||
    movement.isSliding ||
    movement.isGrappling ||
    movement.isJetpacking ||
    movement.isGliding ||
    (!movement.isGrounded && Math.abs(player.velocity.y) > AIRBORNE_IDLE_VERTICAL_SPEED)
  );
}

function getPlayerMovementPose(
  player: Player,
  hasLoweredPosture: boolean,
  isMoving: boolean,
  movement: PlayerMovementState = player.movement
): HeroMovementPose {
  if (movement.isSliding) return 'run';
  if (hasLoweredPosture && isMoving) return 'crouchWalk';
  return movement.isSprinting ? 'run' : 'walk';
}

function hasActivePhantomVeil(player: Player): boolean {
  if (player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
  return Boolean(veil?.isActive);
}

function distanceSquared(a: Pick<Vec3, 'x' | 'y' | 'z'>, b: Pick<Vec3, 'x' | 'y' | 'z'>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function getNameplateAnchorPosition(
  localPlayerId: string | null,
  players: Map<string, Player>
): Vec3 | null {
  if (!localPlayerId) return null;
  return visualStore.getState().playerPositions.get(localPlayerId) ??
    players.get(localPlayerId)?.position ??
    null;
}

function isWithinNameplateDistance(
  player: Player,
  config: RemotePlayerQualityConfig,
  anchorPosition: Vec3 | null,
  minimumDistance = 0
): boolean {
  const distance = Math.max(config.nameplateDistance, minimumDistance);
  if (!Number.isFinite(distance)) return true;
  if (distance <= 0) return false;
  if (!anchorPosition) return true;
  return distanceSquared(player.position, anchorPosition) <= distance * distance;
}

export type RemoteStatusPlateMode = 'full' | 'fullTeam' | 'enemyHealth' | 'enemyDowned';

export function isEnemyRemotePlayer(
  player: Pick<Player, 'team'>,
  localPlayerTeam: Team | null
): boolean {
  return localPlayerTeam !== null && player.team !== localPlayerTeam;
}

export function shouldShowRemoteNameplate(
  player: Player,
  config: RemotePlayerQualityConfig,
  isBattleRoyal: boolean,
  localPlayerTeam: Team | null,
  anchorPosition: Vec3 | null
): boolean {
  if (isBattleRoyal) {
    return player.team === localPlayerTeam &&
      isWithinNameplateDistance(player, config, anchorPosition, BATTLE_ROYAL_TEAMMATE_NAMEPLATE_MIN_DISTANCE);
  }
  if (!config.showNameplates) return false;
  return isWithinNameplateDistance(player, config, anchorPosition);
}

export function getRemoteStatusPlateMode(
  player: Player,
  config: RemotePlayerQualityConfig,
  isBattleRoyal: boolean,
  localPlayerTeam: Team | null,
  anchorPosition: Vec3 | null
): RemoteStatusPlateMode | null {
  if (shouldShowRemoteNameplate(player, config, isBattleRoyal, localPlayerTeam, anchorPosition)) {
    return isBattleRoyal && player.team === localPlayerTeam ? 'fullTeam' : 'full';
  }
  if (isBattleRoyal && player.state === 'downed' && isEnemyRemotePlayer(player, localPlayerTeam)) {
    return 'enemyDowned';
  }
  return isEnemyRemotePlayer(player, localPlayerTeam) ? 'enemyHealth' : null;
}

function getStatusPlateHealth(player: Player, mode: RemoteStatusPlateMode): number {
  return mode === 'enemyDowned' ? player.downedHealth ?? player.health : player.health;
}

function getStatusPlateMaxHealth(player: Player, mode: RemoteStatusPlateMode): number {
  return mode === 'enemyDowned' ? player.downedMaxHealth ?? player.maxHealth : player.maxHealth;
}

function shouldRenderRemotePlayerFallback(
  player: Player,
  statusPlateMode: RemoteStatusPlateMode | null,
  showFlagIndicator: boolean
): boolean {
  return hasActivePhantomVeil(player) || showFlagIndicator || statusPlateMode !== null;
}

function getPlayerRenderMovement(
  player: Player,
  localPlayerId: string | null | undefined
): PlayerMovementState {
  return player.id === localPlayerId ? visualStore.getState().localMovement : player.movement;
}

const OtherPlayer = memo(function OtherPlayer({
  player,
  localPlayerId,
  statusPlateMode,
  showFlagIndicator,
}: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [isVeiled, setIsVeiled] = useState(() => hasActivePhantomVeil(player));
  const playerHeight = getPlayerHeight(player.heroId);
  const initialMovement = getPlayerRenderMovement(player, localPlayerId);
  const initialLookPitch = getPlayerVisualLookPitch(visualStore.getState(), player);
  const hasLoweredPosture = hasLoweredPlayerPosture(initialMovement, player.state);
  const visibleHeight = getVisiblePlayerHeight(player.heroId, initialMovement, player.state);
  const postureScaleY = getPlayerBodyPostureScaleY(initialMovement, player.state);
  const initialIsMoving = isPlayerMovingForAnimation(player, 0, initialMovement);
  const initialMovementPose = getPlayerMovementPose(player, hasLoweredPosture, initialIsMoving, initialMovement);
  const targetPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const currentPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const previousFramePosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const isMovingRef = useRef(initialIsMoving);
  const isCrouchingRef = useRef(initialMovement.isCrouching);
  const isSlidingRef = useRef(initialMovement.isSliding);
  const isDownedRef = useRef(player.state === 'downed');
  const isBeingRevivedRef = useRef(Boolean(player.reviveByPlayerId));
  const isAttackingRef = useRef(false);
  const attackStartedAtMsRef = useRef<number | null>(null);
  const attackSideRef = useRef<-1 | 1>(1);
  const movementPoseRef = useRef<HeroMovementPose>(initialMovementPose);
  const postureScaleYRef = useRef(postureScaleY);
  const bodyOpacityRef = useRef(isVeiled ? PHANTOM_VEIL_BODY_OPACITY : 1);
  const isVeiledRef = useRef(isVeiled);
  const lookPitchRef = useRef(initialLookPitch);
  const walkDirectionRef = useRef<HeroWalkDirection>({ forward: 1, right: 0 });
  const initializedRef = useRef(false);
  const remoteEpochRef = useRef<number | null>(null);
  const sampledTransformRef = useRef<SampledRemoteTransform>({
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  });
  // VISUAL_STORE_VERIFICATION: This component reads visualStore.getState() in the frame scheduler.
  // Verify with React DevTools profiler that OtherPlayers does NOT re-render when player positions update at 60fps.
  // Expected: OtherPlayers renders only when players Map changes (add/remove), not on position updates.
  useEffect(() => gameplayFrameScheduler.register({
    system: 'remotePlayers',
    label: 'frame.remotePlayers',
    callback: ({ deltaSeconds, nowMs }) => {
      if (!groupRef.current) return;
      const stepDelta = deltaSeconds;
      const frameNowMs = nowMs;

      const frameIsVeiled = hasActivePhantomVeil(player);
      if (frameIsVeiled !== isVeiledRef.current) {
        isVeiledRef.current = frameIsVeiled;
        setIsVeiled(frameIsVeiled);
      }
      bodyOpacityRef.current = THREE.MathUtils.damp(
        bodyOpacityRef.current,
        frameIsVeiled ? PHANTOM_VEIL_BODY_OPACITY : 1,
        PHANTOM_VEIL_OPACITY_DAMP_RATE,
        stepDelta
      );

      // Initialize position on first frame
      if (!initializedRef.current) {
        const visualState = visualStore.getState();
        const initialPos = visualState.playerPositions.get(player.id);
        setPlayerRenderOrigin(currentPosition.current, initialPos ?? player.position);
        groupRef.current.position.copy(currentPosition.current);
        initializedRef.current = true;
      }

      // Read from visualStore non-reactively (no re-renders)
      const visualState = visualStore.getState();
      if (!frameIsVeiled || player.heroId !== 'phantom') {
        const targetPos = visualState.renderedPlayerPositions.get(player.id) ??
          visualState.playerPositions.get(player.id);
        setPlayerRenderOrigin(currentPosition.current, targetPos ?? player.position);
        groupRef.current.position.copy(currentPosition.current);
        groupRef.current.rotation.y = visualState.renderedPlayerRotations.get(player.id) ??
          visualState.playerRotations.get(player.id) ??
          player.lookYaw;
        lookPitchRef.current = getPlayerVisualLookPitch(visualState, player);
        previousFramePosition.current.copy(currentPosition.current);
        return;
      }

      const sampledTransform = sampledTransformRef.current;
      const hasSampledTransform = sampleRemoteTransformInto(player.id, sampledTransform, frameNowMs);
      let snappedToSample = false;
      if (hasSampledTransform) {
        setPlayerRenderOrigin(targetPosition.current, sampledTransform.position);
        const epochChanged = remoteEpochRef.current !== null && remoteEpochRef.current !== sampledTransform.movementEpoch;
        const tooFarForSmoothing = currentPosition.current.distanceToSquared(targetPosition.current) >
          REMOTE_SAMPLE_SNAP_DISTANCE_SQ;
        if (epochChanged || tooFarForSmoothing) {
          currentPosition.current.copy(targetPosition.current);
          snappedToSample = true;
        } else {
          const samplePositionAlpha = smoothingFactor(REMOTE_SAMPLE_POSITION_SMOOTHING, stepDelta);
          currentPosition.current.lerp(targetPosition.current, samplePositionAlpha);
        }
        remoteEpochRef.current = sampledTransform.movementEpoch;
      } else {
        const targetPos = visualState.playerPositions.get(player.id);
        if (targetPos) {
          setPlayerRenderOrigin(targetPosition.current, targetPos);
        } else {
          // Fallback to prop position if visualStore doesn't have data yet
          setPlayerRenderOrigin(targetPosition.current, player.position);
        }
      }

      // Lerp current position toward target
      if (!hasSampledTransform) {
        currentPosition.current.lerp(targetPosition.current, Math.min(1, stepDelta * 15));
      }
      groupRef.current.position.copy(currentPosition.current);

      const visualDeltaX = currentPosition.current.x - previousFramePosition.current.x;
      const visualDeltaZ = currentPosition.current.z - previousFramePosition.current.z;
      // Read rotation from visualStore non-reactively
      const targetRot = visualState.playerRotations.get(player.id);
      const renderYaw = hasSampledTransform ? sampledTransform.lookYaw : targetRot ?? player.lookYaw;
      if (hasSampledTransform && !snappedToSample) {
        const sampleRotationAlpha = smoothingFactor(REMOTE_SAMPLE_ROTATION_SMOOTHING, stepDelta);
        groupRef.current.rotation.y = lerpAngle(
          groupRef.current.rotation.y,
          sampledTransform.lookYaw,
          sampleRotationAlpha
        );
      } else if (hasSampledTransform) {
        groupRef.current.rotation.y = sampledTransform.lookYaw;
      } else if (targetRot !== undefined) {
        groupRef.current.rotation.y = targetRot;
      } else {
        // Fallback to prop rotation if visualStore doesn't have data yet
        groupRef.current.rotation.y = player.lookYaw;
      }
      lookPitchRef.current = hasSampledTransform
        ? sampledTransform.lookPitch
        : getPlayerVisualLookPitch(visualState, player);

      previousFramePosition.current.copy(currentPosition.current);
      if (!frameIsVeiled || player.heroId !== 'phantom') return;

      const visualHorizontalSpeed = stepDelta > 0
        ? Math.sqrt(visualDeltaX * visualDeltaX + visualDeltaZ * visualDeltaZ) / stepDelta
        : 0;

      const remoteAttackState = visualState.remotePlayerAttackStates.get(player.id);
      if (remoteAttackState) {
        const attackAgeMs = frameNowMs - remoteAttackState.startedAtMs;
        isAttackingRef.current = attackAgeMs <= REMOTE_ATTACK_STATE_RETENTION_MS;
        attackStartedAtMsRef.current = remoteAttackState.startedAtMs;
        attackSideRef.current = remoteAttackState.side;

        if (attackAgeMs > REMOTE_ATTACK_STATE_CLEANUP_MS) {
          visualState.remotePlayerAttackStates.delete(player.id);
        }
      } else {
        isAttackingRef.current = false;
        attackStartedAtMsRef.current = null;
      }

      if (visualHorizontalSpeed > VISUAL_MOVING_SPEED && stepDelta > 0) {
        setWalkDirectionFromComponents(
          walkDirectionRef.current,
          visualDeltaX,
          visualDeltaZ,
          renderYaw
        );
      } else {
        setWalkDirectionFromVelocity(
          walkDirectionRef.current,
          hasSampledTransform ? sampledTransform.velocity : player.velocity,
          renderYaw
        );
      }

      const frameMovement = getPlayerRenderMovement(player, localPlayerId);
      const frameHasLoweredPosture = hasLoweredPlayerPosture(frameMovement, player.state);
      const frameIsMoving = isPlayerMovingForAnimation(player, visualHorizontalSpeed, frameMovement);
      postureScaleYRef.current = getPlayerBodyPostureScaleY(frameMovement, player.state);
      isCrouchingRef.current = frameMovement.isCrouching;
      isSlidingRef.current = frameMovement.isSliding;
      isDownedRef.current = player.state === 'downed';
      isBeingRevivedRef.current = Boolean(player.reviveByPlayerId);
      movementPoseRef.current = getPlayerMovementPose(player, frameHasLoweredPosture, frameIsMoving, frameMovement);
      isMovingRef.current = frameIsMoving;
    },
  }), [localPlayerId, player, playerHeight]);

  return (
    <group ref={groupRef}>
      {isVeiled && (
        <HeroVoxelBody
          heroId={player.heroId}
          skinId={player.skinId}
          team={player.team}
          height={playerHeight}
          postureScaleY={postureScaleY}
          postureScaleYRef={postureScaleYRef}
          lookPitch={initialLookPitch}
          lookPitchRef={lookPitchRef}
          isBot={player.isBot}
          isMoving={initialIsMoving}
          isMovingRef={isMovingRef}
          isCrouching={initialMovement.isCrouching}
          isCrouchingRef={isCrouchingRef}
          isSliding={initialMovement.isSliding}
          isSlidingRef={isSlidingRef}
          isDowned={player.state === 'downed'}
          isDownedRef={isDownedRef}
          isBeingRevived={Boolean(player.reviveByPlayerId)}
          isBeingRevivedRef={isBeingRevivedRef}
          isAttackingRef={isAttackingRef}
          attackStartedAtMsRef={attackStartedAtMsRef}
          attackSideRef={attackSideRef}
          movementPose={initialMovementPose}
          movementPoseRef={movementPoseRef}
          walkDirectionRef={walkDirectionRef}
          hasFlag={player.hasFlag}
          castShadow={false}
          bodyOpacity={PHANTOM_VEIL_BODY_OPACITY}
          bodyOpacityRef={bodyOpacityRef}
          showOutline={false}
        />
      )}

      {/* Status plate */}
      {!isVeiled && statusPlateMode && (
        <StatusPlate
          mode={statusPlateMode}
          name={player.name}
          health={getStatusPlateHealth(player, statusPlateMode)}
          maxHealth={getStatusPlateMaxHealth(player, statusPlateMode)}
          height={visibleHeight}
        />
      )}

      {/* Flag indicator */}
      {showFlagIndicator && (
        <FlagCarrierIndicator team={player.team === 'red' ? 'blue' : 'red'} />
      )}
    </group>
  );
});

interface StatusPlateProps {
  mode: RemoteStatusPlateMode;
  name: string;
  health: number;
  maxHealth: number;
  height: number;
}

const NAMEPLATE_CANVAS_WIDTH = 256;
const NAMEPLATE_CANVAS_HEIGHT = 72;
const NAMEPLATE_TEAM_CANVAS_HEIGHT = 96;
const NAMEPLATE_HEALTH_CANVAS_WIDTH = 192;
const NAMEPLATE_HEALTH_CANVAS_HEIGHT = 28;
const NAMEPLATE_DOWNED_CANVAS_WIDTH = 192;
const NAMEPLATE_DOWNED_CANVAS_HEIGHT = 58;
const NAMEPLATE_HEALTH_BUCKETS = 40;
const NAMEPLATE_TEXTURE_CACHE_LIMIT = 192;
const NAMEPLATE_FULL_SPRITE_HEIGHT = 0.68;
const NAMEPLATE_TEAM_SPRITE_HEIGHT = 0.9;
const NAMEPLATE_TEAM_WORLD_EXTRA_OFFSET_Y = 0.1;
const NAMEPLATE_HEALTH_SPRITE_WIDTH = 1.9;
const NAMEPLATE_HEALTH_SPRITE_HEIGHT = 0.28;
const NAMEPLATE_DOWNED_SPRITE_WIDTH = 1.9;
const NAMEPLATE_DOWNED_SPRITE_HEIGHT = 0.58;

interface StatusPlateTextureEntry {
  texture: THREE.CanvasTexture;
  refCount: number;
  lastUsedAt: number;
}

const statusPlateTextureCache = new Map<string, StatusPlateTextureEntry>();
let statusPlateTextureUseCounter = 0;

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function trimTextToWidth(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;

  let trimmed = value;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  barX: number,
  barY: number,
  barWidth: number,
  barHeight: number,
  healthPercent: number,
  tone: 'health' | 'downed' = 'health'
): void {
  const barRadius = barHeight / 2;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  roundedRectPath(ctx, barX, barY, barWidth, barHeight, barRadius);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
  ctx.fill();

  const fillWidth = Math.max(0, Math.min(barWidth, barWidth * healthPercent));
  if (fillWidth <= 0) return;

  roundedRectPath(ctx, barX, barY, fillWidth, barHeight, barRadius);
  const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
  if (tone === 'downed') {
    gradient.addColorStop(0, '#ef4444');
    gradient.addColorStop(1, '#fb7185');
  } else if (healthPercent > 0.3) {
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(1, '#86efac');
  } else {
    gradient.addColorStop(0, '#ef4444');
    gradient.addColorStop(1, '#f97316');
  }
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawStatusPlateTexture(
  canvas: HTMLCanvasElement,
  mode: RemoteStatusPlateMode,
  name: string,
  healthPercent: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mode === 'enemyHealth') {
    const barX = 10;
    const barY = 9;
    const barWidth = NAMEPLATE_HEALTH_CANVAS_WIDTH - barX * 2;
    const barHeight = 10;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    roundedRectPath(ctx, barX - 2, barY - 2, barWidth + 4, barHeight + 4, 7);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fill();
    drawHealthBar(ctx, barX, barY, barWidth, barHeight, healthPercent);
    return;
  }

  if (mode === 'enemyDowned') {
    const tagWidth = 132;
    const tagHeight = 26;
    const tagX = (NAMEPLATE_DOWNED_CANVAS_WIDTH - tagWidth) / 2;
    const tagY = 5;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundedRectPath(ctx, tagX, tagY, tagWidth, tagHeight, 6);
    ctx.fillStyle = 'rgba(185, 28, 28, 0.94)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(254, 202, 202, 0.92)';
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.font = '900 18px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7f7';
    ctx.fillText('DOWNED', NAMEPLATE_DOWNED_CANVAS_WIDTH / 2, tagY + tagHeight / 2 + 1);

    const barX = 22;
    const barY = 41;
    const barWidth = NAMEPLATE_DOWNED_CANVAS_WIDTH - barX * 2;
    const barHeight = 8;
    drawHealthBar(ctx, barX, barY, barWidth, barHeight, healthPercent, 'downed');
    return;
  }

  if (mode === 'fullTeam') {
    ctx.font = '800 13px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    const tagWidth = 62;
    const tagHeight = 19;
    const tagX = (NAMEPLATE_CANVAS_WIDTH - tagWidth) / 2;
    const tagY = 8;
    roundedRectPath(ctx, tagX, tagY, tagWidth, tagHeight, 9.5);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.92)';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(236, 254, 255, 0.9)';
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#062433';
    ctx.fillText('TEAM', NAMEPLATE_CANVAS_WIDTH / 2, tagY + tagHeight / 2 + 0.5);
  }

  ctx.font = '700 17px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillText(
    trimTextToWidth(ctx, name.toUpperCase(), 224),
    NAMEPLATE_CANVAS_WIDTH / 2,
    mode === 'fullTeam' ? 46 : 27
  );

  const barX = 34;
  const barY = mode === 'fullTeam' ? 74 : 52;
  const barWidth = 188;
  const barHeight = 6;
  drawHealthBar(ctx, barX, barY, barWidth, barHeight, healthPercent);
}

function getQuantizedNameplateHealthPercent(health: number, maxHealth: number): number {
  const healthPercent = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
  return Math.round(healthPercent * NAMEPLATE_HEALTH_BUCKETS) / NAMEPLATE_HEALTH_BUCKETS;
}

function getStatusPlateTextureKey(
  mode: RemoteStatusPlateMode,
  name: string,
  healthPercent: number
): string {
  const playerKey = mode === 'full' || mode === 'fullTeam' ? name : 'enemy';
  return `${mode}:${playerKey}:${healthPercent}`;
}

function createStatusPlateTexture(
  mode: RemoteStatusPlateMode,
  name: string,
  healthPercent: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  if (mode === 'fullTeam') {
    canvas.width = NAMEPLATE_CANVAS_WIDTH;
    canvas.height = NAMEPLATE_TEAM_CANVAS_HEIGHT;
  } else if (mode === 'enemyDowned') {
    canvas.width = NAMEPLATE_DOWNED_CANVAS_WIDTH;
    canvas.height = NAMEPLATE_DOWNED_CANVAS_HEIGHT;
  } else {
    canvas.width = mode === 'full' ? NAMEPLATE_CANVAS_WIDTH : NAMEPLATE_HEALTH_CANVAS_WIDTH;
    canvas.height = mode === 'full' ? NAMEPLATE_CANVAS_HEIGHT : NAMEPLATE_HEALTH_CANVAS_HEIGHT;
  }
  drawStatusPlateTexture(canvas, mode, name, healthPercent);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function evictUnusedStatusPlateTextures(): void {
  if (statusPlateTextureCache.size <= NAMEPLATE_TEXTURE_CACHE_LIMIT) return;

  while (statusPlateTextureCache.size > NAMEPLATE_TEXTURE_CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestEntry: StatusPlateTextureEntry | null = null;

    for (const [key, entry] of statusPlateTextureCache) {
      if (entry.refCount > 0) continue;
      if (!oldestEntry || entry.lastUsedAt < oldestEntry.lastUsedAt) {
        oldestKey = key;
        oldestEntry = entry;
      }
    }

    if (oldestKey === null || oldestEntry === null) return;
    oldestEntry.texture.dispose();
    statusPlateTextureCache.delete(oldestKey);
  }
}

function acquireStatusPlateTexture(
  mode: RemoteStatusPlateMode,
  name: string,
  healthPercent: number
): THREE.CanvasTexture {
  const key = getStatusPlateTextureKey(mode, name, healthPercent);
  let entry = statusPlateTextureCache.get(key);
  if (!entry) {
    entry = {
      texture: createStatusPlateTexture(mode, name, healthPercent),
      refCount: 0,
      lastUsedAt: 0,
    };
    statusPlateTextureCache.set(key, entry);
  }

  entry.refCount++;
  entry.lastUsedAt = ++statusPlateTextureUseCounter;
  evictUnusedStatusPlateTextures();
  return entry.texture;
}

function releaseStatusPlateTexture(
  mode: RemoteStatusPlateMode,
  name: string,
  healthPercent: number
): void {
  const entry = statusPlateTextureCache.get(getStatusPlateTextureKey(mode, name, healthPercent));
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsedAt = ++statusPlateTextureUseCounter;
  evictUnusedStatusPlateTextures();
}

function prewarmStatusPlateTexture(
  mode: RemoteStatusPlateMode,
  name: string,
  health: number,
  maxHealth: number
): void {
  if (typeof document === 'undefined') return;
  const healthPercent = getQuantizedNameplateHealthPercent(health, maxHealth);
  const texture = acquireStatusPlateTexture(mode, name, healthPercent);
  releaseStatusPlateTexture(mode, name, healthPercent);
  texture.needsUpdate = true;
}

const StatusPlate = memo(function StatusPlate({ mode, name, health, maxHealth, height }: StatusPlateProps) {
  const quantizedHealthPercent = getQuantizedNameplateHealthPercent(health, maxHealth);
  const texture = useMemo(
    () => acquireStatusPlateTexture(mode, name, quantizedHealthPercent),
    [mode, name, quantizedHealthPercent]
  );

  useEffect(
    () => () => releaseStatusPlateTexture(mode, name, quantizedHealthPercent),
    [mode, name, quantizedHealthPercent]
  );

  const width = mode === 'full'
    ? Math.max(1.75, Math.min(2.7, 1.55 + name.length * 0.045))
    : mode === 'fullTeam'
      ? Math.max(1.85, Math.min(2.8, 1.62 + name.length * 0.045))
      : mode === 'enemyDowned'
        ? NAMEPLATE_DOWNED_SPRITE_WIDTH
        : NAMEPLATE_HEALTH_SPRITE_WIDTH;
  const spriteHeight = mode === 'full'
    ? NAMEPLATE_FULL_SPRITE_HEIGHT
    : mode === 'fullTeam'
      ? NAMEPLATE_TEAM_SPRITE_HEIGHT
      : mode === 'enemyDowned'
        ? NAMEPLATE_DOWNED_SPRITE_HEIGHT
        : NAMEPLATE_HEALTH_SPRITE_HEIGHT;
  const yOffset = NAMEPLATE_WORLD_OFFSET_Y +
    (mode === 'fullTeam' ? NAMEPLATE_TEAM_WORLD_EXTRA_OFFSET_Y : 0);

  return (
    <sprite position={[0, height + yOffset, 0]} scale={[width, spriteHeight, 1]} renderOrder={60}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
});

interface FlagCarrierIndicatorProps {
  team: Team; // Team of the flag being carried
}

function FlagCarrierIndicator({ team }: FlagCarrierIndicatorProps) {
  const flagColor = team === 'red' ? '#ef4444' : '#4444ff';

  return (
    <group position={[0, 2.5, 0]}>
      {/* Flag pole */}
      <mesh position={[0, 0.3, -0.3]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8]} />
        <meshStandardMaterial color="#888888" />
      </mesh>

      {/* Flag cloth */}
      <mesh position={[0.2, 0.5, -0.3]}>
        <planeGeometry args={[0.4, 0.3]} />
        <meshStandardMaterial 
          color={flagColor}
          emissive={flagColor}
          emissiveIntensity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
