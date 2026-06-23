import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
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
import type { Player, PlayerMovementState, Team, VoxelMapTheme } from '@voxel-strike/shared';
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
}

export function OtherPlayers({ config, effectConfig, theme }: OtherPlayersProps) {
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
  }, [gamePhase, isBattleRoyal, localPlayerId, playerId, players, showFirstPersonDropBody, showLocalPlayerBody]);

  useEffect(() => {
    if (!config.showNameplates) return;
    for (const player of otherPlayers) {
      if (player.id === playerId || player.id === localPlayerId) continue;
      if (!shouldShowRemoteNameplate(player, config, isBattleRoyal, localPlayerTeam)) continue;
      prewarmNameplateTexture(
        player.name,
        player.health,
        player.maxHealth
      );
    }
  }, [config.showNameplates, isBattleRoyal, localPlayerId, localPlayerTeam, otherPlayers, playerId]);

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
        const showNameplate = player.id !== playerId
          && player.id !== localPlayerId
          && shouldShowRemoteNameplate(player, config, isBattleRoyal, localPlayerTeam);
        return shouldRenderRemotePlayerFallback(player, config, showNameplate) ? (
          <OtherPlayer
            key={player.id}
            player={player}
            localPlayerId={showLocalPlayerBody ? (localPlayerId ?? playerId) : null}
            config={config}
            showNameplate={showNameplate}
          />
        ) : null;
      })}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
  localPlayerId?: string | null;
  config: RemotePlayerQualityConfig;
  showNameplate: boolean;
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
  if (player.state !== 'alive' && player.state !== 'dropping') return false;

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

function shouldShowRemoteNameplate(
  player: Player,
  config: RemotePlayerQualityConfig,
  isBattleRoyal: boolean,
  localPlayerTeam: Team | null
): boolean {
  if (!config.showNameplates) return false;
  return !isBattleRoyal || player.team === localPlayerTeam;
}

function shouldRenderRemotePlayerFallback(
  player: Player,
  config: RemotePlayerQualityConfig,
  showNameplate: boolean
): boolean {
  return player.heroId === 'phantom' || player.hasFlag || showNameplate || config.showBeacons;
}

function getPlayerRenderMovement(
  player: Player,
  localPlayerId: string | null | undefined
): PlayerMovementState {
  return player.id === localPlayerId ? visualStore.getState().localMovement : player.movement;
}

const OtherPlayer = memo(function OtherPlayer({ player, localPlayerId, config, showNameplate }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [isVeiled, setIsVeiled] = useState(() => hasActivePhantomVeil(player));
  const playerHeight = getPlayerHeight(player.heroId);
  const initialMovement = getPlayerRenderMovement(player, localPlayerId);
  const initialLookPitch = getPlayerVisualLookPitch(visualStore.getState(), player);
  const hasLoweredPosture = hasLoweredPlayerPosture(initialMovement);
  const visibleHeight = getVisiblePlayerHeight(player.heroId, initialMovement);
  const postureScaleY = getPlayerBodyPostureScaleY(initialMovement);
  const initialIsMoving = isPlayerMovingForAnimation(player, 0, initialMovement);
  const initialMovementPose = getPlayerMovementPose(player, hasLoweredPosture, initialIsMoving, initialMovement);
  const targetPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const currentPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const previousFramePosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const isMovingRef = useRef(initialIsMoving);
  const isCrouchingRef = useRef(initialMovement.isCrouching);
  const isSlidingRef = useRef(initialMovement.isSliding);
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
      const frameHasLoweredPosture = hasLoweredPlayerPosture(frameMovement);
      const frameIsMoving = isPlayerMovingForAnimation(player, visualHorizontalSpeed, frameMovement);
      postureScaleYRef.current = getPlayerBodyPostureScaleY(frameMovement);
      isCrouchingRef.current = frameMovement.isCrouching;
      isSlidingRef.current = frameMovement.isSliding;
      movementPoseRef.current = getPlayerMovementPose(player, frameHasLoweredPosture, frameIsMoving, frameMovement);
      isMovingRef.current = frameIsMoving;
    },
  }), [localPlayerId, player, playerHeight]);

  return (
    <group ref={groupRef}>
      {isVeiled && (
        <HeroVoxelBody
          heroId={player.heroId}
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

      {/* Nameplate */}
      {!isVeiled && showNameplate && (
        <Nameplate
          name={player.name}
          health={player.health}
          maxHealth={player.maxHealth}
          height={visibleHeight}
        />
      )}

      {!isVeiled && config.showBeacons && (
        <PlayerVisibilityBeacon
          team={player.team}
          height={visibleHeight}
          isBot={player.isBot}
          animate={config.animateBeacons}
        />
      )}

      {/* Flag indicator */}
      {player.hasFlag && (
        <FlagCarrierIndicator team={player.team === 'red' ? 'blue' : 'red'} />
      )}
    </group>
  );
});

interface NameplateProps {
  name: string;
  health: number;
  maxHealth: number;
  height: number;
}

const NAMEPLATE_CANVAS_WIDTH = 256;
const NAMEPLATE_CANVAS_HEIGHT = 72;
const NAMEPLATE_HEALTH_BUCKETS = 40;
const NAMEPLATE_TEXTURE_CACHE_LIMIT = 192;
const NAMEPLATE_FULL_SPRITE_HEIGHT = 0.68;

interface NameplateTextureEntry {
  texture: THREE.CanvasTexture;
  refCount: number;
  lastUsedAt: number;
}

const nameplateTextureCache = new Map<string, NameplateTextureEntry>();
let nameplateTextureUseCounter = 0;

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

