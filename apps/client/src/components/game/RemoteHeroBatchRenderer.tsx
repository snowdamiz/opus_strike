import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { HeroId, Player, PlayerMovementState, Team } from '@voxel-strike/shared';
import {
  DEFAULT_WALK_DIRECTION,
  EMPTY_TEAM_ACCENT_PARTS,
  HERO_BODY_MANIFESTS,
  IDLE_SPEED_MULTIPLIER,
  TEAM_BODY_GLOW_OUTLINE_OPACITY,
  TEAM_BODY_GLOW_OUTLINE_SCALE,
  TEAM_COLORS,
  getHeroBodyMaterialEmissiveIntensity,
  getHeroMovementProfile,
  getTeamBodyGlowEmissiveIntensity,
  getTeamBodyGlowOpacity,
  lerpMovementProfile,
} from '../../model-system/heroBodyManifests';
import {
  applyChronosArmPose,
  applyCrouchBonePose,
  applyHeroBodyPoseTransition,
  applyHeroAttackPose,
  applyPhantomShieldBodyPose,
  applyIdleBonePose,
  applyJumpBonePose,
  applyLookPitchWaistBend,
  applySlideBonePose,
  applyWalkingBonePose,
  beginHeroBodyPoseTransition,
  clamp01,
  createHeroBodyPoseTransitionRuntime,
  easeInOutSine,
  getBlazeAttackPoseAmount,
  getHeroBodyPoseBlendKey,
  getJumpPose,
  getNormalizedWalkDirection,
  getPhantomShieldBodyPoseAmount,
  HERO_LOOK_PITCH_WAIST_DAMPING,
  resetHeroBodyPoseTransitionRuntime,
  setBoneBasePose,
  type HeroBodyPoseRootTransform,
  type HeroBodyPoseTransitionRuntime,
} from '../../model-system/heroBodyPose';
import {
  HERO_BODY_BOT_MARKER_PART,
} from '../../model-system/heroBodyGeneratedParts';
import { groupHeroBodyRenderParts } from '../../model-system/heroBodyRenderParts';
import {
  EMPTY_REMOTE_SOCKET_MARKERS,
  EMPTY_RIGGED_PARTS,
  HERO_BONE_PARENTS,
  HERO_BONE_PIVOTS,
  HERO_PART_GEOMETRIES,
  getChildBonePosition,
  getPartGeometry,
  groupRiggedParts,
} from '../../model-system/heroRig';
import type {
  HeroBoneName,
  HeroBoneRefs,
  HeroMovementPose,
  HeroMovementProfile,
  HeroWalkDirection,
  MaterialKind,
  RiggedVoxelPart,
  TeamAccentPart,
  VoxelPart,
} from '../../model-system/heroBodyTypes';
import {
  getPlayerVisualLookPitch,
  sampleRemoteTransformHistoryInto,
  setRenderedPlayerVisualTransform,
  type SampledRemoteTransform,
  type VisualState,
  visualStore,
} from '../../store/visualStore';
import { recordFrameAllocation } from '../../movement/networkDiagnostics';
import { registerRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';
import {
  getPlayerBodyPostureScaleY,
  getPlayerHeight,
  PLAYER_CENTER_TO_FEET,
  setPlayerRenderOrigin,
} from './playerWorldAnchors';
import { gameplayFrameScheduler } from './systems/gameplayFrameScheduler';
import type { RemotePlayerQualityConfig } from './visualQuality';

type BoneOrRoot = HeroBoneName | 'root';
type PlayerFilter = 'all' | 'bot' | 'nonBot';

interface RemoteHeroBatchRendererProps {
  players: readonly Player[];
  resourcePlayers?: readonly Player[];
  isBattleRoyal?: boolean;
  localPlayerId?: string | null;
  localPlayerTeam?: Team | null;
  config: RemotePlayerQualityConfig;
}

interface RemotePartDescriptor {
  id: string;
  bone: BoneOrRoot;
  meshOffset: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  localMatrix: THREE.Matrix4;
  geometry: THREE.BufferGeometry;
  geometryKey: string;
  materialKey: string;
  playerFilter: PlayerFilter;
  paletteKind?: MaterialKind;
  trimEmissiveIntensity?: number;
  fixedEmissiveIntensity?: number;
  instanceColor?: 'team';
  battleRoyalLocalMatrix?: THREE.Matrix4;
}

interface RemotePartBatch {
  key: string;
  geometry: THREE.BufferGeometry;
  descriptors: RemotePartDescriptor[];
  material: THREE.MeshStandardMaterial;
  capacityPerPlayer: number;
  playerFilter: PlayerFilter;
}

interface RemoteOutlineBatch {
  key: string;
  geometry: THREE.BufferGeometry;
  descriptors: RemotePartDescriptor[];
  material: THREE.MeshBasicMaterial;
  capacityPerPlayer: number;
  playerFilter: PlayerFilter;
}

interface RemoteBatchResources {
  heroId: HeroId;
  batches: RemotePartBatch[];
  outlineBatches: RemoteOutlineBatch[];
  dispose: () => void;
}

interface RemoteHeroRenderGroup {
  key: string;
  players: readonly Player[];
  resourcePlayerCount: number;
  resource: RemoteBatchResources;
}

export interface RemoteHeroBatchBenchmarkFrameStats {
  groups: number;
  emptyGroups: number;
  players: number;
  consideredPlayers: number;
  bodyPlayers: number;
  outlinePlayers: number;
  normalMatrixWrites: number;
  outlineMatrixWrites: number;
  normalBatches: number;
  outlineBatches: number;
  mountedInstancedMeshes: number;
  emptyMountedInstancedMeshes: number;
  batchFinalizations: number;
}

export interface RemoteHeroBatchBenchmarkRunner {
  runFrame: (options: {
    deltaSeconds: number;
    elapsedSeconds: number;
    nowMs: number;
    cameraPosition?: { x: number; y: number; z: number };
  }) => RemoteHeroBatchBenchmarkFrameStats;
  dispose: () => void;
}

interface RemoteMaterialOptions {
  color: string;
  roughness: number;
  metalness: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  toneMapped: boolean;
  vertexColors?: boolean;
}

interface RemoteSocketRegistration {
  object: THREE.Object3D;
  cleanup: () => void;
}

type CompleteBoneRefs = Record<HeroBoneName, THREE.Group>;

interface RemoteHeroRuntime {
  playerId: string;
  heroId: HeroId;
  seenGeneration: number;
  bodyRoot: THREE.Group;
  bones: CompleteBoneRefs;
  sockets: Map<string, RemoteSocketRegistration>;
  idleBlend: number;
  movementBlend: number;
  crouchBlend: number;
  jumpBlend: number;
  slideBlend: number;
  attackBlend: number;
  poseTransition: HeroBodyPoseTransitionRuntime;
  targetMovementPose: HeroMovementPose;
  previousMovementProfile: HeroMovementProfile;
  currentMovementProfile: HeroMovementProfile;
  movementProfileBlend: number;
  movementCycle: number;
  postureScaleY: number;
  smoothedWalkDirection: HeroWalkDirection;
  wasJumping: boolean;
  jumpStartedAt: number | null;
  currentPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  previousFramePosition: THREE.Vector3;
  visualPosition: { x: number; y: number; z: number };
  sampledTransform: SampledRemoteTransform;
  remoteEpoch: number | null;
  initialized: boolean;
  renderYaw: number;
  renderPitch: number;
  rootPosition: THREE.Vector3;
  rootPoseTransform: HeroBodyPoseRootTransform;
  yawQuaternion: THREE.Quaternion;
  rootQuaternion: THREE.Quaternion;
  rootRotation: THREE.Euler;
  rootScale: THREE.Vector3;
  playerMatrix: THREE.Matrix4;
  bodyLocalMatrix: THREE.Matrix4;
  bodyWorldMatrix: THREE.Matrix4;
  finalMatrix: THREE.Matrix4;
  glowPulse: number;
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
const PHANTOM_PERSONAL_SHIELD_ABILITY_ID = 'phantom_personal_shield';
const INSTANCE_EMISSIVE_ATTRIBUTE = 'instanceEmissiveBoost';
const WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
const WORLD_UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const REMOTE_BATCH_PREWARM_PLAYER_CAPACITY = 4;
const REMOTE_BATCH_CAPACITY_GROWTH_PADDING = 2;
const BATTLE_ROYAL_MAX_REMOTE_FULL_BODY_DISTANCE = 88;
const BATTLE_ROYAL_MAX_REMOTE_OUTLINE_DISTANCE = 112;
const BATTLE_ROYAL_REMOTE_ACTIVITY_BODY_DISTANCE = 96;
const BATTLE_ROYAL_REMOTE_ACTIVITY_OUTLINE_DISTANCE = 128;
const BATTLE_ROYAL_TEAM_SILHOUETTE_OUTLINE_SCALE = 1.22;
const BATTLE_ROYAL_TEAM_SILHOUETTE_OUTLINE_OPACITY = 0.92;
const teamColorCache = new Map<Team, THREE.Color>();

function isHeroId(value: string | null | undefined): value is HeroId {
  return Boolean(value && HERO_BODY_MANIFESTS[value as HeroId]);
}

function resolveHeroId(player: Player): HeroId {
  return isHeroId(player.heroId) ? player.heroId : 'phantom';
}

function getRemoteHeroResourceKey(player: Player): string {
  return resolveHeroId(player);
}

function createRemoteBatchResourcesForKey(key: string): RemoteBatchResources {
  const heroId = key as HeroId;
  recordFrameAllocation('remoteHeroBatch.resourceCreated');
  return createRemoteBatchResources(heroId);
}

function getCachedRemoteBatchResources(
  cache: Map<string, RemoteBatchResources>,
  key: string
): RemoteBatchResources {
  let resource = cache.get(key);
  if (!resource) {
    resource = createRemoteBatchResourcesForKey(key);
    cache.set(key, resource);
  }
  return resource;
}

function buildRemoteHeroRenderGroups(
  players: readonly Player[],
  resourcePlayers: readonly Player[],
  cache: Map<string, RemoteBatchResources>
): RemoteHeroRenderGroup[] {
  const playerGroupsByKey = new Map<string, Player[]>();
  const resourcePlayerCountsByKey = new Map<string, number>();

  const ensureResourceKey = (key: string): void => {
    if (resourcePlayerCountsByKey.has(key)) return;
    resourcePlayerCountsByKey.set(key, 0);
  };

  for (const player of resourcePlayers) {
    const key = getRemoteHeroResourceKey(player);
    ensureResourceKey(key);
    resourcePlayerCountsByKey.set(key, resourcePlayerCountsByKey.get(key)! + 1);
  }

  for (const player of players) {
    const key = getRemoteHeroResourceKey(player);
    ensureResourceKey(key);
    let groupPlayers = playerGroupsByKey.get(key);
    if (!groupPlayers) {
      groupPlayers = [];
      playerGroupsByKey.set(key, groupPlayers);
    }
    groupPlayers.push(player);
    if (groupPlayers.length > resourcePlayerCountsByKey.get(key)!) {
      resourcePlayerCountsByKey.set(key, groupPlayers.length);
    }
  }

  const renderKeys = Array.from(playerGroupsByKey.keys()).sort();
  const groups: RemoteHeroRenderGroup[] = [];
  for (const key of renderKeys) {
    const groupPlayers = playerGroupsByKey.get(key);
    if (!groupPlayers) continue;
    groups.push({
      key,
      players: groupPlayers,
      resourcePlayerCount: Math.max(resourcePlayerCountsByKey.get(key) ?? 0, groupPlayers.length),
      resource: getCachedRemoteBatchResources(cache, key),
    });
  }
  return groups;
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

function setWalkDirectionFromVelocity(
  target: HeroWalkDirection,
  velocity: { x: number; z: number },
  yaw: number
): void {
  setWalkDirectionFromComponents(target, velocity.x, velocity.z, yaw);
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

function getActivePhantomShieldStartedAt(player: Player): number | null {
  if (player.state !== 'alive' || player.heroId !== 'phantom') return null;

  const shield = player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
  if (!shield?.isActive) return null;

  return shield.activatedAt ?? null;
}

function hasRecentRemoteAttack(player: Player, visualState: VisualState, frameNowMs: number): boolean {
  const attackState = visualState.remotePlayerAttackStates.get(player.id);
  if (!attackState) return false;
  const attackAgeMs = frameNowMs - attackState.startedAtMs;
  if (attackAgeMs > REMOTE_ATTACK_STATE_CLEANUP_MS) {
    visualState.remotePlayerAttackStates.delete(player.id);
    return false;
  }
  return attackAgeMs <= REMOTE_ATTACK_STATE_RETENTION_MS;
}

function hasActiveRemoteBodyEffect(player: Player, visualState: VisualState, frameNowMs: number): boolean {
  return (
    visualState.activeBlazeFlamethrowerPlayerIdSet.has(player.id) ||
    visualState.activeBlazeBurningPlayerIdSet.has(player.id) ||
    visualState.activeChronosAegisPlayerIdSet.has(player.id) ||
    visualState.activeChronosAscendantPlayerIdSet.has(player.id) ||
    (player.onFireUntil ?? 0) > frameNowMs
  );
}

function isObjectivePriorityRemoteBody(player: Player): boolean {
  return player.hasFlag;
}

function isActivityPriorityRemoteBody(player: Player, visualState: VisualState, frameNowMs: number): boolean {
  return (
    hasActivePhantomVeil(player) ||
    getActivePhantomShieldStartedAt(player) !== null ||
    hasRecentRemoteAttack(player, visualState, frameNowMs) ||
    hasActiveRemoteBodyEffect(player, visualState, frameNowMs)
  );
}

function getPlayerRenderMovement(
  player: Player,
  visualState: VisualState,
  localPlayerId: string | null | undefined
): PlayerMovementState {
  return player.id === localPlayerId ? visualState.localMovement : player.movement;
}

function getBattleRoyalDistanceCap(distance: number, cap: number): number {
  return Number.isFinite(distance) ? Math.min(distance, cap) : cap;
}

function getDistanceLimitSq(distance: number): number {
  if (!Number.isFinite(distance)) return Number.POSITIVE_INFINITY;
  return distance > 0 ? distance * distance : -1;
}

function getScaledDistanceLimitSq(distance: number, scale: number): number {
  if (!Number.isFinite(distance)) return Number.POSITIVE_INFINITY;
  return getDistanceLimitSq(distance * Math.max(0, scale));
}

function getPlayerDistanceLimitSq(
  player: Player,
  localPlayerId: string | null | undefined,
  localPlayerTeam: Team | null | undefined,
  baseDistance: number,
  baseDistanceSq: number,
  botDistanceScale: number,
  isBattleRoyal: boolean
): number {
  if (
    !isBattleRoyal ||
    !player.isBot ||
    player.id === localPlayerId ||
    (localPlayerTeam && player.team === localPlayerTeam) ||
    player.hasFlag
  ) {
    return baseDistanceSq;
  }
  return getScaledDistanceLimitSq(baseDistance, botDistanceScale);
}

function getTeamColor(team: Team): THREE.Color {
  let color = teamColorCache.get(team);
  if (!color) {
    color = new THREE.Color(TEAM_COLORS[team] ?? '#ffffff');
    teamColorCache.set(team, color);
  }
  return color;
}

function isWithinDistanceLimitSq(camera: THREE.Camera, position: THREE.Vector3, maxDistanceSq: number): boolean {
  if (maxDistanceSq === Number.POSITIVE_INFINITY) return true;
  if (maxDistanceSq < 0) return false;

  const dx = camera.position.x - position.x;
  const dy = camera.position.y - position.y;
  const dz = camera.position.z - position.z;
  return dx * dx + dy * dy + dz * dz <= maxDistanceSq;
}

function isWithinPointDistanceLimitSq(
  origin: { x: number; y: number; z: number },
  position: THREE.Vector3,
  maxDistanceSq: number
): boolean {
  if (maxDistanceSq === Number.POSITIVE_INFINITY) return true;
  if (maxDistanceSq < 0) return false;

  const dx = origin.x - position.x;
  const dy = origin.y - position.y;
  const dz = origin.z - position.z;
  return dx * dx + dy * dy + dz * dz <= maxDistanceSq;
}

function getRemotePlayerHeight(player: Player): number {
  return getPlayerHeight(player.heroId);
}

function getOutlineScale(
  scale: VoxelPart['scale'],
  outlineScale = TEAM_BODY_GLOW_OUTLINE_SCALE
): VoxelPart['scale'] {
  return [
    scale[0] * outlineScale,
    scale[1] * outlineScale,
    scale[2] * outlineScale,
  ];
}

function createOutlineDescriptor(descriptor: RemotePartDescriptor): RemotePartDescriptor {
  const scale = getOutlineScale(descriptor.scale);
  const battleRoyalScale = getOutlineScale(
    descriptor.scale,
    BATTLE_ROYAL_TEAM_SILHOUETTE_OUTLINE_SCALE
  );
  return {
    ...descriptor,
    scale,
    localMatrix: createPartLocalMatrix(descriptor.meshOffset, scale, descriptor.rotation),
    battleRoyalLocalMatrix: createPartLocalMatrix(
      descriptor.meshOffset,
      battleRoyalScale,
      descriptor.rotation
    ),
  };
}

function createBoneRefs(): { bodyRoot: THREE.Group; bones: CompleteBoneRefs } {
  const bodyRoot = new THREE.Group();
  bodyRoot.matrixAutoUpdate = false;

  const bones = Object.fromEntries(
    (Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]).map((bone) => [bone, new THREE.Group()])
  ) as CompleteBoneRefs;

  for (const bone of Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]) {
    const parent = HERO_BONE_PARENTS[bone];
    if (parent) {
      bones[parent].add(bones[bone]);
    } else {
      bodyRoot.add(bones[bone]);
    }
  }

  return { bodyRoot, bones };
}

function resetRemoteAnimationState(runtime: RemoteHeroRuntime, player: Player): void {
  const heroId = runtime.heroId;
  const moving = isPlayerMovingForAnimation(player);
  const hasLoweredPosture = player.movement.isCrouching || player.movement.isSliding;
  const movementPose = getPlayerMovementPose(player, hasLoweredPosture, moving);
  const movementProfile = getHeroMovementProfile(heroId, movementPose);

  runtime.idleBlend = moving || player.movement.isCrouching || player.movement.isSliding ? 0 : 1;
  runtime.movementBlend = moving ? 1 : 0;
  runtime.crouchBlend = player.movement.isCrouching ? 1 : 0;
  runtime.jumpBlend = !player.movement.isGrounded ? 1 : 0;
  runtime.slideBlend = player.movement.isSliding ? 1 : 0;
  runtime.attackBlend = 0;
  runtime.postureScaleY = getPlayerBodyPostureScaleY(player.movement);
  runtime.targetMovementPose = movementPose;
  runtime.previousMovementProfile = movementProfile;
  runtime.currentMovementProfile = movementProfile;
  runtime.movementProfileBlend = 1;
  runtime.movementCycle = 0;
  runtime.smoothedWalkDirection = { ...DEFAULT_WALK_DIRECTION };
  runtime.wasJumping = false;
  runtime.jumpStartedAt = null;
  runtime.glowPulse = 0;
  resetHeroBodyPoseTransitionRuntime(runtime.poseTransition);
}

function clearSocketRegistrations(runtime: RemoteHeroRuntime): void {
  for (const registration of runtime.sockets.values()) {
    registration.cleanup();
    registration.object.removeFromParent();
  }
  runtime.sockets.clear();
}

function syncSocketRegistrations(runtime: RemoteHeroRuntime): void {
  clearSocketRegistrations(runtime);
  const manifest = HERO_BODY_MANIFESTS[runtime.heroId];

  for (const marker of manifest.remoteSocketMarkers ?? EMPTY_REMOTE_SOCKET_MARKERS) {
    const bone = runtime.bones[marker.bone];
    const object = new THREE.Group();
    object.position.set(...marker.position);
    bone.add(object);
    runtime.sockets.set(marker.socketName, {
      object,
      cleanup: registerRemoteModelSocket(
        runtime.playerId,
        marker.socketName,
        object,
        'fullBody'
      ),
    });
  }
}

function createRemoteRuntime(player: Player): RemoteHeroRuntime {
  const heroId = resolveHeroId(player);
  const { bodyRoot, bones } = createBoneRefs();
  const initialPosition = setPlayerRenderOrigin(new THREE.Vector3(), player.position);
  const visualPosition = {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
  };
  const rootPosition = new THREE.Vector3();
  const rootQuaternion = new THREE.Quaternion();
  const rootScale = new THREE.Vector3(1, 1, 1);
  const initialMovementPose = getPlayerMovementPose(
    player,
    player.movement.isCrouching || player.movement.isSliding,
    isPlayerMovingForAnimation(player)
  );
  const initialMovementProfile = getHeroMovementProfile(heroId, initialMovementPose);
  const runtime: RemoteHeroRuntime = {
    playerId: player.id,
    heroId,
    seenGeneration: 0,
    bodyRoot,
    bones,
    sockets: new Map(),
    idleBlend: 1,
    movementBlend: 0,
    crouchBlend: 0,
    jumpBlend: 0,
    slideBlend: 0,
    attackBlend: 0,
    poseTransition: createHeroBodyPoseTransitionRuntime(),
    targetMovementPose: initialMovementPose,
    previousMovementProfile: initialMovementProfile,
    currentMovementProfile: initialMovementProfile,
    movementProfileBlend: 1,
    movementCycle: 0,
    postureScaleY: getPlayerBodyPostureScaleY(player.movement),
    smoothedWalkDirection: { ...DEFAULT_WALK_DIRECTION },
    wasJumping: false,
    jumpStartedAt: null,
    currentPosition: initialPosition.clone(),
    targetPosition: initialPosition.clone(),
    previousFramePosition: initialPosition.clone(),
    visualPosition,
    sampledTransform: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      lookYaw: 0,
      lookPitch: 0,
      movementBits: 0,
      wallRunSide: 0,
      movementEpoch: 0,
      extrapolatedMs: 0,
      stale: false,
    },
    remoteEpoch: null,
    initialized: false,
    renderYaw: player.lookYaw,
    renderPitch: player.lookPitch,
    rootPosition,
    rootPoseTransform: {
      position: rootPosition,
      quaternion: rootQuaternion,
      scale: rootScale,
    },
    yawQuaternion: new THREE.Quaternion(),
    rootQuaternion,
    rootRotation: new THREE.Euler(),
    rootScale,
    playerMatrix: new THREE.Matrix4(),
    bodyLocalMatrix: new THREE.Matrix4(),
    bodyWorldMatrix: new THREE.Matrix4(),
    finalMatrix: new THREE.Matrix4(),
    glowPulse: 0,
  };

  resetRemoteAnimationState(runtime, player);
  syncSocketRegistrations(runtime);
  return runtime;
}

function updateRuntimeHero(runtime: RemoteHeroRuntime, player: Player): void {
  const nextHeroId = resolveHeroId(player);
  if (runtime.heroId === nextHeroId) return;
  runtime.heroId = nextHeroId;
  resetRemoteAnimationState(runtime, player);
  syncSocketRegistrations(runtime);
}

function disposeRemoteRuntime(runtime: RemoteHeroRuntime): void {
  clearSocketRegistrations(runtime);
  runtime.bodyRoot.clear();
}

function updateRemoteTransform(
  runtime: RemoteHeroRuntime,
  player: Player,
  delta: number,
  visualState: VisualState,
  frameNowMs: number
): number {
  if (!runtime.initialized) {
    const initialPos = visualState.playerPositions.get(player.id);
    setPlayerRenderOrigin(runtime.currentPosition, initialPos ?? player.position);
    runtime.previousFramePosition.copy(runtime.currentPosition);
    runtime.initialized = true;
  }

  const sampledTransform = runtime.sampledTransform;
  const hasSampledTransform = sampleRemoteTransformHistoryInto(
    visualState.remoteTransformHistories.get(player.id),
    sampledTransform,
    frameNowMs
  );
  let snappedToSample = false;

  if (hasSampledTransform) {
    setPlayerRenderOrigin(runtime.targetPosition, sampledTransform.position);
    const epochChanged = runtime.remoteEpoch !== null && runtime.remoteEpoch !== sampledTransform.movementEpoch;
    const tooFarForSmoothing = runtime.currentPosition.distanceToSquared(runtime.targetPosition) >
      REMOTE_SAMPLE_SNAP_DISTANCE * REMOTE_SAMPLE_SNAP_DISTANCE;
    if (epochChanged || tooFarForSmoothing) {
      runtime.currentPosition.copy(runtime.targetPosition);
      snappedToSample = true;
    } else {
      runtime.currentPosition.lerp(
        runtime.targetPosition,
        smoothingFactor(REMOTE_SAMPLE_POSITION_SMOOTHING, delta)
      );
    }
    runtime.remoteEpoch = sampledTransform.movementEpoch;
  } else {
    const targetPos = visualState.playerPositions.get(player.id);
    setPlayerRenderOrigin(runtime.targetPosition, targetPos ?? player.position);
    runtime.currentPosition.lerp(runtime.targetPosition, Math.min(1, delta * 15));
  }

  const targetRot = visualState.playerRotations.get(player.id);
  const renderYaw = hasSampledTransform ? sampledTransform.lookYaw : targetRot ?? player.lookYaw;
  const renderPitch = hasSampledTransform
    ? sampledTransform.lookPitch
    : getPlayerVisualLookPitch(visualState, player);
  if (hasSampledTransform && !snappedToSample) {
    runtime.renderYaw = lerpAngle(
      runtime.renderYaw,
      sampledTransform.lookYaw,
      smoothingFactor(REMOTE_SAMPLE_ROTATION_SMOOTHING, delta)
    );
    runtime.renderPitch = THREE.MathUtils.damp(
      runtime.renderPitch,
      renderPitch,
      HERO_LOOK_PITCH_WAIST_DAMPING,
      delta
    );
  } else if (hasSampledTransform) {
    runtime.renderYaw = sampledTransform.lookYaw;
    runtime.renderPitch = renderPitch;
  } else {
    runtime.renderYaw = renderYaw;
    runtime.renderPitch = THREE.MathUtils.damp(
      runtime.renderPitch,
      renderPitch,
      HERO_LOOK_PITCH_WAIST_DAMPING,
      delta
    );
  }

  runtime.visualPosition.x = runtime.currentPosition.x;
  runtime.visualPosition.y = runtime.currentPosition.y + PLAYER_CENTER_TO_FEET;
  runtime.visualPosition.z = runtime.currentPosition.z;
  setRenderedPlayerVisualTransform(player.id, runtime.visualPosition, runtime.renderYaw);

  const visualHorizontalSpeed = delta > 0
    ? Math.sqrt(
      (runtime.currentPosition.x - runtime.previousFramePosition.x) ** 2 +
      (runtime.currentPosition.z - runtime.previousFramePosition.z) ** 2
    ) / delta
    : 0;

  if (visualHorizontalSpeed > VISUAL_MOVING_SPEED && delta > 0) {
    setWalkDirectionFromComponents(
      runtime.smoothedWalkDirection,
      runtime.currentPosition.x - runtime.previousFramePosition.x,
      runtime.currentPosition.z - runtime.previousFramePosition.z,
      runtime.renderYaw
    );
  } else {
    setWalkDirectionFromVelocity(
      runtime.smoothedWalkDirection,
      hasSampledTransform ? sampledTransform.velocity : player.velocity,
      runtime.renderYaw
    );
  }

  runtime.previousFramePosition.copy(runtime.currentPosition);
  return visualHorizontalSpeed;
}

function updateRemotePose(
  runtime: RemoteHeroRuntime,
  player: Player,
  movement: PlayerMovementState,
  delta: number,
  elapsedSeconds: number,
  visualHorizontalSpeed: number,
  visualState: VisualState,
  frameNowMs: number
): void {
  const frameDelta = Math.min(delta, 0.05);
  const heroId = runtime.heroId;
  const manifest = HERO_BODY_MANIFESTS[heroId];
  const playerHeight = getRemotePlayerHeight(player);
  const scale = playerHeight / 1.8;
  const targetPostureScaleY = getPlayerBodyPostureScaleY(movement);
  runtime.postureScaleY = THREE.MathUtils.damp(
    runtime.postureScaleY,
    targetPostureScaleY,
    targetPostureScaleY < runtime.postureScaleY ? 13 : 10,
    frameDelta
  );
  const baseScaleY = scale * runtime.postureScaleY;
  const moving = isPlayerMovingForAnimation(player, visualHorizontalSpeed, movement);
  const jumping = !movement.isGrounded && !movement.isSliding;
  const crouching = movement.isCrouching;
  const sliding = movement.isSliding;
  let attacking = false;
  let attackStartedAtMs: number | null = null;
  let attackSide: -1 | 1 = 1;

  const remoteAttackState = visualState.remotePlayerAttackStates.get(player.id);
  const shieldStartedAt = getActivePhantomShieldStartedAt(player);
  if (remoteAttackState) {
    const attackAgeMs = frameNowMs - remoteAttackState.startedAtMs;
    attacking = attackAgeMs <= REMOTE_ATTACK_STATE_RETENTION_MS;
    attackStartedAtMs = remoteAttackState.startedAtMs;
    attackSide = remoteAttackState.side;

    if (attackAgeMs > REMOTE_ATTACK_STATE_CLEANUP_MS) {
      visualState.remotePlayerAttackStates.delete(player.id);
    }
  }

  let attackProgress = 1;
  const attackDuration = manifest.attackDurationSeconds;
  let activeAttackSide = attackSide;
  if (attacking && attackStartedAtMs && attackStartedAtMs > 0) {
    attackProgress = clamp01((frameNowMs - attackStartedAtMs) / (attackDuration * 1000));
    attacking = attackProgress < 1;
  } else if (attacking) {
    const attackCycle = elapsedSeconds / attackDuration;
    const attackCycleIndex = Math.floor(attackCycle);
    attackProgress = attackCycle - attackCycleIndex;
    if (heroId === 'hookshot' || heroId === 'phantom') {
      activeAttackSide = attackCycleIndex % 2 === 0 ? 1 : -1;
    }
  }

  const movementPose = getPlayerMovementPose(player, crouching || sliding, moving, movement);
  if (runtime.targetMovementPose !== movementPose) {
    runtime.previousMovementProfile = runtime.currentMovementProfile;
    runtime.targetMovementPose = movementPose;
    runtime.movementProfileBlend = 0;
  }

  runtime.movementProfileBlend = THREE.MathUtils.damp(
    runtime.movementProfileBlend,
    1,
    6.5,
    frameDelta
  );
  const movementProfile = lerpMovementProfile(
    runtime.previousMovementProfile,
    getHeroMovementProfile(heroId, runtime.targetMovementPose),
    runtime.movementProfileBlend
  );
  runtime.currentMovementProfile = movementProfile;

  const targetWalkDirection = getNormalizedWalkDirection(runtime.smoothedWalkDirection);
  const directionDampSpeed = moving && !jumping && !sliding
    ? (runtime.targetMovementPose === 'run' ? 11.5 : 9.5)
    : 6;
  runtime.smoothedWalkDirection.forward = THREE.MathUtils.damp(
    runtime.smoothedWalkDirection.forward,
    targetWalkDirection.forward,
    directionDampSpeed,
    frameDelta
  );
  runtime.smoothedWalkDirection.right = THREE.MathUtils.damp(
    runtime.smoothedWalkDirection.right,
    targetWalkDirection.right,
    directionDampSpeed,
    frameDelta
  );

  const smoothedWalkDirectionLength = Math.sqrt(
    runtime.smoothedWalkDirection.forward * runtime.smoothedWalkDirection.forward +
    runtime.smoothedWalkDirection.right * runtime.smoothedWalkDirection.right
  );
  if (smoothedWalkDirectionLength > 1) {
    runtime.smoothedWalkDirection.forward /= smoothedWalkDirectionLength;
    runtime.smoothedWalkDirection.right /= smoothedWalkDirectionLength;
  }

  const bones = runtime.bones as HeroBoneRefs;
  const poseBlendKey = getHeroBodyPoseBlendKey({
    heroId,
    moving,
    jumping,
    crouching,
    sliding,
    attacking,
    attackSide: activeAttackSide,
    movementPose: runtime.targetMovementPose,
    idleEnabled: true,
    shieldActive: Boolean(shieldStartedAt),
  });
  beginHeroBodyPoseTransition(
    runtime.poseTransition,
    poseBlendKey,
    runtime.rootPoseTransform,
    bones
  );
  setBoneBasePose(bones);

  if (jumping) {
    if (!runtime.wasJumping || runtime.jumpStartedAt === null) {
      runtime.jumpStartedAt = elapsedSeconds;
    }
  } else if (runtime.jumpBlend <= 0.001) {
    runtime.jumpStartedAt = null;
  }
  runtime.wasJumping = jumping;

  const targetMovementBlend = moving && !jumping && !sliding ? 1 : 0;
  const targetCrouchBlend = crouching && !jumping && !sliding ? 1 : 0;
  const targetJumpBlend = jumping ? 1 : 0;
  const targetSlideBlend = sliding && !jumping ? 1 : 0;
  const targetAttackBlend = attacking ? 1 : 0;
  runtime.movementBlend = THREE.MathUtils.damp(
    runtime.movementBlend,
    targetMovementBlend,
    targetMovementBlend > runtime.movementBlend ? 7.5 : 8.5,
    frameDelta
  );
  runtime.crouchBlend = THREE.MathUtils.damp(
    runtime.crouchBlend,
    targetCrouchBlend,
    targetCrouchBlend > runtime.crouchBlend ? 8 : 7,
    frameDelta
  );
  runtime.jumpBlend = THREE.MathUtils.damp(
    runtime.jumpBlend,
    targetJumpBlend,
    targetJumpBlend > runtime.jumpBlend ? 9.5 : 7.5,
    frameDelta
  );
  runtime.slideBlend = THREE.MathUtils.damp(
    runtime.slideBlend,
    targetSlideBlend,
    targetSlideBlend > runtime.slideBlend ? 11 : 7.5,
    frameDelta
  );
  runtime.attackBlend = THREE.MathUtils.damp(
    runtime.attackBlend,
    targetAttackBlend,
    targetAttackBlend > runtime.attackBlend ? 14 : 8.5,
    frameDelta
  );

  const targetIdleBlend = moving || jumping || crouching || sliding || attacking ? 0 : 1;
  runtime.idleBlend = THREE.MathUtils.damp(
    runtime.idleBlend,
    targetIdleBlend,
    moving || jumping || crouching || sliding || attacking ? 9.5 : 5.5,
    frameDelta
  );

  const slideAmount = easeInOutSine(runtime.slideBlend);
  const runSlideCrossfadeAmount = runtime.targetMovementPose === 'run' ? slideAmount : 0;
  const attackAmount = easeInOutSine(runtime.attackBlend);
  const attackPosePulse = heroId === 'blaze' || heroId === 'phantom'
    ? getBlazeAttackPoseAmount(attackProgress)
    : Math.sin(attackProgress * Math.PI);
  const attackPulse = attackPosePulse * attackAmount;
  const rootAttackPulse = heroId === 'phantom' ? 0 : attackPulse;
  const shieldPoseAmount = getPhantomShieldBodyPoseAmount(shieldStartedAt, frameNowMs);
  const idleAmount = runtime.idleBlend;
  const movingAmount = runtime.movementBlend * (1 - runSlideCrossfadeAmount);
  const jumpAmount = runtime.jumpBlend;
  const poseCrouchAmount = runtime.crouchBlend;
  const jumpTime = runtime.jumpStartedAt === null ? 0 : elapsedSeconds - runtime.jumpStartedAt;
  const jumpPose = getJumpPose(jumpTime);
  if (movingAmount > 0.001) {
    runtime.movementCycle = (
      runtime.movementCycle + frameDelta * movementProfile.cycleSpeed
    ) % (Math.PI * 2);
  }
  const movementCycleTime = runtime.movementCycle;
  const movementStep = 0.5 + 0.5 * Math.sin(movementCycleTime * 2);
  const movementSway = Math.sin(movementCycleTime);
  const idleProfile = manifest.idleProfile;
  const idleTime = elapsedSeconds * IDLE_SPEED_MULTIPLIER;
  const primary = Math.sin(idleTime * idleProfile.cycleSpeed + idleProfile.phase);
  const secondary = Math.sin(idleTime * idleProfile.cycleSpeed * 0.57 + idleProfile.phase + 1.1);
  const tertiary = Math.sin(idleTime * idleProfile.cycleSpeed * 1.31 + idleProfile.phase * 0.5);
  const slideSkid = Math.sin(elapsedSeconds * 8.5) * 0.012 * slideAmount;

  runtime.rootPosition.set(
    0,
    jumpPose.rootLift * jumpAmount +
      movementStep * movementProfile.rootBob * movingAmount -
      0.09 * poseCrouchAmount +
      Math.sin(elapsedSeconds * 2.2) * 0.006 * poseCrouchAmount -
      0.31 * slideAmount +
      0.012 * rootAttackPulse,
    -0.24 * slideAmount + slideSkid - 0.035 * rootAttackPulse
  );
  runtime.rootRotation.set(
    secondary * idleProfile.swayAmplitude * 0.08 * idleAmount -
      runtime.smoothedWalkDirection.forward * movementProfile.rootPitch * movingAmount +
      jumpPose.pitch * jumpAmount +
      -0.025 * poseCrouchAmount +
      0.6 * slideAmount -
      0.035 * rootAttackPulse,
    tertiary * idleProfile.twistAmplitude * 0.12 * idleAmount +
      activeAttackSide * 0.025 * rootAttackPulse,
    secondary * idleProfile.swayAmplitude * 0.12 * idleAmount -
      runtime.smoothedWalkDirection.right * movementProfile.rootRoll * movingAmount +
      movementSway * movementProfile.rootSway * movingAmount +
      0.055 * slideAmount -
      activeAttackSide * 0.018 * rootAttackPulse
  );
  runtime.rootQuaternion.setFromEuler(runtime.rootRotation);

  const jumpSquash = jumpPose.crouch * 0.035 + jumpPose.land * 0.026;
  const jumpStretch = jumpPose.extension * 0.026;
  const jumpScaleY = 1 - jumpSquash + jumpStretch;
  const jumpScaleXZ = 1 + jumpSquash * 0.45 - jumpStretch * 0.28;
  const crouchScaleY = 1 - 0.055 * poseCrouchAmount;
  const crouchScaleXZ = 1 + 0.012 * poseCrouchAmount;
  runtime.rootScale.set(
    scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ,
    baseScaleY * THREE.MathUtils.lerp(1, jumpScaleY, jumpAmount) * crouchScaleY,
    scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ
  );

  applyIdleBonePose(bones, idleProfile, primary, secondary, tertiary, idleAmount);
  applyJumpBonePose(bones, jumpPose, jumpAmount);
  applyCrouchBonePose(bones, elapsedSeconds, poseCrouchAmount);
  if (heroId === 'chronos') {
    applyChronosArmPose(bones, 1 - slideAmount);
  }
  applyWalkingBonePose(bones, movementCycleTime, movingAmount, runtime.smoothedWalkDirection, movementProfile);
  applySlideBonePose(bones, elapsedSeconds, slideAmount);
  applyHeroAttackPose(heroId, bones, attackProgress, attackAmount, activeAttackSide);
  applyPhantomShieldBodyPose(bones, shieldPoseAmount);
  applyHeroBodyPoseTransition(
    runtime.poseTransition,
    runtime.rootPoseTransform,
    bones,
    frameDelta
  );
  applyLookPitchWaistBend(bones, runtime.renderPitch);

  runtime.glowPulse =
    (0.5 + 0.5 * tertiary) * idleProfile.auraPulse * idleAmount +
    (jumpPose.extension * 0.18 + jumpPose.land * 0.14) * jumpAmount +
    movementStep * movementProfile.glowPulse * movingAmount +
    0.035 * poseCrouchAmount +
    0.09 * slideAmount +
    0.16 * attackPulse +
    0.14 * shieldPoseAmount;
}

function updateBodyWorldMatrix(runtime: RemoteHeroRuntime): void {
  runtime.playerMatrix.compose(
    runtime.currentPosition,
    runtime.yawQuaternion.setFromAxisAngle(WORLD_UP_AXIS, runtime.renderYaw),
    WORLD_UNIT_SCALE
  );
  runtime.bodyLocalMatrix.compose(runtime.rootPosition, runtime.rootQuaternion, runtime.rootScale);
  runtime.bodyWorldMatrix.multiplyMatrices(runtime.playerMatrix, runtime.bodyLocalMatrix);
  runtime.bodyRoot.matrix.copy(runtime.bodyWorldMatrix);
  runtime.bodyRoot.updateMatrixWorld(true);
}

function setPartMatrix(
  runtime: RemoteHeroRuntime,
  descriptor: RemotePartDescriptor,
  localMatrix = descriptor.localMatrix
): THREE.Matrix4 {
  const parentMatrix = descriptor.bone === 'root'
    ? runtime.bodyRoot.matrixWorld
    : runtime.bones[descriptor.bone].matrixWorld;
  runtime.finalMatrix.multiplyMatrices(parentMatrix, localMatrix);
  return runtime.finalMatrix;
}

function countBatchDescriptorsForPlayers(
  batches: readonly (RemotePartBatch | RemoteOutlineBatch)[],
  players: readonly Player[]
): number {
  let total = 0;
  for (const batch of batches) {
    let playersForBatch = 0;
    for (const player of players) {
      if (shouldRenderBatchForPlayer(batch.playerFilter, player)) playersForBatch++;
    }
    total += Math.max(1, playersForBatch) * batch.capacityPerPlayer;
  }
  return total;
}

export function createRemoteHeroBatchBenchmarkRunner(options: {
  players: readonly Player[];
  resourcePlayers?: readonly Player[];
  isBattleRoyal?: boolean;
  localPlayerId?: string | null;
  localPlayerTeam?: Team | null;
  config: RemotePlayerQualityConfig;
  cameraPosition?: { x: number; y: number; z: number };
}): RemoteHeroBatchBenchmarkRunner {
  const {
    players,
    resourcePlayers = players,
    isBattleRoyal = false,
    localPlayerId = null,
    localPlayerTeam = null,
    config,
  } = options;
  const resourceCache = new Map<string, RemoteBatchResources>();
  const groups = buildRemoteHeroRenderGroups(players, resourcePlayers, resourceCache);
  const groupCounters = groups.map((group) => ({
    normal: new Uint32Array(group.resource.batches.length),
    outline: new Uint32Array(group.resource.outlineBatches.length),
  }));
  const runtimes = new Map<string, RemoteHeroRuntime>();
  const cameraPosition = new THREE.Vector3(
    options.cameraPosition?.x ?? 0,
    options.cameraPosition?.y ?? 0,
    options.cameraPosition?.z ?? 0
  );
  const normalMatrixSink = new Float32Array(
    Math.max(16, groups.reduce((total, group) => (
      total + countBatchDescriptorsForPlayers(group.resource.batches, group.players)
    ), 0) * 16)
  );
  const outlineMatrixSink = new Float32Array(
    Math.max(16, groups.reduce((total, group) => (
      total + countBatchDescriptorsForPlayers(group.resource.outlineBatches, group.players)
    ), 0) * 16)
  );
  const fullBodyDistance = isBattleRoyal
    ? getBattleRoyalDistanceCap(config.fullBodyDistance, BATTLE_ROYAL_MAX_REMOTE_FULL_BODY_DISTANCE)
    : config.fullBodyDistance;
  const outlineDistance = isBattleRoyal
    ? getBattleRoyalDistanceCap(config.outlineDistance, BATTLE_ROYAL_MAX_REMOTE_OUTLINE_DISTANCE)
    : config.outlineDistance;
  const fullBodyDistanceSq = getDistanceLimitSq(fullBodyDistance);
  const outlineDistanceSq = getDistanceLimitSq(outlineDistance);
  const activityBodyDistanceSq = isBattleRoyal
    ? getDistanceLimitSq(BATTLE_ROYAL_REMOTE_ACTIVITY_BODY_DISTANCE)
    : Number.POSITIVE_INFINITY;
  const activityOutlineDistanceSq = isBattleRoyal
    ? getDistanceLimitSq(BATTLE_ROYAL_REMOTE_ACTIVITY_OUTLINE_DISTANCE)
    : Number.POSITIVE_INFINITY;
  let disposed = false;

  return {
    runFrame: ({ deltaSeconds, elapsedSeconds, nowMs, cameraPosition: nextCameraPosition }) => {
      if (disposed) {
        throw new Error('Remote hero batch benchmark runner has already been disposed');
      }
      if (nextCameraPosition) {
        cameraPosition.set(nextCameraPosition.x, nextCameraPosition.y, nextCameraPosition.z);
      }

      const visualState = visualStore.getState();
      const stats: RemoteHeroBatchBenchmarkFrameStats = {
        groups: groups.length,
        emptyGroups: 0,
        players: players.length,
        consideredPlayers: 0,
        bodyPlayers: 0,
        outlinePlayers: 0,
        normalMatrixWrites: 0,
        outlineMatrixWrites: 0,
        normalBatches: 0,
        outlineBatches: 0,
        mountedInstancedMeshes: 0,
        emptyMountedInstancedMeshes: 0,
        batchFinalizations: 0,
      };
      let normalMatrixOffset = 0;
      let outlineMatrixOffset = 0;

      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        if (!group) continue;
        const { resource } = group;
        const counters = groupCounters[groupIndex];
        counters?.normal.fill(0);
        counters?.outline.fill(0);
        stats.normalBatches += resource.batches.length;
        stats.outlineBatches += resource.outlineBatches.length;
        stats.mountedInstancedMeshes += resource.batches.length + resource.outlineBatches.length;
        if (group.players.length === 0) {
          stats.emptyGroups++;
          stats.emptyMountedInstancedMeshes += resource.batches.length + resource.outlineBatches.length;
        }

        for (const player of group.players) {
          let runtime = runtimes.get(player.id);
          if (!runtime) {
            runtime = createRemoteRuntime(player);
            runtimes.set(player.id, runtime);
          }
          updateRuntimeHero(runtime, player);
          if (runtime.heroId !== resource.heroId) continue;
          stats.consideredPlayers++;

          const movement = getPlayerRenderMovement(player, visualState, localPlayerId);
          const visualHorizontalSpeed = updateRemoteTransform(runtime, player, deltaSeconds, visualState, nowMs);
          const isLocalPlayer = player.id === localPlayerId;
          const isObjectivePriority = isObjectivePriorityRemoteBody(player);
          const isActivityPriority = isActivityPriorityRemoteBody(player, visualState, nowMs);
          const forceBodyForPriority = isLocalPlayer || isObjectivePriority || (
            isActivityPriority &&
            isWithinPointDistanceLimitSq(cameraPosition, runtime.currentPosition, activityBodyDistanceSq)
          );
          const playerFullBodyDistanceSq = getPlayerDistanceLimitSq(
            player,
            localPlayerId,
            localPlayerTeam,
            fullBodyDistance,
            fullBodyDistanceSq,
            config.botFullBodyDistanceScale ?? 1,
            isBattleRoyal
          );
          const renderBody = !hasActivePhantomVeil(player) && (
            forceBodyForPriority ||
            isWithinPointDistanceLimitSq(cameraPosition, runtime.currentPosition, playerFullBodyDistanceSq)
          );
          if (!renderBody) continue;

          stats.bodyPlayers++;
          updateRemotePose(
            runtime,
            player,
            movement,
            deltaSeconds,
            elapsedSeconds,
            visualHorizontalSpeed,
            visualState,
            nowMs
          );
          updateBodyWorldMatrix(runtime);

          for (let batchIndex = 0; batchIndex < resource.batches.length; batchIndex++) {
            const batch = resource.batches[batchIndex];
            if (!batch) continue;
            if (!shouldRenderBatchForPlayer(batch.playerFilter, player)) continue;
            let writeIndex = counters?.normal[batchIndex] ?? 0;
            for (const descriptor of batch.descriptors) {
              setPartMatrix(runtime, descriptor).toArray(normalMatrixSink, normalMatrixOffset);
              normalMatrixOffset = (normalMatrixOffset + 16) % normalMatrixSink.length;
              getDescriptorEmissiveBoost(descriptor, player, runtime.glowPulse);
              writeIndex++;
              stats.normalMatrixWrites++;
            }
            if (counters) counters.normal[batchIndex] = writeIndex;
          }

          const forceOutlineForPriority = isObjectivePriority || (
            isActivityPriority &&
            isWithinPointDistanceLimitSq(cameraPosition, runtime.currentPosition, activityOutlineDistanceSq)
          );
          const playerOutlineDistanceSq = getPlayerDistanceLimitSq(
            player,
            localPlayerId,
            localPlayerTeam,
            outlineDistance,
            outlineDistanceSq,
            config.botOutlineDistanceScale ?? 1,
            isBattleRoyal
          );
          const renderOutline = config.outlineDistance > 0 && (
            forceOutlineForPriority ||
            isWithinPointDistanceLimitSq(cameraPosition, runtime.currentPosition, playerOutlineDistanceSq)
          );
          if (!renderOutline) continue;

          stats.outlinePlayers++;
          for (let batchIndex = 0; batchIndex < resource.outlineBatches.length; batchIndex++) {
            const batch = resource.outlineBatches[batchIndex];
            if (!batch) continue;
            if (!shouldRenderBatchForPlayer(batch.playerFilter, player)) continue;
            let writeIndex = counters?.outline[batchIndex] ?? 0;
            for (const descriptor of batch.descriptors) {
              setPartMatrix(runtime, descriptor, getOutlineLocalMatrix(descriptor, isBattleRoyal))
                .toArray(outlineMatrixSink, outlineMatrixOffset);
              outlineMatrixOffset = (outlineMatrixOffset + 16) % outlineMatrixSink.length;
              writeIndex++;
              stats.outlineMatrixWrites++;
            }
            if (counters) counters.outline[batchIndex] = writeIndex;
          }
        }

        for (let batchIndex = 0; batchIndex < resource.batches.length; batchIndex++) {
          const count = counters?.normal[batchIndex] ?? 0;
          if (count > 0) normalMatrixSink[batchIndex % normalMatrixSink.length] = count;
          stats.batchFinalizations++;
        }
        for (let batchIndex = 0; batchIndex < resource.outlineBatches.length; batchIndex++) {
          const count = counters?.outline[batchIndex] ?? 0;
          if (count > 0) outlineMatrixSink[batchIndex % outlineMatrixSink.length] = count;
          stats.batchFinalizations++;
        }
      }

      return stats;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const runtime of runtimes.values()) {
        disposeRemoteRuntime(runtime);
      }
      runtimes.clear();
      for (const resource of resourceCache.values()) {
        resource.dispose();
      }
      resourceCache.clear();
    },
  };
}

