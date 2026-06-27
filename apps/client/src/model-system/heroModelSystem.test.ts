import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ABILITY_SOCKET_CATALOG,
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  DEFAULT_HERO_SKIN_IDS,
  HERO_SKIN_CATALOG,
  HERO_DEFINITIONS,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  TEAM_CATALOG,
  validateHeroSkinCatalog,
  validateHeroModelDocument,
  type HeroId,
  type HeroSkinId,
} from '@voxel-strike/shared';
import {
  HERO_BODY_MANIFESTS,
  HERO_SKIN_BODY_MANIFESTS,
  TEAM_COLORS,
} from './heroBodyManifests';
import { getHeroBodyRenderParts } from './heroBodyRenderParts';
import { HERO_SKIN_MODEL_DOCUMENTS } from './heroModelDocuments';
import { resolveHeroSkinModel } from './heroSkinModelResolver';
import {
  addVoxelPartMetadata,
  HERO_BONE_PARENTS,
  HERO_BONE_PIVOTS,
  classifyHeroBone,
  getBoneRestPosition,
  getChildBonePosition,
  groupRiggedParts,
} from './heroRig';
import {
  applyDownedBonePose,
  applyDownedRootPivot,
  applyHeroBodyPoseTransition,
  applyLookPitchWaistBend,
  beginHeroBodyPoseTransition,
  createHeroBodyPoseTransitionRuntime,
  getHeroLookPitchWaistBend,
  getJumpPose,
  getNormalizedWalkDirection,
  setBoneBasePose,
} from './heroBodyPose';
import {
  createViewmodelPoseRuntime,
  getViewmodelHeldBlend,
  resetViewmodelPoseRuntime,
} from '../viewmodel/viewmodelPoseRuntime';
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
import type { HeroBoneRefs, VoxelPartDraft } from './heroBodyTypes';

const heroIds = Object.keys(HERO_DEFINITIONS).sort() as HeroId[];
const skinIds = HERO_SKIN_CATALOG.map((skin) => skin.id).sort() as HeroSkinId[];

assert.deepEqual(Object.keys(HERO_BODY_MANIFESTS).sort(), heroIds);
assert.deepEqual(Object.keys(HERO_SKIN_BODY_MANIFESTS).sort(), skinIds);
assert.deepEqual(Object.keys(HERO_SKIN_MODEL_DOCUMENTS).sort(), skinIds);
assert.deepEqual(validateHeroSkinCatalog().errors, []);

for (const team of TEAM_CATALOG) {
  assert.equal(TEAM_COLORS[team.id], team.color, `${team.id} body color must match the shared team catalog`);
}

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
  assert.deepEqual(
    getHeroBodyRenderParts(manifest.parts).map((part) => part.id),
    manifest.parts.map((part) => part.id),
    `${heroId} render parts should not inject shared generated bone geometry`
  );

  const partIds = new Set<string>();
  for (const part of [...manifest.parts, ...manifest.teamAccentParts]) {
    assert.ok(part.id, `${heroId} part needs a stable id`);
    assert.ok(!partIds.has(part.id), `${heroId} duplicate part id ${part.id}`);
    partIds.add(part.id);
    assert.ok(HERO_BONE_PIVOTS[part.bone], `${heroId} part ${part.id} references an unknown bone`);
  }

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
    assert.ok(marker.id, `${heroId} socket ${marker.socketName} needs a stable id`);
    assert.ok(HERO_BONE_PIVOTS[marker.bone], `${heroId} socket ${marker.socketName} references an unknown bone`);
  }

  const defaultSkinId = DEFAULT_HERO_SKIN_IDS[heroId];
  const document = HERO_SKIN_MODEL_DOCUMENTS[defaultSkinId];
  const validation = validateHeroModelDocument(document);
  assert.deepEqual(validation.errors, [], `${heroId} model document must validate`);
  assert.equal(validation.ok, true, `${heroId} model document must validate`);

  const fullBodySocketNames = new Set(document.fullBody.sockets.map((socket) => socket.name));
  const viewmodelSocketNames = new Set(document.viewmodel?.sockets.map((socket) => socket.name) ?? []);
  assert.ok((document.viewmodel?.parts.length ?? 0) > 0, `${heroId} viewmodel document must include editable parts`);
  const viewmodelMaterials = new Set(document.viewmodel?.materials.map((material) => material.token) ?? []);
  for (const material of ['armor', 'dark', 'metal', 'accent', 'glow', 'glass'] as const) {
    assert.ok(viewmodelMaterials.has(material), `${heroId} viewmodel document missing ${material} material`);
  }
  const requiredSocketNames = Object.values(ABILITY_SOCKET_CATALOG)
    .filter((entry) => entry.heroId === heroId)
    .flatMap((entry) => entry.socketNames);
  for (const socketName of requiredSocketNames) {
    assert.ok(
      fullBodySocketNames.has(socketName),
      `${heroId} full-body document missing catalog socket ${socketName}`
    );
    assert.ok(
      viewmodelSocketNames.has(socketName),
      `${heroId} viewmodel document missing catalog socket ${socketName}`
    );
  }
}

