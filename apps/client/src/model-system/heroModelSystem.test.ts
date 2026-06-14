import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HERO_DEFINITIONS,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  type HeroId,
} from '@voxel-strike/shared';
import {
  HERO_BODY_MANIFESTS,
} from './heroBodyManifests';
import {
  HERO_BONE_PIVOTS,
  classifyHeroBone,
  getChildBonePosition,
  groupRiggedParts,
} from './heroRig';
import {
  applyHeroBodyPoseTransition,
  beginHeroBodyPoseTransition,
  createHeroBodyPoseTransitionRuntime,
  getJumpPose,
  getNormalizedWalkDirection,
} from './heroBodyPose';
import { createViewmodelPoseRuntime, resetViewmodelPoseRuntime } from '../viewmodel/viewmodelPoseRuntime';
import {
  getPhantomPrimaryHeldBlend,
  getPhantomVeilCastPose,
  setPhantomPrimaryHeld,
  triggerPhantomVeilCastPose,
} from '../viewmodel/phantomPrimaryPose';
import {
  getBlazeRocketHeldBlend,
  getBlazeRocketJumpStaffSlamPose,
  setBlazeRocketHeld,
  triggerBlazeRocketJumpStaffSlam,
} from '../viewmodel/blazePose';
import {
  getChronosPrimaryHeldBlend,
  getChronosTimebreakPose,
  setChronosPrimaryHeld,
  triggerChronosTimebreakPose,
} from '../viewmodel/chronosPose';
import type { HeroBoneRefs, VoxelPart } from './heroBodyTypes';

const heroIds = Object.keys(HERO_DEFINITIONS).sort() as HeroId[];

assert.deepEqual(Object.keys(HERO_BODY_MANIFESTS).sort(), heroIds);

const expectedRemoteSockets: Record<HeroId, readonly string[]> = {
  phantom: [
    PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
    PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
    PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  ],
  hookshot: [
    HOOKSHOT_HOOK_SOCKET_NAMES[-1],
    HOOKSHOT_HOOK_SOCKET_NAMES[1],
  ],
  blaze: [
    BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  ],
  chronos: [
    CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  ],
};

for (const heroId of heroIds) {
  const manifest = HERO_BODY_MANIFESTS[heroId];
  assert.equal(manifest.heroId, heroId);
  assert.ok(manifest.parts.length > 0, `${heroId} body manifest needs parts`);
  assert.ok(manifest.teamAccentParts.length > 0, `${heroId} body manifest needs team accent parts`);
  assert.ok(manifest.attackDurationSeconds > 0, `${heroId} body manifest needs attack timing`);
  assert.ok(manifest.idleProfile.breathingAmplitude > 0, `${heroId} body manifest needs idle breathing`);

  const materials = new Set([
    ...manifest.parts.map((part) => part.material),
    ...manifest.teamAccentParts.map((part) => part.material),
  ]);
  for (const material of materials) {
    assert.ok(manifest.materialPalette[material], `${heroId} missing material ${material}`);
  }

  assert.deepEqual(
    manifest.remoteSocketMarkers.map((marker) => marker.socketName).sort(),
    [...expectedRemoteSockets[heroId]].sort(),
    `${heroId} remote sockets must match catalog-facing socket names`
  );

  for (const marker of manifest.remoteSocketMarkers) {
    assert.ok(HERO_BONE_PIVOTS[marker.bone], `${heroId} socket ${marker.socketName} references an unknown bone`);
  }
}

const sampleParts: VoxelPart[] = [
  { material: 'armor', position: [0, 1.66, 0], scale: [0.2, 0.2, 0.2] },
  { material: 'armor', position: [-0.2, 0.45, 0], scale: [0.1, 0.2, 0.1] },
  { material: 'armor', position: [0.62, 1.0, -0.1], scale: [0.1, 0.2, 0.1] },
  { material: 'mist', kind: 'cylinder', position: [0, 0.02, 0], scale: [0.5, 0.02, 0.5] },
  { material: 'glow', position: [0.4, 0.9, -0.2], scale: [0.08, 0.08, 0.08], limb: 'rightForearm' },
];

assert.equal(classifyHeroBone(sampleParts[0]), 'head');
assert.equal(classifyHeroBone(sampleParts[1]), 'leftShin');
assert.equal(classifyHeroBone(sampleParts[2]), 'rightArm');
assert.equal(classifyHeroBone(sampleParts[3]), 'aura');
assert.equal(classifyHeroBone(sampleParts[4]), 'rightForearm');