function patchInstancedEmissiveMaterial(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float ${INSTANCE_EMISSIVE_ATTRIBUTE};
varying float vInstanceEmissiveBoost;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vInstanceEmissiveBoost = ${INSTANCE_EMISSIVE_ATTRIBUTE};`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vInstanceEmissiveBoost;`
      )
      .replace(
        'vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive * vInstanceEmissiveBoost;'
      );
  };
  material.customProgramCacheKey = () => 'remote-hero-instanced-emissive-v1';
}

function createStandardBatchMaterial(options: RemoteMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    emissive: new THREE.Color(options.color),
    emissiveIntensity: 1,
    roughness: options.roughness,
    metalness: options.metalness,
    transparent: options.transparent,
    opacity: options.opacity,
    depthWrite: options.depthWrite,
    toneMapped: options.toneMapped,
    vertexColors: options.vertexColors ?? false,
  });
  patchInstancedEmissiveMaterial(material);
  return material;
}

function getPaletteMaterialOptions(kind: MaterialKind, color: string): RemoteMaterialOptions {
  const isTranslucent = kind === 'glass' || kind === 'mist';
  return {
    color,
    roughness: kind === 'glass' ? 0.18 : kind === 'eye' || kind === 'glow' ? 0.28 : kind === 'void' ? 0.92 : 0.68,
    metalness: kind === 'armor' || kind === 'accent' || kind === 'edge' ? 0.28 : 0.05,
    transparent: isTranslucent,
    opacity: kind === 'mist' ? 0.22 : kind === 'glass' ? 0.68 : 1,
    depthWrite: !isTranslucent,
    toneMapped: kind !== 'eye' && kind !== 'glow',
  };
}

