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

function createVoidMonarchViewmodelDocument(): ViewmodelModelDocument {
  const base = VIEWMODEL_MODEL_DOCUMENTS.phantom;
  const colorOverrides: Partial<Record<string, string>> = {
    armor: VOID_MONARCH_COLORS.armor,
    dark: VOID_MONARCH_COLORS.dark,
    metal: VOID_MONARCH_COLORS.metal,
    accent: VOID_MONARCH_COLORS.accent,
    glow: VOID_MONARCH_COLORS.glow,
    glass: VOID_MONARCH_COLORS.glass,
  };

  return {
    ...base,
    materials: base.materials.map((material): ModelMaterialDescriptor => ({
      ...material,
      color: colorOverrides[material.token] ?? material.color,
      emissiveIntensity: material.token === 'glow'
        ? 0.9
        : material.token === 'glass'
          ? 0.38
          : material.emissiveIntensity,
    })),
    parts: [
      ...base.parts,
      ...VOID_MONARCH_VIEWMODEL_PARTS,
    ],
  };
}

const VIEWMODEL_DOCUMENTS_BY_SKIN: Record<HeroSkinId, ViewmodelModelDocument> = {
  'phantom.default': VIEWMODEL_MODEL_DOCUMENTS.phantom,
  'hookshot.default': VIEWMODEL_MODEL_DOCUMENTS.hookshot,
  'blaze.default': VIEWMODEL_MODEL_DOCUMENTS.blaze,
  'chronos.default': VIEWMODEL_MODEL_DOCUMENTS.chronos,
  'phantom.void-monarch': createVoidMonarchViewmodelDocument(),
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
};
