import * as THREE from 'three';
import type { HeroId } from '@voxel-strike/shared';
import {
  BLAZE_ATTACK_HOLD_DURATION,
  BLAZE_ATTACK_RAMP_DURATION,
  BLAZE_ATTACK_RELEASE_DURATION,
  BLAZE_ATTACK_DURATION,
  CHRONOS_WALK_ARM_ARC_SCALE,
  DEFAULT_WALK_DIRECTION,
  JUMP_CYCLE_DURATION,
  JUMP_HEIGHT,
  SLIDE_KNEE_HINGE_SPEED,
  WALK_LEG_LIFT,
  WALK_LEG_STRIDE,
} from './heroBodyManifests';
import { getBoneRestPosition, HERO_BONE_PIVOTS } from './heroRig';
import type {
  HeroBoneRefs,
  HeroBoneName,
  HeroIdleProfile,
  HeroJumpPose,
  HeroMovementPose,
  HeroMovementProfile,
  HeroWalkDirection,
} from './heroBodyTypes';

const PHANTOM_SHIELD_BODY_POSE_ATTACK_MS = 120;
const PHANTOM_SHIELD_BODY_POSE_HOLD_MS = 340;
const PHANTOM_SHIELD_BODY_POSE_FADE_MS = 740;
const HERO_BODY_POSE_BLEND_DURATION_SECONDS = 0.14;
const HERO_LOOK_PITCH_DEADZONE = 0.035;
const HERO_LOOK_PITCH_WAIST_SCALE = 0.55;
const HERO_LOOK_PITCH_MAX_WAIST_BEND = THREE.MathUtils.degToRad(38);
const HERO_LOOK_PITCH_HEAD_BLEND = 0.28;
const DOWNED_BODY_FACE_DOWN_TILT_RADIANS = -THREE.MathUtils.degToRad(84);
const DOWNED_BODY_TOE_PIVOT_Z = -0.22;
const JUMP_ROOT_LIFT_MULTIPLIER = 1.28;
const JUMP_ANTICIPATION_DIP = 0.055;
const JUMP_LANDING_DIP = 0.058;
const JUMP_CROUCH_MULTIPLIER = 1.36;
const JUMP_KNEE_CROUCH_BEND_MULTIPLIER = 1.12;
const JUMP_LAUNCH_EXTENSION_MULTIPLIER = 1.18;
const JUMP_TUCK_MULTIPLIER = 1.14;
const JUMP_LAND_MULTIPLIER = 1.16;
const JUMP_ARM_REACH_MULTIPLIER = 0.86;
const HERO_TORSO_WAIST_ANCHOR = new THREE.Vector3(
  HERO_BONE_PIVOTS.hips[0] - HERO_BONE_PIVOTS.torso[0],
  HERO_BONE_PIVOTS.hips[1] - HERO_BONE_PIVOTS.torso[1],
  HERO_BONE_PIVOTS.hips[2] - HERO_BONE_PIVOTS.torso[2]
);
const HERO_TORSO_WAIST_ANCHOR_BEFORE = new THREE.Vector3();
const HERO_TORSO_WAIST_ANCHOR_AFTER = new THREE.Vector3();

export const HERO_LOOK_PITCH_WAIST_DAMPING = 14;

export function applyDownedRootPivot(
  position: THREE.Vector3,
  rotation: THREE.Euler,
  scale: number,
  amount: number
): void {
  const blend = clamp01(amount);
  if (blend <= 0.001) return;

  const tilt = DOWNED_BODY_FACE_DOWN_TILT_RADIANS * blend;
  const pivotZ = DOWNED_BODY_TOE_PIVOT_Z * scale;
  position.y += Math.sin(tilt) * pivotZ;
  position.z += pivotZ * (1 - Math.cos(tilt));
  rotation.x += tilt;
}

export interface HeroBodyPoseRootTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface HeroBodyPoseSnapshotTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

type HeroBodyPoseBlendTarget = HeroBoneName | 'root';

export interface HeroBodyPoseTransitionRuntime {
  activeKey: number | string | null;
  elapsedSeconds: number;
  durationSeconds: number;
  fromPose: Record<HeroBodyPoseBlendTarget, HeroBodyPoseSnapshotTransform>;
  toPose: Record<HeroBodyPoseBlendTarget, HeroBodyPoseSnapshotTransform>;
}

const HERO_BODY_POSE_BLEND_TARGETS: readonly HeroBodyPoseBlendTarget[] = [
  'root',
  ...(Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]),
];

function createSnapshotTransform(): HeroBodyPoseSnapshotTransform {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  };
}

function createPoseSnapshot(): Record<HeroBodyPoseBlendTarget, HeroBodyPoseSnapshotTransform> {
  return Object.fromEntries(
    HERO_BODY_POSE_BLEND_TARGETS.map((target) => [target, createSnapshotTransform()])
  ) as Record<HeroBodyPoseBlendTarget, HeroBodyPoseSnapshotTransform>;
}

function getPoseBlendTarget(
  root: HeroBodyPoseRootTransform,
  bones: HeroBoneRefs,
  target: HeroBodyPoseBlendTarget
): HeroBodyPoseRootTransform | THREE.Group | null | undefined {
  return target === 'root' ? root : bones[target];
}

function capturePoseBlendTarget(
  root: HeroBodyPoseRootTransform,
  bones: HeroBoneRefs,
  target: HeroBodyPoseBlendTarget,
  snapshot: HeroBodyPoseSnapshotTransform
): void {
  const object = getPoseBlendTarget(root, bones, target);
  if (!object) return;

  snapshot.position.copy(object.position);
  snapshot.quaternion.copy(object.quaternion);
  snapshot.scale.copy(object.scale);
}