function materialKey(options: RemoteMaterialOptions): string {
  return [
    options.color,
    options.roughness,
    options.metalness,
    options.transparent ? 1 : 0,
    options.opacity,
    options.depthWrite ? 1 : 0,
    options.toneMapped ? 1 : 0,
    options.vertexColors ? 1 : 0,
  ].join('|');
}

function geometryKeyForPart(part: Pick<VoxelPart, 'kind'>): string {
  return part.kind ?? 'box';
}

function createPartLocalMatrix(
  position: [number, number, number],
  scale: [number, number, number],
  rotation?: [number, number, number]
): THREE.Matrix4 {
  const partPosition = new THREE.Vector3(position[0], position[1], position[2]);
  const partQuaternion = rotation
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    : new THREE.Quaternion();
  const partScale = new THREE.Vector3(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(partPosition, partQuaternion, partScale);
}

function descriptorBase(
  id: string,
  bone: BoneOrRoot,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] | undefined,
  geometry: THREE.BufferGeometry,
  geometryKey: string,
  materialKeyValue: string,
  playerFilter: PlayerFilter
): Omit<RemotePartDescriptor, 'paletteKind' | 'trimEmissiveIntensity' | 'fixedEmissiveIntensity'> {
  return {
    id,
    bone,
    meshOffset: position,
    scale,
    rotation,
    localMatrix: createPartLocalMatrix(position, scale, rotation),
    geometry,
    geometryKey,
    materialKey: materialKeyValue,
    playerFilter,
  };
}

