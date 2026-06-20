import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  type HeroId,
  type KnownModelMaterialToken,
  type ModelMaterialDescriptor,
  type ModelPartDescriptor,
  type ModelPartKind,
  type ModelPartTarget,
  type ModelSocketDescriptor,
  type ViewmodelModelDocument,
  type ViewmodelPoseChannelDescriptor,
} from '@voxel-strike/shared';
import { getSocketMetadata } from '../model-system/modelSocketMetadata';

export const SHARED_VIEWMODEL_ROOT_OFFSET: [number, number, number] = [0, 0.28, -0.04];

export type ViewmodelMaterialToken = Extract<
  KnownModelMaterialToken,
  'armor' | 'dark' | 'metal' | 'accent' | 'glow' | 'glass'
>;

export const VIEWMODEL_MATERIAL_TOKENS: readonly ViewmodelMaterialToken[] = [
  'armor',
  'dark',
  'metal',
  'accent',
  'glow',
  'glass',
];

export const VIEWMODEL_MATERIAL_COLORS: Record<HeroId, Record<ViewmodelMaterialToken, string>> = {
  phantom: {
    armor: '#302447',
    dark: '#090612',
    metal: '#211833',
    accent: '#7c3aed',
    glow: '#c084fc',
    glass: '#251a3a',
  },
  hookshot: {
    armor: '#1f3b4a',
    dark: '#10242e',
    metal: '#4a4a4a',
    accent: '#14b8a6',
    glow: '#67e8f9',
    glass: '#22d3ee',
  },
  blaze: {
    armor: '#7c2d12',
    dark: '#1f130d',
    metal: '#333333',
    accent: '#ffaa00',
    glow: '#ffffcc',
    glass: '#fb923c',
  },
  chronos: {
    armor: '#123b2d',
    dark: '#07130f',
    metal: '#9b7a34',
    accent: '#22c55e',
    glow: '#a7f3d0',
    glass: '#b91c1c',
  },
};

function createViewmodelMaterials(heroId: HeroId): ModelMaterialDescriptor[] {
  const colors = VIEWMODEL_MATERIAL_COLORS[heroId];
  return VIEWMODEL_MATERIAL_TOKENS.map((token) => {
    const descriptor: ModelMaterialDescriptor = {
      token,
      color: colors[token],
    };

    if (token === 'metal') {
      descriptor.metalness = 0.76;
      descriptor.roughness = 0.25;
    } else if (token === 'glow') {
      descriptor.transparent = true;
      descriptor.opacity = 1;
      descriptor.toneMapped = false;
    } else if (token === 'glass') {
      descriptor.emissiveIntensity = 0.26;
      descriptor.metalness = 0.1;
      descriptor.roughness = 0.18;
    } else if (token === 'accent') {
      descriptor.emissiveIntensity = 0.34;
      descriptor.metalness = 0.2;
      descriptor.roughness = 0.32;
    } else if (token === 'armor') {
      descriptor.metalness = 0.3;
      descriptor.roughness = 0.42;
    } else {
      descriptor.metalness = 0.24;
      descriptor.roughness = 0.6;
    }

    return descriptor;
  });
}

function createViewmodelSocket(
  heroId: HeroId,
  socketName: string
): ModelSocketDescriptor {
  const metadata = getSocketMetadata(socketName);
  return {
    id: `${heroId}.viewmodelSocket.${socketName}`,
    role: metadata.role,
    name: socketName,
    side: metadata.side,
    ownerScope: 'localViewmodel',
    fallbackOffset: metadata.fallbackOffset,
  };
}

function channel(id: string, kind: ViewmodelPoseChannelDescriptor['kind']): ViewmodelPoseChannelDescriptor {
  return { id, kind, driver: 'poseRuntime' };
}

function componentChannel(id: string, kind: ViewmodelPoseChannelDescriptor['kind']): ViewmodelPoseChannelDescriptor {
  return { id, kind, driver: 'componentRef' };
}

function visualStoreChannel(id: string, kind: ViewmodelPoseChannelDescriptor['kind']): ViewmodelPoseChannelDescriptor {
  return { id, kind, driver: 'visualStore' };
}

function derivedChannel(id: string, kind: ViewmodelPoseChannelDescriptor['kind']): ViewmodelPoseChannelDescriptor {
  return { id, kind, driver: 'derived' };
}

function part({
  id,
  material,
  position,
  scale,
  bone = 'root',
  kind = 'box',
  rotation,
  emissive,
  transparent,
}: {
  id: string;
  material: ViewmodelMaterialToken;
  position: ModelPartDescriptor['position'];
  scale: ModelPartDescriptor['scale'];
  bone?: ModelPartTarget;
  kind?: ModelPartKind;
  rotation?: ModelPartDescriptor['rotation'];
  emissive?: boolean;
  transparent?: boolean;
}): ModelPartDescriptor {
  return {
    id,
    material,
    position,
    scale,
    bone,
    kind,
    rotation,
    emissive,
    transparent,
  };
}