export function createHeroBodyPoseTransitionRuntime(
  durationSeconds = HERO_BODY_POSE_BLEND_DURATION_SECONDS
): HeroBodyPoseTransitionRuntime {
  return {
    activeKey: null,
    elapsedSeconds: durationSeconds,
    durationSeconds,
    fromPose: createPoseSnapshot(),
    toPose: createPoseSnapshot(),
  };
}

export function resetHeroBodyPoseTransitionRuntime(
  runtime: HeroBodyPoseTransitionRuntime,
  activeKey: number | string | null = null
): void {
  runtime.activeKey = activeKey;
  runtime.elapsedSeconds = runtime.durationSeconds;
}

export function beginHeroBodyPoseTransition(
  runtime: HeroBodyPoseTransitionRuntime,
  poseKey: number | string,
  root: HeroBodyPoseRootTransform,
  bones: HeroBoneRefs
): void {
  if (runtime.activeKey === null) {
    runtime.activeKey = poseKey;
    runtime.elapsedSeconds = runtime.durationSeconds;
    return;
  }

  if (runtime.activeKey === poseKey) return;

  for (const target of HERO_BODY_POSE_BLEND_TARGETS) {
    capturePoseBlendTarget(root, bones, target, runtime.fromPose[target]);
  }
  runtime.activeKey = poseKey;
  runtime.elapsedSeconds = 0;
}

export function applyHeroBodyPoseTransition(
  runtime: HeroBodyPoseTransitionRuntime,
  root: HeroBodyPoseRootTransform,
  bones: HeroBoneRefs,
  deltaSeconds: number
): void {
  if (runtime.elapsedSeconds >= runtime.durationSeconds) return;

  runtime.elapsedSeconds = Math.min(
    runtime.durationSeconds,
    runtime.elapsedSeconds + Math.max(0, deltaSeconds)
  );
  const blend = runtime.durationSeconds <= 0
    ? 1
    : easeInOutSine(runtime.elapsedSeconds / runtime.durationSeconds);

  for (const target of HERO_BODY_POSE_BLEND_TARGETS) {
    const object = getPoseBlendTarget(root, bones, target);
    if (!object) continue;

    const from = runtime.fromPose[target];
    const to = runtime.toPose[target];
    to.position.copy(object.position);
    to.quaternion.copy(object.quaternion);
    to.scale.copy(object.scale);

    object.position.lerpVectors(from.position, to.position, blend);
    object.quaternion.slerpQuaternions(from.quaternion, to.quaternion, blend);
    object.scale.lerpVectors(from.scale, to.scale, blend);
  }
}

// Numeric (bitmask) encoding of a hero body pose state. Each field occupies a
// disjoint bit range so two distinct pose states can never collide to the same
// number. Bit layout (LSB first):
//   bit 0      idleEnabled
//   bit 1      moving
//   bit 2      jumping
//   bit 3      crouching
//   bit 4      sliding
//   bit 5      downed
//   bit 6      crawling
//   bit 7      beingRevived
//   bit 8      shieldActive
//   bits 9-10  attackState (0 = none, 1 = attack side +1, 2 = attack side -1)
//   bits 11-13 heroId index (0-7)
//   bits 14-16 movementPose index (0-7)
// Max occupied bit is 16, so the key is always a positive 17-bit integer.
const HERO_BODY_POSE_HERO_ID_BITS: Record<HeroId, number> = {
  phantom: 0,
  hookshot: 1,
  blaze: 2,
  chronos: 3,
};

const HERO_BODY_POSE_MOVEMENT_BITS: Record<HeroMovementPose, number> = {
  walk: 0,
  crouchWalk: 1,
  run: 2,
};

export function getHeroBodyPoseBlendKey(options: {
  heroId: HeroId;
  moving: boolean;
  jumping: boolean;
  crouching: boolean;
  sliding: boolean;
  downed?: boolean;
  crawling?: boolean;
  beingRevived?: boolean;
  attacking: boolean;
  attackSide: -1 | 1;
  movementPose: HeroMovementPose;
  idleEnabled: boolean;
  shieldActive?: boolean;
}): number {
  let key = 0;
  if (options.idleEnabled) key |= 1 << 0;
  if (options.moving) key |= 1 << 1;
  if (options.jumping) key |= 1 << 2;
  if (options.crouching) key |= 1 << 3;
  if (options.sliding) key |= 1 << 4;
  if (options.downed) key |= 1 << 5;
  if (options.crawling) key |= 1 << 6;
  if (options.beingRevived) key |= 1 << 7;
  if (options.shieldActive) key |= 1 << 8;
  const attackState = options.attacking ? (options.attackSide === 1 ? 1 : 2) : 0;
  key |= attackState << 9;
  key |= HERO_BODY_POSE_HERO_ID_BITS[options.heroId] << 11;
  key |= HERO_BODY_POSE_MOVEMENT_BITS[options.movementPose] << 14;
  return key;
}

