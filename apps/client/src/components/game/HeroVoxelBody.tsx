import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HeroId, Team } from '@voxel-strike/shared';
import {
  DEFAULT_WALK_DIRECTION,
  EMPTY_TEAM_ACCENT_PARTS,
  HERO_BODY_MANIFESTS,
  IDLE_SPEED_MULTIPLIER,
  TEAM_COLORS,
  getHeroMovementProfile,
  lerpMovementProfile,
} from '../../model-system/heroBodyManifests';
import {
  applyChronosArmPose,
  applyCrouchBonePose,
  applyHeroAttackPose,
  applyIdleBonePose,
  applyJumpBonePose,
  applySlideBonePose,
  applyWalkingBonePose,
  clamp01,
  easeInOutSine,
  getBlazeAttackPoseAmount,
  getJumpPose,
  getNormalizedWalkDirection,
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
  idleIntensity?: number;
  showTeamAccents?: boolean;
  castShadow?: boolean;
  bodyOpacity?: number;
  bodyOpacityRef?: MutableRefObject<number>;
  socketOwnerId?: string;
}

function getMaterialEmissiveIntensity(kind: MaterialKind, hasFlag: boolean) {
  const flagBoost = hasFlag ? 0.35 : 0;
  if (kind === 'glow') return 0.78 + flagBoost;
  if (kind === 'eye') return 0.9 + flagBoost;
  if (kind === 'accent') return 0.32 + flagBoost * 0.6;
  if (kind === 'mist') return 0.42 + flagBoost * 0.4;
  return flagBoost * 0.35;
}

