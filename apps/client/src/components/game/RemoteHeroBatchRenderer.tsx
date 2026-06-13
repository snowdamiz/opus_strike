import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  HERO_DEFINITIONS,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  type HeroId,
  type Player,
  type Team,
} from '@voxel-strike/shared';
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
  applyHeroAttackPose,
  applyPhantomShieldBodyPose,
  applyIdleBonePose,
  applyJumpBonePose,
  applySlideBonePose,
  applyWalkingBonePose,
  clamp01,
  easeInOutSine,
  getBlazeAttackPoseAmount,
  getJumpPose,
  getNormalizedWalkDirection,
  getPhantomShieldBodyPoseAmount,
  setBoneBasePose,
} from '../../model-system/heroBodyPose';
import {
  EMPTY_REMOTE_SOCKET_MARKERS,
  EMPTY_RIGGED_PARTS,
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
  sampleRemoteTransformInto,
  type SampledRemoteTransform,
  visualStore,
} from '../../store/visualStore';
import { getFrameClock } from '../../utils/frameClock';
import { registerRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';

type BoneOrRoot = HeroBoneName | 'root';
type PlayerFilter = 'all' | 'bot' | 'nonBot';

interface RemoteHeroBatchRendererProps {
  players: readonly Player[];
}

interface RemotePartDescriptor {
  id: string;
  bone: BoneOrRoot;
  meshOffset: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  geometry: THREE.BufferGeometry;
  geometryKey: string;
  materialKey: string;
  playerFilter: PlayerFilter;
  paletteKind?: MaterialKind;
  teamAccentEmissiveIntensity?: number;
  fixedEmissiveIntensity?: number;
}

interface RemotePartBatch {
  key: string;
  geometry: THREE.BufferGeometry;
  descriptors: RemotePartDescriptor[];
  material: THREE.MeshStandardMaterial;
  capacityPerPlayer: number;
}

interface RemoteOutlineBatch {
  key: string;
  geometry: THREE.BufferGeometry;
  descriptors: RemotePartDescriptor[];
  material: THREE.MeshBasicMaterial;
  capacityPerPlayer: number;
}

interface RemoteBatchResources {
  heroId: HeroId;
  team: Team;
  batches: RemotePartBatch[];
  outlineBatches: RemoteOutlineBatch[];
  dispose: () => void;
}

interface RemoteSocketRegistration {
  object: THREE.Object3D;
  cleanup: () => void;
}

type CompleteBoneRefs = Record<HeroBoneName, THREE.Group>;

interface RemoteHeroRuntime {
  playerId: string;
  heroId: HeroId;
  bodyRoot: THREE.Group;
  bones: CompleteBoneRefs;
  sockets: Map<string, RemoteSocketRegistration>;
  idleBlend: number;
  movementBlend: number;
  crouchBlend: number;
  jumpBlend: number;
  slideBlend: number;
  attackBlend: number;
  targetMovementPose: HeroMovementPose;
  previousMovementProfile: HeroMovementProfile;
  currentMovementProfile: HeroMovementProfile;
  movementProfileBlend: number;
  movementCycle: number;
  smoothedWalkDirection: HeroWalkDirection;
  wasJumping: boolean;
  jumpStartedAt: number | null;
  currentPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  previousFramePosition: THREE.Vector3;
  sampledTransform: SampledRemoteTransform;
  remoteEpoch: number | null;
  initialized: boolean;
  renderYaw: number;
  rootPosition: THREE.Vector3;
  yawQuaternion: THREE.Quaternion;
  rootQuaternion: THREE.Quaternion;
  rootRotation: THREE.Euler;
  rootScale: THREE.Vector3;
  playerMatrix: THREE.Matrix4;
  bodyLocalMatrix: THREE.Matrix4;
  bodyWorldMatrix: THREE.Matrix4;
  partMatrix: THREE.Matrix4;
  finalMatrix: THREE.Matrix4;
  partPosition: THREE.Vector3;
  partQuaternion: THREE.Quaternion;
  partEuler: THREE.Euler;
  partScale: THREE.Vector3;
  glowPulse: number;
  visible: boolean;
}

const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
const CROUCH_HEIGHT_RATIO = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
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
const ALL_HERO_IDS = Object.keys(HERO_BODY_MANIFESTS) as HeroId[];
const ALL_TEAMS: readonly Team[] = ['red', 'blue'];
const WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
const WORLD_UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function isHeroId(value: string | null | undefined): value is HeroId {
  return Boolean(value && HERO_BODY_MANIFESTS[value as HeroId]);
}

function resolveHeroId(player: Player): HeroId {
  return isHeroId(player.heroId) ? player.heroId : 'phantom';
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

function getActivePhantomShieldStartedAt(player: Player): number | null {
  if (player.state !== 'alive' || player.heroId !== 'phantom') return null;

  const shield = player.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
  if (!shield?.isActive) return null;

  return shield.activatedAt ?? null;
}

function getPlayerHeight(player: Player): number {
  const heroStats = player.heroId ? HERO_DEFINITIONS[player.heroId]?.stats : null;
  return heroStats?.size.height ?? 1.8;
}

function getPostureScaleY(player: Player, playerHeight: number): number {
  const hasLoweredPosture = player.movement.isCrouching || player.movement.isSliding;
  const visibleHeight = hasLoweredPosture
    ? Math.max(PLAYER_CROUCH_HEIGHT, playerHeight * CROUCH_HEIGHT_RATIO)
    : playerHeight;
  return visibleHeight / playerHeight;
}

function getOutlineScale(scale: VoxelPart['scale']): VoxelPart['scale'] {
  return [
    scale[0] * TEAM_BODY_GLOW_OUTLINE_SCALE,
    scale[1] * TEAM_BODY_GLOW_OUTLINE_SCALE,
    scale[2] * TEAM_BODY_GLOW_OUTLINE_SCALE,
  ];
}

function createBoneRefs(): { bodyRoot: THREE.Group; bones: CompleteBoneRefs } {
  const bodyRoot = new THREE.Group();
  bodyRoot.matrixAutoUpdate = false;

  const bones = Object.fromEntries(
    (Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]).map((bone) => [bone, new THREE.Group()])
  ) as CompleteBoneRefs;

  bodyRoot.add(bones.aura, bones.hips, bones.leftLeg, bones.rightLeg, bones.torso);
  bones.leftLeg.add(bones.leftKnee);
  bones.leftKnee.add(bones.leftShin);
  bones.rightLeg.add(bones.rightKnee);
  bones.rightKnee.add(bones.rightShin);
  bones.torso.add(bones.head, bones.leftArm, bones.rightArm);
  bones.leftArm.add(bones.leftForearm);
  bones.rightArm.add(bones.rightForearm);

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
  runtime.targetMovementPose = movementPose;
  runtime.previousMovementProfile = movementProfile;
  runtime.currentMovementProfile = movementProfile;
  runtime.movementProfileBlend = 1;
  runtime.movementCycle = 0;
  runtime.smoothedWalkDirection = { ...DEFAULT_WALK_DIRECTION };
  runtime.wasJumping = false;
  runtime.jumpStartedAt = null;
  runtime.glowPulse = 0;
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
  const initialMovementPose = getPlayerMovementPose(
    player,
    player.movement.isCrouching || player.movement.isSliding,
    isPlayerMovingForAnimation(player)
  );
  const initialMovementProfile = getHeroMovementProfile(heroId, initialMovementPose);
  const runtime: RemoteHeroRuntime = {
    playerId: player.id,
    heroId,
    bodyRoot,
    bones,
    sockets: new Map(),
    idleBlend: 1,
    movementBlend: 0,
    crouchBlend: 0,
    jumpBlend: 0,
    slideBlend: 0,
    attackBlend: 0,
    targetMovementPose: initialMovementPose,
    previousMovementProfile: initialMovementProfile,
    currentMovementProfile: initialMovementProfile,
    movementProfileBlend: 1,
    movementCycle: 0,
    smoothedWalkDirection: { ...DEFAULT_WALK_DIRECTION },
    wasJumping: false,
    jumpStartedAt: null,
    currentPosition: initialPosition.clone(),
    targetPosition: initialPosition.clone(),
    previousFramePosition: initialPosition.clone(),
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
    rootPosition: new THREE.Vector3(),
    yawQuaternion: new THREE.Quaternion(),
    rootQuaternion: new THREE.Quaternion(),
    rootRotation: new THREE.Euler(),
    rootScale: new THREE.Vector3(1, 1, 1),
    playerMatrix: new THREE.Matrix4(),
    bodyLocalMatrix: new THREE.Matrix4(),
    bodyWorldMatrix: new THREE.Matrix4(),
    partMatrix: new THREE.Matrix4(),
    finalMatrix: new THREE.Matrix4(),
    partPosition: new THREE.Vector3(),
    partQuaternion: new THREE.Quaternion(),
    partEuler: new THREE.Euler(),
    partScale: new THREE.Vector3(1, 1, 1),
    glowPulse: 0,
    visible: true,
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

function updateRemoteTransform(runtime: RemoteHeroRuntime, player: Player, delta: number): number {
  const frameNowMs = getFrameClock().epochNowMs;

  if (!runtime.initialized) {
    const visualState = visualStore.getState();
    const initialPos = visualState.playerPositions.get(player.id);
    setPlayerRenderOrigin(runtime.currentPosition, initialPos ?? player.position);
    runtime.previousFramePosition.copy(runtime.currentPosition);
    runtime.initialized = true;
  }

  const visualState = visualStore.getState();
  const sampledTransform = runtime.sampledTransform;
  const hasSampledTransform = sampleRemoteTransformInto(player.id, sampledTransform, frameNowMs);
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
  if (hasSampledTransform && !snappedToSample) {
    runtime.renderYaw = lerpAngle(
      runtime.renderYaw,
      sampledTransform.lookYaw,
      smoothingFactor(REMOTE_SAMPLE_ROTATION_SMOOTHING, delta)
    );
  } else if (hasSampledTransform) {
    runtime.renderYaw = sampledTransform.lookYaw;
  } else {
    runtime.renderYaw = renderYaw;
  }

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
  delta: number,
  elapsedSeconds: number,
  visualHorizontalSpeed: number
): void {
  const frameDelta = Math.min(delta, 0.05);
  const frameNowMs = getFrameClock().epochNowMs;
  const heroId = runtime.heroId;
  const manifest = HERO_BODY_MANIFESTS[heroId];
  const playerHeight = getPlayerHeight(player);
  const postureScaleY = Math.max(0.45, Math.min(1, getPostureScaleY(player, playerHeight)));
  const scale = playerHeight / 1.8;
  const baseScaleY = scale * postureScaleY;
  const moving = isPlayerMovingForAnimation(player, visualHorizontalSpeed);
  const jumping = !player.movement.isGrounded && !player.movement.isSliding;
  const crouching = player.movement.isCrouching;
  const sliding = player.movement.isSliding;
  let attacking = false;
  let attackStartedAtMs: number | null = null;
  let attackSide: -1 | 1 = 1;

  const visualState = visualStore.getState();
  const remoteAttackState = visualState.remotePlayerAttackStates.get(player.id);
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
    if (heroId === 'hookshot') {
      activeAttackSide = attackCycleIndex % 2 === 0 ? 1 : -1;
    }
  }

  const movementPose = getPlayerMovementPose(player, crouching || sliding, moving);
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
  const shieldPoseAmount = getPhantomShieldBodyPoseAmount(
    getActivePhantomShieldStartedAt(player),
    frameNowMs
  );
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
  runtime.bodyLocalMatrix.compose(runtime.rootPosition, runtime.rootQuaternion.setFromEuler(runtime.rootRotation), runtime.rootScale);
  runtime.bodyWorldMatrix.multiplyMatrices(runtime.playerMatrix, runtime.bodyLocalMatrix);
  runtime.bodyRoot.matrix.copy(runtime.bodyWorldMatrix);
  runtime.bodyRoot.updateMatrixWorld(true);
}

function setPartMatrix(runtime: RemoteHeroRuntime, descriptor: RemotePartDescriptor): THREE.Matrix4 {
  runtime.partPosition.set(...descriptor.meshOffset);
  if (descriptor.rotation) {
    runtime.partEuler.set(...descriptor.rotation);
    runtime.partQuaternion.setFromEuler(runtime.partEuler);
  } else {
    runtime.partQuaternion.identity();
  }
  runtime.partScale.set(...descriptor.scale);
  runtime.partMatrix.compose(runtime.partPosition, runtime.partQuaternion, runtime.partScale);

  const parentMatrix = descriptor.bone === 'root'
    ? runtime.bodyRoot.matrixWorld
    : runtime.bones[descriptor.bone].matrixWorld;
  runtime.finalMatrix.multiplyMatrices(parentMatrix, runtime.partMatrix);
  return runtime.finalMatrix;
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

function createStandardBatchMaterial(options: {
  color: string;
  roughness: number;
  metalness: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  toneMapped: boolean;
}): THREE.MeshStandardMaterial {
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
  });
  patchInstancedEmissiveMaterial(material);
  return material;
}

function getPaletteMaterialOptions(kind: MaterialKind, color: string) {
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

function materialKey(options: ReturnType<typeof getPaletteMaterialOptions>): string {
  return [
    options.color,
    options.roughness,
    options.metalness,
    options.transparent ? 1 : 0,
    options.opacity,
    options.depthWrite ? 1 : 0,
    options.toneMapped ? 1 : 0,
  ].join('|');
}

function geometryKeyForPart(part: Pick<VoxelPart, 'kind'>): string {
  return part.kind ?? 'box';
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
): Omit<RemotePartDescriptor, 'paletteKind' | 'teamAccentEmissiveIntensity' | 'fixedEmissiveIntensity'> {
  return {
    id,
    bone,
    meshOffset: position,
    scale,
    rotation,
    geometry,
    geometryKey,
    materialKey: materialKeyValue,
    playerFilter,
  };
}

function getTeamAccentEmissiveIntensity(part: VoxelPart): number | undefined {
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
    teamAccent?: boolean;
  }
): void {
  for (const bone of Object.keys(riggedPartsByBone) as HeroBoneName[]) {
    for (let index = 0; index < (riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).length; index++) {
      const riggedPart = riggedPartsByBone[bone][index];
      const part = riggedPart.part;
      const geometryKey = geometryKeyForPart(part);
      const base = descriptorBase(
        `${options.prefix}-${bone}-${index}`,
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
        teamAccentEmissiveIntensity: options.teamAccent ? getTeamAccentEmissiveIntensity(part) : undefined,
      });
    }
  }
}

