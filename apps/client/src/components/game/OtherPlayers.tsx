import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import {
  sampleRemoteTransformInto,
  setPlayerVisualPosition,
  setPlayerVisualRotation,
  type SampledRemoteTransform,
  visualStore,
} from '../../store/visualStore';
import { useShallow } from 'zustand/shallow';
import { HERO_DEFINITIONS, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from '@voxel-strike/shared';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from './HeroVoxelBody';
import type { HeroMovementPose, HeroWalkDirection } from './HeroVoxelBody';
import { BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME } from '../../viewmodel/blazePose';
import { CHRONOS_PRIMARY_ORB_SOCKET_NAME } from '../../viewmodel/chronosPose';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../../viewmodel/hookshotPose';
import {
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
} from '../../viewmodel/phantomPrimaryPose';
import { registerRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';
import { HERO_COLOR_SCHEMES as HERO_ICON_COLORS } from '../../styles/colorTokens';
import type { RemotePlayerQualityConfig } from './visualQuality';
import { selectRemoteFullBodyIds, type RemoteLodCandidate } from './remotePlayerLod';

interface OtherPlayersProps {
  config: RemotePlayerQualityConfig;
}

export function OtherPlayers({ config }: OtherPlayersProps) {
  const { camera } = useThree();
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
  const [fullBodyAllowedIds, setFullBodyAllowedIds] = useState<Set<string>>(() => new Set());
  const otherPlayersRef = useRef<Player[]>(otherPlayers);
  const fullBodyCandidateRef = useRef<RemoteLodCandidate[]>([]);
  const fullBodyCandidateDistanceRef = useRef<number[]>([]);
  const fullBodyAllowedIdListRef = useRef<string[]>([]);
  const fullBodyAllowedIdsRef = useRef(fullBodyAllowedIds);
  const fullBodyAllowedSignatureRef = useRef('');
  const fullBodyLodAccumulatorRef = useRef(LOD_UPDATE_INTERVAL);
  otherPlayersRef.current = otherPlayers;
  fullBodyAllowedIdsRef.current = fullBodyAllowedIds;

  useFrame((_, delta) => {
    fullBodyLodAccumulatorRef.current += delta;
    if (fullBodyLodAccumulatorRef.current < LOD_UPDATE_INTERVAL) return;
    fullBodyLodAccumulatorRef.current = 0;

    const visualState = visualStore.getState();
    const candidates = fullBodyCandidateRef.current;
    const playersToSample = otherPlayersRef.current;
    candidates.length = playersToSample.length;
    for (let index = 0; index < playersToSample.length; index++) {
      const player = playersToSample[index];
      let candidate = candidates[index];
      if (!candidate) {
        candidate = {
          id: player.id,
          team: player.team,
          hasFlag: player.hasFlag,
          position: player.position,
        };
        candidates[index] = candidate;
      }
      candidate.id = player.id;
      candidate.team = player.team;
      candidate.hasFlag = player.hasFlag;
      candidate.position = visualState.playerPositions.get(player.id) ?? player.position;
    }

    const nextIds = fullBodyAllowedIdListRef.current;
    selectRemoteFullBodyIds(
      candidates,
      camera.position,
      config.maxFullBodies,
      fullBodyAllowedIdsRef.current,
      nextIds,
      fullBodyCandidateDistanceRef.current
    );
    const nextSignature = nextIds.join('|');
    if (nextSignature !== fullBodyAllowedSignatureRef.current) {
      fullBodyAllowedSignatureRef.current = nextSignature;
      setFullBodyAllowedIds(new Set(nextIds));
    }
  });

  return (
    <group>
      {otherPlayers.map((player) => (
        <OtherPlayer
          key={player.id}
          player={player}
          config={config}
          allowFullBody={player.hasFlag || fullBodyAllowedIds.has(player.id)}
        />
      ))}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
  config: RemotePlayerQualityConfig;
  allowFullBody: boolean;
}

const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
const CROUCH_HEIGHT_RATIO = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
const NETWORK_MOVING_SPEED = 0.45;
const VISUAL_MOVING_SPEED = 0.18;
const AIRBORNE_IDLE_VERTICAL_SPEED = 0.2;
const LOD_UPDATE_INTERVAL = 0.25;
const REMOTE_SAMPLE_POSITION_SMOOTHING = 28;
const REMOTE_SAMPLE_ROTATION_SMOOTHING = 32;
const REMOTE_SAMPLE_SNAP_DISTANCE = 3.5;
const REMOTE_ATTACK_STATE_RETENTION_MS = 3200;
const REMOTE_ATTACK_STATE_CLEANUP_MS = 5000;
const PHANTOM_VEIL_ABILITY_ID = 'phantom_veil';
const PHANTOM_VEIL_BODY_OPACITY = 0.12;
const PHANTOM_VEIL_OPACITY_DAMP_RATE = 12;
const REMOTE_SIMPLIFIED_GEOMETRIES = {
  torso: new THREE.BoxGeometry(1, 1, 1),
  head: new THREE.BoxGeometry(1, 1, 1),
  flag: new THREE.BoxGeometry(1, 1, 1),
  markerRing: new THREE.RingGeometry(0.24, 0.34, 18),
  markerCore: new THREE.OctahedronGeometry(0.28, 0),
};
const remoteBodyMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
const remoteMarkerMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

type RemotePlayerLodTier = 0 | 1 | 2;

interface SimplifiedRemoteSocketMarker {
  socketName: string;
  position: [number, number, number];
}

function getSharedRemoteBodyMaterial(
  color: string,
  emissiveIntensity: number,
  roughness = 0.7
): THREE.MeshStandardMaterial {
  const key = `${color}:${emissiveIntensity}:${roughness}`;
  let material = remoteBodyMaterialCache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity,
      roughness,
    });
    remoteBodyMaterialCache.set(key, material);
  }
  return material;
}