function TeamAccentMaterial({ part, teamColor }: { part: TeamAccentPart; teamColor: string }) {
  const transparent = part.transparent || part.opacity !== undefined;
  return (
    <meshStandardMaterial
      color={teamColor}
      emissive={teamColor}
      emissiveIntensity={part.emissiveIntensity}
      roughness={part.roughness}
      metalness={part.metalness}
      transparent={transparent}
      opacity={part.opacity ?? 1}
      depthWrite={part.depthWrite ?? !transparent}
      toneMapped={part.toneMapped}
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
  idleIntensity = 1,
  showTeamAccents = true,
  castShadow = true,
  bodyOpacity = 1,
  bodyOpacityRef,
  socketOwnerId,
}: HeroVoxelBodyProps) {
  const resolvedHero = heroId || 'phantom';
  const groupRef = useRef<THREE.Group>(null);
  const boneRefs = useRef<HeroBoneRefs>({});
  const socketRefs = useRef<Record<string, THREE.Group | null>>({});
  const idleBlendRef = useRef(isMoving || isJumping || isCrouching || isSliding || isAttacking ? 0 : 1);
  const movementBlendRef = useRef(isMoving && !isJumping && !isSliding ? 1 : 0);
  const crouchBlendRef = useRef(isCrouching && !isJumping && !isSliding ? 1 : 0);
  const jumpBlendRef = useRef(isJumping ? 1 : 0);
  const slideBlendRef = useRef(isSliding && !isJumping ? 1 : 0);
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
  const wasJumpingRef = useRef(false);
  const jumpStartedAtRef = useRef<number | null>(null);
  const appliedBodyOpacityRef = useRef(-1);
  const scale = height / 1.8;
  const initialVerticalScale = Math.max(0.45, Math.min(1, postureScaleY));
  const teamColor = TEAM_COLORS[team];
  const manifest = HERO_BODY_MANIFESTS[resolvedHero];
  const parts = manifest.parts;
  const teamAccentParts = showTeamAccents ? manifest.teamAccentParts : EMPTY_TEAM_ACCENT_PARTS;
  const riggedPartsByBone = useMemo(() => groupRiggedParts(parts), [parts]);
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
      const baseColor = kind === 'accent' && isBot ? teamColor : colors[kind];
      const emissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
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
  }, [colors, hasFlag, isBot, teamColor]);

  useEffect(() => {
    return () => {
      materials.forEach((material) => material.dispose());
    };
  }, [materials]);

  useEffect(() => {
    appliedBodyOpacityRef.current = -1;
  }, [materials]);

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
    const attacking = isAttackingRef?.current ?? isAttacking;
    const nextMovementPose = movementPoseRef?.current ?? movementPose;
    const nextMovementProfile = getHeroMovementProfile(resolvedHero, nextMovementPose);
    idleBlendRef.current = idleIntensity > 0 && !moving && !jumping && !crouching && !sliding && !attacking ? 1 : 0;
    movementBlendRef.current = moving && !jumping && !sliding ? 1 : 0;
    crouchBlendRef.current = crouching && !jumping && !sliding ? 1 : 0;
    jumpBlendRef.current = jumping ? 1 : 0;
    slideBlendRef.current = sliding && !jumping ? 1 : 0;
    attackBlendRef.current = attacking ? 1 : 0;
    targetMovementPoseRef.current = nextMovementPose;
    previousMovementProfileRef.current = nextMovementProfile;
    currentMovementProfileRef.current = nextMovementProfile;
    movementProfileBlendRef.current = 1;
    movementCycleRef.current = 0;
    jumpStartedAtRef.current = null;
    wasJumpingRef.current = false;
  }, [idleIntensity, resolvedHero]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const frameDelta = Math.min(delta, 0.05);
    const nextBodyOpacity = bodyOpacityRef?.current ?? bodyOpacity;
    if (Math.abs(appliedBodyOpacityRef.current - nextBodyOpacity) > 0.001) {
      appliedBodyOpacityRef.current = nextBodyOpacity;
      applyHeroBodyOpacity(groupRef.current, nextBodyOpacity);
    }
    const verticalScale = Math.max(0.45, Math.min(1, postureScaleYRef?.current ?? postureScaleY));
    const baseScaleY = scale * verticalScale;
    const t = state.clock.elapsedTime;
    const moving = isMovingRef?.current ?? isMoving;
    const jumping = isJumpingRef?.current ?? isJumping;
    const crouching = isCrouchingRef?.current ?? isCrouching;
    const sliding = isSlidingRef?.current ?? isSliding;
    let attacking = isAttackingRef?.current ?? isAttacking;
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

      if (!attackSideRef && attackSide === undefined && resolvedHero === 'hookshot') {
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
    const normalizedWalkDirection = getNormalizedWalkDirection(rawWalkDirection);
    const bones = boneRefs.current;
    setBoneBasePose(bones);

    if (jumping) {
      if (!wasJumpingRef.current || jumpStartedAtRef.current === null) {
        jumpStartedAtRef.current = t;
      }
    } else if (jumpBlendRef.current <= 0.001) {
      jumpStartedAtRef.current = null;
    }
    wasJumpingRef.current = jumping;

    const targetMovementBlend = moving && !jumping && !sliding ? 1 : 0;
    const targetCrouchBlend = crouching && !jumping && !sliding ? 1 : 0;
    const targetJumpBlend = jumping ? 1 : 0;
    const targetSlideBlend = sliding && !jumping ? 1 : 0;
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
      attackBlendRef.current <= 0.001
    ) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.rotation.set(0, 0, 0);
      groupRef.current.scale.set(scale, baseScaleY, scale);
      materials.forEach((material, kind) => {
        material.emissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
      });

      return;
    }

    const targetIdleBlend = moving || jumping || crouching || sliding || attacking ? 0 : 1;
    idleBlendRef.current = THREE.MathUtils.damp(
      idleBlendRef.current,
      targetIdleBlend,
      moving || jumping || crouching || sliding || attacking ? 9.5 : 5.5,
      frameDelta
    );

    const slideAmount = easeInOutSine(slideBlendRef.current);
    const runSlideCrossfadeAmount = targetMovementPoseRef.current === 'run' ? slideAmount : 0;
    const attackAmount = easeInOutSine(attackBlendRef.current);
    const attackPosePulse = resolvedHero === 'blaze' || resolvedHero === 'phantom'
      ? getBlazeAttackPoseAmount(attackProgress)
      : Math.sin(attackProgress * Math.PI);
    const attackPulse = attackPosePulse * attackAmount;
    const rootAttackPulse = resolvedHero === 'phantom' ? 0 : attackPulse;
    const idleAmount = idleBlendRef.current * idleIntensity;
    const movingAmount = movementBlendRef.current * (1 - runSlideCrossfadeAmount);
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
    groupRef.current.rotation.x =
      secondary * idleProfile.swayAmplitude * 0.08 * idleAmount -
      normalizedWalkDirection.forward * movementProfile.rootPitch * movingAmount +
      jumpPose.pitch * jumpAmount +
      -0.025 * poseCrouchAmount +
      0.6 * slideAmount -
      0.035 * rootAttackPulse;
    groupRef.current.rotation.y =
      tertiary * idleProfile.twistAmplitude * 0.12 * idleAmount +
      activeAttackSide * 0.025 * rootAttackPulse;
    groupRef.current.rotation.z =
      secondary * idleProfile.swayAmplitude * 0.12 * idleAmount -
      normalizedWalkDirection.right * movementProfile.rootRoll * movingAmount +
      movementSway * movementProfile.rootSway * movingAmount +
      0.055 * slideAmount -
      activeAttackSide * 0.018 * rootAttackPulse;

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
    if (resolvedHero === 'chronos') {
      applyChronosArmPose(bones, 1 - slideAmount);
    }

    const glowPulse =
      (0.5 + 0.5 * tertiary) * idleProfile.auraPulse * idleAmount +
      (jumpPose.extension * 0.18 + jumpPose.land * 0.14) * jumpAmount +
      movementStep * movementProfile.glowPulse * movingAmount +
      0.035 * poseCrouchAmount +
      0.09 * slideAmount +
      0.16 * attackPulse;
    materials.forEach((material, kind) => {
      const baseEmissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
      material.emissiveIntensity = baseEmissiveIntensity * (1 + glowPulse);
    });

    applyWalkingBonePose(bones, movementCycleTime, movingAmount, normalizedWalkDirection, movementProfile);
    applySlideBonePose(bones, t, slideAmount);
    applyHeroAttackPose(resolvedHero, bones, attackProgress, attackAmount, activeAttackSide);
  });

  const renderPartsForBone = (bone: HeroBoneName) => (
    <>
      {(riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <mesh
          key={`${resolvedHero}-${bone}-${index}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <primitive object={materials.get(riggedPart.part.material)!} attach="material" />
        </mesh>
      ))}

      {(riggedTeamAccentPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <mesh
          key={`${resolvedHero}-team-${bone}-${index}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <TeamAccentMaterial part={riggedPart.part as TeamAccentPart} teamColor={teamColor} />
        </mesh>
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

  const renderKneeJoint = (side: 'left' | 'right') => (
    <>
      <mesh
        key={`${resolvedHero}-${side}-knee-cap`}
        position={[0, 0.015, -0.185]}
        scale={[0.18, 0.08, 0.05]}
        castShadow={castShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materials.get('edge')!} attach="material" />
      </mesh>
      <mesh
        key={`${resolvedHero}-${side}-knee-glow`}
        position={[0, 0.018, -0.222]}
        scale={[0.105, 0.028, 0.026]}
        castShadow={castShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materials.get('accent')!} attach="material" />
      </mesh>
    </>
  );

  const renderUpperLegLink = (side: 'left' | 'right') => (
    <mesh
      key={`${resolvedHero}-${side}-upper-leg-link`}
      position={[0, -0.15, -0.018]}
      scale={[0.17, 0.3, 0.13]}
      castShadow={castShadow}
      geometry={HERO_PART_GEOMETRIES.box}
    >
      <primitive object={materials.get('dark')!} attach="material" />
    </mesh>
  );

  return (
    <group ref={groupRef} scale={[scale, scale * initialVerticalScale, scale]}>
      <group
        ref={(node) => {
          boneRefs.current.aura = node;
        }}
        position={HERO_BONE_PIVOTS.aura}
      >
        {renderPartsForBone('aura')}
        {renderSocketMarkersForBone('aura')}
      </group>

      <group
        ref={(node) => {
          boneRefs.current.hips = node;
        }}
        position={HERO_BONE_PIVOTS.hips}
      >
        {renderPartsForBone('hips')}
        {renderSocketMarkersForBone('hips')}
      </group>

      <group
        ref={(node) => {
          boneRefs.current.leftLeg = node;
        }}
        position={HERO_BONE_PIVOTS.leftLeg}
      >
        {renderUpperLegLink('left')}
        {renderPartsForBone('leftLeg')}
        {renderSocketMarkersForBone('leftLeg')}

        <group
          ref={(node) => {
            boneRefs.current.leftKnee = node;
          }}
          position={getChildBonePosition('leftKnee', 'leftLeg')}
        >
          {renderKneeJoint('left')}
          {renderSocketMarkersForBone('leftKnee')}

          <group
            ref={(node) => {
              boneRefs.current.leftShin = node;
            }}
            position={getChildBonePosition('leftShin', 'leftKnee')}
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
        position={HERO_BONE_PIVOTS.rightLeg}
      >
        {renderUpperLegLink('right')}
        {renderPartsForBone('rightLeg')}
        {renderSocketMarkersForBone('rightLeg')}

        <group
          ref={(node) => {
            boneRefs.current.rightKnee = node;
          }}
          position={getChildBonePosition('rightKnee', 'rightLeg')}
        >
          {renderKneeJoint('right')}
          {renderSocketMarkersForBone('rightKnee')}

          <group
            ref={(node) => {
              boneRefs.current.rightShin = node;
            }}
            position={getChildBonePosition('rightShin', 'rightKnee')}
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
        position={HERO_BONE_PIVOTS.torso}
      >
        {renderPartsForBone('torso')}
        {renderSocketMarkersForBone('torso')}

        <group
          ref={(node) => {
            boneRefs.current.head = node;
          }}
          position={getChildBonePosition('head', 'torso')}
        >
          {renderPartsForBone('head')}
          {renderSocketMarkersForBone('head')}
        </group>

        <group
          ref={(node) => {
            boneRefs.current.leftArm = node;
          }}
          position={getChildBonePosition('leftArm', 'torso')}
        >
          {renderPartsForBone('leftArm')}
          {renderSocketMarkersForBone('leftArm')}

          <group
            ref={(node) => {
              boneRefs.current.leftForearm = node;
            }}
            position={getChildBonePosition('leftForearm', 'leftArm')}
          >
            {renderPartsForBone('leftForearm')}
            {renderSocketMarkersForBone('leftForearm')}
          </group>
        </group>

        <group
          ref={(node) => {
            boneRefs.current.rightArm = node;
          }}
          position={getChildBonePosition('rightArm', 'torso')}
        >
          {renderPartsForBone('rightArm')}
          {renderSocketMarkersForBone('rightArm')}

          <group
            ref={(node) => {
              boneRefs.current.rightForearm = node;
            }}
            position={getChildBonePosition('rightForearm', 'rightArm')}
          >
            {renderPartsForBone('rightForearm')}
            {renderSocketMarkersForBone('rightForearm')}
          </group>
        </group>
      </group>

      {isBot && (
        <mesh
          position={[0, 1.98, 0]}
          scale={[0.14, 0.04, 0.14]}
          castShadow={castShadow}
          geometry={HERO_PART_GEOMETRIES.box}
        >
          <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.75} />
        </mesh>
      )}
    </group>
  );
});
