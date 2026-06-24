import {
  BLAZE_ROCKET_STAFF_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET,
  HERO_DEFINITIONS,
  HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
  HOOKSHOT_CHAIN_SOCKET,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_VOID_RAY_SOCKET,
  type HeroId,
  type HeroSkinId,
  type HeroModelDocumentV1,
  type ModelMaterialDescriptor,
  type ModelPartDescriptor,
  type ModelSocketDescriptor,
  type ViewmodelModelDocument,
} from '@voxel-strike/shared';
import {
  HERO_SKIN_BODY_MANIFESTS,
  EPOCH_REGENT_COLORS,
  SOLAR_FORGE_COLORS,
  TIDEBREAKER_COLORS,
  VOID_MONARCH_COLORS,
} from './heroBodyManifests';
import { HERO_BODY_BOT_MARKER_PART } from './heroBodyGeneratedParts';
import { getHeroBodyRenderParts } from './heroBodyRenderParts';
import type { HeroBodyManifest, RemoteBodySocketMarker, VoxelPart } from './heroBodyTypes';
import { getSocketMetadata } from './modelSocketMetadata';
import { VIEWMODEL_MODEL_DOCUMENTS } from '../viewmodel/viewmodelManifests';

type DocumentPartSource = VoxelPart | typeof HERO_BODY_BOT_MARKER_PART;

function toModelPartDescriptor(part: DocumentPartSource): ModelPartDescriptor {
  return {
    id: part.id,
    kind: part.kind,
    material: part.material,
    bone: part.bone,
    position: part.position,
    scale: part.scale,
    rotation: part.rotation,
    emissive: part.emissive,
    transparent: part.transparent,
    generated: part.generated,
  };
}

function toModelSocketDescriptor(marker: RemoteBodySocketMarker): ModelSocketDescriptor {
  const metadata = getSocketMetadata(marker.socketName);

  return {
    id: marker.id,
    role: metadata.role,
    name: marker.socketName,
    side: metadata.side,
    ownerScope: 'remoteBody',
    bone: marker.bone,
    position: marker.position,
    rotation: marker.rotation,
    fallbackOffset: metadata.fallbackOffset,
  };
}

function defaultFallbackSocketsForHero(heroId: HeroId): HeroModelDocumentV1['defaultFallbackSockets'] {
  switch (heroId) {
    case 'phantom':
      return {
        primaryPalm: PHANTOM_DIRE_BALL_SOCKET,
        voidRayOrb: PHANTOM_VOID_RAY_SOCKET,
      };
    case 'hookshot':
      return { hookTip: HOOKSHOT_CHAIN_SOCKET };
    case 'blaze':
      return { staffTip: BLAZE_ROCKET_STAFF_SOCKET };
    case 'chronos':
      return { chronosPrimaryOrb: CHRONOS_PRIMARY_ORB_SOCKET };
  }
}

const VOID_MONARCH_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'phantom.void-monarch.viewmodel.left.knuckleCap', material: 'metal', bone: 'leftForearm', position: [-0.19, -0.255, -0.38], scale: [0.07, 0.018, 0.032] },
  { id: 'phantom.void-monarch.viewmodel.right.knuckleCap', material: 'metal', bone: 'rightForearm', position: [0.19, -0.255, -0.38], scale: [0.07, 0.018, 0.032] },
  { id: 'phantom.void-monarch.viewmodel.left.wristTrim', material: 'accent', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018], emissive: true },
  { id: 'phantom.void-monarch.viewmodel.right.wristTrim', material: 'accent', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018], emissive: true },
  { id: 'phantom.void-monarch.viewmodel.voidRayOrb.crystalShell', material: 'glass', bone: 'root', kind: 'sphere', position: [0, -0.12, -0.72], scale: [0.14, 0.14, 0.14], transparent: true },
];

const TIDEBREAKER_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'hookshot.tidebreaker.viewmodel.left.brassClamp', material: 'metal', bone: 'leftForearm', position: [-0.2, -0.055, -0.31], scale: [0.1, 0.018, 0.034] },
  { id: 'hookshot.tidebreaker.viewmodel.right.brassClamp', material: 'metal', bone: 'rightForearm', position: [0.2, -0.055, -0.31], scale: [0.1, 0.018, 0.034] },
  { id: 'hookshot.tidebreaker.viewmodel.left.anchorCore', material: 'accent', bone: 'leftForearm', position: [-0.2, -0.1, -0.48], scale: [0.052, 0.052, 0.026], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.anchorCore', material: 'accent', bone: 'rightForearm', position: [0.2, -0.1, -0.48], scale: [0.052, 0.052, 0.026], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.left.hookBarbA', material: 'glow', bone: 'leftForearm', position: [-0.25, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, 0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.left.hookBarbB', material: 'glow', bone: 'leftForearm', position: [-0.15, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, -0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.hookBarbA', material: 'glow', bone: 'rightForearm', position: [0.15, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, 0.36, 0], emissive: true },
  { id: 'hookshot.tidebreaker.viewmodel.right.hookBarbB', material: 'glow', bone: 'rightForearm', position: [0.25, -0.1, -0.93], scale: [0.028, 0.038, 0.13], rotation: [0, -0.36, 0], emissive: true },
];