function getTrimEmissiveIntensity(part: VoxelPart): number | undefined {
  if (!('emissiveIntensity' in part) || typeof part.emissiveIntensity !== 'number') return undefined;
  return getTeamBodyGlowEmissiveIntensity(part as TeamAccentPart);
}

function appendRiggedPartDescriptors<TPart extends VoxelPart>(
  descriptors: RemotePartDescriptor[],
  riggedPartsByBone: Record<HeroBoneName, RiggedVoxelPart<TPart>[]>,
  materialKeyFor: (part: TPart, filter: PlayerFilter) => string,
  options: {
    prefix: string;
    playerFilter?: PlayerFilter;
    palette?: boolean;
    trim?: boolean;
  }
): void {
  for (const bone of Object.keys(riggedPartsByBone) as HeroBoneName[]) {
    for (let index = 0; index < (riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).length; index++) {
      const riggedPart = riggedPartsByBone[bone][index];
      const part = riggedPart.part;
      const geometryKey = geometryKeyForPart(part);
      const base = descriptorBase(
        `${options.prefix}-${part.id}`,
        bone,
        riggedPart.meshOffset,
        part.scale,
        part.rotation,
        getPartGeometry(part),
        geometryKey,
        materialKeyFor(part, options.playerFilter ?? 'all'),
        options.playerFilter ?? 'all'
      );
      descriptors.push({
        ...base,
        paletteKind: options.palette ? part.material : undefined,
        trimEmissiveIntensity: options.trim ? getTrimEmissiveIntensity(part) : undefined,
      });
    }
  }
}

