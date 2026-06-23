import { Fragment, memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HeroId, Team } from '@voxel-strike/shared';
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
  applyDownedBonePose,
  applyDownedRootPivot,
  applyHeroBodyPoseTransition,
  applyHeroAttackPose,
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
  HERO_LOOK_PITCH_WAIST_DAMPING,
  resetHeroBodyPoseTransitionRuntime,
  setBoneBasePose,
} from '../../model-system/heroBodyPose';
import {
  HERO_BODY_BOT_MARKER_PART,
  type HeroBodyGeneratedRootPart,
} from '../../model-system/heroBodyGeneratedParts';
import { groupHeroBodyRenderParts } from '../../model-system/heroBodyRenderParts';
import {
  EMPTY_REMOTE_SOCKET_MARKERS,
  EMPTY_RIGGED_PARTS,
  HERO_PART_GEOMETRIES,
  getBoneRestPosition,
  getPartGeometry,
  groupRiggedParts,
} from '../../model-system/heroRig';
import { getFrameClock } from '../../utils/frameClock';
import type {
  HeroAnimationMode,
  HeroBoneName,
  HeroBoneRefs,
  HeroMovementPose,
  HeroMovementProfile,
  HeroWalkDirection,
  MaterialKind,
  RemoteBodySocketMarker,
  TeamAccentPart,
  VoxelPart,
} from '../../model-system/heroBodyTypes';
import { registerRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';

export type { HeroAnimationMode, HeroMovementPose, HeroWalkDirection } from '../../model-system/heroBodyTypes';

interface HeroVoxelBodyProps {
  heroId: HeroId | null;
  team: Team;
  height: number;
  isBot?: boolean;
  isMoving?: boolean;
  isMovingRef?: MutableRefObject<boolean>;
  isJumping?: boolean;
  isJumpingRef?: MutableRefObject<boolean>;
  isCrouching?: boolean;
  isCrouchingRef?: MutableRefObject<boolean>;
  isSliding?: boolean;
  isSlidingRef?: MutableRefObject<boolean>;
  isDowned?: boolean;
  isDownedRef?: MutableRefObject<boolean>;
  isBeingRevived?: boolean;
  isBeingRevivedRef?: MutableRefObject<boolean>;
  isAttacking?: boolean;
  isAttackingRef?: MutableRefObject<boolean>;
  attackStartedAtMs?: number | null;
  attackStartedAtMsRef?: MutableRefObject<number | null>;
  attackSide?: -1 | 1;
  attackSideRef?: MutableRefObject<-1 | 1>;
  movementPose?: HeroMovementPose;
  movementPoseRef?: MutableRefObject<HeroMovementPose>;
  walkDirection?: HeroWalkDirection;
  walkDirectionRef?: MutableRefObject<HeroWalkDirection>;
  hasFlag?: boolean;
  postureScaleY?: number;
  postureScaleYRef?: MutableRefObject<number>;
  lookPitch?: number;
  lookPitchRef?: MutableRefObject<number>;
  idleIntensity?: number;
  showTeamAccents?: boolean;
  castShadow?: boolean;
  bodyOpacity?: number;
  bodyOpacityRef?: MutableRefObject<number>;
  showOutline?: boolean;
  socketOwnerId?: string;
}

function BodyTrimMaterial({
  part,
  color,
}: {
  part: TeamAccentPart;
  color: string;
}) {
  const transparent = part.transparent || part.opacity !== undefined;
  return (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={getTeamBodyGlowEmissiveIntensity(part)}
      roughness={part.roughness}
      metalness={part.metalness}
      transparent={transparent}
      opacity={getTeamBodyGlowOpacity(part)}
      depthWrite={part.depthWrite ?? !transparent}
      toneMapped={part.toneMapped ?? false}
    />
  );
}

function applyHeroBodyOpacity(root: THREE.Object3D, opacity: number): void {
  const clampedOpacity = clamp01(opacity);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const storedBaseOpacity = material.userData.heroBodyBaseOpacity;
      const storedTransparent = material.userData.heroBodyBaseTransparent;
      const storedDepthWrite = material.userData.heroBodyBaseDepthWrite;
      const baseOpacity = typeof storedBaseOpacity === 'number' ? storedBaseOpacity : material.opacity;
      const baseTransparent = typeof storedTransparent === 'boolean' ? storedTransparent : material.transparent;
      const baseDepthWrite = typeof storedDepthWrite === 'boolean' ? storedDepthWrite : material.depthWrite;
      const nextTransparent = clampedOpacity < 0.999 || baseTransparent;
      const nextDepthWrite = clampedOpacity < 0.999 ? false : baseDepthWrite;

      if (storedBaseOpacity === undefined) {
        material.userData.heroBodyBaseOpacity = material.opacity;
        material.userData.heroBodyBaseTransparent = material.transparent;
        material.userData.heroBodyBaseDepthWrite = material.depthWrite;
      }

      material.opacity = baseOpacity * clampedOpacity;
      if (material.transparent !== nextTransparent) {
        material.transparent = nextTransparent;
        material.needsUpdate = true;
      }
      material.depthWrite = nextDepthWrite;
    }
  });
}

