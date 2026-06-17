import {
  BLAZE_ROCKET_STAFF_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET,
  HERO_DEFINITIONS,
  HERO_MODEL_DOCUMENT_SCHEMA_VERSION,
  HOOKSHOT_CHAIN_SOCKET,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_VOID_RAY_SOCKET,
  type HeroId,
  type HeroModelDocumentV1,
  type ModelPartDescriptor,
  type ModelSocketDescriptor,
} from '@voxel-strike/shared';
import { HERO_BODY_MANIFESTS } from './heroBodyManifests';
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

function createHeroModelDocument(manifest: HeroBodyManifest): HeroModelDocumentV1 {
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
    viewmodel: VIEWMODEL_MODEL_DOCUMENTS[manifest.heroId],
    defaultFallbackSockets: defaultFallbackSocketsForHero(manifest.heroId),
  };
}

export const HERO_MODEL_DOCUMENTS: Record<string, HeroModelDocumentV1> = {
  phantom: createHeroModelDocument(HERO_BODY_MANIFESTS.phantom),
  hookshot: createHeroModelDocument(HERO_BODY_MANIFESTS.hookshot),
  blaze: createHeroModelDocument(HERO_BODY_MANIFESTS.blaze),
  chronos: createHeroModelDocument(HERO_BODY_MANIFESTS.chronos),
};