function createRemotePartDescriptors(heroId: HeroId): {
  descriptors: RemotePartDescriptor[];
  materialOptions: Map<string, RemoteMaterialOptions>;
} {
  const manifest = HERO_BODY_MANIFESTS[heroId];
  const materialOptionsByKey = new Map<string, RemoteMaterialOptions>();
  const descriptors: RemotePartDescriptor[] = [];

  const getOrAddMaterialKey = (options: RemoteMaterialOptions) => {
    const key = materialKey(options);
    materialOptionsByKey.set(key, options);
    return key;
  };
  const materialKeyForPalettePart = (part: VoxelPart, _filter: PlayerFilter) => {
    const color = manifest.materialPalette[part.material];
    return getOrAddMaterialKey(getPaletteMaterialOptions(part.material, color));
  };

  const riggedPartsByBone = groupHeroBodyRenderParts(manifest.parts);
  appendRiggedPartDescriptors(descriptors, riggedPartsByBone, materialKeyForPalettePart, {
    prefix: `${heroId}-palette`,
    palette: true,
  });

  const teamAccentParts = manifest.teamAccentParts ?? EMPTY_TEAM_ACCENT_PARTS;
  const teamAccentKeyFor = (part: VoxelPart) => {
    const accent = part as TeamAccentPart;
    const transparent = accent.transparent || accent.opacity !== undefined;
    return getOrAddMaterialKey({
      color: manifest.materialPalette[part.material],
      roughness: accent.roughness,
      metalness: accent.metalness,
      transparent,
      opacity: getTeamBodyGlowOpacity(accent),
      depthWrite: accent.depthWrite ?? !transparent,
      toneMapped: accent.toneMapped ?? false,
    });
  };
  appendRiggedPartDescriptors(descriptors, groupRiggedParts(teamAccentParts), teamAccentKeyFor, {
    prefix: `${heroId}-team`,
    trim: true,
  });

  const botMarkerOptions = getPaletteMaterialOptions('accent', '#ffffff');
  const botMarkerKey = getOrAddMaterialKey({
    ...botMarkerOptions,
    roughness: 1,
    metalness: 0,
    toneMapped: true,
    vertexColors: true,
  });
  descriptors.push({
    ...descriptorBase(
      `${heroId}-${HERO_BODY_BOT_MARKER_PART.id}`,
      HERO_BODY_BOT_MARKER_PART.bone,
      HERO_BODY_BOT_MARKER_PART.position,
      HERO_BODY_BOT_MARKER_PART.scale,
      HERO_BODY_BOT_MARKER_PART.rotation,
      HERO_PART_GEOMETRIES[HERO_BODY_BOT_MARKER_PART.kind ?? 'box'],
      HERO_BODY_BOT_MARKER_PART.kind ?? 'box',
      botMarkerKey,
      'bot'
    ),
    fixedEmissiveIntensity: HERO_BODY_BOT_MARKER_PART.fixedEmissiveIntensity,
    instanceColor: 'team',
  });

  return { descriptors, materialOptions: materialOptionsByKey };
}