function getOutlineScale(scale: VoxelPart['scale']): VoxelPart['scale'] {
  return [
    scale[0] * TEAM_BODY_GLOW_OUTLINE_SCALE,
    scale[1] * TEAM_BODY_GLOW_OUTLINE_SCALE,
    scale[2] * TEAM_BODY_GLOW_OUTLINE_SCALE,
  ];
}

export const HeroVoxelBody = memo(function HeroVoxelBody({
  heroId,
  team,
  height,
  isBot = false,
  isMoving = false,
  isMovingRef,
  isJumping = false,
  isJumpingRef,
  isCrouching = false,
  isCrouchingRef,
  isSliding = false,
  isSlidingRef,
  isDowned = false,
  isDownedRef,
  isBeingRevived = false,
  isBeingRevivedRef,
  isAttacking = false,
  isAttackingRef,
  attackStartedAtMs = null,
  attackStartedAtMsRef,
  attackSide,
  attackSideRef,
  movementPose = 'walk',
  movementPoseRef,
  walkDirection = DEFAULT_WALK_DIRECTION,
  walkDirectionRef,
  hasFlag = false,
  postureScaleY = 1,
  postureScaleYRef,
  lookPitch = 0,
  lookPitchRef,
  idleIntensity = 1,
  showTeamAccents = true,
  castShadow = true,
  bodyOpacity = 1,
  bodyOpacityRef,
  showOutline = false,
  socketOwnerId,
}: HeroVoxelBodyProps) {
  const resolvedHero = heroId || 'phantom';
  const groupRef = useRef<THREE.Group>(null);
  const boneRefs = useRef<HeroBoneRefs>({});
  const socketRefs = useRef<Record<string, THREE.Group | null>>({});
  const poseTransitionRuntimeRef = useRef(createHeroBodyPoseTransitionRuntime());
  const idleBlendRef = useRef(isDowned || !(isMoving || isJumping || isCrouching || isSliding || isAttacking) ? 1 : 0);
  const movementBlendRef = useRef(isMoving && !isJumping && !isSliding ? 1 : 0);
  const crouchBlendRef = useRef(isCrouching && !isJumping && !isSliding ? 1 : 0);
  const jumpBlendRef = useRef(isJumping ? 1 : 0);
  const slideBlendRef = useRef(isSliding && !isJumping ? 1 : 0);
  const downedBlendRef = useRef(isDowned ? 1 : 0);
  const reviveBlendRef = useRef(isBeingRevived ? 1 : 0);
  const attackBlendRef = useRef(isAttacking ? 1 : 0);
  const targetMovementPoseRef = useRef<HeroMovementPose>(movementPose);
  const previousMovementProfileRef = useRef<HeroMovementProfile>(
    getHeroMovementProfile(resolvedHero, movementPose)
  );
  const currentMovementProfileRef = useRef<HeroMovementProfile>(
    getHeroMovementProfile(resolvedHero, movementPose)
  );
  const movementProfileBlendRef = useRef(1);
  const movementCycleRef = useRef(0);
  const smoothedWalkDirectionRef = useRef<HeroWalkDirection>(
    getNormalizedWalkDirection(walkDirection)
  );
  const smoothedLookPitchRef = useRef(lookPitchRef?.current ?? lookPitch);
  const wasJumpingRef = useRef(false);
  const jumpStartedAtRef = useRef<number | null>(null);
  const appliedBodyOpacityRef = useRef(-1);
  const scale = height / 1.8;
  const initialVerticalScale = Math.max(0.45, Math.min(1, postureScaleY));
  const postureScaleYRefInternal = useRef(initialVerticalScale);
  const teamColor = TEAM_COLORS[team];
  const manifest = HERO_BODY_MANIFESTS[resolvedHero];
  const parts = manifest.parts;
  const teamAccentParts = showTeamAccents ? manifest.teamAccentParts : EMPTY_TEAM_ACCENT_PARTS;
  const riggedPartsByBone = useMemo(() => groupHeroBodyRenderParts(parts), [parts]);
  const riggedTeamAccentPartsByBone = useMemo(() => groupRiggedParts(teamAccentParts), [teamAccentParts]);
  const socketMarkersByBone = useMemo(() => {
    const grouped: Partial<Record<HeroBoneName, RemoteBodySocketMarker[]>> = {};
    for (const marker of manifest.remoteSocketMarkers ?? EMPTY_REMOTE_SOCKET_MARKERS) {
      (grouped[marker.bone] ??= []).push(marker);
    }
    return grouped;
  }, [manifest]);
  const colors = manifest.materialPalette;
  const idleProfile = manifest.idleProfile;

  const materials = useMemo(() => {
    const materialByKind = new Map<MaterialKind, THREE.MeshStandardMaterial>();
    (Object.keys(colors) as MaterialKind[]).forEach((kind) => {
      const baseColor = colors[kind];
      const emissiveIntensity = getHeroBodyMaterialEmissiveIntensity(kind, hasFlag);
      const isTranslucent = kind === 'glass' || kind === 'mist';
      materialByKind.set(kind, new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: emissiveIntensity > 0 ? new THREE.Color(baseColor) : new THREE.Color('#000000'),
        emissiveIntensity,
        roughness: kind === 'glass' ? 0.18 : kind === 'eye' || kind === 'glow' ? 0.28 : kind === 'void' ? 0.92 : 0.68,
        metalness: kind === 'armor' || kind === 'accent' || kind === 'edge' ? 0.28 : 0.05,
        transparent: isTranslucent,
        opacity: kind === 'mist' ? 0.22 : kind === 'glass' ? 0.68 : 1,
        depthWrite: !isTranslucent,
        toneMapped: kind !== 'eye' && kind !== 'glow',
      }));
    });
    return materialByKind;
  }, [colors, hasFlag]);
  const outlineMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: teamColor,
    transparent: true,
    opacity: TEAM_BODY_GLOW_OUTLINE_OPACITY,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [teamColor]);

  useEffect(() => {
    return () => {
      materials.forEach((material) => material.dispose());
    };
  }, [materials]);

  useEffect(() => {
    return () => {
      outlineMaterial.dispose();
    };
  }, [outlineMaterial]);

  useEffect(() => {
    appliedBodyOpacityRef.current = -1;
  }, [materials, outlineMaterial]);

  useEffect(() => {
    if (!socketOwnerId) return undefined;

    const cleanups: Array<() => void> = [];
    for (const marker of manifest.remoteSocketMarkers ?? EMPTY_REMOTE_SOCKET_MARKERS) {
      const socketObject = socketRefs.current[marker.socketName];
      if (!socketObject) continue;
      cleanups.push(registerRemoteModelSocket(
        socketOwnerId,
        marker.socketName,
        socketObject,
        'fullBody'
      ));
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [manifest, socketOwnerId]);

  useEffect(() => {
    const moving = isMovingRef?.current ?? isMoving;
    const jumping = isJumpingRef?.current ?? isJumping;
    const crouching = isCrouchingRef?.current ?? isCrouching;
    const sliding = isSlidingRef?.current ?? isSliding;
    const downed = isDownedRef?.current ?? isDowned;
    const beingRevived = isBeingRevivedRef?.current ?? isBeingRevived;
    const attacking = isAttackingRef?.current ?? isAttacking;
    const nextMovementPose = movementPoseRef?.current ?? movementPose;
    const nextMovementProfile = getHeroMovementProfile(resolvedHero, nextMovementPose);
    const nextWalkDirection = getNormalizedWalkDirection(walkDirectionRef?.current ?? walkDirection);
    idleBlendRef.current = idleIntensity > 0 && (downed || (!moving && !jumping && !crouching && !sliding && !attacking)) ? 1 : 0;
    movementBlendRef.current = moving && !jumping && !sliding && !downed ? 1 : 0;
    crouchBlendRef.current = crouching && !jumping && !sliding && !downed ? 1 : 0;
    jumpBlendRef.current = jumping && !downed ? 1 : 0;
    slideBlendRef.current = sliding && !jumping && !downed ? 1 : 0;
    downedBlendRef.current = downed ? 1 : 0;
    reviveBlendRef.current = beingRevived ? 1 : 0;
    attackBlendRef.current = attacking ? 1 : 0;
    targetMovementPoseRef.current = nextMovementPose;
    previousMovementProfileRef.current = nextMovementProfile;
    currentMovementProfileRef.current = nextMovementProfile;
    movementProfileBlendRef.current = 1;
    movementCycleRef.current = 0;
    smoothedWalkDirectionRef.current = { ...nextWalkDirection };
    smoothedLookPitchRef.current = lookPitchRef?.current ?? lookPitch;
    jumpStartedAtRef.current = null;
    wasJumpingRef.current = false;
    postureScaleYRefInternal.current = Math.max(0.45, Math.min(1, postureScaleYRef?.current ?? postureScaleY));
    resetHeroBodyPoseTransitionRuntime(poseTransitionRuntimeRef.current);
  }, [resolvedHero]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const frameDelta = Math.min(delta, 0.05);
    smoothedLookPitchRef.current = THREE.MathUtils.damp(
      smoothedLookPitchRef.current,
      lookPitchRef?.current ?? lookPitch,
      HERO_LOOK_PITCH_WAIST_DAMPING,
      frameDelta
    );
    const nextBodyOpacity = bodyOpacityRef?.current ?? bodyOpacity;
    if (Math.abs(appliedBodyOpacityRef.current - nextBodyOpacity) > 0.001) {
      appliedBodyOpacityRef.current = nextBodyOpacity;
      applyHeroBodyOpacity(groupRef.current, nextBodyOpacity);
    }
    const targetVerticalScale = Math.max(0.45, Math.min(1, postureScaleYRef?.current ?? postureScaleY));
    postureScaleYRefInternal.current = THREE.MathUtils.damp(
      postureScaleYRefInternal.current,
      targetVerticalScale,
      targetVerticalScale < postureScaleYRefInternal.current ? 13 : 10,
      frameDelta
    );
    const verticalScale = postureScaleYRefInternal.current;
    const baseScaleY = scale * verticalScale;
    const t = state.clock.elapsedTime;
    const downed = isDownedRef?.current ?? isDowned;
    const beingRevived = isBeingRevivedRef?.current ?? isBeingRevived;
    const moving = downed && beingRevived ? false : (isMovingRef?.current ?? isMoving);
    const jumping = downed ? false : (isJumpingRef?.current ?? isJumping);
    const crouching = downed ? false : (isCrouchingRef?.current ?? isCrouching);
    const sliding = downed ? false : (isSlidingRef?.current ?? isSliding);
    let attacking = downed ? false : (isAttackingRef?.current ?? isAttacking);
    const attackDuration = manifest.attackDurationSeconds;
    const providedAttackStartedAtMs = attackStartedAtMsRef?.current ?? attackStartedAtMs;
    let attackProgress = 1;
    const configuredAttackSide = attackSideRef?.current ?? attackSide ?? 1;
    let activeAttackSide = configuredAttackSide;

    if (attacking && providedAttackStartedAtMs && providedAttackStartedAtMs > 0) {
      attackProgress = clamp01((getFrameClock().epochNowMs - providedAttackStartedAtMs) / (attackDuration * 1000));
      attacking = attackProgress < 1;
    } else if (attacking) {
      const attackCycle = t / attackDuration;
      const attackCycleIndex = Math.floor(attackCycle);
      attackProgress = attackCycle - attackCycleIndex;

      if (
        !attackSideRef &&
        attackSide === undefined &&
        (resolvedHero === 'hookshot' || resolvedHero === 'phantom')
      ) {
        activeAttackSide = attackCycleIndex % 2 === 0 ? 1 : -1;
      }
    }

    const targetMovementPose = movementPoseRef?.current ?? movementPose;
    if (targetMovementPoseRef.current !== targetMovementPose) {
      previousMovementProfileRef.current = currentMovementProfileRef.current;
      targetMovementPoseRef.current = targetMovementPose;
      movementProfileBlendRef.current = 0;
    }

    movementProfileBlendRef.current = THREE.MathUtils.damp(
      movementProfileBlendRef.current,
      1,
      6.5,
      frameDelta
    );
    const movementProfile = lerpMovementProfile(
      previousMovementProfileRef.current,
      getHeroMovementProfile(resolvedHero, targetMovementPoseRef.current),
      movementProfileBlendRef.current
    );
    currentMovementProfileRef.current = movementProfile;
    const rawWalkDirection = walkDirectionRef?.current ?? walkDirection;
    const targetWalkDirection = getNormalizedWalkDirection(rawWalkDirection);
    const smoothedWalkDirection = smoothedWalkDirectionRef.current;
    const directionDampSpeed = moving && !jumping && !sliding
      ? (targetMovementPoseRef.current === 'run' ? 11.5 : 9.5)
      : 6;
    smoothedWalkDirection.forward = THREE.MathUtils.damp(
      smoothedWalkDirection.forward,
      targetWalkDirection.forward,
      directionDampSpeed,
      frameDelta
    );
    smoothedWalkDirection.right = THREE.MathUtils.damp(
      smoothedWalkDirection.right,
      targetWalkDirection.right,
      directionDampSpeed,
      frameDelta
    );
    const smoothedWalkDirectionLength = Math.sqrt(
      smoothedWalkDirection.forward * smoothedWalkDirection.forward +
      smoothedWalkDirection.right * smoothedWalkDirection.right
    );
    if (smoothedWalkDirectionLength > 1) {
      smoothedWalkDirection.forward /= smoothedWalkDirectionLength;
      smoothedWalkDirection.right /= smoothedWalkDirectionLength;
    }
    const bones = boneRefs.current;
    const poseBlendKey = getHeroBodyPoseBlendKey({
      heroId: resolvedHero,
      moving,
      jumping,
      crouching,
      sliding,
      downed,
      crawling: downed && moving,
      beingRevived,
      attacking,
      attackSide: activeAttackSide,
      movementPose: targetMovementPoseRef.current,
      idleEnabled: idleIntensity > 0,
    });
    beginHeroBodyPoseTransition(
      poseTransitionRuntimeRef.current,
      poseBlendKey,
      groupRef.current,
      bones
    );
    setBoneBasePose(bones);

    if (jumping) {
      if (!wasJumpingRef.current || jumpStartedAtRef.current === null) {
        jumpStartedAtRef.current = t;
      }
    } else if (jumpBlendRef.current <= 0.001) {
      jumpStartedAtRef.current = null;
    }
    wasJumpingRef.current = jumping;

    const targetMovementBlend = moving && !jumping && !sliding && !downed ? 1 : 0;
    const targetCrouchBlend = crouching && !jumping && !sliding && !downed ? 1 : 0;
    const targetJumpBlend = jumping ? 1 : 0;
    const targetSlideBlend = sliding && !jumping ? 1 : 0;
    const targetDownedBlend = downed ? 1 : 0;
    const targetReviveBlend = beingRevived ? 1 : 0;
    const targetAttackBlend = attacking ? 1 : 0;
    movementBlendRef.current = THREE.MathUtils.damp(
      movementBlendRef.current,
      targetMovementBlend,
      targetMovementBlend > movementBlendRef.current ? 7.5 : 8.5,
      frameDelta
    );
    crouchBlendRef.current = THREE.MathUtils.damp(
      crouchBlendRef.current,
      targetCrouchBlend,
      targetCrouchBlend > crouchBlendRef.current ? 8 : 7,
      frameDelta
    );
    jumpBlendRef.current = THREE.MathUtils.damp(
      jumpBlendRef.current,
      targetJumpBlend,
      targetJumpBlend > jumpBlendRef.current ? 9.5 : 7.5,
      frameDelta
    );
    slideBlendRef.current = THREE.MathUtils.damp(
      slideBlendRef.current,
      targetSlideBlend,
      targetSlideBlend > slideBlendRef.current ? 11 : 7.5,
      frameDelta
    );
    downedBlendRef.current = THREE.MathUtils.damp(
      downedBlendRef.current,
      targetDownedBlend,
      targetDownedBlend > downedBlendRef.current ? 8.5 : 7,
      frameDelta
    );
    reviveBlendRef.current = THREE.MathUtils.damp(
      reviveBlendRef.current,
      targetReviveBlend,
      targetReviveBlend > reviveBlendRef.current ? 9 : 8,
      frameDelta
    );
    attackBlendRef.current = THREE.MathUtils.damp(
      attackBlendRef.current,
      targetAttackBlend,
      targetAttackBlend > attackBlendRef.current ? 14 : 8.5,
      frameDelta
    );

    if (
      idleIntensity <= 0 &&
      !moving &&
      !jumping &&
      !crouching &&
      !sliding &&
      !attacking &&
      movementBlendRef.current <= 0.001 &&
      crouchBlendRef.current <= 0.001 &&
      jumpBlendRef.current <= 0.001 &&
      slideBlendRef.current <= 0.001 &&
      downedBlendRef.current <= 0.001 &&
      reviveBlendRef.current <= 0.001 &&
      attackBlendRef.current <= 0.001
    ) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.rotation.set(0, 0, 0);
      groupRef.current.scale.set(scale, baseScaleY, scale);
      materials.forEach((material, kind) => {
        material.emissiveIntensity = getHeroBodyMaterialEmissiveIntensity(kind, hasFlag);
      });
      applyHeroBodyPoseTransition(
        poseTransitionRuntimeRef.current,
        groupRef.current,
        bones,
        frameDelta
      );
      applyLookPitchWaistBend(bones, smoothedLookPitchRef.current);

      return;
    }

    const targetIdleBlend = downed || !(moving || jumping || crouching || sliding || attacking) ? 1 : 0;
    idleBlendRef.current = THREE.MathUtils.damp(
      idleBlendRef.current,
      targetIdleBlend,
      targetIdleBlend < idleBlendRef.current ? 9.5 : 5.5,
      frameDelta
    );

    const slideAmount = easeInOutSine(slideBlendRef.current);
    const downedAmount = easeInOutSine(downedBlendRef.current);
    const crawlAmount = downed && moving && !beingRevived ? downedAmount : 0;
    const reviveAmount = easeInOutSine(reviveBlendRef.current);
    const runSlideCrossfadeAmount = targetMovementPoseRef.current === 'run' ? slideAmount : 0;
    const attackAmount = easeInOutSine(attackBlendRef.current);
    const attackPosePulse = resolvedHero === 'blaze' || resolvedHero === 'phantom'
      ? getBlazeAttackPoseAmount(attackProgress)
      : Math.sin(attackProgress * Math.PI);
    const attackPulse = attackPosePulse * attackAmount;
    const rootAttackPulse = resolvedHero === 'phantom' ? 0 : attackPulse;
    const idleAmount = idleBlendRef.current * idleIntensity;
    const movingAmount = downed ? 0 : movementBlendRef.current * (1 - runSlideCrossfadeAmount);
    const jumpAmount = jumpBlendRef.current;
    const crouchAmount = crouchBlendRef.current;
    const poseCrouchAmount = crouchAmount;
    const jumpTime = jumpStartedAtRef.current === null ? 0 : t - jumpStartedAtRef.current;
    const jumpPose = getJumpPose(jumpTime);
    if (movingAmount > 0.001) {
      movementCycleRef.current = (
        movementCycleRef.current + frameDelta * movementProfile.cycleSpeed
      ) % (Math.PI * 2);
    }
    const movementCycleTime = movementCycleRef.current;
    const movementStep = 0.5 + 0.5 * Math.sin(movementCycleTime * 2);
    const movementSway = Math.sin(movementCycleTime);
    const idleTime = t * IDLE_SPEED_MULTIPLIER;
    const primary = Math.sin(idleTime * idleProfile.cycleSpeed + idleProfile.phase);
    const secondary = Math.sin(idleTime * idleProfile.cycleSpeed * 0.57 + idleProfile.phase + 1.1);
    const tertiary = Math.sin(idleTime * idleProfile.cycleSpeed * 1.31 + idleProfile.phase * 0.5);

    const slideSkid = Math.sin(t * 8.5) * 0.012 * slideAmount;
    groupRef.current.position.set(
      0,
      jumpPose.rootLift * jumpAmount +
      movementStep * movementProfile.rootBob * movingAmount -
      0.09 * poseCrouchAmount +
      Math.sin(t * 2.2) * 0.006 * poseCrouchAmount -
      0.31 * slideAmount +
      0.012 * rootAttackPulse,
      -0.24 * slideAmount + slideSkid - 0.035 * rootAttackPulse
    );
    const uprightRootAmount = 1 - downedAmount;
    groupRef.current.rotation.x =
      (secondary * idleProfile.swayAmplitude * 0.08 * idleAmount -
      smoothedWalkDirection.forward * movementProfile.rootPitch * movingAmount +
      jumpPose.pitch * jumpAmount +
      -0.025 * poseCrouchAmount +
      0.6 * slideAmount -
      0.035 * rootAttackPulse) * uprightRootAmount;
    groupRef.current.rotation.y =
      (tertiary * idleProfile.twistAmplitude * 0.12 * idleAmount +
      activeAttackSide * 0.025 * rootAttackPulse) * uprightRootAmount;
    groupRef.current.rotation.z =
      (secondary * idleProfile.swayAmplitude * 0.12 * idleAmount -
      smoothedWalkDirection.right * movementProfile.rootRoll * movingAmount +
      movementSway * movementProfile.rootSway * movingAmount +
      0.055 * slideAmount -
      activeAttackSide * 0.018 * rootAttackPulse) * uprightRootAmount;
    applyDownedRootPivot(groupRef.current.position, groupRef.current.rotation, scale, downedAmount);

    const jumpSquash = jumpPose.crouch * 0.035 + jumpPose.land * 0.026;
    const jumpStretch = jumpPose.extension * 0.026;
    const jumpScaleY = 1 - jumpSquash + jumpStretch;
    const jumpScaleXZ = 1 + jumpSquash * 0.45 - jumpStretch * 0.28;
    const crouchScaleY = 1 - 0.055 * poseCrouchAmount;
    const crouchScaleXZ = 1 + 0.012 * poseCrouchAmount;
    groupRef.current.scale.set(
      scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ,
      baseScaleY * THREE.MathUtils.lerp(1, jumpScaleY, jumpAmount) * crouchScaleY,
      scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ
    );
    applyIdleBonePose(bones, idleProfile, primary, secondary, tertiary, idleAmount);
    applyJumpBonePose(bones, jumpPose, jumpAmount);
    applyCrouchBonePose(bones, t, poseCrouchAmount);
    applyDownedBonePose(bones, t, downedAmount, crawlAmount, reviveAmount);
    if (resolvedHero === 'chronos') {
      applyChronosArmPose(bones, 1 - slideAmount);
    }

    const glowPulse =
      (0.5 + 0.5 * tertiary) * idleProfile.auraPulse * idleAmount +
      (jumpPose.extension * 0.18 + jumpPose.land * 0.14) * jumpAmount +
      movementStep * movementProfile.glowPulse * movingAmount +
      0.035 * poseCrouchAmount +
      0.035 * downedAmount +
      0.09 * slideAmount +
      0.16 * attackPulse;
    materials.forEach((material, kind) => {
      const baseEmissiveIntensity = getHeroBodyMaterialEmissiveIntensity(kind, hasFlag);
      material.emissiveIntensity = baseEmissiveIntensity * (1 + glowPulse);
    });

    applyWalkingBonePose(bones, movementCycleTime, movingAmount, smoothedWalkDirection, movementProfile);
    applySlideBonePose(bones, t, slideAmount);
    applyHeroAttackPose(resolvedHero, bones, attackProgress, attackAmount, activeAttackSide);
    applyHeroBodyPoseTransition(
      poseTransitionRuntimeRef.current,
      groupRef.current,
      bones,
      frameDelta
    );
    applyLookPitchWaistBend(bones, smoothedLookPitchRef.current * (1 - downedAmount));
  });

  const renderOutlineMesh = (
    key: string,
    position: [number, number, number],
    scale: VoxelPart['scale'],
    geometry: THREE.BufferGeometry,
    rotation?: [number, number, number]
  ) => {
    if (!showOutline) return null;

    return (
      <mesh
        key={key}
        position={position}
        rotation={rotation}
        scale={getOutlineScale(scale)}
        geometry={geometry}
        renderOrder={1}
      >
        <primitive object={outlineMaterial} attach="material" />
      </mesh>
    );
  };

  const renderPartsForBone = (bone: HeroBoneName) => (
    <>
      {(riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <Fragment key={`${resolvedHero}-${riggedPart.part.id ?? `${bone}-${index}`}`}>
          <mesh
            position={riggedPart.meshOffset}
            rotation={riggedPart.part.rotation}
            scale={riggedPart.part.scale}
            castShadow={castShadow}
            geometry={getPartGeometry(riggedPart.part)}
          >
            <primitive object={materials.get(riggedPart.part.material)!} attach="material" />
          </mesh>
          {renderOutlineMesh(
            `${resolvedHero}-${riggedPart.part.id ?? `${bone}-${index}`}-outline`,
            riggedPart.meshOffset,
            riggedPart.part.scale,
            getPartGeometry(riggedPart.part),
            riggedPart.part.rotation
          )}
        </Fragment>
      ))}

      {(riggedTeamAccentPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <Fragment key={`${resolvedHero}-team-${riggedPart.part.id ?? `${bone}-${index}`}`}>
          <mesh
            position={riggedPart.meshOffset}
            rotation={riggedPart.part.rotation}
            scale={riggedPart.part.scale}
            castShadow={castShadow}
            geometry={getPartGeometry(riggedPart.part)}
          >
            <BodyTrimMaterial
              part={riggedPart.part as TeamAccentPart}
              color={colors[riggedPart.part.material]}
            />
          </mesh>
          {renderOutlineMesh(
            `${resolvedHero}-team-${riggedPart.part.id ?? `${bone}-${index}`}-outline`,
            riggedPart.meshOffset,
            riggedPart.part.scale,
            getPartGeometry(riggedPart.part),
            riggedPart.part.rotation
          )}
        </Fragment>
      ))}
    </>
  );

  const renderSocketMarkersForBone = (bone: HeroBoneName) => (
    (socketMarkersByBone[bone] ?? EMPTY_REMOTE_SOCKET_MARKERS).map((marker) => (
      <group
        key={`${resolvedHero}-socket-${marker.socketName}`}
        ref={(node) => {
          socketRefs.current[marker.socketName] = node;
        }}
        position={marker.position}
      />
    ))
  );

  const renderRootGeneratedPart = (part: HeroBodyGeneratedRootPart) => {
    const color = part.materialColorSource === 'team' ? teamColor : colors[part.material];
    const geometry = HERO_PART_GEOMETRIES[part.kind ?? 'box'];
    const emissiveIntensity = part.fixedEmissiveIntensity ?? getHeroBodyMaterialEmissiveIntensity(part.material, hasFlag);

    return (
      <Fragment key={`${resolvedHero}-${part.id}`}>
        <mesh
          position={part.position}
          rotation={part.rotation}
          scale={part.scale}
          castShadow={castShadow}
          geometry={geometry}
        >
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} />
        </mesh>
        {renderOutlineMesh(
          `${resolvedHero}-${part.id}-outline`,
          part.position,
          part.scale,
          geometry,
          part.rotation
        )}
      </Fragment>
    );
  };

  const renderBotMarker = () => (
    <>
      {renderRootGeneratedPart(HERO_BODY_BOT_MARKER_PART)}
    </>
  );

  return (
    <group ref={groupRef} scale={[scale, scale * initialVerticalScale, scale]}>
      <group
        ref={(node) => {
          boneRefs.current.aura = node;
        }}
        position={getBoneRestPosition('aura')}
      >
        {renderPartsForBone('aura')}
        {renderSocketMarkersForBone('aura')}
      </group>

      <group
        ref={(node) => {
          boneRefs.current.hips = node;
        }}
        position={getBoneRestPosition('hips')}
      >
        {renderPartsForBone('hips')}
        {renderSocketMarkersForBone('hips')}

        <group
          ref={(node) => {
            boneRefs.current.leftLeg = node;
          }}
          position={getBoneRestPosition('leftLeg')}
        >
          {renderPartsForBone('leftLeg')}
          {renderSocketMarkersForBone('leftLeg')}

          <group
            ref={(node) => {
              boneRefs.current.leftKnee = node;
            }}
            position={getBoneRestPosition('leftKnee')}
          >
            {renderPartsForBone('leftKnee')}
            {renderSocketMarkersForBone('leftKnee')}

            <group
              ref={(node) => {
                boneRefs.current.leftShin = node;
              }}
              position={getBoneRestPosition('leftShin')}
            >
              {renderPartsForBone('leftShin')}
              {renderSocketMarkersForBone('leftShin')}
            </group>
          </group>
        </group>

        <group
          ref={(node) => {
            boneRefs.current.rightLeg = node;
          }}
          position={getBoneRestPosition('rightLeg')}
        >
          {renderPartsForBone('rightLeg')}
          {renderSocketMarkersForBone('rightLeg')}

          <group
            ref={(node) => {
              boneRefs.current.rightKnee = node;
            }}
            position={getBoneRestPosition('rightKnee')}
          >
            {renderPartsForBone('rightKnee')}
            {renderSocketMarkersForBone('rightKnee')}

            <group
              ref={(node) => {
                boneRefs.current.rightShin = node;
              }}
              position={getBoneRestPosition('rightShin')}
            >
              {renderPartsForBone('rightShin')}
              {renderSocketMarkersForBone('rightShin')}
            </group>
          </group>
        </group>

        <group
          ref={(node) => {
            boneRefs.current.torso = node;
          }}
          position={getBoneRestPosition('torso')}
        >
          {renderPartsForBone('torso')}
          {renderSocketMarkersForBone('torso')}

          <group
            ref={(node) => {
              boneRefs.current.head = node;
            }}
            position={getBoneRestPosition('head')}
          >
            {renderPartsForBone('head')}
            {renderSocketMarkersForBone('head')}
          </group>

          <group
            ref={(node) => {
              boneRefs.current.leftArm = node;
            }}
            position={getBoneRestPosition('leftArm')}
          >
            {renderPartsForBone('leftArm')}
            {renderSocketMarkersForBone('leftArm')}

            <group
              ref={(node) => {
                boneRefs.current.leftForearm = node;
              }}
              position={getBoneRestPosition('leftForearm')}
            >
              {renderPartsForBone('leftForearm')}
              {renderSocketMarkersForBone('leftForearm')}
            </group>
          </group>

          <group
            ref={(node) => {
              boneRefs.current.rightArm = node;
            }}
            position={getBoneRestPosition('rightArm')}
          >
            {renderPartsForBone('rightArm')}
            {renderSocketMarkersForBone('rightArm')}

            <group
              ref={(node) => {
                boneRefs.current.rightForearm = node;
              }}
              position={getBoneRestPosition('rightForearm')}
            >
              {renderPartsForBone('rightForearm')}
              {renderSocketMarkersForBone('rightForearm')}
            </group>
          </group>
        </group>
      </group>

      {isBot && renderBotMarker()}
    </group>
  );
});