export function getNormalizedWalkDirection(direction: HeroWalkDirection): HeroWalkDirection {
  const length = Math.sqrt(direction.forward * direction.forward + direction.right * direction.right);
  if (length < 0.001) {
    return DEFAULT_WALK_DIRECTION;
  }

  return {
    forward: direction.forward / length,
    right: direction.right / length,
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function easeInOutSine(value: number): number {
  const t = clamp01(value);
  return 0.5 - Math.cos(t * Math.PI) * 0.5;
}

export function smoothPulse(phase: number, start: number, peak: number, end: number): number {
  if (phase <= start || phase >= end) return 0;
  if (phase <= peak) return easeInOutSine((phase - start) / (peak - start));
  return 1 - easeInOutSine((phase - peak) / (end - peak));
}

export function getHeroLookPitchWaistBend(lookPitch: number): number {
  if (!Number.isFinite(lookPitch)) return 0;

  const absPitch = Math.abs(lookPitch);
  if (absPitch <= HERO_LOOK_PITCH_DEADZONE) return 0;

  const softenedPitch = Math.sign(lookPitch) * (absPitch - HERO_LOOK_PITCH_DEADZONE);
  return THREE.MathUtils.clamp(
    softenedPitch * HERO_LOOK_PITCH_WAIST_SCALE,
    -HERO_LOOK_PITCH_MAX_WAIST_BEND,
    HERO_LOOK_PITCH_MAX_WAIST_BEND
  );
}

export function applyLookPitchWaistBend(bones: HeroBoneRefs, lookPitch: number): void {
  const waistBend = getHeroLookPitchWaistBend(lookPitch);
  if (Math.abs(waistBend) <= 0.001) return;

  if (bones.torso) {
    HERO_TORSO_WAIST_ANCHOR_BEFORE
      .copy(HERO_TORSO_WAIST_ANCHOR)
      .multiply(bones.torso.scale)
      .applyEuler(bones.torso.rotation);
    bones.torso.rotation.x += waistBend;
    HERO_TORSO_WAIST_ANCHOR_AFTER
      .copy(HERO_TORSO_WAIST_ANCHOR)
      .multiply(bones.torso.scale)
      .applyEuler(bones.torso.rotation);
    bones.torso.position.add(
      HERO_TORSO_WAIST_ANCHOR_BEFORE.sub(HERO_TORSO_WAIST_ANCHOR_AFTER)
    );
  }

  if (bones.head) {
    bones.head.rotation.x += waistBend * HERO_LOOK_PITCH_HEAD_BLEND;
  }
}

export function getPhantomShieldBodyPoseAmount(startedAtMs: number | null | undefined, nowMs: number): number {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return 0;

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs > PHANTOM_SHIELD_BODY_POSE_FADE_MS) return 0;

  const attack = easeInOutSine(elapsedMs / PHANTOM_SHIELD_BODY_POSE_ATTACK_MS);
  const fade = 1 - easeInOutSine((elapsedMs - PHANTOM_SHIELD_BODY_POSE_HOLD_MS) / (
    PHANTOM_SHIELD_BODY_POSE_FADE_MS - PHANTOM_SHIELD_BODY_POSE_HOLD_MS
  ));
  return clamp01(attack * fade);
}

export function getJumpPose(time: number): HeroJumpPose {
  const phase = (time % JUMP_CYCLE_DURATION) / JUMP_CYCLE_DURATION;
  const airProgress = clamp01((phase - 0.32) / 0.5);
  const isAirborne = phase > 0.32 && phase < 0.82;
  const rootLift = isAirborne ? Math.sin(airProgress * Math.PI) * JUMP_HEIGHT : 0;
  const anticipation = smoothPulse(phase, 0, 0.17, 0.32);
  const launch = smoothPulse(phase, 0.25, 0.36, 0.48);
  const tuck = smoothPulse(phase, 0.42, 0.58, 0.78);
  const land = smoothPulse(phase, 0.78, 0.86, 0.98);
  const armSwing = smoothPulse(phase, 0.24, 0.38, 0.84);

  return {
    rootLift:
      rootLift * JUMP_ROOT_LIFT_MULTIPLIER -
      anticipation * JUMP_ANTICIPATION_DIP -
      land * JUMP_LANDING_DIP,
    crouch: anticipation * JUMP_CROUCH_MULTIPLIER + land * 0.78,
    extension: launch * JUMP_LAUNCH_EXTENSION_MULTIPLIER,
    tuck: tuck * JUMP_TUCK_MULTIPLIER,
    land: land * JUMP_LAND_MULTIPLIER,
    armReach: armSwing * JUMP_ARM_REACH_MULTIPLIER,
    pitch: launch * 0.092 - anticipation * 0.067 - land * 0.05,
  };
}


export function setBoneBasePose(bones: HeroBoneRefs): void {
  (Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]).forEach((bone) => {
    const group = bones[bone];
    if (!group) return;
    group.position.set(...getBoneRestPosition(bone));
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
  });
}