function createRemoteBatchResources(heroId: HeroId): RemoteBatchResources {
  const { descriptors, materialOptions } = createRemotePartDescriptors(heroId);
  const normalGroups = new Map<string, RemotePartDescriptor[]>();
  const outlineGroups = new Map<string, RemotePartDescriptor[]>();

  for (const descriptor of descriptors) {
    const normalKey = `${descriptor.geometryKey}:${descriptor.materialKey}:${descriptor.playerFilter}`;
    const outlineKey = `${descriptor.geometryKey}:${descriptor.playerFilter}`;
    (normalGroups.get(normalKey) ?? normalGroups.set(normalKey, []).get(normalKey)!).push(descriptor);
    (outlineGroups.get(outlineKey) ?? outlineGroups.set(outlineKey, []).get(outlineKey)!).push(
      createOutlineDescriptor(descriptor)
    );
  }

  const materials: THREE.Material[] = [];
  const batches: RemotePartBatch[] = Array.from(normalGroups, ([key, groupDescriptors]) => {
    const materialOptionsForKey = materialOptions.get(groupDescriptors[0].materialKey);
    if (!materialOptionsForKey) {
      throw new Error(`Missing remote hero material options for ${groupDescriptors[0].materialKey}`);
    }
    const material = createStandardBatchMaterial(materialOptionsForKey);
    materials.push(material);
    return {
      key: `remote-hero:${heroId}:${key}`,
      geometry: groupDescriptors[0].geometry,
      descriptors: groupDescriptors,
      material,
      capacityPerPlayer: groupDescriptors.length,
      playerFilter: groupDescriptors[0].playerFilter,
    };
  });

  const outlineBatches: RemoteOutlineBatch[] = Array.from(outlineGroups, ([key, groupDescriptors]) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: TEAM_BODY_GLOW_OUTLINE_OPACITY,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexColors: true,
    });
    materials.push(material);
    return {
      key: `remote-hero-outline:${heroId}:${key}`,
      geometry: groupDescriptors[0].geometry,
      descriptors: groupDescriptors,
      material,
      capacityPerPlayer: groupDescriptors.length,
      playerFilter: groupDescriptors[0].playerFilter,
    };
  });

  return {
    heroId,
    batches,
    outlineBatches,
    dispose: () => {
      materials.forEach((material) => material.dispose());
    },
  };
}