function createRemotePartDescriptors(heroId: HeroId, team: Team): { descriptors: RemotePartDescriptor[]; materialOptions: Map<string, ReturnType<typeof getPaletteMaterialOptions>> } {
  const manifest = HERO_BODY_MANIFESTS[heroId];
  const teamColor = TEAM_COLORS[team];
  const materialOptionsByKey = new Map<string, ReturnType<typeof getPaletteMaterialOptions>>();
  const descriptors: RemotePartDescriptor[] = [];

  const getOrAddMaterialKey = (options: ReturnType<typeof getPaletteMaterialOptions>) => {
    const key = materialKey(options);
    materialOptionsByKey.set(key, options);
    return key;
  };
  const materialKeyForPalettePart = (part: VoxelPart, filter: PlayerFilter) => {
    const color = part.material === 'accent' && filter === 'bot'
      ? teamColor
      : manifest.materialPalette[part.material];
    return getOrAddMaterialKey(getPaletteMaterialOptions(part.material, color));
  };

  const riggedPartsByBone = groupRiggedParts(manifest.parts);
  appendRiggedPartDescriptors(descriptors, riggedPartsByBone, materialKeyForPalettePart, {
    prefix: `${heroId}-palette`,
    palette: true,
  });

  const teamAccentParts = manifest.teamAccentParts ?? EMPTY_TEAM_ACCENT_PARTS;
  const teamAccentKeyFor = (part: VoxelPart) => {
    const accent = part as TeamAccentPart;
    const transparent = accent.transparent || accent.opacity !== undefined;
    return getOrAddMaterialKey({
      color: teamColor,
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
    teamAccent: true,
  });

  const addPaletteDescriptor = (
    id: string,
    bone: BoneOrRoot,
    material: MaterialKind,
    position: [number, number, number],
    scale: [number, number, number],
    geometry = HERO_PART_GEOMETRIES.box,
    rotation?: [number, number, number]
  ) => {
    const options = getPaletteMaterialOptions(material, manifest.materialPalette[material]);
    descriptors.push({
      ...descriptorBase(
        id,
        bone,
        position,
        scale,
        rotation,
        geometry,
        'box',
        getOrAddMaterialKey(options),
        'all'
      ),
      paletteKind: material,
    });
  };

  addPaletteDescriptor(`${heroId}-left-knee-cap`, 'leftKnee', 'edge', [0, 0.015, -0.185], [0.18, 0.08, 0.05]);
  addPaletteDescriptor(`${heroId}-left-knee-glow`, 'leftKnee', 'accent', [0, 0.018, -0.222], [0.105, 0.028, 0.026]);
  addPaletteDescriptor(`${heroId}-right-knee-cap`, 'rightKnee', 'edge', [0, 0.015, -0.185], [0.18, 0.08, 0.05]);
  addPaletteDescriptor(`${heroId}-right-knee-glow`, 'rightKnee', 'accent', [0, 0.018, -0.222], [0.105, 0.028, 0.026]);
  addPaletteDescriptor(`${heroId}-left-upper-leg-link`, 'leftLeg', 'dark', [0, -0.15, -0.018], [0.17, 0.3, 0.13]);
  addPaletteDescriptor(`${heroId}-right-upper-leg-link`, 'rightLeg', 'dark', [0, -0.15, -0.018], [0.17, 0.3, 0.13]);

  const botMarkerOptions = getPaletteMaterialOptions('accent', teamColor);
  const botMarkerKey = getOrAddMaterialKey({
    ...botMarkerOptions,
    roughness: 1,
    metalness: 0,
    toneMapped: true,
  });
  descriptors.push({
    ...descriptorBase(
      `${heroId}-bot-marker`,
      'root',
      [0, 1.98, 0],
      [0.14, 0.04, 0.14],
      undefined,
      HERO_PART_GEOMETRIES.box,
      'box',
      botMarkerKey,
      'bot'
    ),
    fixedEmissiveIntensity: 0.75,
  });

  const botAccentMaterialKey = materialKeyForPalettePart(
    { material: 'accent', position: [0, 0, 0], scale: [1, 1, 1] },
    'bot'
  );
  const botAccentDescriptors: RemotePartDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.paletteKind !== 'accent' || descriptor.playerFilter !== 'all') continue;
    descriptor.playerFilter = 'nonBot';
    botAccentDescriptors.push({
      ...descriptor,
      id: `${descriptor.id}-bot`,
      materialKey: botAccentMaterialKey,
      playerFilter: 'bot',
    });
  }
  descriptors.push(...botAccentDescriptors);

  return { descriptors, materialOptions: materialOptionsByKey };
}

