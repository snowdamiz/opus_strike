import assert from 'node:assert/strict';
import { getRankFromRating, type PartyStateSnapshot } from '@voxel-strike/shared';
import {
  arePartyMembersReady,
  getPartyMember,
  isPartyLeader,
  usePartyStore,
} from './partyStore';

const rank = getRankFromRating(900, 0);
const party: PartyStateSnapshot = {
  partyId: 'party-a',
  leaderUserId: 'leader',
  selectedMode: 'quick_play',
  gameplayMode: 'capture_the_flag',
  launchError: null,
  members: [
    {
      userId: 'leader',
      displayName: 'Leader',
      heroId: 'blaze',
      ready: false,
      connected: true,
      leader: true,
      rank,
    },
    {
      userId: 'member',
      displayName: 'Member',
      heroId: 'phantom',
      ready: true,
      connected: true,
      leader: false,
      rank,
    },
  ],
};

usePartyStore.getState().setPartyState(party, 'member');
assert.equal(usePartyStore.getState().party?.partyId, 'party-a');
assert.equal(usePartyStore.getState().localUserId, 'member');
assert.equal(getPartyMember(party, 'member')?.heroId, 'phantom');
assert.equal(isPartyLeader(party, 'leader'), true);
assert.equal(isPartyLeader(party, 'member'), false);
assert.equal(arePartyMembersReady(party), true);

usePartyStore.getState().setLaunchError('launch failed');
assert.equal(usePartyStore.getState().launchError, 'launch failed');

usePartyStore.getState().clearParty();
assert.equal(usePartyStore.getState().party, null);
assert.equal(usePartyStore.getState().localUserId, null);

console.log('party-store tests passed');