function shouldRenderBatchForPlayer(playerFilter: PlayerFilter, player: Player): boolean {
  if (playerFilter === 'bot') return player.isBot;
  if (playerFilter === 'nonBot') return !player.isBot;
  return true;
}

function getDescriptorEmissiveBoost(
  descriptor: RemotePartDescriptor,
  player: Player,
  glowPulse: number
): number {
  if (descriptor.paletteKind) {
    return getHeroBodyMaterialEmissiveIntensity(descriptor.paletteKind, player.hasFlag) * (1 + glowPulse);
  }
  if (descriptor.trimEmissiveIntensity !== undefined) {
    return descriptor.trimEmissiveIntensity;
  }
  return descriptor.fixedEmissiveIntensity ?? 0;
}

function getOutlineLocalMatrix(descriptor: RemotePartDescriptor, isBattleRoyal: boolean): THREE.Matrix4 {
  return isBattleRoyal && descriptor.battleRoyalLocalMatrix
    ? descriptor.battleRoyalLocalMatrix
    : descriptor.localMatrix;
}

function getOutlineOpacity(isBattleRoyal: boolean): number {
  return isBattleRoyal
    ? BATTLE_ROYAL_TEAM_SILHOUETTE_OUTLINE_OPACITY
    : TEAM_BODY_GLOW_OUTLINE_OPACITY;
}

function assignDynamicInstancedMesh(
  mesh: THREE.InstancedMesh | null,
  onMesh: (mesh: THREE.InstancedMesh | null) => void
): void {
  if (mesh) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  onMesh(mesh);
}