function drawNameplateTexture(
  canvas: HTMLCanvasElement,
  name: string,
  healthPercent: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, NAMEPLATE_CANVAS_WIDTH, NAMEPLATE_CANVAS_HEIGHT);

  ctx.font = '700 17px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillText(trimTextToWidth(ctx, name.toUpperCase(), 224), NAMEPLATE_CANVAS_WIDTH / 2, 27);

  const barX = 34;
  const barY = 52;
  const barWidth = 188;
  const barHeight = 6;
  const barRadius = 3;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  roundedRectPath(ctx, barX, barY, barWidth, barHeight, barRadius);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const fillWidth = Math.max(0, Math.min(barWidth, barWidth * healthPercent));
  if (fillWidth > 0) {
    roundedRectPath(ctx, barX, barY, fillWidth, barHeight, barRadius);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    if (healthPercent > 0.3) {
      gradient.addColorStop(0, '#22c55e');
      gradient.addColorStop(1, '#86efac');
    } else {
      gradient.addColorStop(0, '#ef4444');
      gradient.addColorStop(1, '#f97316');
    }
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

function getQuantizedNameplateHealthPercent(health: number, maxHealth: number): number {
  const healthPercent = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
  return Math.round(healthPercent * NAMEPLATE_HEALTH_BUCKETS) / NAMEPLATE_HEALTH_BUCKETS;
}

function getNameplateTextureKey(
  name: string,
  healthPercent: number
): string {
  return `full:${name}:${healthPercent}`;
}

function createNameplateTexture(
  name: string,
  healthPercent: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = NAMEPLATE_CANVAS_WIDTH;
  canvas.height = NAMEPLATE_CANVAS_HEIGHT;
  drawNameplateTexture(canvas, name, healthPercent);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function evictUnusedNameplateTextures(): void {
  if (nameplateTextureCache.size <= NAMEPLATE_TEXTURE_CACHE_LIMIT) return;

  while (nameplateTextureCache.size > NAMEPLATE_TEXTURE_CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestEntry: NameplateTextureEntry | null = null;

    for (const [key, entry] of nameplateTextureCache) {
      if (entry.refCount > 0) continue;
      if (!oldestEntry || entry.lastUsedAt < oldestEntry.lastUsedAt) {
        oldestKey = key;
        oldestEntry = entry;
      }
    }

    if (oldestKey === null || oldestEntry === null) return;
    oldestEntry.texture.dispose();
    nameplateTextureCache.delete(oldestKey);
  }
}

function acquireNameplateTexture(
  name: string,
  healthPercent: number
): THREE.CanvasTexture {
  const key = getNameplateTextureKey(name, healthPercent);
  let entry = nameplateTextureCache.get(key);
  if (!entry) {
    entry = {
      texture: createNameplateTexture(name, healthPercent),
      refCount: 0,
      lastUsedAt: 0,
    };
    nameplateTextureCache.set(key, entry);
  }

  entry.refCount++;
  entry.lastUsedAt = ++nameplateTextureUseCounter;
  evictUnusedNameplateTextures();
  return entry.texture;
}

function releaseNameplateTexture(
  name: string,
  healthPercent: number
): void {
  const entry = nameplateTextureCache.get(getNameplateTextureKey(name, healthPercent));
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsedAt = ++nameplateTextureUseCounter;
  evictUnusedNameplateTextures();
}

function prewarmNameplateTexture(
  name: string,
  health: number,
  maxHealth: number
): void {
  if (typeof document === 'undefined') return;
  const healthPercent = getQuantizedNameplateHealthPercent(health, maxHealth);
  const texture = acquireNameplateTexture(name, healthPercent);
  releaseNameplateTexture(name, healthPercent);
  texture.needsUpdate = true;
}

const Nameplate = memo(function Nameplate({ name, health, maxHealth, height }: NameplateProps) {
  const quantizedHealthPercent = getQuantizedNameplateHealthPercent(health, maxHealth);
  const texture = useMemo(
    () => acquireNameplateTexture(name, quantizedHealthPercent),
    [name, quantizedHealthPercent]
  );

  useEffect(
    () => () => releaseNameplateTexture(name, quantizedHealthPercent),
    [name, quantizedHealthPercent]
  );

  const width = Math.max(1.75, Math.min(2.7, 1.55 + name.length * 0.045));

  return (
    <sprite position={[0, height + NAMEPLATE_WORLD_OFFSET_Y, 0]} scale={[width, NAMEPLATE_FULL_SPRITE_HEIGHT, 1]} renderOrder={30}>
      <spriteMaterial map={texture} transparent depthTest depthWrite={false} toneMapped={false} />
    </sprite>
  );
});

const BEACON_TORUS_GEOMETRY = new THREE.TorusGeometry(0.42, 0.018, 6, 24);
const BEACON_MATERIALS = {
  red: new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.75 }),
  redBot: new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.95 }),
  blue: new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.75 }),
  blueBot: new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.95 }),
} as const;

function getBeaconMaterial(team: Team, isBot?: boolean): THREE.MeshBasicMaterial {
  if (team === 'red') return isBot ? BEACON_MATERIALS.redBot : BEACON_MATERIALS.red;
  return isBot ? BEACON_MATERIALS.blueBot : BEACON_MATERIALS.blue;
}

const PlayerVisibilityBeacon = memo(function PlayerVisibilityBeacon({ team, height, isBot, animate }: { team: Team; height: number; isBot?: boolean; animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const material = getBeaconMaterial(team, isBot);

  useFrame((state) => {
    if (!animate || !groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 1.6;
  });

  return (
    <group ref={groupRef} position={[0, height + 0.18, 0]}>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        geometry={BEACON_TORUS_GEOMETRY}
        material={material}
        dispose={null}
      />
    </group>
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