for (const skin of HERO_SKIN_CATALOG) {
  const manifest = HERO_SKIN_BODY_MANIFESTS[skin.id];
  const document = HERO_SKIN_MODEL_DOCUMENTS[skin.id];
  assert.equal(manifest.heroId, skin.heroId, `${skin.id} body manifest must match catalog hero`);
  assert.equal(document.heroId, skin.heroId, `${skin.id} model document must match catalog hero`);
  assert.equal(validateHeroModelDocument(document).ok, true, `${skin.id} model document must validate`);

  if (skin.availability !== 'free') {
    const defaultSkinId = DEFAULT_HERO_SKIN_IDS[skin.heroId];
    const defaultManifest = HERO_SKIN_BODY_MANIFESTS[defaultSkinId];
    const defaultDocument = HERO_SKIN_MODEL_DOCUMENTS[defaultSkinId];
    assert.ok(
      manifest.parts.length > defaultManifest.parts.length,
      `${skin.id} should add full-body geometry beyond the default skin`
    );
    assert.ok(
      (document.viewmodel?.parts.length ?? 0) > (defaultDocument.viewmodel?.parts.length ?? 0),
      `${skin.id} should add first-person viewmodel geometry beyond the default skin`
    );
  }

  const fullBodySocketNames = new Set(document.fullBody.sockets.map((socket) => socket.name));
  const viewmodelSocketNames = new Set(document.viewmodel?.sockets.map((socket) => socket.name) ?? []);
  const requiredSocketNames = Object.values(ABILITY_SOCKET_CATALOG)
    .filter((entry) => entry.heroId === skin.heroId)
    .flatMap((entry) => entry.socketNames);
  for (const socketName of requiredSocketNames) {
    assert.ok(fullBodySocketNames.has(socketName), `${skin.id} full-body document missing ${socketName}`);
    assert.ok(viewmodelSocketNames.has(socketName), `${skin.id} viewmodel document missing ${socketName}`);
  }
}

for (const skinId of ['phantom.default', 'phantom.void-monarch'] as const) {
  const manifest = HERO_SKIN_BODY_MANIFESTS[skinId];
  const legCoreParts = HERO_SKIN_BODY_MANIFESTS[skinId].parts.filter((part) => (
    part.material === 'void' &&
    Math.abs(Math.abs(part.position[0]) - 0.14) < 0.001 &&
    Math.abs(part.position[2] - 0.02) < 0.001 &&
    part.position[1] < 0.75
  ));
  const hipCore = manifest.parts.find((part) => (
    part.material === 'void' &&
    part.bone === 'hips' &&
    Math.abs(part.position[0]) < 0.001 &&
    part.position[1] >= 0.6 &&
    part.position[1] <= 0.85 &&
    part.scale[0] >= 0.3
  ));

  assert.ok(
    legCoreParts.some((part) => part.bone === 'leftShin' && part.scale[1] >= 0.6),
    `${skinId} needs a continuous left leg core on the same shin bone pattern as the other heroes`
  );
  assert.ok(
    legCoreParts.some((part) => part.bone === 'rightShin' && part.scale[1] >= 0.6),
    `${skinId} needs a continuous right leg core on the same shin bone pattern as the other heroes`
  );
  assert.ok(hipCore, `${skinId} needs a centered hip core above the leg columns`);
  assert.ok(
    Math.abs(hipCore!.position[2] - 0.02) <= 0.001,
    `${skinId} hip core depth must align with the leg core depth`
  );
}

const voidMonarchLowerLegTrim = HERO_SKIN_BODY_MANIFESTS['phantom.void-monarch'].parts.filter((part) => (
  part.id.startsWith('phantom.voidMonarch.body.') &&
  (part.material === 'metal' || part.material === 'edge') &&
  Math.abs(Math.abs(part.position[0]) - 0.15) <= 0.001 &&
  part.position[1] < 0.55
));
assert.equal(voidMonarchLowerLegTrim.length, 4);
for (const part of voidMonarchLowerLegTrim) {
  assert.ok(
    Math.abs(part.position[2] - -0.07) <= 0.001,
    `void monarch lower-leg trim ${part.id} must sit on the leg surface`
  );
}