function setDynamicInstanceColorAt(
  mesh: THREE.InstancedMesh,
  index: number,
  color: THREE.Color
): void {
  mesh.setColorAt(index, color);
  if (mesh.instanceColor && mesh.instanceColor.usage !== THREE.DynamicDrawUsage) {
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
}

function RemoteHeroInstancedBatch({
  batch,
  capacity,
  castShadow,
  onMesh,
}: {
  batch: RemotePartBatch;
  capacity: number;
  castShadow: boolean;
  onMesh: (mesh: THREE.InstancedMesh | null) => void;
}) {
  const geometry = useMemo(() => {
    const nextGeometry = batch.geometry.clone();
    const emissiveAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    emissiveAttribute.setUsage(THREE.DynamicDrawUsage);
    nextGeometry.setAttribute(
      INSTANCE_EMISSIVE_ATTRIBUTE,
      emissiveAttribute
    );
    return nextGeometry;
  }, [batch.geometry, capacity]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh
      ref={(mesh) => assignDynamicInstancedMesh(mesh, onMesh)}
      args={[geometry, batch.material, capacity]}
      count={0}
      castShadow={castShadow}
      receiveShadow={false}
      frustumCulled={false}
    />
  );
}

function RemoteHeroOutlineBatch({
  batch,
  capacity,
  isBattleRoyal,
  onMesh,
}: {
  batch: RemoteOutlineBatch;
  capacity: number;
  isBattleRoyal: boolean;
  onMesh: (mesh: THREE.InstancedMesh | null) => void;
}) {
  useLayoutEffect(() => {
    batch.material.opacity = getOutlineOpacity(isBattleRoyal);
  }, [batch.material, isBattleRoyal]);

  return (
    <instancedMesh
      ref={(mesh) => assignDynamicInstancedMesh(mesh, onMesh)}
      args={[batch.geometry, batch.material, capacity]}
      count={0}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}

function RemoteHeroBatchGroup({
  players,
  resourcePlayerCount,
  resources,
  isBattleRoyal,
  localPlayerId,
  localPlayerTeam,
  config,
}: {
  players: readonly Player[];
  resourcePlayerCount: number;
  resources: RemoteBatchResources;
  isBattleRoyal: boolean;
  localPlayerId?: string | null;
  localPlayerTeam?: Team | null;
  config: RemotePlayerQualityConfig;
}) {
  const camera = useThree((state) => state.camera);
  const runtimeByPlayerIdRef = useRef<Map<string, RemoteHeroRuntime>>(new Map());
  const meshesRef = useRef<Array<THREE.InstancedMesh | null>>([]);
  const emissiveAttributesRef = useRef<Array<THREE.InstancedBufferAttribute | null>>([]);
  const outlineMeshesRef = useRef<Array<THREE.InstancedMesh | null>>([]);
  const countsRef = useRef<Uint32Array>(new Uint32Array(resources.batches.length));
  const outlineCountsRef = useRef<Uint32Array>(new Uint32Array(resources.outlineBatches.length));
  const playersRef = useRef(players);
  const configRef = useRef(config);
  const playerGenerationRef = useRef(0);
  const capacityPlayersRef = useRef(Math.max(
    REMOTE_BATCH_PREWARM_PLAYER_CAPACITY,
    players.length,
    resourcePlayerCount
  ));
  if (players.length > capacityPlayersRef.current) {
    capacityPlayersRef.current = players.length + REMOTE_BATCH_CAPACITY_GROWTH_PADDING;
  }
  if (resourcePlayerCount > capacityPlayersRef.current) {
    capacityPlayersRef.current = resourcePlayerCount + REMOTE_BATCH_CAPACITY_GROWTH_PADDING;
  }
  const capacity = capacityPlayersRef.current;

  if (countsRef.current.length !== resources.batches.length) {
    countsRef.current = new Uint32Array(resources.batches.length);
  }
  if (outlineCountsRef.current.length !== resources.outlineBatches.length) {
    outlineCountsRef.current = new Uint32Array(resources.outlineBatches.length);
  }

  playersRef.current = players;
  configRef.current = config;

  useLayoutEffect(() => {
    const runtimes = runtimeByPlayerIdRef.current;
    const generation = playerGenerationRef.current + 1;
    playerGenerationRef.current = generation;

    for (const player of players) {
      const runtime = runtimes.get(player.id);
      if (runtime) {
        runtime.seenGeneration = generation;
        updateRuntimeHero(runtime, player);
      } else {
        const nextRuntime = createRemoteRuntime(player);
        nextRuntime.seenGeneration = generation;
        runtimes.set(player.id, nextRuntime);
      }
    }

    for (const [playerId, runtime] of runtimes) {
      if (runtime.seenGeneration === generation) continue;
      disposeRemoteRuntime(runtime);
      runtimes.delete(playerId);
    }
  }, [players]);

  useEffect(() => () => {
    for (const runtime of runtimeByPlayerIdRef.current.values()) {
      disposeRemoteRuntime(runtime);
    }
    runtimeByPlayerIdRef.current.clear();
  }, []);

  useEffect(() => gameplayFrameScheduler.register({
    system: 'remoteHeroBatch',
    label: 'frame.remoteHeroBatch',
    callback: ({ deltaSeconds, elapsedSeconds, nowMs }) => {
      const framePlayers = playersRef.current;
      const frameConfig = configRef.current;
      const runtimes = runtimeByPlayerIdRef.current;
      const counts = countsRef.current;
      const outlineCounts = outlineCountsRef.current;
      const visualState = visualStore.getState();
      const fullBodyDistance = isBattleRoyal
        ? getBattleRoyalDistanceCap(frameConfig.fullBodyDistance, BATTLE_ROYAL_MAX_REMOTE_FULL_BODY_DISTANCE)
        : frameConfig.fullBodyDistance;
      const outlineDistance = isBattleRoyal
        ? getBattleRoyalDistanceCap(frameConfig.outlineDistance, BATTLE_ROYAL_MAX_REMOTE_OUTLINE_DISTANCE)
        : frameConfig.outlineDistance;
      const fullBodyDistanceSq = getDistanceLimitSq(fullBodyDistance);
      const outlineDistanceSq = getDistanceLimitSq(outlineDistance);
      const activityBodyDistanceSq = isBattleRoyal
        ? getDistanceLimitSq(BATTLE_ROYAL_REMOTE_ACTIVITY_BODY_DISTANCE)
        : Number.POSITIVE_INFINITY;
      const activityOutlineDistanceSq = isBattleRoyal
        ? getDistanceLimitSq(BATTLE_ROYAL_REMOTE_ACTIVITY_OUTLINE_DISTANCE)
        : Number.POSITIVE_INFINITY;
      counts.fill(0);
      outlineCounts.fill(0);

      for (const player of framePlayers) {
        let runtime = runtimes.get(player.id);
        if (!runtime) {
          runtime = createRemoteRuntime(player);
          runtimes.set(player.id, runtime);
        }
        updateRuntimeHero(runtime, player);
        if (runtime.heroId !== resources.heroId) continue;

        const movement = getPlayerRenderMovement(player, visualState, localPlayerId);
        const visualHorizontalSpeed = updateRemoteTransform(runtime, player, deltaSeconds, visualState, nowMs);
        const isLocalPlayer = player.id === localPlayerId;
        const isObjectivePriority = isObjectivePriorityRemoteBody(player);
        const isActivityPriority = isActivityPriorityRemoteBody(player, visualState, nowMs);
        const forceBodyForPriority = isLocalPlayer || isObjectivePriority || (
          isActivityPriority &&
          isWithinDistanceLimitSq(camera, runtime.currentPosition, activityBodyDistanceSq)
        );
        const playerFullBodyDistanceSq = getPlayerDistanceLimitSq(
          player,
          localPlayerId,
          localPlayerTeam,
          fullBodyDistance,
          fullBodyDistanceSq,
          frameConfig.botFullBodyDistanceScale ?? 1,
          isBattleRoyal
        );
        const renderBody = !hasActivePhantomVeil(player) && (
          forceBodyForPriority ||
          isWithinDistanceLimitSq(camera, runtime.currentPosition, playerFullBodyDistanceSq)
        );
        if (!renderBody) continue;

        updateRemotePose(
          runtime,
          player,
          movement,
          deltaSeconds,
          elapsedSeconds,
          visualHorizontalSpeed,
          visualState,
          nowMs
        );
        updateBodyWorldMatrix(runtime);
        const teamColor = getTeamColor(player.team as Team);

        for (let batchIndex = 0; batchIndex < resources.batches.length; batchIndex++) {
          const batch = resources.batches[batchIndex];
          if (!shouldRenderBatchForPlayer(batch.playerFilter, player)) continue;
          const mesh = meshesRef.current[batchIndex];
          if (!mesh) continue;
          const emissiveAttribute = emissiveAttributesRef.current[batchIndex];
          let writeIndex = counts[batchIndex];
          for (const descriptor of batch.descriptors) {
            mesh.setMatrixAt(writeIndex, setPartMatrix(runtime, descriptor));
            emissiveAttribute?.setX(writeIndex, getDescriptorEmissiveBoost(descriptor, player, runtime.glowPulse));
            if (descriptor.instanceColor === 'team') {
              setDynamicInstanceColorAt(mesh, writeIndex, teamColor);
            }
            writeIndex++;
          }
          counts[batchIndex] = writeIndex;
        }

        const forceOutlineForPriority = isObjectivePriority || (
          isActivityPriority &&
          isWithinDistanceLimitSq(camera, runtime.currentPosition, activityOutlineDistanceSq)
        );
        const playerOutlineDistanceSq = getPlayerDistanceLimitSq(
          player,
          localPlayerId,
          localPlayerTeam,
          outlineDistance,
          outlineDistanceSq,
          frameConfig.botOutlineDistanceScale ?? 1,
          isBattleRoyal
        );
        const renderOutline = frameConfig.outlineDistance > 0 && (
          forceOutlineForPriority ||
          isWithinDistanceLimitSq(camera, runtime.currentPosition, playerOutlineDistanceSq)
        );
        if (!renderOutline) continue;

        for (let batchIndex = 0; batchIndex < resources.outlineBatches.length; batchIndex++) {
          const batch = resources.outlineBatches[batchIndex];
          if (!shouldRenderBatchForPlayer(batch.playerFilter, player)) continue;
          const mesh = outlineMeshesRef.current[batchIndex];
          if (!mesh) continue;
          let writeIndex = outlineCounts[batchIndex];
          for (const descriptor of batch.descriptors) {
            mesh.setMatrixAt(
              writeIndex,
              setPartMatrix(runtime, descriptor, getOutlineLocalMatrix(descriptor, isBattleRoyal))
            );
            setDynamicInstanceColorAt(mesh, writeIndex, teamColor);
            writeIndex++;
          }
          outlineCounts[batchIndex] = writeIndex;
        }
      }

      for (let batchIndex = 0; batchIndex < resources.batches.length; batchIndex++) {
        const mesh = meshesRef.current[batchIndex];
        if (!mesh) continue;
        const count = counts[batchIndex];
        mesh.count = count;
        if (count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          const emissiveAttribute = emissiveAttributesRef.current[batchIndex];
          if (emissiveAttribute) emissiveAttribute.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }

      for (let batchIndex = 0; batchIndex < resources.outlineBatches.length; batchIndex++) {
        const mesh = outlineMeshesRef.current[batchIndex];
        if (!mesh) continue;
        const count = outlineCounts[batchIndex];
        mesh.count = count;
        if (count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    },
  }), [camera, isBattleRoyal, localPlayerId, resources]);

  return (
    <>
      {resources.batches.map((batch, batchIndex) => (
        <RemoteHeroInstancedBatch
          key={batch.key}
          batch={batch}
          capacity={Math.max(1, capacity * batch.capacityPerPlayer)}
          castShadow={config.castShadows}
          onMesh={(mesh) => {
            meshesRef.current[batchIndex] = mesh;
            emissiveAttributesRef.current[batchIndex] = mesh
              ? (mesh.geometry.getAttribute(INSTANCE_EMISSIVE_ATTRIBUTE) as THREE.InstancedBufferAttribute)
              : null;
          }}
        />
      ))}
      {resources.outlineBatches.map((batch, batchIndex) => (
        <RemoteHeroOutlineBatch
          key={batch.key}
          batch={batch}
          capacity={Math.max(1, capacity * batch.capacityPerPlayer)}
          isBattleRoyal={isBattleRoyal}
          onMesh={(mesh) => {
            outlineMeshesRef.current[batchIndex] = mesh;
          }}
        />
      ))}
    </>
  );
}

export const RemoteHeroBatchRenderer = memo(function RemoteHeroBatchRenderer({
  players,
  resourcePlayers = players,
  isBattleRoyal = false,
  localPlayerId = null,
  localPlayerTeam = null,
  config,
}: RemoteHeroBatchRendererProps) {
  const resourceCacheRef = useRef<Map<string, RemoteBatchResources>>(new Map());
  const renderGroups = useMemo(
    () => buildRemoteHeroRenderGroups(players, resourcePlayers, resourceCacheRef.current),
    [players, resourcePlayers]
  );

  useEffect(() => () => {
    for (const resource of resourceCacheRef.current.values()) {
      resource.dispose();
    }
    resourceCacheRef.current.clear();
  }, []);

  return (
    <>
      {renderGroups.map(({ key, players: groupPlayers, resourcePlayerCount, resource }) => (
        <RemoteHeroBatchGroup
          key={key}
          players={groupPlayers}
          resourcePlayerCount={resourcePlayerCount}
          resources={resource}
          isBattleRoyal={isBattleRoyal}
          localPlayerId={localPlayerId}
          localPlayerTeam={localPlayerTeam}
          config={config}
        />
      ))}
    </>
  );
});