export function applyIdleBonePose(
  bones: HeroBoneRefs,
  profile: HeroIdleProfile,
  primary: number,
  secondary: number,
  tertiary: number,
  amount: number
): void {
  if (amount <= 0.001) return;

  const breathe = primary * profile.breathingAmplitude * amount;
  const widthBreath = breathe * 0.3;
  const rawSway = secondary * profile.swayAmplitude;
  const hipSway = rawSway * amount;
  const shoulderSway = rawSway * 1.15 * amount;
  const twist = tertiary * profile.twistAmplitude * amount;

  if (bones.hips) {
    bones.hips.position.x += hipSway * 0.1;
    bones.hips.position.z += twist * 0.025;
    bones.hips.rotation.y += -twist * 0.18;
    bones.hips.rotation.z += -hipSway * 0.26;
  }

  if (bones.torso) {
    bones.torso.position.x += -hipSway * 0.06;
    bones.torso.position.y += breathe * 0.1;
    bones.torso.rotation.x += secondary * profile.swayAmplitude * 0.4 * amount;
    bones.torso.rotation.y += twist * 0.62;
    bones.torso.rotation.z += shoulderSway * 0.5;
    bones.torso.scale.set(1 - widthBreath, 1 + breathe, 1 - widthBreath);
  }

  if (bones.head) {
    bones.head.position.x += -hipSway * 0.035;
    bones.head.position.y += primary * 0.01 * amount;
    bones.head.rotation.x += -secondary * 0.024 * amount;
    bones.head.rotation.y += tertiary * 0.045 * amount;
    bones.head.rotation.z += secondary * 0.019 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.position.y += primary * 0.005 * amount;
    bones.leftArm.position.x += -Math.abs(hipSway) * 0.045;
    bones.leftArm.rotation.x += (secondary * 0.034 + tertiary * 0.012) * amount;
    bones.leftArm.rotation.y += twist * 0.16;
    bones.leftArm.rotation.z += (0.036 + primary * 0.038) * amount + shoulderSway * 0.42;
  }
  if (bones.rightArm) {
    bones.rightArm.position.y += primary * 0.005 * amount;
    bones.rightArm.position.x += Math.abs(hipSway) * 0.045;
    bones.rightArm.rotation.x += (secondary * 0.034 - tertiary * 0.012) * amount;
    bones.rightArm.rotation.y += twist * 0.16;
    bones.rightArm.rotation.z -= (0.036 + primary * 0.038) * amount - shoulderSway * 0.42;
  }

  if (bones.leftLeg) {
    bones.leftLeg.position.x += hipSway * 0.025;
    bones.leftLeg.rotation.x += -primary * 0.013 * amount;
    bones.leftLeg.rotation.y += -twist * 0.12;
    bones.leftLeg.rotation.z += secondary * 0.012 * amount;
  }
  if (bones.leftKnee) {
    bones.leftKnee.position.y += primary * 0.005 * amount;
    bones.leftKnee.position.x += hipSway * 0.018;
  }
  if (bones.leftShin) {
    bones.leftShin.rotation.x += primary * 0.018 * amount;
    bones.leftShin.rotation.z += -secondary * 0.008 * amount;
  }
  if (bones.rightLeg) {
    bones.rightLeg.position.x += hipSway * 0.025;
    bones.rightLeg.rotation.x += primary * 0.013 * amount;
    bones.rightLeg.rotation.y += -twist * 0.12;
    bones.rightLeg.rotation.z += secondary * 0.012 * amount;
  }
  if (bones.rightKnee) {
    bones.rightKnee.position.y += -primary * 0.005 * amount;
    bones.rightKnee.position.x += hipSway * 0.018;
  }
  if (bones.rightShin) {
    bones.rightShin.rotation.x += -primary * 0.018 * amount;
    bones.rightShin.rotation.z += -secondary * 0.008 * amount;
  }

  if (bones.aura) {
    const pulse = 1 + (0.5 + 0.5 * tertiary) * profile.auraPulse * amount;
    bones.aura.scale.set(pulse, 1, pulse);
    bones.aura.rotation.y += tertiary * 0.052 * amount;
  }
}

function applyWalkArmPose(
  bone: THREE.Group | null | undefined,
  isLeft: boolean,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  profile: HeroMovementProfile
): void {
  if (!bone || amount <= 0.001) return;

  const phaseOffset = isLeft ? 0 : Math.PI;
  const phase = Math.sin(cycleTime + phaseOffset);
  const strafeBlend = THREE.MathUtils.smoothstep(Math.abs(direction.right), 0.08, 0.86);

  const armAmount = amount * profile.armArcScale;
  bone.rotation.x += direction.forward * phase * profile.armPitch * armAmount;
  bone.rotation.y += direction.right * phase * profile.armPitch * 0.16 * strafeBlend * armAmount;
  bone.rotation.z += direction.right * phase * profile.armStrafeRoll * (1 + strafeBlend * 0.28) * armAmount;
  bone.position.x += direction.right * phase * 0.035 * (1 + strafeBlend * 0.55) * armAmount;
  bone.position.z += -direction.forward * phase * 0.045 * armAmount;
}

