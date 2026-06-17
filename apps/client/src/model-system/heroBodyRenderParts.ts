import { HERO_BODY_GENERATED_BONE_PARTS } from './heroBodyGeneratedParts';
import type { HeroBoneName, RiggedVoxelPart, VoxelPart } from './heroBodyTypes';
import { groupRiggedParts } from './heroRig';

export function getHeroBodyRenderParts(parts: readonly VoxelPart[]): VoxelPart[] {
  return [
    ...HERO_BODY_GENERATED_BONE_PARTS,
    ...parts,
  ];
}

export function groupHeroBodyRenderParts(
  parts: readonly VoxelPart[]
): Record<HeroBoneName, RiggedVoxelPart<VoxelPart>[]> {
  return groupRiggedParts(getHeroBodyRenderParts(parts));
}