const grouped = groupRiggedParts(sampleParts);
assert.equal(grouped.head.length, 1);
assert.equal(grouped.leftShin.length, 1);
assert.equal(grouped.rightArm.length, 1);
assert.equal(grouped.aura.length, 1);
assert.equal(grouped.rightForearm[0].meshOffset[0], sampleParts[4].position[0] - HERO_BONE_PIVOTS.rightForearm[0]);
assert.deepEqual(getChildBonePosition('head', 'torso'), [
  HERO_BONE_PIVOTS.head[0] - HERO_BONE_PIVOTS.torso[0],
  HERO_BONE_PIVOTS.head[1] - HERO_BONE_PIVOTS.torso[1],
  HERO_BONE_PIVOTS.head[2] - HERO_BONE_PIVOTS.torso[2],
]);

assert.deepEqual(getNormalizedWalkDirection({ forward: 0, right: 0 }), { forward: 1, right: 0 });
assert.deepEqual(getNormalizedWalkDirection({ forward: 3, right: 4 }), { forward: 0.6, right: 0.8 });
assert.equal(getJumpPose(0).rootLift <= 0, true);
assert.equal(getJumpPose(0.5).rootLift > 0, true);

const root = new THREE.Group();
const torso = new THREE.Group();
const leftArm = new THREE.Group();
const poseBlendBones: HeroBoneRefs = { torso, leftArm };
const poseBlendRuntime = createHeroBodyPoseTransitionRuntime(1);
beginHeroBodyPoseTransition(poseBlendRuntime, 'phantom|idle', root, poseBlendBones);

root.position.set(1, 0, 0);
root.scale.set(1, 1, 1);
torso.position.set(0, 1, 0);
torso.scale.set(1, 1, 1);
leftArm.rotation.set(0, 0, 0);
beginHeroBodyPoseTransition(poseBlendRuntime, 'phantom|slide', root, poseBlendBones);

root.position.set(5, 0, 0);
root.scale.set(3, 3, 3);
torso.position.set(0, 5, 0);
torso.scale.set(1, 3, 1);
leftArm.rotation.set(Math.PI, 0, 0);
applyHeroBodyPoseTransition(poseBlendRuntime, root, poseBlendBones, 0.5);

assert.equal(root.position.x, 3);
assert.equal(root.scale.x, 2);
assert.equal(torso.position.y, 3);
assert.equal(torso.scale.y, 2);
assert.ok(Math.abs(leftArm.rotation.x) > 0 && Math.abs(leftArm.rotation.x) < Math.PI);

const runtime = createViewmodelPoseRuntime('phantom');
setPhantomPrimaryHeld(true, 1000, runtime);
triggerPhantomVeilCastPose(1000, runtime);
setBlazeRocketHeld(true, 1000, runtime);
setChronosPrimaryHeld(true, 1000, runtime);
triggerBlazeRocketJumpStaffSlam(1000, runtime);
triggerChronosTimebreakPose(1000, runtime);

assert.equal(getPhantomPrimaryHeldBlend(1300, runtime), 1);
assert.equal(getPhantomVeilCastPose(1180, runtime).active, true);
assert.ok(getPhantomVeilCastPose(1360, runtime).contact > 0.95);
assert.equal(getBlazeRocketHeldBlend(1300, runtime), 1);
assert.equal(getChronosPrimaryHeldBlend(1300, runtime), 1);
assert.equal(getBlazeRocketJumpStaffSlamPose(1020, runtime).active, true);
assert.equal(getChronosTimebreakPose(1100, runtime).glow > 0, true);

const revisionBeforeReset = runtime.revision;
resetViewmodelPoseRuntime(runtime, 'blaze');
assert.equal(runtime.heroId, 'blaze');
assert.equal(runtime.revision, revisionBeforeReset + 1);
assert.equal(getPhantomPrimaryHeldBlend(1400, runtime), 0);
assert.equal(getPhantomVeilCastPose(1400, runtime).active, false);
assert.equal(getBlazeRocketHeldBlend(1400, runtime), 0);
assert.equal(getChronosPrimaryHeldBlend(1400, runtime), 0);
assert.equal(getBlazeRocketJumpStaffSlamPose(1400, runtime).active, false);
assert.equal(getChronosTimebreakPose(1400, runtime).glow, 0);

console.log('hero model system tests passed');
