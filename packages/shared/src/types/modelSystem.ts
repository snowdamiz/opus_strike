import type { PlayerSocketOffset } from '../constants/physics.js';
import type { HeroId } from './hero.js';

export type ModelSide = -1 | 1;

export type ModelOwnerScope =
  | 'localViewmodel'
  | 'remoteBody'
  | 'preview'
  | 'serverFallback';

export type ModelPartKind = 'box' | 'sphere' | 'cylinder' | 'cone';

export type ModelTransformTuple = readonly [number, number, number];

export type ModelMaterialToken =
  | 'armor'
  | 'dark'
  | 'accent'
  | 'glow'
  | 'glass'
  | 'skin'
  | 'void'
  | 'edge'
  | 'eye'
  | 'mist';

export type ModelSocketRole =
  | 'primaryPalm'
  | 'voidRayOrb'
  | 'hookTip'
  | 'staffTip'
  | 'chronosPrimaryOrb';

export type AbilitySocketSideMode =
  | 'launchSide'
  | 'left'
  | 'right'
  | 'center'
  | 'both';

export interface ModelPartDescriptor {
  kind?: ModelPartKind;
  material: ModelMaterialToken;
  position: ModelTransformTuple;
  scale: ModelTransformTuple;
  rotation?: ModelTransformTuple;
  emissive?: boolean;
  transparent?: boolean;
}

export interface ModelSocketDescriptor {
  role: ModelSocketRole;
  name: string;
  side?: ModelSide;
  fallbackOffset: PlayerSocketOffset;
}

export interface HeroModelManifest {
  heroId: HeroId;
  materialPalette: Record<ModelMaterialToken, string>;
  bodyParts: readonly ModelPartDescriptor[];
  teamAccentParts: readonly ModelPartDescriptor[];
  bodySockets: readonly ModelSocketDescriptor[];
  defaultFallbackSockets: Partial<Record<ModelSocketRole, PlayerSocketOffset>>;
}