for (const skin of HERO_SKIN_CATALOG.filter((catalogSkin) => catalogSkin.availability !== 'free')) {
  assert.equal(
    resolveHeroSkinModel(skin.heroId, skin.id).skinId,
    skin.id,
    `${skin.id} should resolve to its renderable model`
  );
}
assert.equal(
  resolveHeroSkinModel('blaze', 'phantom.void-monarch').skinId,
  'blaze.default'
);
assert.equal(
  resolveHeroSkinModel('phantom', 'unknown.skin').skinId,
  'phantom.default'
);

const invalidViewmodelDocument = JSON.parse(JSON.stringify(HERO_SKIN_MODEL_DOCUMENTS['phantom.default']));
invalidViewmodelDocument.viewmodel.poseChannels = [{ id: 'phantom.invalid', kind: 'unknown-kind' }];
invalidViewmodelDocument.viewmodel.materials = [
  { token: 'armor', color: '#ffffff' },
  { token: 'armor', color: '#eeeeee' },
];
invalidViewmodelDocument.defaultFallbackSockets.customEditorRole = {
  handHeight: 'not-a-number',
  forwardOffset: 0,
  sideOffset: 0,
};
invalidViewmodelDocument.fullBody.parts[0].attachmentMode = 'hovering';
const invalidViewmodelValidation = validateHeroModelDocument(invalidViewmodelDocument);
assert.equal(invalidViewmodelValidation.ok, false);
assert.ok(
  invalidViewmodelValidation.errors.some((error) => error.includes('viewmodel.poseChannels[0].kind')),
  'validator should reject unknown viewmodel pose channel kinds'
);
assert.ok(
  invalidViewmodelValidation.errors.some((error) => error.includes('viewmodel.materials[1].token')),
  'validator should reject duplicate viewmodel material tokens'
);
assert.ok(
  invalidViewmodelValidation.errors.some((error) => error.includes('defaultFallbackSockets.customEditorRole.handHeight')),
  'validator should reject malformed custom fallback socket offsets'
);
assert.ok(
  invalidViewmodelValidation.errors.some((error) => error.includes('fullBody.parts[0].attachmentMode')),
  'validator should reject unknown full-body attachment modes'
);

const customEditorDocument = JSON.parse(JSON.stringify(HERO_SKIN_MODEL_DOCUMENTS['phantom.default']));
customEditorDocument.heroId = 'editor-authored-hero';
customEditorDocument.materialPalette.editorCrystal = '#88ffee';
customEditorDocument.fullBody.parts[0].material = 'editorCrystal';
customEditorDocument.fullBody.sockets[0].role = 'editorPrimary';
customEditorDocument.defaultFallbackSockets.editorPrimary = {
  handHeight: 1.1,
  forwardOffset: 0.3,
  sideOffset: 0,
};
const customEditorValidation = validateHeroModelDocument(customEditorDocument);
assert.deepEqual(customEditorValidation.errors, [], 'validator should allow editor-authored hero ids, materials, and socket roles');
assert.equal(customEditorValidation.ok, true);

const sampleParts = addVoxelPartMetadata<VoxelPartDraft>([
  { material: 'armor', position: [0, 1.66, 0], scale: [0.2, 0.2, 0.2] },
  { material: 'armor', position: [0, 0.76, 0.02], scale: [0.3, 0.2, 0.2] },
  { material: 'armor', position: [-0.2, 0.45, 0], scale: [0.1, 0.2, 0.1] },
  { material: 'armor', position: [0.62, 1.0, -0.1], scale: [0.1, 0.2, 0.1] },
  { material: 'mist', kind: 'cylinder', position: [0, 0.02, 0], scale: [0.5, 0.02, 0.5] },
  { material: 'glow', position: [0.4, 0.9, -0.2], scale: [0.08, 0.08, 0.08], bone: 'rightForearm' },
], 'test.body');

assert.equal(classifyHeroBone(sampleParts[0]), 'head');
assert.equal(classifyHeroBone(sampleParts[1]), 'hips');
assert.equal(classifyHeroBone(sampleParts[2]), 'leftShin');
assert.equal(classifyHeroBone(sampleParts[3]), 'rightArm');
assert.equal(classifyHeroBone(sampleParts[4]), 'aura');
assert.equal(classifyHeroBone(sampleParts[5]), 'rightForearm');

