import assert from 'node:assert/strict';
import {
  getHumanPartyHeroIds,
  getRankFromRating,
  createDefaultPartyBotFillSettings,
  isHumanPartyHeroAvailable,
  type PartyStateSnapshot,
} from '@voxel-strike/shared';
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
  botFillEnabledByMode: createDefaultPartyBotFillSettings(),
  launchError: null,
  members: [
    {
      userId: 'leader',
      displayName: 'Leader',
      heroId: 'blaze',
      ready: false,
      connected: true,
      leader: true,
      isBot: false,
      rank,
    },
    {
      userId: 'member',
      displayName: 'Member',
      heroId: 'phantom',
      ready: true,
      connected: true,
      leader: false,
      isBot: false,
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

const partyWithBot: PartyStateSnapshot = {
  ...party,
  members: [
    ...party.members,
    {
      userId: 'bot',
      displayName: 'Bot',
      heroId: 'chronos',
      ready: true,
      connected: true,
      leader: false,
      isBot: true,
      rank,
    },
  ],
};
assert.deepEqual(Array.from(getHumanPartyHeroIds(partyWithBot.members, 'member')).sort(), ['blaze']);
assert.equal(isHumanPartyHeroAvailable(partyWithBot.members, 'chronos', 'member'), true);
assert.equal(isHumanPartyHeroAvailable(partyWithBot.members, 'blaze', 'member'), false);

usePartyStore.getState().setLaunchError('launch failed');
assert.equal(usePartyStore.getState().launchError, 'launch failed');

usePartyStore.getState().clearParty();
assert.equal(usePartyStore.getState().party, null);
assert.equal(usePartyStore.getState().localUserId, null);

console.log('party-store tests passed');
