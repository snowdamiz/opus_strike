import type { HeroBoneName, RiggedVoxelPart, VoxelPart } from './heroBodyTypes';
import { groupRiggedParts } from './heroRig';

export function getHeroBodyRenderParts(parts: readonly VoxelPart[]): VoxelPart[] {
  return [...parts];
}

export function groupHeroBodyRenderParts(
  parts: readonly VoxelPart[]
): Record<HeroBoneName, RiggedVoxelPart<VoxelPart>[]> {
  return groupRiggedParts(getHeroBodyRenderParts(parts));
}