const SOLAR_FORGE_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'blaze.solar-forge.viewmodel.left.ventTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'blaze.solar-forge.viewmodel.right.ventTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'blaze.solar-forge.viewmodel.left.emberVent', material: 'glow', bone: 'leftForearm', position: [-0.24, -0.115, -0.36], scale: [0.042, 0.026, 0.024], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.right.emberVent', material: 'glow', bone: 'rightForearm', position: [0.24, -0.115, -0.36], scale: [0.042, 0.026, 0.024], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.staff.solarRing', material: 'accent', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.91], scale: [0.11, 0.016, 0.11], emissive: true },
  { id: 'blaze.solar-forge.viewmodel.staff.goldCap', material: 'metal', bone: 'rightForearm', kind: 'cylinder', position: [0.32, -0.07, -0.82], scale: [0.064, 0.018, 0.064] },
  { id: 'blaze.solar-forge.viewmodel.staff.whiteCore', material: 'glow', bone: 'rightForearm', kind: 'sphere', position: [0.32, -0.07, -0.99], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
];

const EPOCH_REGENT_VIEWMODEL_PARTS: readonly ModelPartDescriptor[] = [
  { id: 'chronos.epoch-regent.viewmodel.left.wristTrim', material: 'metal', bone: 'leftForearm', position: [-0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'chronos.epoch-regent.viewmodel.right.wristTrim', material: 'metal', bone: 'rightForearm', position: [0.24, -0.052, -0.25], scale: [0.08, 0.018, 0.018] },
  { id: 'chronos.epoch-regent.viewmodel.left.paradoxRune', material: 'accent', bone: 'leftForearm', position: [-0.24, -0.105, -0.35], scale: [0.034, 0.034, 0.018], emissive: true },
  { id: 'chronos.epoch-regent.viewmodel.right.paradoxRune', material: 'accent', bone: 'rightForearm', position: [0.24, -0.105, -0.35], scale: [0.034, 0.034, 0.018], emissive: true },
  { id: 'chronos.epoch-regent.viewmodel.pyramid.innerGlass', material: 'glass', bone: 'root', kind: 'cone', position: [0, -0.12, -0.66], scale: [0.105, 0.245, 0.105], rotation: [0, 0, Math.PI / 4], transparent: true },
  { id: 'chronos.epoch-regent.viewmodel.primaryOrb.crown', material: 'metal', bone: 'root', kind: 'cylinder', position: [0, -0.12, -0.78], scale: [0.105, 0.014, 0.105] },
  { id: 'chronos.epoch-regent.viewmodel.aegis.regentTop', material: 'glow', bone: 'root', position: [0, 0.2, -0.7], scale: [0.62, 0.016, 0.02], emissive: true, transparent: true },
  { id: 'chronos.epoch-regent.viewmodel.aegis.regentBottom', material: 'glow', bone: 'root', position: [0, -0.2, -0.7], scale: [0.62, 0.016, 0.02], emissive: true, transparent: true },
];

function createSkinViewmodelDocument(
  heroId: HeroId,
  colorOverrides: Partial<Record<string, string>>,
  extraParts: readonly ModelPartDescriptor[],
  options: {
    glowIntensity?: number;
    glassIntensity?: number;
    accentIntensity?: number;
  } = {}
): ViewmodelModelDocument {
  const base = VIEWMODEL_MODEL_DOCUMENTS[heroId];

  return {
    ...base,
    materials: base.materials.map((material): ModelMaterialDescriptor => ({
      ...material,
      color: colorOverrides[material.token] ?? material.color,
      emissiveIntensity: material.token === 'glow'
        ? options.glowIntensity ?? 0.9
        : material.token === 'glass'
          ? options.glassIntensity ?? 0.38
          : material.token === 'accent' && options.accentIntensity !== undefined
            ? options.accentIntensity
            : material.emissiveIntensity,
    })),
    parts: [
      ...base.parts,
      ...extraParts,
    ],
  };
}

function createVoidMonarchViewmodelDocument(): ViewmodelModelDocument {
  return createSkinViewmodelDocument('phantom', VOID_MONARCH_COLORS, VOID_MONARCH_VIEWMODEL_PARTS);
}

function createTidebreakerViewmodelDocument(): ViewmodelModelDocument {
  return createSkinViewmodelDocument('hookshot', TIDEBREAKER_COLORS, TIDEBREAKER_VIEWMODEL_PARTS, {
    accentIntensity: 0.48,
    glassIntensity: 0.34,
    glowIntensity: 0.82,
  });
}

function createSolarForgeViewmodelDocument(): ViewmodelModelDocument {
  return createSkinViewmodelDocument('blaze', SOLAR_FORGE_COLORS, SOLAR_FORGE_VIEWMODEL_PARTS, {
    accentIntensity: 0.5,
    glassIntensity: 0.42,
    glowIntensity: 1,
  });
}

function createEpochRegentViewmodelDocument(): ViewmodelModelDocument {
  return createSkinViewmodelDocument('chronos', EPOCH_REGENT_COLORS, EPOCH_REGENT_VIEWMODEL_PARTS, {
    accentIntensity: 0.46,
    glassIntensity: 0.4,
    glowIntensity: 0.88,
  });
}

const VIEWMODEL_DOCUMENTS_BY_SKIN: Record<HeroSkinId, ViewmodelModelDocument> = {
  'phantom.default': VIEWMODEL_MODEL_DOCUMENTS.phantom,
  'hookshot.default': VIEWMODEL_MODEL_DOCUMENTS.hookshot,
  'blaze.default': VIEWMODEL_MODEL_DOCUMENTS.blaze,
  'chronos.default': VIEWMODEL_MODEL_DOCUMENTS.chronos,
  'phantom.void-monarch': createVoidMonarchViewmodelDocument(),
  'hookshot.tidebreaker': createTidebreakerViewmodelDocument(),
  'blaze.solar-forge': createSolarForgeViewmodelDocument(),
  'chronos.epoch-regent': createEpochRegentViewmodelDocument(),
};

function createHeroModelDocument(skinId: HeroSkinId, manifest: HeroBodyManifest): HeroModelDocumentV1 {
  const stats = HERO_DEFINITIONS[manifest.heroId].stats;

  return {
    schemaVersion: HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
    heroId: manifest.heroId,
    materialPalette: manifest.materialPalette,
    fullBody: {
      baseHeight: 1.8,
      bounds: {
        height: stats.size.height,
        width: stats.size.width,
        depth: stats.size.depth,
      },
      parts: [
        ...getHeroBodyRenderParts(manifest.parts),
        HERO_BODY_BOT_MARKER_PART,
      ].map(toModelPartDescriptor),
      teamAccentParts: manifest.teamAccentParts.map(toModelPartDescriptor),
      sockets: manifest.remoteSocketMarkers.map(toModelSocketDescriptor),
      idleProfile: manifest.idleProfile,
      attackDurationSeconds: manifest.attackDurationSeconds,
    },
    viewmodel: VIEWMODEL_DOCUMENTS_BY_SKIN[skinId],
    defaultFallbackSockets: defaultFallbackSocketsForHero(manifest.heroId),
  };
}

export const HERO_SKIN_MODEL_DOCUMENTS: Record<HeroSkinId, HeroModelDocumentV1> = {
  'phantom.default': createHeroModelDocument('phantom.default', HERO_SKIN_BODY_MANIFESTS['phantom.default']),
  'hookshot.default': createHeroModelDocument('hookshot.default', HERO_SKIN_BODY_MANIFESTS['hookshot.default']),
  'blaze.default': createHeroModelDocument('blaze.default', HERO_SKIN_BODY_MANIFESTS['blaze.default']),
  'chronos.default': createHeroModelDocument('chronos.default', HERO_SKIN_BODY_MANIFESTS['chronos.default']),
  'phantom.void-monarch': createHeroModelDocument('phantom.void-monarch', HERO_SKIN_BODY_MANIFESTS['phantom.void-monarch']),
  'hookshot.tidebreaker': createHeroModelDocument('hookshot.tidebreaker', HERO_SKIN_BODY_MANIFESTS['hookshot.tidebreaker']),
  'blaze.solar-forge': createHeroModelDocument('blaze.solar-forge', HERO_SKIN_BODY_MANIFESTS['blaze.solar-forge']),
  'chronos.epoch-regent': createHeroModelDocument('chronos.epoch-regent', HERO_SKIN_BODY_MANIFESTS['chronos.epoch-regent']),
};
