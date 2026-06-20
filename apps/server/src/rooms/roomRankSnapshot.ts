import type { PublicRankSnapshot } from '@voxel-strike/shared';

export interface RoomRankState {
  rankTier: string;
  rankTierLabel: string;
  rankDivision: number;
  rankDivisionIndex: number;
  rankLabel: string;
  rankIconKey: string;
  rankIsRanked: boolean;
  rankPlacementRemaining: number;
}

export function applyRoomRankState(
  target: RoomRankState,
  rank: PublicRankSnapshot
): void {
  target.rankTier = rank.tier;
  target.rankTierLabel = rank.tierLabel;
  target.rankDivision = rank.division ?? 0;
  target.rankDivisionIndex = rank.divisionIndex ?? -1;
  target.rankLabel = rank.label;
  target.rankIconKey = rank.iconKey;
  target.rankIsRanked = rank.isRanked;
  target.rankPlacementRemaining = rank.placementRemaining;
}

export function buildRoomRankSnapshot(source: RoomRankState): PublicRankSnapshot {
  return {
    tier: source.rankTier as PublicRankSnapshot['tier'],
    tierLabel: source.rankTierLabel,
    division: source.rankDivision > 0 ? source.rankDivision : null,
    divisionIndex: source.rankDivisionIndex >= 0 ? source.rankDivisionIndex : null,
    label: source.rankLabel,
    iconKey: source.rankIconKey,
    isRanked: source.rankIsRanked,
    placementRemaining: source.rankPlacementRemaining,
  };
}
