import assert from 'node:assert/strict';
import type { PublicRankSnapshot } from '@voxel-strike/shared';
import {
  applyRoomRankState,
  buildRoomRankSnapshot,
  type RoomRankState,
} from '../rooms/roomRankSnapshot';

function createRankState(overrides: Partial<RoomRankState> = {}): RoomRankState {
  return {
    rankTier: 'unranked',
    rankTierLabel: 'Unranked',
    rankDivision: 0,
    rankDivisionIndex: -1,
    rankLabel: 'Unranked',
    rankIconKey: 'unranked',
    rankIsRanked: false,
    rankPlacementRemaining: 5,
    ...overrides,
  };
}

{
  const state = createRankState();
  const rank: PublicRankSnapshot = {
    tier: 'plastic',
    tierLabel: 'Plastic',
    division: 2,
    divisionIndex: 1,
    label: 'Plastic II',
    iconKey: 'plastic',
    isRanked: true,
    placementRemaining: 0,
  };

  applyRoomRankState(state, rank);

  assert.deepEqual(state, {
    rankTier: 'plastic',
    rankTierLabel: 'Plastic',
    rankDivision: 2,
    rankDivisionIndex: 1,
    rankLabel: 'Plastic II',
    rankIconKey: 'plastic',
    rankIsRanked: true,
    rankPlacementRemaining: 0,
  });
}

{
  const state = createRankState({
    rankTier: 'plastic',
    rankTierLabel: 'Plastic',
    rankLabel: 'Plastic',
    rankIconKey: 'plastic',
  });

  assert.deepEqual(buildRoomRankSnapshot(state), {
    tier: 'plastic',
    tierLabel: 'Plastic',
    division: null,
    divisionIndex: null,
    label: 'Plastic',
    iconKey: 'plastic',
    isRanked: false,
    placementRemaining: 5,
  });
}

{
  const state = createRankState({
    rankTier: 'bronze',
    rankTierLabel: 'Bronze',
    rankDivision: 3,
    rankDivisionIndex: 2,
    rankLabel: 'Bronze III',
    rankIconKey: 'bronze',
    rankIsRanked: true,
    rankPlacementRemaining: 0,
  });

  assert.deepEqual(buildRoomRankSnapshot(state), {
    tier: 'bronze',
    tierLabel: 'Bronze',
    division: 3,
    divisionIndex: 2,
    label: 'Bronze III',
    iconKey: 'bronze',
    isRanked: true,
    placementRemaining: 0,
  });
}

console.log('room rank snapshot tests passed');