const surfaceAttachmentParts = addVoxelPartMetadata<VoxelPartDraft>([
  { material: 'armor', bone: 'torso', position: [0, 1, 0], scale: [0.8, 0.8, 0.4] },
  { material: 'metal', bone: 'torso', position: [0, 1, -0.31], scale: [0.32, 0.22, 0.1] },
  { material: 'glow', bone: 'torso', position: [0, 1, -0.78], scale: [0.32, 0.22, 0.1], attachmentMode: 'floating' },
], 'test.surfaceAttachment');
const resolvedSurfaceAttachmentParts = getHeroBodyRenderParts(surfaceAttachmentParts);
assert.equal(resolvedSurfaceAttachmentParts[0], surfaceAttachmentParts[0]);
assert.equal(surfaceAttachmentParts[1].position[2], -0.31);
assert.ok(
  resolvedSurfaceAttachmentParts[1].position[2] > surfaceAttachmentParts[1].position[2],
  'surface attachments should move toward the same-bone host surface when separated by a small gap'
);
assert.deepEqual(
  resolvedSurfaceAttachmentParts[2].position,
  surfaceAttachmentParts[2].position,
  'floating attachments should keep their authored coordinates'
);

const grouped = groupRiggedParts(sampleParts);
assert.equal(grouped.head.length, 1);
assert.equal(grouped.hips.length, 1);
assert.equal(grouped.leftShin.length, 1);
assert.equal(grouped.rightArm.length, 1);
assert.equal(grouped.aura.length, 1);
assert.equal(grouped.rightForearm[0].meshOffset[0], sampleParts[5].position[0] - HERO_BONE_PIVOTS.rightForearm[0]);
assert.deepEqual(getChildBonePosition('head', 'torso'), [
  HERO_BONE_PIVOTS.head[0] - HERO_BONE_PIVOTS.torso[0],
  HERO_BONE_PIVOTS.head[1] - HERO_BONE_PIVOTS.torso[1],
  HERO_BONE_PIVOTS.head[2] - HERO_BONE_PIVOTS.torso[2],
]);
assert.equal(HERO_BONE_PARENTS.torso, 'hips');
assert.equal(HERO_BONE_PARENTS.leftLeg, 'hips');
assert.equal(HERO_BONE_PARENTS.rightLeg, 'hips');
assert.deepEqual(getBoneRestPosition('torso'), getChildBonePosition('torso', 'hips'));
assert.deepEqual(getBoneRestPosition('leftLeg'), getChildBonePosition('leftLeg', 'hips'));

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

const jointRoot = new THREE.Group();
const jointHips = new THREE.Group();
const jointTorso = new THREE.Group();
const jointLeftLeg = new THREE.Group();
const jointRightLeg = new THREE.Group();
const jointLeftKnee = new THREE.Group();
const jointLeftShin = new THREE.Group();
const jointRightKnee = new THREE.Group();
const jointRightShin = new THREE.Group();
const torsoWaistAnchorLocal = new THREE.Vector3(
  HERO_BONE_PIVOTS.hips[0] - HERO_BONE_PIVOTS.torso[0],
  HERO_BONE_PIVOTS.hips[1] - HERO_BONE_PIVOTS.torso[1],
  HERO_BONE_PIVOTS.hips[2] - HERO_BONE_PIVOTS.torso[2]
);
const jointBones: HeroBoneRefs = {
  hips: jointHips,
  torso: jointTorso,
  leftLeg: jointLeftLeg,
  rightLeg: jointRightLeg,
  leftKnee: jointLeftKnee,
  leftShin: jointLeftShin,
  rightKnee: jointRightKnee,
  rightShin: jointRightShin,
};
jointRoot.add(jointHips);
jointHips.add(jointTorso, jointLeftLeg, jointRightLeg);
jointLeftLeg.add(jointLeftKnee);
jointLeftKnee.add(jointLeftShin);
jointRightLeg.add(jointRightKnee);
jointRightKnee.add(jointRightShin);
setBoneBasePose(jointBones);
assert.deepEqual(jointTorso.position.toArray(), getBoneRestPosition('torso'));
assert.deepEqual(jointLeftLeg.position.toArray(), getBoneRestPosition('leftLeg'));
assert.deepEqual(jointLeftKnee.position.toArray(), getBoneRestPosition('leftKnee'));

assert.equal(jointTorso.parent, jointHips);
assert.equal(jointLeftLeg.parent, jointHips);
assert.equal(jointRightLeg.parent, jointHips);
assert.equal(jointLeftKnee.parent, jointLeftLeg);
assert.equal(jointLeftShin.parent, jointLeftKnee);