function createRemoteBatchResources(heroId: HeroId, team: Team): RemoteBatchResources {
  const { descriptors, materialOptions } = createRemotePartDescriptors(heroId, team);
  const normalGroups = new Map<string, RemotePartDescriptor[]>();
  const outlineGroups = new Map<string, RemotePartDescriptor[]>();

  for (const descriptor of descriptors) {
    const normalKey = `${descriptor.geometryKey}:${descriptor.materialKey}:${descriptor.playerFilter}`;
    const outlineKey = `${descriptor.geometryKey}:${descriptor.playerFilter}`;
    (normalGroups.get(normalKey) ?? normalGroups.set(normalKey, []).get(normalKey)!).push(descriptor);
    (outlineGroups.get(outlineKey) ?? outlineGroups.set(outlineKey, []).get(outlineKey)!).push({
      ...descriptor,
      scale: getOutlineScale(descriptor.scale),
    });
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
      key: `remote-hero:${heroId}:${team}:${key}`,
      geometry: groupDescriptors[0].geometry,
      descriptors: groupDescriptors,
      material,
      capacityPerPlayer: groupDescriptors.length,
    };
  });

  const outlineBatches: RemoteOutlineBatch[] = Array.from(outlineGroups, ([key, groupDescriptors]) => {
    const material = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS[team],
      transparent: true,
      opacity: TEAM_BODY_GLOW_OUTLINE_OPACITY,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    materials.push(material);
    return {
      key: `remote-hero-outline:${heroId}:${team}:${key}`,
      geometry: groupDescriptors[0].geometry,
      descriptors: groupDescriptors,
      material,
      capacityPerPlayer: groupDescriptors.length,
    };
  });

  return {
    heroId,
    team,
    batches,
    outlineBatches,
    dispose: () => {
      materials.forEach((material) => material.dispose());
    },
  };
}