function applyWalkLegPose(
  upperLeg: THREE.Group | null | undefined,
  knee: THREE.Group | null | undefined,
  shin: THREE.Group | null | undefined,
  isLeft: boolean,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  profile: HeroMovementProfile
): void {
  if (amount <= 0.001) return;

  const side = isLeft ? -1 : 1;
  const phaseOffset = isLeft ? 0 : Math.PI;
  const phase = Math.sin(cycleTime + phaseOffset);
  const footLift = Math.max(0, Math.cos(cycleTime + phaseOffset));
  const supportBend = Math.max(0, -Math.cos(cycleTime + phaseOffset));
  const strideScale = THREE.MathUtils.clamp(profile.legStride / WALK_LEG_STRIDE, 0.7, 2.2);
  const liftScale = THREE.MathUtils.clamp(profile.legLift / WALK_LEG_LIFT, 0.7, 2.4);
  const lowerLegScale = THREE.MathUtils.clamp((strideScale + liftScale) * 0.5, 0.7, 2.3);
  const strafeBlend = THREE.MathUtils.smoothstep(Math.abs(direction.right), 0.08, 0.86);
  const forwardBlend = THREE.MathUtils.smoothstep(Math.abs(direction.forward), 0.08, 0.78);
  const leadingLeg = Math.max(0, direction.right * side);
  const trailingLeg = Math.max(0, -direction.right * side);
  const lateralStep =
    direction.right * profile.legStrafe *
    (footLift * (1.3 + liftScale * 0.35 + trailingLeg * 0.45) - supportBend * 0.42);
  const lateralOpen = side * leadingLeg * footLift * profile.legStrafe * 1.15;
  const lateralClose = direction.right * trailingLeg * footLift * profile.legStrafe * 0.8;
  const lateralLegOffset =
    direction.right * phase * profile.legStrafe * (1 - strafeBlend * 0.65) +
    strafeBlend * (lateralStep + lateralOpen + lateralClose);

  if (upperLeg) {
    upperLeg.rotation.x += direction.forward * phase * profile.legPitch * (1 - strafeBlend * 0.22) * amount;
    upperLeg.rotation.y +=
      (direction.right * phase * 0.025 +
      direction.right * footLift * 0.075 * strafeBlend) * amount;
    upperLeg.rotation.z +=
      (-direction.right * phase * profile.legStrafeRoll * (1 - strafeBlend * 0.45) +
      direction.right * footLift * profile.legStrafeRoll * 0.62 * strafeBlend -
      direction.right * supportBend * profile.legStrafeRoll * 0.2 * strafeBlend) * amount;
    upperLeg.position.x += lateralLegOffset * amount;
    upperLeg.position.y += footLift * profile.legLift * amount;
    upperLeg.position.z += -direction.forward * phase * profile.legStride * (1 - strafeBlend * 0.18) * amount;
  }

  if (knee) {
    knee.position.x += (
      side * footLift * 0.018 * liftScale +
      strafeBlend * direction.right * (footLift * 0.028 * liftScale - supportBend * 0.009 * lowerLegScale)
    ) * amount;
    knee.position.y += (footLift * 0.01 * liftScale - supportBend * 0.006 * lowerLegScale) * amount;
    knee.position.z += -direction.forward * footLift * 0.008 * strideScale * (1 - strafeBlend * 0.24) * amount;
    knee.rotation.z += (
      side * footLift * 0.035 * liftScale +
      direction.right * footLift * 0.05 * strafeBlend
    ) * amount;
  }

  if (shin) {
    const bend = profile.supportKneeBend * supportBend + profile.kneeBend * footLift * (1 + strafeBlend * 0.18);
    shin.rotation.x += bend * amount;
    shin.rotation.z +=
      side * footLift * 0.07 * liftScale * amount -
      direction.right * phase * 0.012 * lowerLegScale * (1 - strafeBlend * 0.35) * amount +
      direction.right * footLift * 0.052 * strafeBlend * amount;
    shin.position.x += direction.right * footLift * 0.012 * liftScale * strafeBlend * amount;
    shin.position.z += -direction.forward * footLift * 0.006 * strideScale * (1 - strafeBlend * 0.24) * amount;
  }

  if (forwardBlend <= 0.001 && strafeBlend > 0.001 && shin) {
    shin.rotation.y += direction.right * footLift * 0.045 * strafeBlend * amount;
  }
}

export function applyWalkingBonePose(
  bones: HeroBoneRefs,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  profile: HeroMovementProfile
): void {
  applyWalkLegPose(bones.leftLeg, bones.leftKnee, bones.leftShin, true, cycleTime, amount, direction, profile);
  applyWalkLegPose(bones.rightLeg, bones.rightKnee, bones.rightShin, false, cycleTime, amount, direction, profile);
  applyWalkArmPose(bones.leftArm, false, cycleTime, amount, direction, profile);
  applyWalkArmPose(bones.rightArm, true, cycleTime, amount, direction, profile);
}