const kneeBeforeHipRotation = new THREE.Vector3();
const kneeAfterHipRotation = new THREE.Vector3();
jointRoot.updateMatrixWorld(true);
jointLeftKnee.getWorldPosition(kneeBeforeHipRotation);
jointHips.rotation.x = 0.24;
jointRoot.updateMatrixWorld(true);
jointLeftKnee.getWorldPosition(kneeAfterHipRotation);
assert.ok(kneeAfterHipRotation.distanceToSquared(kneeBeforeHipRotation) > 0.000001);

setBoneBasePose(jointBones);
const waistAnchorBeforeLookPitch = new THREE.Vector3();
const waistAnchorAfterLookPitch = new THREE.Vector3();
jointRoot.updateMatrixWorld(true);
jointTorso.localToWorld(waistAnchorBeforeLookPitch.copy(torsoWaistAnchorLocal));
applyLookPitchWaistBend(jointBones, 0.82);
jointRoot.updateMatrixWorld(true);
jointTorso.localToWorld(waistAnchorAfterLookPitch.copy(torsoWaistAnchorLocal));
assert.ok(waistAnchorAfterLookPitch.distanceTo(waistAnchorBeforeLookPitch) < 0.000001);

const lookPitchTorso = new THREE.Group();
const lookPitchHead = new THREE.Group();
const lookPitchHips = new THREE.Group();
const lookPitchBones: HeroBoneRefs = {
  torso: lookPitchTorso,
  head: lookPitchHead,
  hips: lookPitchHips,
};
applyLookPitchWaistBend(lookPitchBones, 0.82);
assert.ok(lookPitchTorso.rotation.x > 0);
assert.ok(lookPitchHead.rotation.x > 0);
assert.equal(lookPitchHips.rotation.x, 0);

const upwardTorsoBend = lookPitchTorso.rotation.x;
lookPitchTorso.rotation.set(0, 0, 0);
lookPitchHead.rotation.set(0, 0, 0);
lookPitchHips.rotation.set(0, 0, 0);
applyLookPitchWaistBend(lookPitchBones, -0.82);
assert.ok(lookPitchTorso.rotation.x < 0);
assert.equal(Math.abs(lookPitchTorso.rotation.x), upwardTorsoBend);
assert.equal(getHeroLookPitchWaistBend(Number.NaN), 0);
assert.equal(getHeroLookPitchWaistBend(0.01), 0);
assert.equal(Math.abs(getHeroLookPitchWaistBend(10)), THREE.MathUtils.degToRad(38));

const downedPoseBones: HeroBoneRefs = {
  hips: new THREE.Group(),
  torso: new THREE.Group(),
  head: new THREE.Group(),
  leftArm: new THREE.Group(),
  rightArm: new THREE.Group(),
  leftLeg: new THREE.Group(),
  rightLeg: new THREE.Group(),
  leftShin: new THREE.Group(),
  rightShin: new THREE.Group(),
};
applyDownedBonePose(downedPoseBones, 1.25, 1, 1, 0);
assert.equal(downedPoseBones.hips!.rotation.x, 0);
assert.equal(downedPoseBones.torso!.rotation.x, 0);
assert.equal(downedPoseBones.head!.rotation.x, 0);
assert.equal(downedPoseBones.leftArm!.rotation.x, 0);
assert.equal(downedPoseBones.rightArm!.rotation.x, 0);
assert.equal(downedPoseBones.leftLeg!.rotation.x, 0);
assert.equal(downedPoseBones.rightLeg!.rotation.x, 0);
assert.equal(downedPoseBones.leftShin!.rotation.x, 0);
assert.equal(downedPoseBones.rightShin!.rotation.x, 0);

const downedRootPosition = new THREE.Vector3();
const downedRootRotation = new THREE.Euler();
applyDownedRootPivot(downedRootPosition, downedRootRotation, 1, 1);
assert.ok(downedRootRotation.x < -1.35);
assert.ok(downedRootRotation.x > -1.55);
assert.ok(downedRootPosition.y > 0.18);
assert.ok(downedRootPosition.z < -0.15);

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
assert.throws(
  () => getViewmodelHeldBlend({
    runtime,
    channelId: 'phantom.typoHeld',
    transitionSeconds: 0.1,
    timestampMs: 1400,
  }),
  /Unknown viewmodel pose channel/
);
assert.throws(
  () => getViewmodelHeldBlend({
    runtime,
    channelId: 'phantom.voidRayCharge',
    transitionSeconds: 0.1,
    timestampMs: 1400,
  }),
  /driven by componentRef/
);

console.log('hero model system tests passed');
