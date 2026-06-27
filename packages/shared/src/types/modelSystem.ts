import type { PlayerSocketOffset } from '../constants/physics.js';
import type { HeroId } from './hero.js';

export const HERO_MODEL_DOCUMENT_SCHEMA_VERSION = 1;

export type HeroModelHeroId = HeroId | (string & {});

export type ModelSide = -1 | 1;

export type ModelOwnerScope =
  | 'localViewmodel'
  | 'remoteBody'
  | 'preview'
  | 'serverFallback';

export type ModelPartKind = 'box' | 'sphere' | 'cylinder' | 'cone';

export type ModelPartAttachmentMode = 'surface' | 'floating';

export type ModelTransformTuple = readonly [number, number, number];

export type ModelQuaternionTuple = readonly [number, number, number, number];

export type KnownModelMaterialToken =
  | 'armor'
  | 'dark'
  | 'metal'
  | 'accent'
  | 'glow'
  | 'glass'
  | 'skin'
  | 'void'
  | 'edge'
  | 'eye'
  | 'mist';

export type ModelMaterialToken = KnownModelMaterialToken | (string & {});

export type ModelBoneName =
  | 'aura'
  | 'hips'
  | 'torso'
  | 'head'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftShin'
  | 'rightShin'
  | 'leftArm'
  | 'rightArm'
  | 'leftForearm'
  | 'rightForearm';

export type ModelPartTarget = ModelBoneName | 'root';

export type KnownModelSocketRole =
  | 'primaryPalm'
  | 'voidRayOrb'
  | 'hookTip'
  | 'staffTip'
  | 'chronosPrimaryOrb';

export type ModelSocketRole = KnownModelSocketRole | (string & {});

export type AbilitySocketSideMode =
  | 'launchSide'
  | 'left'
  | 'right'
  | 'center'
  | 'both';

export interface ModelPartDescriptor {
  id: string;
  kind?: ModelPartKind;
  material: ModelMaterialToken;
  bone: ModelPartTarget;
  position: ModelTransformTuple;
  scale: ModelTransformTuple;
  rotation?: ModelTransformTuple;
  attachmentMode?: ModelPartAttachmentMode;
  emissive?: boolean;
  transparent?: boolean;
  generated?: boolean;
}

export interface ModelSocketDescriptor {
  id: string;
  role: ModelSocketRole;
  name: string;
  side?: ModelSide;
  ownerScope: Extract<ModelOwnerScope, 'localViewmodel' | 'remoteBody' | 'preview'>;
  bone?: ModelBoneName;
  position?: ModelTransformTuple;
  rotation?: ModelTransformTuple;
  fallbackOffset: PlayerSocketOffset;
}

export interface ModelMaterialDescriptor {
  token: ModelMaterialToken;
  color: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  toneMapped?: boolean;
  depthWrite?: boolean;
}

export interface HeroModelBounds {
  height: number;
  width: number;
  depth: number;
}

export interface HeroModelIdleProfile {
  cycleSpeed: number;
  breathingAmplitude: number;
  swayAmplitude: number;
  twistAmplitude: number;
  auraPulse: number;
  phase: number;
}

export interface FullBodyModelDocument {
  baseHeight: number;
  bounds: HeroModelBounds;
  parts: readonly ModelPartDescriptor[];
  teamAccentParts: readonly ModelPartDescriptor[];
  sockets: readonly ModelSocketDescriptor[];
  idleProfile: HeroModelIdleProfile;
  attackDurationSeconds: number;
}

export type ViewmodelChannelKind =
  | 'held'
  | 'charge'
  | 'fire'
  | 'cast'
  | 'slam'
  | 'targeting'
  | 'movement';

export type ViewmodelPoseChannelDriver =
  | 'poseRuntime'
  | 'componentRef'
  | 'visualStore'
  | 'derived';

export interface ViewmodelPoseChannelDescriptor {
  id: string;
  kind: ViewmodelChannelKind;
  driver?: ViewmodelPoseChannelDriver;
}

export interface ViewmodelModelDocument {
  rootOffset: ModelTransformTuple;
  fov?: number;
  materials: readonly ModelMaterialDescriptor[];
  parts: readonly ModelPartDescriptor[];
  sockets: readonly ModelSocketDescriptor[];
  poseChannels: readonly ViewmodelPoseChannelDescriptor[];
}

export interface HeroModelDocumentV1 {
  schemaVersion: typeof HERO_MODEL_DOCUMENT_SCHEMA_VERSION;
  heroId: HeroModelHeroId;
  materialPalette: Partial<Record<ModelMaterialToken, string>>;
  fullBody: FullBodyModelDocument;
  viewmodel?: ViewmodelModelDocument;
  defaultFallbackSockets: Partial<Record<ModelSocketRole, PlayerSocketOffset>>;
}