function getSharedRemoteMarkerMaterial(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const key = `${color}:${opacity}`;
  let material = remoteMarkerMaterialCache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    remoteMarkerMaterialCache.set(key, material);
  }
  return material;
}

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

function createSimplifiedRemoteSocketMarkers(
  heroId: HeroId,
  height: number
): SimplifiedRemoteSocketMarker[] {
  switch (heroId) {
    case 'phantom':
      return [
        {
          socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
          position: [-0.34, -height * 0.08, -0.32],
        },
        {
          socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
          position: [0.34, -height * 0.08, -0.32],
        },
        {
          socketName: PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
          position: [0, 0, -0.34],
        },
      ];
    case 'hookshot':
      return [
        {
          socketName: HOOKSHOT_HOOK_SOCKET_NAMES[-1],
          position: [-0.42, -height * 0.06, -0.38],
        },
        {
          socketName: HOOKSHOT_HOOK_SOCKET_NAMES[1],
          position: [0.42, -height * 0.06, -0.38],
        },
      ];
    case 'blaze':
      return [
        {
          socketName: BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
          position: [0.34, height * 0.34, -0.32],
        },
      ];
    case 'chronos':
      return [
        {
          socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
          position: [0, height * 0.02, -0.34],
        },
      ];
  }
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

function hasActivePhantomVeil(player: Player): boolean {
  if (player.state !== 'alive' || player.heroId !== 'phantom') return false;
  const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
  return Boolean(veil?.isActive);
}

function OtherPlayer({ player, config, allowFullBody }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [lodTier, setLodTier] = useState<RemotePlayerLodTier>(0);
  const [isVeiled, setIsVeiled] = useState(() => hasActivePhantomVeil(player));
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
  const isAttackingRef = useRef(false);
  const attackStartedAtMsRef = useRef<number | null>(null);
  const attackSideRef = useRef<-1 | 1>(1);
  const movementPoseRef = useRef<HeroMovementPose>(initialMovementPose);
  const postureScaleYRef = useRef(postureScaleY);
  const bodyOpacityRef = useRef(isVeiled ? PHANTOM_VEIL_BODY_OPACITY : 1);
  const isVeiledRef = useRef(isVeiled);
  const walkDirectionRef = useRef<HeroWalkDirection>({ forward: 1, right: 0 });
  const initializedRef = useRef(false);
  const distantUpdateAccumulatorRef = useRef(0);
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
    let stepDelta = delta;

    if (lodTier === 2) {
      distantUpdateAccumulatorRef.current += delta;
      const updateInterval = 1 / Math.max(1, config.distantAnimationFps);
      if (distantUpdateAccumulatorRef.current < updateInterval) return;
      stepDelta = distantUpdateAccumulatorRef.current;
      distantUpdateAccumulatorRef.current = 0;
    } else {
      distantUpdateAccumulatorRef.current = 0;
    }

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
    const remoteAttackState = visualState.remotePlayerAttackStates.get(player.id);
    if (remoteAttackState) {
      const attackAgeMs = Date.now() - remoteAttackState.startedAtMs;
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

    const sampledTransform = sampledTransformRef.current;
    const hasSampledTransform = sampleRemoteTransformInto(player.id, sampledTransform);
    let snappedToSample = false;
    if (hasSampledTransform) {
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

    if (visualHorizontalSpeed > VISUAL_MOVING_SPEED && stepDelta > 0) {
      setWalkDirectionFromVelocity(
        walkDirectionRef.current,
        {
          x: (currentPosition.current.x - previousFramePosition.current.x) / stepDelta,
          z: (currentPosition.current.z - previousFramePosition.current.z) / stepDelta,
        },
        renderYaw
      );
    } else {
      setWalkDirectionFromVelocity(
        walkDirectionRef.current,
        hasSampledTransform ? sampledTransform.velocity : player.velocity,
        renderYaw
      );
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

    lodAccumulatorRef.current += stepDelta;
    if (lodAccumulatorRef.current >= LOD_UPDATE_INTERVAL) {
      lodAccumulatorRef.current = 0;
      const distanceSq = camera.position.distanceToSquared(groupRef.current.position);
      const nextTier: RemotePlayerLodTier = player.hasFlag
        ? 0
        : allowFullBody && distanceSq < config.nearDistance * config.nearDistance
          ? 0
          : distanceSq < config.midDistance * config.midDistance
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
          socketOwnerId={player.id}
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
          castShadow={!isVeiled}
          bodyOpacity={isVeiled ? PHANTOM_VEIL_BODY_OPACITY : 1}
          bodyOpacityRef={bodyOpacityRef}
        />
      ) : lodTier === 1 ? (
        <SimplifiedRemoteBody
          socketOwnerId={player.id}
          heroId={player.heroId}
          team={player.team}
          height={playerHeight}
          postureScaleYRef={postureScaleYRef}
          hasFlag={player.hasFlag}
          bodyVisible={!isVeiled}
        />
      ) : (
        !isVeiled && <RemotePlayerMarker team={player.team} isBot={player.isBot} hasFlag={player.hasFlag} />
      )}

      {/* Nameplate */}
      {!isVeiled && config.showNameplates && lodTier <= 1 && (
        <Nameplate
          heroId={player.heroId}
          name={player.name}
          team={player.team}
          health={player.health}
          maxHealth={player.maxHealth}
          height={visibleHeight}
        />
      )}

      {!isVeiled && config.showBeacons && lodTier <= 1 && (
        <PlayerVisibilityBeacon
          team={player.team}
          height={visibleHeight}
          isBot={player.isBot}
          animate={config.animateFarMarkers}
        />
      )}

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
  socketOwnerId,
  heroId,
  team,
  height,
  postureScaleYRef,
  hasFlag,
  bodyVisible = true,
}: {
  socketOwnerId?: string;
  heroId: HeroId | null;
  team: Team;
  height: number;
  postureScaleYRef: MutableRefObject<number>;
  hasFlag: boolean;
  bodyVisible?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const socketRefs = useRef<Record<string, THREE.Group | null>>({});
  const resolvedHero = heroId ?? 'phantom';
  const teamColor = getTeamColor(team);
  const accent = getHeroAccent(heroId, team);
  const torsoMaterial = getSharedRemoteBodyMaterial(teamColor, 0.18, 0.72);
  const headMaterial = getSharedRemoteBodyMaterial(accent, 0.25, 0.66);
  const flagMaterial = getSharedRemoteBodyMaterial('#facc15', 0.55, 0.58);
  const socketMarkers = useMemo(
    () => createSimplifiedRemoteSocketMarkers(resolvedHero, height),
    [height, resolvedHero]
  );

  useEffect(() => {
    if (!socketOwnerId) return undefined;

    const cleanups: Array<() => void> = [];
    for (const marker of socketMarkers) {
      const socketObject = socketRefs.current[marker.socketName];
      if (!socketObject) continue;
      cleanups.push(registerRemoteModelSocket(
        socketOwnerId,
        marker.socketName,
        socketObject,
        'simplifiedBody'
      ));
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [socketMarkers, socketOwnerId]);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.scale.y = postureScaleYRef.current;
  });

  return (
    <group ref={groupRef} position={[0, height * 0.5, 0]} dispose={null}>
      {bodyVisible && (
        <>
          <mesh
            geometry={REMOTE_SIMPLIFIED_GEOMETRIES.torso}
            material={torsoMaterial}
            scale={[0.62, height * 0.72, 0.42]}
          />
          <mesh
            geometry={REMOTE_SIMPLIFIED_GEOMETRIES.head}
            material={headMaterial}
            position={[0, height * 0.43, 0]}
            scale={[0.42, 0.34, 0.36]}
          />
          {hasFlag && (
            <mesh
              geometry={REMOTE_SIMPLIFIED_GEOMETRIES.flag}
              material={flagMaterial}
              position={[0, height * 0.7, -0.28]}
              scale={[0.18, 0.42, 0.04]}
            />
          )}
        </>
      )}
      {socketMarkers.map((marker) => (
        <group
          key={`${resolvedHero}-simplified-socket-${marker.socketName}`}
          ref={(node) => {
            socketRefs.current[marker.socketName] = node;
          }}
          position={marker.position}
        />
      ))}
    </group>
  );
}

function RemotePlayerMarker({ team, isBot, hasFlag }: { team: Team; isBot?: boolean; hasFlag: boolean }) {
  const color = getTeamColor(team);
  const scale = hasFlag ? 1.35 : isBot ? 1.1 : 1;
  const ringMaterial = getSharedRemoteMarkerMaterial(color, 0.86);
  const coreMaterial = getSharedRemoteMarkerMaterial(hasFlag ? '#facc15' : color);

  return (
    <group position={[0, 1.1, 0]} scale={scale} dispose={null}>
      <mesh
        geometry={REMOTE_SIMPLIFIED_GEOMETRIES.markerRing}
        material={ringMaterial}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={REMOTE_SIMPLIFIED_GEOMETRIES.markerCore}
        material={coreMaterial}
        position={[0, 0.18, 0]}
      />
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

function Nameplate({ heroId, name, team, health, maxHealth, height }: NameplateProps) {
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
    <sprite position={[0, height + 0.58, 0]} scale={[width, 0.68, 1]} renderOrder={30}>
      <spriteMaterial map={texture} transparent depthTest depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function PlayerVisibilityBeacon({ team, height, isBot, animate }: { team: Team; height: number; isBot?: boolean; animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const color = team === 'red' ? '#ef4444' : '#38bdf8';

  useFrame((state) => {
    if (!animate || !groupRef.current) return;
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
