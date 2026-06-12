import * as THREE from 'three';
import type { HeroId } from '@voxel-strike/shared';
import {
  BLAZE_ATTACK_HOLD_DURATION,
  BLAZE_ATTACK_RAMP_DURATION,
  BLAZE_ATTACK_RELEASE_DURATION,
  BLAZE_ATTACK_DURATION,
  CHRONOS_WALK_ARM_ARC_SCALE,
  DEFAULT_WALK_DIRECTION,
  HERO_IDLE_PROFILES,
  HERO_MOVEMENT_PROFILES,
  JUMP_CYCLE_DURATION,
  JUMP_HEIGHT,
  SLIDE_KNEE_HINGE_SPEED,
} from './heroBodyManifests';
import { getChildBonePosition, HERO_BONE_PIVOTS } from './heroRig';
import type {
  HeroBoneRefs,
  HeroBoneName,
  HeroIdleProfile,
  HeroJumpPose,
  HeroMovementProfile,
  HeroWalkDirection,
} from './heroBodyTypes';

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
    rootLift: rootLift - anticipation * 0.035 - land * 0.045,
    crouch: anticipation + land * 0.65,
    extension: launch,
    tuck,
    land,
    armReach: armSwing * 0.72,
    pitch: launch * 0.065 - anticipation * 0.05 - land * 0.035,
  };
}