function shouldRenderDescriptorForPlayer(descriptor: RemotePartDescriptor, player: Player): boolean {
  if (descriptor.playerFilter === 'bot') return player.isBot;
  if (descriptor.playerFilter === 'nonBot') return !player.isBot;
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
  if (descriptor.teamAccentEmissiveIntensity !== undefined) {
    return descriptor.teamAccentEmissiveIntensity;
  }
  return descriptor.fixedEmissiveIntensity ?? 0;
}

function RemoteHeroInstancedBatch({
  batch,
  capacity,
  onMesh,
}: {
  batch: RemotePartBatch;
  capacity: number;
  onMesh: (mesh: THREE.InstancedMesh | null) => void;
}) {
  const geometry = useMemo(() => {
    const nextGeometry = batch.geometry.clone();
    nextGeometry.setAttribute(
      INSTANCE_EMISSIVE_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    );
    return nextGeometry;
  }, [batch.geometry, capacity]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh
      ref={onMesh}
      args={[geometry, batch.material, capacity]}
      count={0}
      castShadow
      receiveShadow={false}
      frustumCulled={false}
    />
  );
}

function RemoteHeroOutlineBatch({
  batch,
  capacity,
  onMesh,
}: {
  batch: RemoteOutlineBatch;
  capacity: number;
  onMesh: (mesh: THREE.InstancedMesh | null) => void;
}) {
  return (
    <instancedMesh
      ref={onMesh}
      args={[batch.geometry, batch.material, capacity]}
      count={0}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}

function RemoteHeroBatchGroup({
  players,
  resources,
}: {
  players: readonly Player[];
  resources: RemoteBatchResources;
}) {
  const runtimeByPlayerIdRef = useRef<Map<string, RemoteHeroRuntime>>(new Map());
  const meshByBatchKeyRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const outlineMeshByBatchKeyRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const countsRef = useRef<Map<string, number>>(new Map());
  const outlineCountsRef = useRef<Map<string, number>>(new Map());
  const playerIds = useMemo(() => new Set(players.map((player) => player.id)), [players]);
  const capacity = Math.max(1, players.length);

  useEffect(() => {
    const runtimes = runtimeByPlayerIdRef.current;
    for (const [playerId, runtime] of runtimes) {
      if (playerIds.has(playerId)) continue;
      disposeRemoteRuntime(runtime);
      runtimes.delete(playerId);
    }
  }, [playerIds]);

  useEffect(() => () => {
    for (const runtime of runtimeByPlayerIdRef.current.values()) {
      disposeRemoteRuntime(runtime);
    }
    runtimeByPlayerIdRef.current.clear();
  }, []);

  useFrame((state, delta) => {
    const runtimes = runtimeByPlayerIdRef.current;
    const counts = countsRef.current;
    const outlineCounts = outlineCountsRef.current;
    counts.clear();
    outlineCounts.clear();

    for (const batch of resources.batches) counts.set(batch.key, 0);
    for (const batch of resources.outlineBatches) outlineCounts.set(batch.key, 0);

    for (const player of players) {
      let runtime = runtimes.get(player.id);
      if (!runtime) {
        runtime = createRemoteRuntime(player);
        runtimes.set(player.id, runtime);
      }
      updateRuntimeHero(runtime, player);
      if (runtime.heroId !== resources.heroId) continue;

      const visualHorizontalSpeed = updateRemoteTransform(runtime, player, delta);
      updateRemotePose(runtime, player, delta, state.clock.elapsedTime, visualHorizontalSpeed);
      updateBodyWorldMatrix(runtime);

      if (hasActivePhantomVeil(player)) continue;

      for (const batch of resources.batches) {
        const mesh = meshByBatchKeyRef.current.get(batch.key);
        if (!mesh) continue;
        const emissiveAttribute = mesh.geometry.getAttribute(INSTANCE_EMISSIVE_ATTRIBUTE) as THREE.InstancedBufferAttribute | undefined;
        let writeIndex = counts.get(batch.key) ?? 0;
        for (const descriptor of batch.descriptors) {
          if (!shouldRenderDescriptorForPlayer(descriptor, player)) continue;
          mesh.setMatrixAt(writeIndex, setPartMatrix(runtime, descriptor));
          emissiveAttribute?.setX(writeIndex, getDescriptorEmissiveBoost(descriptor, player, runtime.glowPulse));
          writeIndex++;
        }
        counts.set(batch.key, writeIndex);
      }

      for (const batch of resources.outlineBatches) {
        const mesh = outlineMeshByBatchKeyRef.current.get(batch.key);
        if (!mesh) continue;
        let writeIndex = outlineCounts.get(batch.key) ?? 0;
        for (const descriptor of batch.descriptors) {
          if (!shouldRenderDescriptorForPlayer(descriptor, player)) continue;
          mesh.setMatrixAt(writeIndex, setPartMatrix(runtime, descriptor));
          writeIndex++;
        }
        outlineCounts.set(batch.key, writeIndex);
      }
    }

    for (const batch of resources.batches) {
      const mesh = meshByBatchKeyRef.current.get(batch.key);
      if (!mesh) continue;
      const count = counts.get(batch.key) ?? 0;
      mesh.count = count;
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        const emissiveAttribute = mesh.geometry.getAttribute(INSTANCE_EMISSIVE_ATTRIBUTE) as THREE.InstancedBufferAttribute | undefined;
        if (emissiveAttribute) emissiveAttribute.needsUpdate = true;
      }
    }

    for (const batch of resources.outlineBatches) {
      const mesh = outlineMeshByBatchKeyRef.current.get(batch.key);
      if (!mesh) continue;
      const count = outlineCounts.get(batch.key) ?? 0;
      mesh.count = count;
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <>
      {resources.batches.map((batch) => (
        <RemoteHeroInstancedBatch
          key={batch.key}
          batch={batch}
          capacity={Math.max(1, capacity * batch.capacityPerPlayer)}
          onMesh={(mesh) => {
            if (mesh) meshByBatchKeyRef.current.set(batch.key, mesh);
            else meshByBatchKeyRef.current.delete(batch.key);
          }}
        />
      ))}
      {resources.outlineBatches.map((batch) => (
        <RemoteHeroOutlineBatch
          key={batch.key}
          batch={batch}
          capacity={Math.max(1, capacity * batch.capacityPerPlayer)}
          onMesh={(mesh) => {
            if (mesh) outlineMeshByBatchKeyRef.current.set(batch.key, mesh);
            else outlineMeshByBatchKeyRef.current.delete(batch.key);
          }}
        />
      ))}
    </>
  );
}

export const RemoteHeroBatchRenderer = memo(function RemoteHeroBatchRenderer({
  players,
}: RemoteHeroBatchRendererProps) {
  const resources = useMemo(() => {
    const nextResources = new Map<string, RemoteBatchResources>();
    for (const heroId of ALL_HERO_IDS) {
      for (const team of ALL_TEAMS) {
        nextResources.set(`${heroId}:${team}`, createRemoteBatchResources(heroId, team));
      }
    }
    return nextResources;
  }, []);

  useEffect(() => () => {
    for (const resource of resources.values()) {
      resource.dispose();
    }
  }, [resources]);

  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();
    for (const player of players) {
      const heroId = resolveHeroId(player);
      const key = `${heroId}:${player.team as Team}`;
      const group = groups.get(key);
      if (group) group.push(player);
      else groups.set(key, [player]);
    }
    return groups;
  }, [players]);

  return (
    <>
      {Array.from(groupedPlayers, ([key, groupPlayers]) => {
        const resource = resources.get(key);
        if (!resource || groupPlayers.length === 0) return null;
        return (
          <RemoteHeroBatchGroup
            key={key}
            players={groupPlayers}
            resources={resource}
          />
        );
      })}
    </>
  );
});
