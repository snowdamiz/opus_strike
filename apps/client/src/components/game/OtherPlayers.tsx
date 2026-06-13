import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import {
  sampleRemoteTransformInto,
  setPlayerVisualTransform,
  type SampledRemoteTransform,
  visualStore,
} from '../../store/visualStore';
import { getFrameClock } from '../../utils/frameClock';
import { useShallow } from 'zustand/shallow';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from './HeroVoxelBody';
import type { HeroMovementPose, HeroWalkDirection } from './HeroVoxelBody';
import { HERO_COLOR_SCHEMES as HERO_ICON_COLORS } from '../../styles/colorTokens';
import type { RemotePlayerQualityConfig } from './visualQuality';
import { RemoteHeroBatchRenderer } from './RemoteHeroBatchRenderer';
import {
  getPlayerHeight,
  getVisiblePlayerHeight,
  hasLoweredPlayerPosture,
  NAMEPLATE_WORLD_OFFSET_Y,
  setPlayerRenderOrigin,
} from './playerWorldAnchors';

interface OtherPlayersProps {
  config: RemotePlayerQualityConfig;
}

export function OtherPlayers({ config }: OtherPlayersProps) {
  // NOTE: This component subscribes to gameStore.players but does NOT re-render on
  // v2 transform position updates because remote player entries are mutated in-place.
  // The Map reference only changes when players are added/removed. Position interpolation
  // reads from visualStore in useFrame (non-reactive, 60fps).
  const { players, playerId, localPlayerId, gamePhase } = useGameStore(
    useShallow(state => ({
      players: state.players,
      playerId: state.playerId,
      localPlayerId: state.localPlayer?.id ?? null,
      gamePhase: state.gamePhase,
    }))
  );

  const otherPlayers = useMemo(() => {
    const nextPlayers: Player[] = [];
    const hideDeadPlayers = gamePhase === 'playing' || gamePhase === 'countdown';

    for (const player of players.values()) {
      if (player.id === playerId || player.id === localPlayerId) continue;
      if (hideDeadPlayers && player.state === 'dead') continue;
      if (player.visibility === 'hidden' || player.visibility === 'last_known' || player.visibility === 'audible') continue;
      nextPlayers.push(player);
    }

    return nextPlayers;
  }, [gamePhase, localPlayerId, playerId, players]);

  return (
    <group>
      <RemoteHeroBatchRenderer players={otherPlayers} />
      {otherPlayers.map((player) => (
        <OtherPlayer
          key={player.id}
          player={player}
          config={config}
        />
      ))}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
  config: RemotePlayerQualityConfig;
}

const NETWORK_MOVING_SPEED = 0.45;
const VISUAL_MOVING_SPEED = 0.18;
const AIRBORNE_IDLE_VERTICAL_SPEED = 0.2;
const REMOTE_SAMPLE_POSITION_SMOOTHING = 28;
const REMOTE_SAMPLE_ROTATION_SMOOTHING = 32;
const REMOTE_SAMPLE_SNAP_DISTANCE = 3.5;
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

function isPlayerMovingForAnimation(player: Player, visualHorizontalSpeed = 0): boolean {
  if (player.state !== 'alive') return false;

  const networkHorizontalSpeed = getHorizontalSpeed(player.velocity);
  const movement = player.movement;

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

function getPlayerMovementPose(player: Player, hasLoweredPosture: boolean, isMoving: boolean): HeroMovementPose {
  if (player.movement.isSliding) return 'run';
  if (hasLoweredPosture && isMoving) return 'crouchWalk';
  return player.movement.isSprinting ? 'run' : 'walk';
}

function hasActivePhantomVeil(player: Player): boolean {
  if (player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
  return Boolean(veil?.isActive);
}

const OtherPlayer = memo(function OtherPlayer({ player, config }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [isVeiled, setIsVeiled] = useState(() => hasActivePhantomVeil(player));
  const playerHeight = getPlayerHeight(player.heroId);
  const hasLoweredPosture = hasLoweredPlayerPosture(player.movement);
  const visibleHeight = getVisiblePlayerHeight(player.heroId, player.movement);
  const postureScaleY = visibleHeight / playerHeight;
  const initialIsMoving = isPlayerMovingForAnimation(player);
  const initialMovementPose = getPlayerMovementPose(player, hasLoweredPosture, initialIsMoving);
  const targetPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const currentPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const previousFramePosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const isMovingRef = useRef(initialIsMoving);
  const isCrouchingRef = useRef(player.movement.isCrouching);
  const isSlidingRef = useRef(player.movement.isSliding);
  const isAttackingRef = useRef(false);
  const attackStartedAtMsRef = useRef<number | null>(null);
  const attackSideRef = useRef<-1 | 1>(1);
  const movementPoseRef = useRef<HeroMovementPose>(initialMovementPose);
  const postureScaleYRef = useRef(postureScaleY);
  const bodyOpacityRef = useRef(isVeiled ? PHANTOM_VEIL_BODY_OPACITY : 1);
  const isVeiledRef = useRef(isVeiled);
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
  // VISUAL_STORE_VERIFICATION: This component reads visualStore.getState() in useFrame.
  // Verify with React DevTools profiler that OtherPlayers does NOT re-render when player positions update at 60fps.
  // Expected: OtherPlayers renders only when players Map changes (add/remove), not on position updates.
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const stepDelta = delta;
    const frameNowMs = getFrameClock().epochNowMs;

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
    const sampledTransform = sampledTransformRef.current;
    const hasSampledTransform = sampleRemoteTransformInto(player.id, sampledTransform, frameNowMs);
    let snappedToSample = false;
    if (hasSampledTransform) {
      setPlayerVisualTransform(player.id, sampledTransform.position, sampledTransform.lookYaw);
      setPlayerRenderOrigin(targetPosition.current, sampledTransform.position);
      const epochChanged = remoteEpochRef.current !== null && remoteEpochRef.current !== sampledTransform.movementEpoch;
      const tooFarForSmoothing = currentPosition.current.distanceToSquared(targetPosition.current) >
        REMOTE_SAMPLE_SNAP_DISTANCE * REMOTE_SAMPLE_SNAP_DISTANCE;
      if (epochChanged || tooFarForSmoothing) {
        currentPosition.current.copy(targetPosition.current);
        snappedToSample = true;
      } else {
        currentPosition.current.lerp(
          targetPosition.current,
          smoothingFactor(REMOTE_SAMPLE_POSITION_SMOOTHING, stepDelta)
        );
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

    const visualHorizontalSpeed = stepDelta > 0
      ? Math.sqrt(
        (currentPosition.current.x - previousFramePosition.current.x) ** 2 +
        (currentPosition.current.z - previousFramePosition.current.z) ** 2
      ) / stepDelta
      : 0;
    // Read rotation from visualStore non-reactively
    const targetRot = visualState.playerRotations.get(player.id);
    const renderYaw = hasSampledTransform ? sampledTransform.lookYaw : targetRot ?? player.lookYaw;
    if (hasSampledTransform && !snappedToSample) {
      groupRef.current.rotation.y = lerpAngle(
        groupRef.current.rotation.y,
        sampledTransform.lookYaw,
        smoothingFactor(REMOTE_SAMPLE_ROTATION_SMOOTHING, stepDelta)
      );
    } else if (hasSampledTransform) {
      groupRef.current.rotation.y = sampledTransform.lookYaw;
    } else if (targetRot !== undefined) {
      groupRef.current.rotation.y = targetRot;
    } else {
      // Fallback to prop rotation if visualStore doesn't have data yet
      groupRef.current.rotation.y = player.lookYaw;
    }

    previousFramePosition.current.copy(currentPosition.current);
    if (!frameIsVeiled) return;

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
        currentPosition.current.x - previousFramePosition.current.x,
        currentPosition.current.z - previousFramePosition.current.z,
        renderYaw
      );
    } else {
      setWalkDirectionFromVelocity(
        walkDirectionRef.current,
        hasSampledTransform ? sampledTransform.velocity : player.velocity,
        renderYaw
      );
    }

    const frameHasLoweredPosture = hasLoweredPlayerPosture(player.movement);
    const frameVisibleHeight = getVisiblePlayerHeight(player.heroId, player.movement);
    const frameIsMoving = isPlayerMovingForAnimation(player, visualHorizontalSpeed);
    postureScaleYRef.current = frameVisibleHeight / playerHeight;
    isCrouchingRef.current = player.movement.isCrouching;
    isSlidingRef.current = player.movement.isSliding;
    movementPoseRef.current = getPlayerMovementPose(player, frameHasLoweredPosture, frameIsMoving);
    isMovingRef.current = frameIsMoving;
  });

  return (
    <group ref={groupRef}>
      {isVeiled && (
        <HeroVoxelBody
          heroId={player.heroId}
          team={player.team}
          height={playerHeight}
          postureScaleY={postureScaleY}
          postureScaleYRef={postureScaleYRef}
          isBot={player.isBot}
          isMoving={initialIsMoving}
          isMovingRef={isMovingRef}
          isCrouching={player.movement.isCrouching}
          isCrouchingRef={isCrouchingRef}
          isSliding={player.movement.isSliding}
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
      {!isVeiled && config.showNameplates && (
        <Nameplate
          heroId={player.heroId}
          name={player.name}
          team={player.team}
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

function getTeamColor(team: Team): string {
  return team === 'red' ? '#ef4444' : '#38bdf8';
}

interface NameplateProps {
  heroId: HeroId | null;
  name: string;
  team: Team;
  health: number;
  maxHealth: number;
  height: number;
}

const NAMEPLATE_CANVAS_WIDTH = 256;
const NAMEPLATE_CANVAS_HEIGHT = 72;
const NAMEPLATE_HEALTH_BUCKETS = 40;

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
  teamColor: string,
  heroColor: string,
  healthPercent: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, NAMEPLATE_CANVAS_WIDTH, NAMEPLATE_CANVAS_HEIGHT);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, 8, 8, 240, 40, 8);
  ctx.fillStyle = 'rgba(5, 10, 18, 0.62)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = heroColor;
  ctx.shadowColor = heroColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(28, 28, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.font = '700 17px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(trimTextToWidth(ctx, name.toUpperCase(), 178), 44, 27);

  const barX = 30;
  const barY = 52;
  const barWidth = 196;
  const barHeight = 6;
  roundedRectPath(ctx, barX, barY, barWidth, barHeight, 3);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fill();

  const fillWidth = Math.max(0, Math.min(barWidth, barWidth * healthPercent));
  if (fillWidth > 0) {
    roundedRectPath(ctx, barX, barY, fillWidth, barHeight, 3);
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

  ctx.fillStyle = teamColor;
  ctx.globalAlpha = 0.9;
  roundedRectPath(ctx, 232, 14, 6, 42, 3);
  ctx.fill();
}

const Nameplate = memo(function Nameplate({ heroId, name, team, health, maxHealth, height }: NameplateProps) {
  const teamColor = getTeamColor(team);
  const healthPercent = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
  const quantizedHealthPercent = Math.round(healthPercent * NAMEPLATE_HEALTH_BUCKETS) / NAMEPLATE_HEALTH_BUCKETS;
  const heroColor = heroId ? HERO_ICON_COLORS[heroId].primary : teamColor;
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = NAMEPLATE_CANVAS_WIDTH;
    canvas.height = NAMEPLATE_CANVAS_HEIGHT;
    const nextTexture = new THREE.CanvasTexture(canvas);
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.minFilter = THREE.LinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    nextTexture.generateMipmaps = false;
    return nextTexture;
  }, []);

  useEffect(() => {
    drawNameplateTexture(texture.image as HTMLCanvasElement, name, teamColor, heroColor, quantizedHealthPercent);
    texture.needsUpdate = true;
  }, [heroColor, name, quantizedHealthPercent, teamColor, texture]);

  useEffect(() => () => texture.dispose(), [texture]);

  const width = Math.max(1.75, Math.min(2.7, 1.55 + name.length * 0.045));

  return (
    <sprite position={[0, height + NAMEPLATE_WORLD_OFFSET_Y, 0]} scale={[width, 0.68, 1]} renderOrder={30}>
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