export function setBoneBasePose(bones: HeroBoneRefs): void {
  bones.aura?.position.set(...HERO_BONE_PIVOTS.aura);
  bones.hips?.position.set(...HERO_BONE_PIVOTS.hips);
  bones.torso?.position.set(...HERO_BONE_PIVOTS.torso);
  bones.leftLeg?.position.set(...HERO_BONE_PIVOTS.leftLeg);
  bones.rightLeg?.position.set(...HERO_BONE_PIVOTS.rightLeg);
  bones.leftKnee?.position.set(...getChildBonePosition('leftKnee', 'leftLeg'));
  bones.rightKnee?.position.set(...getChildBonePosition('rightKnee', 'rightLeg'));
  bones.leftShin?.position.set(...getChildBonePosition('leftShin', 'leftKnee'));
  bones.rightShin?.position.set(...getChildBonePosition('rightShin', 'rightKnee'));
  bones.head?.position.set(...getChildBonePosition('head', 'torso'));
  bones.leftArm?.position.set(...getChildBonePosition('leftArm', 'torso'));
  bones.rightArm?.position.set(...getChildBonePosition('rightArm', 'torso'));
  bones.leftForearm?.position.set(...getChildBonePosition('leftForearm', 'leftArm'));
  bones.rightForearm?.position.set(...getChildBonePosition('rightForearm', 'rightArm'));

  (Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]).forEach((bone) => {
    const group = bones[bone];
    if (!group) return;
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

function applyWalkLimbPose(
  bone: THREE.Group | null | undefined,
  isLeft: boolean,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  isLeg: boolean,
  profile: HeroMovementProfile
): void {
  if (!bone || amount <= 0.001) return;

  const phaseOffset = isLeft ? 0 : Math.PI;
  const phase = Math.sin(cycleTime + phaseOffset);

  if (isLeg) {
    const lift = Math.max(0, Math.cos(cycleTime + phaseOffset));
    bone.rotation.x += direction.forward * phase * profile.legPitch * amount;
    bone.rotation.y += direction.right * phase * 0.08 * amount;
    bone.rotation.z += -direction.right * phase * profile.legStrafeRoll * amount;
    bone.position.x += direction.right * phase * profile.legStrafe * amount;
    bone.position.y += lift * profile.legLift * amount;
    bone.position.z += -direction.forward * phase * profile.legStride * amount;
    return;
  }

  const armAmount = amount * profile.armArcScale;
  bone.rotation.x += direction.forward * phase * profile.armPitch * armAmount;
  bone.rotation.z += direction.right * phase * profile.armStrafeRoll * armAmount;
  bone.position.x += direction.right * phase * 0.035 * armAmount;
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

  if (upperLeg) {
    upperLeg.rotation.x += direction.forward * phase * profile.legPitch * amount;
    upperLeg.rotation.y += direction.right * phase * 0.025 * amount;
    upperLeg.rotation.z += -direction.right * phase * profile.legStrafeRoll * amount;
    upperLeg.position.x += direction.right * phase * profile.legStrafe * amount;
    upperLeg.position.y += footLift * profile.legLift * amount;
    upperLeg.position.z += -direction.forward * phase * profile.legStride * amount;
  }

  if (knee) {
    knee.position.x += side * footLift * 0.018 * amount;
    knee.position.y += (footLift * 0.01 - supportBend * 0.006) * amount;
    knee.position.z += -direction.forward * footLift * 0.008 * amount;
    knee.rotation.z += side * footLift * 0.035 * amount;
  }

  if (shin) {
    const bend = profile.supportKneeBend * supportBend + profile.kneeBend * footLift;
    shin.rotation.x += bend * amount;
    shin.rotation.z += side * footLift * 0.07 * amount - direction.right * phase * 0.012 * amount;
    shin.position.z += -direction.forward * footLift * 0.006 * amount;
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
  applyWalkLimbPose(bones.leftArm, false, cycleTime, amount, direction, false, profile);
  applyWalkLimbPose(bones.rightArm, true, cycleTime, amount, direction, false, profile);
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

export function applyJumpBonePose(bones: HeroBoneRefs, pose: HeroJumpPose, amount: number): void {
  if (amount <= 0.001) return;

  const crouch = pose.crouch * amount;
  const extension = pose.extension * amount;
  const tuck = pose.tuck * amount;
  const land = pose.land * amount;
  const armReach = pose.armReach * amount;

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
    bones.leftLeg.rotation.x += 0.56 * crouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.leftLeg.position.y += -0.018 * crouch + 0.008 * extension;
    bones.leftLeg.position.z += -0.012 * crouch + 0.008 * extension;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.025 * crouch + 0.012 * tuck - 0.014 * land;
    bones.leftKnee.position.z += -0.012 * crouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -0.74 * crouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.leftShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.leftShin.position.z += 0.008 * crouch + 0.008 * tuck;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 0.56 * crouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.rightLeg.position.y += -0.018 * crouch + 0.008 * extension;
    bones.rightLeg.position.z += -0.012 * crouch + 0.008 * extension;
  }

  if (bones.rightKnee) {
    bones.rightKnee.position.y += -0.025 * crouch + 0.012 * tuck - 0.014 * land;
    bones.rightKnee.position.z += -0.012 * crouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += -0.74 * crouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.rightShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.rightShin.position.z += 0.008 * crouch + 0.008 * tuck;
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

function applyPhantomAttackPose(bones: HeroBoneRefs, progress: number, amount: number): void {
  if (amount <= 0.001) return;

  const poseAmount = getBlazeAttackPoseAmount(progress);
  const aim = poseAmount * amount;
  const settle = poseAmount * amount;

  if (bones.torso) {
    bones.torso.rotation.x += -0.035 * aim;
    bones.torso.rotation.y += -0.055 * aim;
  }

  if (bones.leftArm) {
    bones.leftArm.position.x -= 0.018 * aim;
    bones.leftArm.position.y += -0.035 * aim;
    bones.leftArm.position.z += -0.08 * aim;
    bones.leftArm.rotation.x += (0.48 + settle * 0.08) * aim;
    bones.leftArm.rotation.y -= 0.08 * aim;
    bones.leftArm.rotation.z += 0.1 * aim;
    bones.leftArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.rightArm) {
    bones.rightArm.position.x += 0.018 * aim;
    bones.rightArm.position.y += -0.035 * aim;
    bones.rightArm.position.z += -0.08 * aim;
    bones.rightArm.rotation.x += (0.48 + settle * 0.08) * aim;
    bones.rightArm.rotation.y += 0.08 * aim;
    bones.rightArm.rotation.z -= 0.1 * aim;
    bones.rightArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.leftForearm) {
    bones.leftForearm.position.z += -0.048 * aim;
    bones.leftForearm.rotation.x -= (0.48 + poseAmount * 0.13) * aim;
    bones.leftForearm.rotation.y -= 0.035 * aim;
  }

  if (bones.rightForearm) {
    bones.rightForearm.position.z += -0.048 * aim;
    bones.rightForearm.rotation.x -= (0.48 + poseAmount * 0.13) * aim;
    bones.rightForearm.rotation.y += 0.035 * aim;
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
      applyPhantomAttackPose(bones, progress, amount);
      return;
    case 'blaze':
      applyBlazeAttackPose(bones, progress, amount);
      return;
    case 'hookshot':
      applyHookshotAttackPose(bones, progress, amount, side);
      return;
    case 'chronos':
      applyPhantomAttackPose(bones, progress, amount);
      return;
  }
}
