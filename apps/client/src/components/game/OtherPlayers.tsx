import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import {
  sampleRemoteTransform,
  setPlayerVisualPosition,
  setPlayerVisualRotation,
  visualStore,
} from '../../store/visualStore';
import { useShallow } from 'zustand/shallow';
import { HERO_DEFINITIONS, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from '@voxel-strike/shared';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from './HeroVoxelBody';
import type { HeroMovementPose, HeroWalkDirection } from './HeroVoxelBody';
import { HERO_COLOR_SCHEMES as HERO_ICON_COLORS } from '../../styles/colorTokens';
import { loggers } from '../../utils/logger';

// Debug: track last logged state to avoid spam
let lastLoggedPlayerCount = -1;
let lastLoggedOtherCount = -1;

export function OtherPlayers() {
  // NOTE: This component subscribes to gameStore.players but does NOT re-render on
  // position updates because updateGameState() updates Map entries in-place (same Map
  // reference). The Map reference only changes when players are added/removed. Position
  // interpolation reads from visualStore in useFrame (non-reactive, 60fps).
  const { players, playerId, localPlayerId, gamePhase } = useGameStore(
    useShallow(state => ({
      players: state.players,
      playerId: state.playerId,
      localPlayerId: state.localPlayer?.id ?? null,
      gamePhase: state.gamePhase,
    }))
  );

  const allPlayers = Array.from(players.values());

  // Filter out local player, show all other players except dead ones (unless in respawn view)
  const otherPlayers = allPlayers.filter((p) => {
    if (p.id === playerId || p.id === localPlayerId) return false;
    // Hide only dead players during active gameplay
    if (p.state === 'dead' && (gamePhase === 'playing' || gamePhase === 'countdown')) {
      return false;
    }
    // Show all other players in lobby, hero select, and during gameplay
    return true;
  });

  // Only log when counts change
  if (players.size !== lastLoggedPlayerCount || otherPlayers.length !== lastLoggedOtherCount) {
    loggers.effects.debug('OtherPlayers', {
      totalInStore: players.size,
      otherPlayersToRender: otherPlayers.length,
      playerId,
      localPlayerId,
      gamePhase,
      allPlayerIds: allPlayers.map(p => `${p.id.slice(0,6)}(${p.state})`),
      otherPlayerPositions: otherPlayers.map(p => ({ 
        id: p.id.slice(0,6), 
        pos: `(${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)})` 
      })),
    });
    lastLoggedPlayerCount = players.size;
    lastLoggedOtherCount = otherPlayers.length;
  }

  return (
    <group>
      {otherPlayers.map((player) => (
        <OtherPlayer key={player.id} player={player} />
      ))}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
}

const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
const CROUCH_HEIGHT_RATIO = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
const NETWORK_MOVING_SPEED = 0.45;
const VISUAL_MOVING_SPEED = 0.18;
const AIRBORNE_IDLE_VERTICAL_SPEED = 0.2;
const LOD_NEAR_DISTANCE = 18;
const LOD_MID_DISTANCE = 38;
const LOD_UPDATE_INTERVAL = 0.25;
const REMOTE_SAMPLE_POSITION_SMOOTHING = 28;
const REMOTE_SAMPLE_ROTATION_SMOOTHING = 32;
const REMOTE_SAMPLE_SNAP_DISTANCE = 3.5;

type RemotePlayerLodTier = 0 | 1 | 2;

function setPlayerRenderOrigin(
  target: THREE.Vector3,
  position: { x: number; y: number; z: number }
): THREE.Vector3 {
  return target.set(position.x, position.y - PLAYER_CENTER_TO_FEET, position.z);
}

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
  const speed = getHorizontalSpeed(velocity);
  if (speed <= 0.001) {
    target.forward = 1;
    target.right = 0;
    return;
  }

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  target.forward = (velocity.x * forwardX + velocity.z * forwardZ) / speed;
  target.right = (velocity.x * rightX + velocity.z * rightZ) / speed;
}

function isPlayerMovingForAnimation(player: Player, visualHorizontalSpeed = 0): boolean {
  const networkHorizontalSpeed = getHorizontalSpeed(player.velocity);
  const movement = player.movement;

  if (player.state !== 'alive') {
    return networkHorizontalSpeed > NETWORK_MOVING_SPEED || visualHorizontalSpeed > VISUAL_MOVING_SPEED;
  }

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

function OtherPlayer({ player }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [lodTier, setLodTier] = useState<RemotePlayerLodTier>(0);
  const lodAccumulatorRef = useRef(0);
  const heroStats = player.heroId ? HERO_DEFINITIONS[player.heroId].stats : null;
  const playerHeight = heroStats?.size.height ?? 1.8;
  const hasLoweredPosture = player.movement.isCrouching || player.movement.isSliding;
  const visibleHeight = hasLoweredPosture
    ? Math.max(PLAYER_CROUCH_HEIGHT, playerHeight * CROUCH_HEIGHT_RATIO)
    : playerHeight;
  const postureScaleY = visibleHeight / playerHeight;
  const initialIsMoving = isPlayerMovingForAnimation(player);
  const initialMovementPose = getPlayerMovementPose(player, hasLoweredPosture, initialIsMoving);
  const targetPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const currentPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const previousFramePosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const isMovingRef = useRef(initialIsMoving);
  const isCrouchingRef = useRef(player.movement.isCrouching);
  const isSlidingRef = useRef(player.movement.isSliding);
  const movementPoseRef = useRef<HeroMovementPose>(initialMovementPose);
  const postureScaleYRef = useRef(postureScaleY);
  const walkDirectionRef = useRef<HeroWalkDirection>({ forward: 1, right: 0 });
  const initializedRef = useRef(false);
  const remoteEpochRef = useRef<number | null>(null);
  const hasLoggedRef = useRef(false);
  
  // Debug log once when component first renders
  if (!hasLoggedRef.current) {
    loggers.effects.debug('OtherPlayer mounted', player.id.slice(0,6), player.name, player.position);
    hasLoggedRef.current = true;
  }

  // VISUAL_STORE_VERIFICATION: This component reads visualStore.getState() in useFrame.
  // Verify with React DevTools profiler that OtherPlayers does NOT re-render when player positions update at 60fps.
  // Expected: OtherPlayers renders only when players Map changes (add/remove), not on position updates.
  useFrame((_, delta) => {
    if (!groupRef.current) return;

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
    const sampledTransform = sampleRemoteTransform(player.id);
    let snappedToSample = false;
    if (sampledTransform) {
      setPlayerVisualPosition(player.id, sampledTransform.position);
      setPlayerVisualRotation(player.id, sampledTransform.lookYaw);
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
          smoothingFactor(REMOTE_SAMPLE_POSITION_SMOOTHING, delta)
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
    if (!sampledTransform) {
      currentPosition.current.lerp(targetPosition.current, Math.min(1, delta * 15));
    }
    groupRef.current.position.copy(currentPosition.current);

    const visualHorizontalSpeed = delta > 0
      ? Math.sqrt(
        (currentPosition.current.x - previousFramePosition.current.x) ** 2 +
        (currentPosition.current.z - previousFramePosition.current.z) ** 2
      ) / delta
      : 0;
    // Read rotation from visualStore non-reactively
    const targetRot = visualState.playerRotations.get(player.id);
    const renderYaw = sampledTransform?.lookYaw ?? targetRot ?? player.lookYaw;
    if (sampledTransform && !snappedToSample) {
      groupRef.current.rotation.y = lerpAngle(
        groupRef.current.rotation.y,
        sampledTransform.lookYaw,
        smoothingFactor(REMOTE_SAMPLE_ROTATION_SMOOTHING, delta)
      );
    } else if (sampledTransform) {
      groupRef.current.rotation.y = sampledTransform.lookYaw;
    } else if (targetRot !== undefined) {
      groupRef.current.rotation.y = targetRot;
    } else {
      // Fallback to prop rotation if visualStore doesn't have data yet
      groupRef.current.rotation.y = player.lookYaw;
    }

    if (visualHorizontalSpeed > VISUAL_MOVING_SPEED && delta > 0) {
      setWalkDirectionFromVelocity(
        walkDirectionRef.current,
        {
          x: (currentPosition.current.x - previousFramePosition.current.x) / delta,
          z: (currentPosition.current.z - previousFramePosition.current.z) / delta,
        },
        renderYaw
      );
    } else {
      setWalkDirectionFromVelocity(walkDirectionRef.current, sampledTransform?.velocity ?? player.velocity, renderYaw);
    }

    previousFramePosition.current.copy(currentPosition.current);
    const frameHasLoweredPosture = player.movement.isCrouching || player.movement.isSliding;
    const frameVisibleHeight = frameHasLoweredPosture
      ? Math.max(PLAYER_CROUCH_HEIGHT, playerHeight * CROUCH_HEIGHT_RATIO)
      : playerHeight;
    const frameIsMoving = isPlayerMovingForAnimation(player, visualHorizontalSpeed);
    postureScaleYRef.current = frameVisibleHeight / playerHeight;
    isCrouchingRef.current = player.movement.isCrouching;
    isSlidingRef.current = player.movement.isSliding;
    movementPoseRef.current = getPlayerMovementPose(player, frameHasLoweredPosture, frameIsMoving);
    isMovingRef.current = frameIsMoving;

    lodAccumulatorRef.current += delta;
    if (lodAccumulatorRef.current >= LOD_UPDATE_INTERVAL) {
      lodAccumulatorRef.current = 0;
      const distanceSq = camera.position.distanceToSquared(groupRef.current.position);
      const nextTier: RemotePlayerLodTier = player.hasFlag
        ? 0
        : distanceSq < LOD_NEAR_DISTANCE * LOD_NEAR_DISTANCE
          ? 0
          : distanceSq < LOD_MID_DISTANCE * LOD_MID_DISTANCE
            ? 1
            : 2;
      setLodTier((current) => current === nextTier ? current : nextTier);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Player body */}
      {lodTier === 0 ? (
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
          movementPose={initialMovementPose}
          movementPoseRef={movementPoseRef}
          walkDirectionRef={walkDirectionRef}
          hasFlag={player.hasFlag}
        />
      ) : lodTier === 1 ? (
        <SimplifiedRemoteBody
          heroId={player.heroId}
          team={player.team}
          height={playerHeight}
          postureScaleYRef={postureScaleYRef}
          hasFlag={player.hasFlag}
        />
      ) : (
        <RemotePlayerMarker team={player.team} isBot={player.isBot} hasFlag={player.hasFlag} />
      )}

      {/* Nameplate */}
      {lodTier <= 1 && (
        <Nameplate
          heroId={player.heroId}
          name={player.name}
          team={player.team}
          health={player.health}
          maxHealth={player.maxHealth}
          height={visibleHeight}
        />
      )}

      {lodTier <= 1 && <PlayerVisibilityBeacon team={player.team} height={visibleHeight} isBot={player.isBot} />}

      {/* Flag indicator */}
      {player.hasFlag && (
        <FlagCarrierIndicator team={player.team === 'red' ? 'blue' : 'red'} />
      )}
    </group>
  );
}

function getTeamColor(team: Team): string {
  return team === 'red' ? '#ef4444' : '#38bdf8';
}

function getHeroAccent(heroId: HeroId | null, team: Team): string {
  return heroId ? HERO_ICON_COLORS[heroId].primary : getTeamColor(team);
}

function SimplifiedRemoteBody({
  heroId,
  team,
  height,
  postureScaleYRef,
  hasFlag,
}: {
  heroId: HeroId | null;
  team: Team;
  height: number;
  postureScaleYRef: MutableRefObject<number>;
  hasFlag: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const teamColor = getTeamColor(team);
  const accent = getHeroAccent(heroId, team);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.scale.y = postureScaleYRef.current;
  });

  return (
    <group ref={groupRef} position={[0, height * 0.5, 0]}>
      <mesh>
        <boxGeometry args={[0.62, height * 0.72, 0.42]} />
        <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.18} roughness={0.72} />
      </mesh>
      <mesh position={[0, height * 0.43, 0]}>
        <boxGeometry args={[0.42, 0.34, 0.36]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.25} roughness={0.66} />
      </mesh>
      {hasFlag && (
        <mesh position={[0, height * 0.7, -0.28]}>
          <boxGeometry args={[0.18, 0.42, 0.04]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.55} />
        </mesh>
      )}
    </group>
  );
}

function RemotePlayerMarker({ team, isBot, hasFlag }: { team: Team; isBot?: boolean; hasFlag: boolean }) {
  const color = getTeamColor(team);
  const scale = hasFlag ? 1.35 : isBot ? 1.1 : 1;

  return (
    <group position={[0, 1.1, 0]} scale={scale}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.24, 0.34, 18]} />
        <meshBasicMaterial color={color} transparent opacity={0.86} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <octahedronGeometry args={[0.28, 0]} />
        <meshBasicMaterial color={hasFlag ? '#facc15' : color} />
      </mesh>
    </group>
  );
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

function Nameplate({ heroId, name, team, health, maxHealth, height }: NameplateProps) {
  const teamColor = getTeamColor(team);
  const healthPercent = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
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
    drawNameplateTexture(texture.image as HTMLCanvasElement, name, teamColor, heroColor, healthPercent);
    texture.needsUpdate = true;
  }, [healthPercent, heroColor, name, teamColor, texture]);

  useEffect(() => () => texture.dispose(), [texture]);

  const width = Math.max(1.75, Math.min(2.7, 1.55 + name.length * 0.045));

  return (
    <sprite position={[0, height + 0.58, 0]} scale={[width, 0.68, 1]} renderOrder={30}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function PlayerVisibilityBeacon({ team, height, isBot }: { team: Team; height: number; isBot?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const color = team === 'red' ? '#ef4444' : '#38bdf8';

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 1.6;
  });

  return (
    <group ref={groupRef} position={[0, height + 0.18, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.018, 6, 24]} />
        <meshBasicMaterial color={color} transparent opacity={isBot ? 0.95 : 0.75} />
      </mesh>
    </group>
  );
}

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