function createForearmParts(heroId: HeroId, side: -1 | 1): ModelPartDescriptor[] {
  const sideName = side < 0 ? 'left' : 'right';
  const bone = side < 0 ? 'leftForearm' : 'rightForearm';
  const x = side * 0.24;

  return [
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.rearDark`, material: 'dark', bone, position: [x, -0.07, 0.16], scale: [0.09, 0.12, 0.22] }),
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.rearArmor`, material: 'armor', bone, position: [x + side * 0.012, -0.035, 0.1], scale: [0.1, 0.07, 0.16] }),
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.topAccent`, material: 'accent', bone, position: [x - side * 0.014, 0.012, 0.05], scale: [0.055, 0.018, 0.11], emissive: true }),
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.coreDark`, material: 'dark', bone, position: [x, -0.04, -0.06], scale: [0.082, 0.108, 0.2] }),
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.topArmor`, material: 'armor', bone, position: [x, -0.012, -0.1], scale: [0.106, 0.072, 0.146] }),
    part({ id: `${heroId}.viewmodel.${sideName}.forearm.wristMetal`, material: 'metal', bone, position: [x, -0.05, -0.21], scale: [0.09, 0.09, 0.035] }),
  ];
}

function createHandParts(heroId: HeroId, side: -1 | 1): ModelPartDescriptor[] {
  const sideName = side < 0 ? 'left' : 'right';
  const bone = side < 0 ? 'leftForearm' : 'rightForearm';
  const x = side * 0.19;
  const fingerXs = [-0.036, -0.012, 0.012, 0.036] as const;

  return [
    part({ id: `${heroId}.viewmodel.${sideName}.hand.palmDark`, material: 'dark', bone, position: [x, -0.18, -0.29], scale: [0.092, 0.124, 0.12] }),
    part({ id: `${heroId}.viewmodel.${sideName}.hand.palmArmor`, material: 'armor', bone, position: [x + side * 0.018, -0.174, -0.272], scale: [0.076, 0.102, 0.074] }),
    part({ id: `${heroId}.viewmodel.${sideName}.hand.sideAccent`, material: 'accent', bone, position: [x - side * 0.052, -0.18, -0.304], scale: [0.018, 0.105, 0.068], emissive: true }),
    part({ id: `${heroId}.viewmodel.${sideName}.hand.thumbMetal`, material: 'metal', bone, position: [x + side * 0.056, -0.168, -0.31], scale: [0.024, 0.024, 0.022] }),
    ...fingerXs.map((fingerX, index) => part({
      id: `${heroId}.viewmodel.${sideName}.hand.finger.${index + 1}`,
      material: index % 2 === 0 ? 'metal' : 'dark',
      bone,
      position: [x + side * fingerX, -0.255, -0.345],
      scale: [0.024, 0.08, 0.026],
    })),
  ];
}

function createPhantomViewmodelParts(): ModelPartDescriptor[] {
  return [
    ...createForearmParts('phantom', -1),
    ...createForearmParts('phantom', 1),
    ...createHandParts('phantom', -1),
    ...createHandParts('phantom', 1),
    part({ id: 'phantom.viewmodel.voidRayOrb.core', material: 'glow', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.075, 0.075, 0.075], emissive: true, transparent: true }),
    part({ id: 'phantom.viewmodel.voidRayOrb.shell', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.11, 0.11, 0.11], transparent: true }),
  ];
}

function createHookshotViewmodelParts(): ModelPartDescriptor[] {
  return [
    ...createForearmParts('hookshot', -1),
    ...createForearmParts('hookshot', 1),
    ...createHandParts('hookshot', -1),
    ...createHandParts('hookshot', 1),
    part({ id: 'hookshot.viewmodel.left.launcherTube', material: 'metal', bone: 'leftForearm', kind: 'cylinder', position: [-0.2, -0.1, -0.42], scale: [0.032, 0.82, 0.032], rotation: [Math.PI / 2, 0, 0] }),
    part({ id: 'hookshot.viewmodel.right.launcherTube', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.2, -0.1, -0.42], scale: [0.032, 0.82, 0.032], rotation: [Math.PI / 2, 0, 0] }),
    part({ id: 'hookshot.viewmodel.left.hookGlow', material: 'glow', bone: 'leftForearm', position: [-0.2, -0.1, -0.86], scale: [0.06, 0.05, 0.11], emissive: true }),
    part({ id: 'hookshot.viewmodel.right.hookGlow', material: 'glow', bone: 'rightForearm', position: [0.2, -0.1, -0.86], scale: [0.06, 0.05, 0.11], emissive: true }),
  ];
}

function createBlazeViewmodelParts(): ModelPartDescriptor[] {
  return [
    ...createForearmParts('blaze', -1),
    ...createForearmParts('blaze', 1),
    ...createHandParts('blaze', -1),
    ...createHandParts('blaze', 1),
    part({ id: 'blaze.viewmodel.staff.shaft', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.52], scale: [0.024, 0.88, 0.024], rotation: [Math.PI / 2, 0, 0] }),
    part({ id: 'blaze.viewmodel.staff.lowerCap', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.14], scale: [0.056, 0.026, 0.056] }),
    part({ id: 'blaze.viewmodel.staff.crystalCore', material: 'glass', bone: 'rightForearm', kind: 'cone', position: [0.32, -0.07, -0.92], scale: [0.05, 0.074, 0.05] }),
    part({ id: 'blaze.viewmodel.staff.flame', material: 'glow', bone: 'rightForearm', kind: 'cone', position: [0.32, -0.07, -0.99], scale: [0.031, 0.082, 0.031], emissive: true, transparent: true }),
    part({ id: 'blaze.viewmodel.staff.ring', material: 'accent', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.88], scale: [0.082, 0.014, 0.082], emissive: true }),
  ];
}

function createChronosViewmodelParts(): ModelPartDescriptor[] {
  return [
    ...createForearmParts('chronos', -1),
    ...createForearmParts('chronos', 1),
    ...createHandParts('chronos', -1),
    ...createHandParts('chronos', 1),
    part({ id: 'chronos.viewmodel.pyramid.core', material: 'glass', bone: 'root', kind: 'cone', position: [0, -0.12, -0.66], scale: [0.135, 0.205, 0.135], rotation: [0, 0, Math.PI / 4], transparent: true }),
    part({ id: 'chronos.viewmodel.pyramid.wire', material: 'glow', bone: 'root', kind: 'cone', position: [0, -0.12, -0.66], scale: [0.143, 0.213, 0.143], rotation: [Math.PI, 0, Math.PI / 4], emissive: true, transparent: true }),
    part({ id: 'chronos.viewmodel.primaryOrb.core', material: 'glow', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.78], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true }),
    part({ id: 'chronos.viewmodel.aegis.edgeTop', material: 'accent', bone: 'root', position: [0, 0.16, -0.7], scale: [0.72, 0.018, 0.024], emissive: true, transparent: true }),
    part({ id: 'chronos.viewmodel.aegis.edgeBottom', material: 'accent', bone: 'root', position: [0, -0.16, -0.7], scale: [0.72, 0.018, 0.024], emissive: true, transparent: true }),
  ];
}

const VIEWMODEL_PARTS: Record<HeroId, readonly ModelPartDescriptor[]> = {
  phantom: createPhantomViewmodelParts(),
  hookshot: createHookshotViewmodelParts(),
  blaze: createBlazeViewmodelParts(),
  chronos: createChronosViewmodelParts(),
};

function createViewmodelDocument(
  heroId: HeroId,
  socketNames: readonly string[],
  poseChannels: readonly ViewmodelPoseChannelDescriptor[]
): ViewmodelModelDocument {
  return {
    rootOffset: SHARED_VIEWMODEL_ROOT_OFFSET,
    materials: createViewmodelMaterials(heroId),
    parts: VIEWMODEL_PARTS[heroId],
    sockets: socketNames.map((socketName) => createViewmodelSocket(heroId, socketName)),
    poseChannels,
  };
}

export const VIEWMODEL_MODEL_DOCUMENTS: Record<string, ViewmodelModelDocument> = {
  phantom: createViewmodelDocument(
    'phantom',
    [
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
      PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
    ],
    [
      channel('phantom.primaryHeld', 'held'),
      componentChannel('phantom.primaryFire', 'fire'),
      componentChannel('phantom.primaryReload', 'cast'),
      componentChannel('phantom.voidRayCharge', 'charge'),
      componentChannel('phantom.voidRayRelease', 'fire'),
      channel('phantom.personalShieldCast', 'cast'),
      channel('phantom.veilCast', 'cast'),
      derivedChannel('phantom.movementBob', 'movement'),
    ]
  ),
  hookshot: createViewmodelDocument(
    'hookshot',
    [
      HOOKSHOT_HOOK_SOCKET_NAMES[-1],
      HOOKSHOT_HOOK_SOCKET_NAMES[1],
    ],
    [
      componentChannel('hookshot.primaryFire', 'fire'),
      componentChannel('hookshot.secondaryFire', 'fire'),
      derivedChannel('hookshot.movementBob', 'movement'),
    ]
  ),
  blaze: createViewmodelDocument(
    'blaze',
    [BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME],
    [
      channel('blaze.rocketHeld', 'held'),
      channel('blaze.bombTarget', 'targeting'),
      channel('blaze.flamethrowerHeld', 'held'),
      channel('blaze.staffShockwave', 'cast'),
      channel('blaze.rocketJumpStaffSlam', 'slam'),
      derivedChannel('blaze.movementBob', 'movement'),
    ]
  ),
  chronos: createViewmodelDocument(
    'chronos',
    [CHRONOS_PRIMARY_ORB_SOCKET_NAME],
    [
      channel('chronos.primaryHeld', 'held'),
      channel('chronos.primaryFire', 'fire'),
      channel('chronos.lifelineQueued', 'held'),
      channel('chronos.lifelineConduit', 'cast'),
      channel('chronos.timebreak', 'cast'),
      channel('chronos.ascendantParadox', 'cast'),
      visualStoreChannel('chronos.aegisShield', 'held'),
      derivedChannel('chronos.movementBob', 'movement'),
    ]
  ),
};
