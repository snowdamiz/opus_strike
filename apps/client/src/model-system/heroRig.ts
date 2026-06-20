import * as THREE from 'three';
import type {
  HeroBoneName,
  PartKind,
  RemoteBodySocketMarker,
  RiggedVoxelPart,
  VoxelPart,
  VoxelPartDraft,
} from './heroBodyTypes';

export const HERO_BONE_PIVOTS: Record<HeroBoneName, [number, number, number]> = {
  aura: [0, 0, 0],
  hips: [0, 0.72, 0.02],
  torso: [0, 1.06, 0],
  head: [0, 1.6, 0],
  leftLeg: [-0.18, 0.72, 0.02],
  rightLeg: [0.18, 0.72, 0.02],
  leftKnee: [-0.18, 0.44, 0.02],
  rightKnee: [0.18, 0.44, 0.02],
  leftShin: [-0.18, 0.44, 0.02],
  rightShin: [0.18, 0.44, 0.02],
  leftArm: [-0.48, 1.32, 0],
  rightArm: [0.48, 1.32, 0],
  leftForearm: [-0.5, 0.9, -0.06],
  rightForearm: [0.5, 0.9, -0.06],
};

export const HERO_BONE_PARENTS: Partial<Record<HeroBoneName, HeroBoneName>> = {
  torso: 'hips',
  leftLeg: 'hips',
  rightLeg: 'hips',
  leftKnee: 'leftLeg',
  rightKnee: 'rightLeg',
  leftShin: 'leftKnee',
  rightShin: 'rightKnee',
  head: 'torso',
  leftArm: 'torso',
  rightArm: 'torso',
  leftForearm: 'leftArm',
  rightForearm: 'rightArm',
};

export const EMPTY_RIGGED_PARTS: RiggedVoxelPart[] = [];
export const EMPTY_REMOTE_SOCKET_MARKERS: RemoteBodySocketMarker[] = [];

export const HERO_PART_GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 10, 8),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
} satisfies Record<PartKind, THREE.BufferGeometry>;

export function getPartGeometry(part: VoxelPartDraft): THREE.BufferGeometry {
  switch (part.kind) {
    case 'sphere':
      return HERO_PART_GEOMETRIES.sphere;
    case 'cylinder':
      return HERO_PART_GEOMETRIES.cylinder;
    case 'cone':
      return HERO_PART_GEOMETRIES.cone;
    default:
      return HERO_PART_GEOMETRIES.box;
  }
}

export function inferStaticBone(part: VoxelPartDraft): HeroBoneName {
  const [, y] = part.position;
  if (part.material === 'mist' || (part.kind === 'cylinder' && y < 0.08)) return 'aura';
  if (y >= 1.52) return 'head';
  if (y >= 0.7) return 'torso';
  return 'hips';
}

export function classifyHeroBone(part: VoxelPartDraft): HeroBoneName {
  if (part.bone) return part.bone;

  const [x, y, z] = part.position;
  const absX = Math.abs(x);

  if (part.material === 'mist' || (part.kind === 'cylinder' && y < 0.08)) {
    return 'aura';
  }

  if (y >= 1.52 && absX <= 0.38) {
    return 'head';
  }

  if (
    absX >= 0.06 &&
    ((y <= 0.56 && absX <= 0.43) || (y <= 0.74 && absX <= 0.32))
  ) {
    if (y <= 0.56) {
      return x < 0 ? 'leftShin' : 'rightShin';
    }

    return x < 0 ? 'leftLeg' : 'rightLeg';
  }

  if (absX >= 0.34 && absX <= 1.05 && y >= 0.46 && y <= 1.52) {
    return x < 0 ? 'leftArm' : 'rightArm';
  }

  if (absX <= 0.5 && y >= 0.58 && y <= 0.84 && Math.abs(z) <= 0.32) {
    return 'hips';
  }

  if (y >= 0.64 || z > 0.28) {
    return 'torso';
  }

  return 'hips';
}

export function createRiggedPart<TPart extends VoxelPartDraft>(part: TPart): RiggedVoxelPart<TPart> {
  const bone = classifyHeroBone(part);
  const [x, y, z] = part.position;
  const pivot = HERO_BONE_PIVOTS[bone];

  return {
    part,
    bone,
    meshOffset: [x - pivot[0], y - pivot[1], z - pivot[2]],
  };
}

export function groupRiggedParts<TPart extends VoxelPart>(
  parts: readonly TPart[]
): Record<HeroBoneName, RiggedVoxelPart<TPart>[]> {
  const grouped: Record<HeroBoneName, RiggedVoxelPart<TPart>[]> = {
    aura: [],
    hips: [],
    torso: [],
    head: [],
    leftLeg: [],
    rightLeg: [],
    leftKnee: [],
    rightKnee: [],
    leftShin: [],
    rightShin: [],
    leftArm: [],
    rightArm: [],
    leftForearm: [],
    rightForearm: [],
  };

  parts.forEach((part) => {
    const riggedPart = createRiggedPart(part);
    grouped[riggedPart.bone].push(riggedPart);
  });

  return grouped;
}

function stableStringifyPartValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyPartValue).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}:${stableStringifyPartValue(entry)}`)
      .join(',')}}`;
  }

  return String(value);
}

function hashPartIdSource(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function createGeneratedPartId(part: VoxelPartDraft, bone: HeroBoneName, idPrefix: string): string {
  const source = stableStringifyPartValue({
    bone,
    kind: part.kind ?? 'box',
    material: part.material,
    position: part.position,
    scale: part.scale,
    rotation: part.rotation,
    emissive: part.emissive,
    transparent: part.transparent,
    generated: part.generated,
  });
  return `${idPrefix}.${bone}.${part.material}.${hashPartIdSource(source)}`;
}

export function addVoxelPartMetadata<TPart extends VoxelPartDraft>(
  parts: readonly TPart[],
  idPrefix: string
): Array<TPart & VoxelPart> {
  return parts.map((part) => {
    const bone = part.bone ?? classifyHeroBone(part);
    return {
      ...part,
      id: part.id ?? createGeneratedPartId(part, bone, idPrefix),
      bone,
    };
  });
}

export function getChildBonePosition(bone: HeroBoneName, parent: HeroBoneName): [number, number, number] {
  const bonePivot = HERO_BONE_PIVOTS[bone];
  const parentPivot = HERO_BONE_PIVOTS[parent];
  return [
    bonePivot[0] - parentPivot[0],
    bonePivot[1] - parentPivot[1],
    bonePivot[2] - parentPivot[2],
  ];
}

export function getBoneRestPosition(bone: HeroBoneName): [number, number, number] {
  const parent = HERO_BONE_PARENTS[bone];
  return parent ? getChildBonePosition(bone, parent) : HERO_BONE_PIVOTS[bone];
}
