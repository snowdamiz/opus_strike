import type * as THREE from 'three';
import type { HeroId } from '@voxel-strike/shared';

export type PartKind = 'box' | 'sphere' | 'cylinder' | 'cone';
export type MaterialKind = 'armor' | 'dark' | 'accent' | 'glow' | 'glass' | 'skin' | 'void' | 'edge' | 'eye' | 'mist';
export type HeroBoneName =
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
export type HeroBoneOverride = HeroBoneName | 'static';

export type HeroAnimationMode = 'idle' | 'walk' | 'jump' | 'crouch' | 'crouchWalk' | 'crouchWalkLoop' | 'run' | 'slide' | 'attack';
export type HeroMovementPose = 'walk' | 'crouchWalk' | 'run';

export interface HeroWalkDirection {
  forward: number;
  right: number;
}

export interface VoxelPart {
  kind?: PartKind;
  material: MaterialKind;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  emissive?: boolean;
  transparent?: boolean;
  limb?: HeroBoneOverride;
}

export interface RiggedVoxelPart<TPart extends VoxelPart = VoxelPart> {
  part: TPart;
  bone: HeroBoneName;
  meshOffset: [number, number, number];
}

export interface TeamAccentPart extends VoxelPart {
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  opacity?: number;
  toneMapped?: boolean;
  depthWrite?: boolean;
}

export interface RemoteBodySocketMarker {
  socketName: string;
  bone: HeroBoneName;
  position: [number, number, number];
}

export interface HeroMovementProfile {
  cycleSpeed: number;
  legPitch: number;
  legStride: number;
  legStrafe: number;
  legLift: number;
  legStrafeRoll: number;
  armPitch: number;
  armStrafeRoll: number;
  armArcScale: number;
  kneeBend: number;
  supportKneeBend: number;
  rootBob: number;
  rootSway: number;
  rootPitch: number;
  rootRoll: number;
  glowPulse: number;
}

export interface HeroIdleProfile {
  cycleSpeed: number;
  breathingAmplitude: number;
  swayAmplitude: number;
  twistAmplitude: number;
  auraPulse: number;
  phase: number;
}

export interface HeroJumpPose {
  rootLift: number;
  crouch: number;
  extension: number;
  tuck: number;
  land: number;
  armReach: number;
  pitch: number;
}

export type HeroBoneRefs = Partial<Record<HeroBoneName, THREE.Group | null>>;

export interface HeroBodyManifest {
  heroId: HeroId;
  parts: readonly VoxelPart[];
  teamAccentParts: readonly TeamAccentPart[];
  remoteSocketMarkers: readonly RemoteBodySocketMarker[];
  materialPalette: Record<MaterialKind, string>;
  idleProfile: HeroIdleProfile;
  attackDurationSeconds: number;
}