export function applyCrouchBonePose(bones: HeroBoneRefs, time: number, amount: number): void {
  if (amount <= 0.001) return;

  const breathe = Math.sin(time * 2.2) * 0.025 * amount;
  const brace = 1 + Math.max(0, Math.sin(time * 3.4)) * 0.035;

  if (bones.hips) {
    bones.hips.position.y += -0.085 * amount;
    bones.hips.position.z += 0.03 * amount;
    bones.hips.rotation.x += 0.14 * amount;
  }

  if (bones.torso) {
    bones.torso.position.y += (-0.044 + breathe * 0.18) * amount;
    bones.torso.position.z += -0.028 * amount;
    bones.torso.rotation.x += -0.25 * amount;
    bones.torso.rotation.z += Math.sin(time * 1.3) * 0.01 * amount;
    bones.torso.scale.y *= 1 - 0.01 * amount;
    bones.torso.scale.x *= 1 + 0.006 * amount;
  }

  if (bones.head) {
    bones.head.position.y += -0.006 * amount;
    bones.head.position.z += -0.014 * amount;
    bones.head.rotation.x += -0.085 * amount;
    bones.head.rotation.y += Math.sin(time * 1.6) * 0.018 * amount;
    bones.head.scale.y *= 1 + 0.035 * amount;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.72 * amount;
    bones.leftLeg.rotation.z += -0.08 * amount;
    bones.leftLeg.position.y += -0.034 * amount;
    bones.leftLeg.position.x += -0.025 * amount;
    bones.leftLeg.position.z += 0.018 * amount;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 0.72 * amount;
    bones.rightLeg.rotation.z += 0.08 * amount;
    bones.rightLeg.position.y += -0.034 * amount;
    bones.rightLeg.position.x += 0.025 * amount;
    bones.rightLeg.position.z += 0.018 * amount;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.052 * amount;
    bones.leftKnee.position.z += -0.018 * amount;
  }

  if (bones.rightKnee) {
    bones.rightKnee.position.y += -0.052 * amount;
    bones.rightKnee.position.z += -0.018 * amount;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -0.86 * amount;
    bones.leftShin.rotation.z += 0.055 * amount;
    bones.leftShin.position.z += 0.026 * amount;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += -0.86 * amount;
    bones.rightShin.rotation.z += -0.055 * amount;
    bones.rightShin.position.z += 0.026 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.13 * brace * amount;
    bones.leftArm.rotation.z += 0.38 * amount;
    bones.leftArm.position.x += -0.028 * amount;
    bones.leftArm.position.y += -0.052 * amount;
    bones.leftArm.position.z += -0.026 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += -0.13 * brace * amount;
    bones.rightArm.rotation.z -= 0.38 * amount;
    bones.rightArm.position.x += 0.028 * amount;
    bones.rightArm.position.y += -0.052 * amount;
    bones.rightArm.position.z += -0.026 * amount;
  }

  if (bones.aura) {
    const pulse = 1 + (0.04 + Math.max(0, breathe) * 0.8) * amount;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

export function applyChronosArmPose(bones: HeroBoneRefs, amount: number): void {
  if (amount <= 0.001) return;

  if (bones.leftArm) {
    bones.leftArm.rotation.x += 0.72 * amount;
    bones.leftArm.rotation.z += 0.48 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += 0.72 * amount;
    bones.rightArm.rotation.z -= 0.48 * amount;
  }

  if (bones.leftForearm) {
    bones.leftForearm.rotation.x -= 0.18 * amount;
    bones.leftForearm.rotation.y -= 0.32 * amount;
  }

  if (bones.rightForearm) {
    bones.rightForearm.rotation.x -= 0.18 * amount;
    bones.rightForearm.rotation.y += 0.32 * amount;
  }
}

export function applySlideBonePose(bones: HeroBoneRefs, time: number, amount: number): void {
  if (amount <= 0.001) return;

  const reach = 1 + Math.sin(time * 4.2) * 0.025;
  const legHinge = Math.sin(time * SLIDE_KNEE_HINGE_SPEED) * 0.1;

  if (bones.hips) {
    bones.hips.position.y += -0.095 * amount;
    bones.hips.position.z += 0.06 * amount;
    bones.hips.rotation.x += 0.13 * amount;
    bones.hips.rotation.z += 0.045 * amount;
  }

  if (bones.torso) {
    bones.torso.position.y += -0.034 * amount;
    bones.torso.position.z += 0.12 * amount;
    bones.torso.rotation.x += 0.29 * amount;
    bones.torso.rotation.y += -0.03 * amount;
    bones.torso.rotation.z += 0.035 * amount;
  }

  if (bones.head) {
    bones.head.position.y += -0.01 * amount;
    bones.head.position.z += 0.014 * amount;
    bones.head.rotation.x += -0.13 * amount;
    bones.head.rotation.y += -0.018 * amount;
    bones.head.rotation.z += 0.022 * amount;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.86 * amount;
    bones.leftLeg.rotation.y += -0.035 * amount;
    bones.leftLeg.rotation.z += -0.18 * amount;
    bones.leftLeg.position.y += -0.026 * amount;
    bones.leftLeg.position.z += -0.012 * amount;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.045 * amount;
    bones.leftKnee.position.z += -0.045 * amount;
    bones.leftKnee.rotation.z += -0.05 * amount;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -1.28 * amount;
    bones.leftShin.rotation.z += 0.16 * amount;
    bones.leftShin.position.z += 0.02 * amount;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 1.03 * amount;
    bones.rightLeg.rotation.y += 0.018 * amount;
    bones.rightLeg.rotation.z += 0.05 * amount;
    bones.rightLeg.position.y += -0.024 * amount;
    bones.rightLeg.position.z += -0.16 * amount;
  }

  if (bones.rightKnee) {
    bones.rightKnee.rotation.z += 0.016 * amount;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += (-0.62 + legHinge) * amount;
    bones.rightShin.rotation.z += -0.02 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.95 * amount;
    bones.leftArm.rotation.y += -0.08 * amount;
    bones.leftArm.rotation.z += 0.28 * amount;
    bones.leftArm.position.y += -0.07 * amount;
    bones.leftArm.position.z += 0.09 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += 0.68 * reach * amount;
    bones.rightArm.rotation.y += 0.035 * amount;
    bones.rightArm.rotation.z += -0.22 * amount;
    bones.rightArm.position.y += -0.018 * amount;
    bones.rightArm.position.z += -0.12 * amount;
  }

  if (bones.aura) {
    bones.aura.scale.x *= 1 + 0.08 * amount;
    bones.aura.scale.z *= 1 + 0.14 * amount;
    bones.aura.rotation.y += time * 0.025 * amount;
  }
}

export function applyDownedBonePose(
  bones: HeroBoneRefs,
  time: number,
  amount: number,
  _crawlAmount: number,
  _reviveAmount: number
): void {
  if (amount <= 0.001) return;

  if (bones.aura) {
    const pulse = 1 + (0.025 + Math.max(0, Math.sin(time * 5.2)) * 0.025) * amount;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

export function applyJumpBonePose(bones: HeroBoneRefs, pose: HeroJumpPose, amount: number): void {
  if (amount <= 0.001) return;

  const crouch = pose.crouch * amount;
  const extension = pose.extension * amount;
  const tuck = pose.tuck * amount;
  const land = pose.land * amount;
  const armReach = pose.armReach * amount;
  const kneeCrouch = crouch * JUMP_KNEE_CROUCH_BEND_MULTIPLIER;

  if (bones.hips) {
    bones.hips.position.y += (-0.055 * crouch + 0.025 * extension - 0.025 * land);
    bones.hips.rotation.x += 0.08 * crouch - 0.055 * extension + 0.04 * land;
  }

  if (bones.torso) {
    bones.torso.position.y += (-0.035 * crouch + 0.025 * extension - 0.025 * land);
    bones.torso.rotation.x += -0.16 * crouch + 0.1 * extension - 0.06 * tuck - 0.08 * land;
    bones.torso.rotation.z += 0.018 * Math.sin(tuck * Math.PI);
  }

  if (bones.head) {
    bones.head.position.y += (-0.018 * crouch + 0.04 * extension - 0.018 * land);
    bones.head.rotation.x += -0.11 * crouch + 0.08 * extension - 0.035 * land;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.56 * kneeCrouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.leftLeg.position.y += -0.018 * kneeCrouch + 0.008 * extension;
    bones.leftLeg.position.z += -0.012 * kneeCrouch + 0.008 * extension;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.025 * kneeCrouch + 0.012 * tuck - 0.014 * land;
    bones.leftKnee.position.z += -0.012 * kneeCrouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -0.74 * kneeCrouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.leftShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.leftShin.position.z += 0.008 * kneeCrouch + 0.008 * tuck;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 0.56 * kneeCrouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.rightLeg.position.y += -0.018 * kneeCrouch + 0.008 * extension;
    bones.rightLeg.position.z += -0.012 * kneeCrouch + 0.008 * extension;
  }

  if (bones.rightKnee) {
    bones.rightKnee.position.y += -0.025 * kneeCrouch + 0.012 * tuck - 0.014 * land;
    bones.rightKnee.position.z += -0.012 * kneeCrouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += -0.74 * kneeCrouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.rightShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.rightShin.position.z += 0.008 * kneeCrouch + 0.008 * tuck;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.48 * armReach + 0.11 * crouch - 0.055 * land;
    bones.leftArm.rotation.z += 0.22 * armReach + 0.055 * crouch;
    bones.leftArm.position.y += 0.017 * armReach - 0.008 * land;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += -0.48 * armReach + 0.11 * crouch - 0.055 * land;
    bones.rightArm.rotation.z -= 0.22 * armReach + 0.055 * crouch;
    bones.rightArm.position.y += 0.017 * armReach - 0.008 * land;
  }

  if (bones.aura) {
    const pulse = 1 + (pose.extension * 0.12 + land * 0.18) * amount;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

function applyPhantomAttackArmPose(
  upperArm: THREE.Group | null | undefined,
  forearm: THREE.Group | null | undefined,
  armSide: -1 | 1,
  activeSide: -1 | 1,
  aim: number,
  shotExtension: number
): void {
  const isActiveArm = armSide === activeSide;
  const ready = aim * (isActiveArm ? 0.74 : 0.58);
  const extension = isActiveArm ? shotExtension : 0;
  const brace = isActiveArm ? 0 : shotExtension * 0.22;

  if (upperArm) {
    upperArm.position.x += armSide * (0.007 * ready - 0.009 * extension + 0.004 * brace);
    upperArm.position.y += -0.03 * ready - 0.004 * extension;
    upperArm.position.z += -0.04 * ready - 0.066 * extension + 0.018 * brace;
    upperArm.rotation.x += 0.44 * ready + 0.2 * extension - 0.035 * brace;
    upperArm.rotation.y += armSide * (0.052 * ready - 0.032 * extension + 0.012 * brace);
    upperArm.rotation.z += -armSide * (0.074 * ready + 0.048 * extension - 0.014 * brace);
    upperArm.scale.y *= 1 + 0.045 * ready + 0.024 * extension;
  }

  if (forearm) {
    forearm.position.z += -0.022 * ready - 0.124 * extension + 0.012 * brace;
    forearm.rotation.x -= 0.46 * ready + 0.32 * extension - 0.045 * brace;
    forearm.rotation.y += armSide * (0.024 * ready + 0.044 * extension - 0.012 * brace);
    forearm.rotation.z += -armSide * 0.026 * extension;
    forearm.scale.z *= 1 + 0.036 * extension;
  }
}

function applyPhantomAttackPose(
  bones: HeroBoneRefs,
  progress: number,
  amount: number,
  side: -1 | 1
): void {
  if (amount <= 0.001) return;

  const poseAmount = getBlazeAttackPoseAmount(progress);
  const aim = poseAmount * amount;
  const shotExtension = smoothPulse(progress, 0, 0.045, 0.16) * amount;

  if (bones.torso) {
    bones.torso.rotation.x += -0.028 * aim - 0.012 * shotExtension;
    bones.torso.rotation.y += -0.024 * aim - side * 0.018 * shotExtension;
    bones.torso.rotation.z += -side * 0.01 * shotExtension;
  }

  applyPhantomAttackArmPose(bones.leftArm, bones.leftForearm, -1, side, aim, shotExtension);
  applyPhantomAttackArmPose(bones.rightArm, bones.rightForearm, 1, side, aim, shotExtension);
}

export function applyPhantomShieldBodyPose(bones: HeroBoneRefs, amount: number): void {
  if (amount <= 0.001) return;

  const open = easeInOutSine(amount);

  if (bones.torso) {
    bones.torso.position.z += -0.026 * open;
    bones.torso.rotation.x += -0.04 * open;
  }

  if (bones.leftArm) {
    bones.leftArm.position.x -= 0.026 * open;
    bones.leftArm.position.y -= 0.014 * open;
    bones.leftArm.position.z -= 0.072 * open;
    bones.leftArm.rotation.x += 0.38 * open;
    bones.leftArm.rotation.y -= 0.1 * open;
    bones.leftArm.rotation.z += 0.24 * open;
  }

  if (bones.rightArm) {
    bones.rightArm.position.x += 0.026 * open;
    bones.rightArm.position.y -= 0.014 * open;
    bones.rightArm.position.z -= 0.072 * open;
    bones.rightArm.rotation.x += 0.38 * open;
    bones.rightArm.rotation.y += 0.1 * open;
    bones.rightArm.rotation.z -= 0.24 * open;
  }

  if (bones.leftForearm) {
    bones.leftForearm.position.z -= 0.064 * open;
    bones.leftForearm.rotation.x -= 0.58 * open;
    bones.leftForearm.rotation.y -= 0.13 * open;
    bones.leftForearm.rotation.z += 0.055 * open;
  }

  if (bones.rightForearm) {
    bones.rightForearm.position.z -= 0.064 * open;
    bones.rightForearm.rotation.x -= 0.58 * open;
    bones.rightForearm.rotation.y += 0.13 * open;
    bones.rightForearm.rotation.z -= 0.055 * open;
  }

  if (bones.aura) {
    const pulse = 1 + 0.08 * open;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

export function getBlazeAttackPoseAmount(progress: number): number {
  const elapsed = clamp01(progress) * BLAZE_ATTACK_DURATION;

  if (elapsed <= BLAZE_ATTACK_RAMP_DURATION) {
    return easeInOutSine(elapsed / BLAZE_ATTACK_RAMP_DURATION);
  }

  if (elapsed <= BLAZE_ATTACK_RAMP_DURATION + BLAZE_ATTACK_HOLD_DURATION) {
    return 1;
  }

  return 1 - easeInOutSine(
    (elapsed - BLAZE_ATTACK_RAMP_DURATION - BLAZE_ATTACK_HOLD_DURATION) /
      BLAZE_ATTACK_RELEASE_DURATION
  );
}

function applyBlazeAttackPose(bones: HeroBoneRefs, progress: number, amount: number): void {
  if (amount <= 0.001) return;

  const poseAmount = getBlazeAttackPoseAmount(progress);
  const aim = poseAmount * amount;
  const settle = poseAmount * amount;

  if (bones.torso) {
    bones.torso.rotation.x += -0.035 * aim;
    bones.torso.rotation.y += -0.055 * aim;
  }

  if (bones.leftArm) {
    bones.leftArm.position.x += 0.025 * aim;
    bones.leftArm.position.y += -0.035 * aim;
    bones.leftArm.position.z += -0.045 * aim;
    bones.leftArm.rotation.x += 0.2 * aim;
    bones.leftArm.rotation.z += 0.18 * aim;
  }

  if (bones.rightArm) {
    bones.rightArm.position.x += 0.018 * aim;
    bones.rightArm.position.y += -0.035 * aim;
    bones.rightArm.position.z += -0.08 * aim;
    bones.rightArm.rotation.x += (0.36 + settle * 0.05) * aim;
    bones.rightArm.rotation.y += 0.08 * aim;
    bones.rightArm.rotation.z -= 0.1 * aim;
    bones.rightArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.rightForearm) {
    bones.rightForearm.position.z += -0.035 * aim;
    bones.rightForearm.rotation.x -= (0.34 + poseAmount * 0.1) * aim;
    bones.rightForearm.rotation.y += 0.035 * aim;
  }
}

function applyHookshotAttackPose(
  bones: HeroBoneRefs,
  progress: number,
  amount: number,
  side: -1 | 1
): void {
  if (amount <= 0.001) return;

  const activeForearm = side < 0 ? bones.leftForearm : bones.rightForearm;
  const activeUpperArm = side < 0 ? bones.leftArm : bones.rightArm;
  const braceForearm = side < 0 ? bones.rightForearm : bones.leftForearm;
  const recoil = smoothPulse(progress, 0, 0.44, 0.98) * 0.64 * amount;

  if (bones.torso) {
    bones.torso.rotation.y += side * 0.01 * recoil;
    bones.torso.rotation.z += -side * 0.006 * recoil;
  }

  if (activeUpperArm) {
    activeUpperArm.position.z += 0.024 * recoil;
    activeUpperArm.rotation.x -= 0.2 * recoil;
    activeUpperArm.rotation.z += -side * 0.016 * recoil;
  }

  if (activeForearm) {
    activeForearm.position.z += 0.018 * recoil;
    activeForearm.rotation.x += 0.36 * recoil;
    activeForearm.rotation.y += side * 0.022 * recoil;
    activeForearm.rotation.z += -side * 0.032 * recoil;
    activeForearm.scale.z *= 1 - 0.022 * recoil;
  }

  if (braceForearm) {
    braceForearm.rotation.x += 0.055 * recoil;
    braceForearm.rotation.z += side * 0.016 * recoil;
  }
}

export function applyHeroAttackPose(
  heroId: HeroId,
  bones: HeroBoneRefs,
  progress: number,
  amount: number,
  side: -1 | 1
): void {
  switch (heroId) {
    case 'phantom':
      applyPhantomAttackPose(bones, progress, amount, side);
      return;
    case 'blaze':
      applyBlazeAttackPose(bones, progress, amount);
      return;
    case 'hookshot':
      applyHookshotAttackPose(bones, progress, amount, side);
      return;
    case 'chronos':
      applyPhantomAttackPose(bones, progress, amount, side);
      return;
  }
}
