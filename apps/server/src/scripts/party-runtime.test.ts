import assert from 'node:assert/strict';
import { DEFAULT_GAME_CONFIG, getRankFromRating } from '@voxel-strike/shared';
import { PartyRosterRuntime } from '../party/partyRuntime';

function addMember(
  party: PartyRosterRuntime,
  userId: string,
  sessionId: string,
  rating: number
) {
  const result = party.addMember({
    userId,
    sessionId,
    displayName: userId,
    heroId: 'blaze',
    rank: getRankFromRating(rating, 0),
    competitiveRating: rating,
    rankDivisionIndex: 0,
  });
  return result.member;
}

const defaultParty = new PartyRosterRuntime('party-default');
assert.equal(defaultParty.maxMembers, DEFAULT_GAME_CONFIG.teamSize);

const party = new PartyRosterRuntime('party-test', 4);
const leader = addMember(party, 'leader', 'session-a', 900);
assert.equal(party.leaderId, leader.userId);
assert.equal(party.snapshot().members[0].leader, true);

const member = addMember(party, 'member', 'session-b', 1000);
assert.equal(party.validateStart().ok, false);

party.setReady(member.userId, true);
assert.equal(party.validateStart().ok, true);
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, true);

party.updateHero(member.userId, 'phantom');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.heroId, 'phantom');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);

party.setReady(member.userId, true);
party.setMode(leader.userId, 'ranked');
assert.equal(party.mode, 'ranked');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);

party.setReady(member.userId, true);
party.removeSession('session-a');
assert.equal(party.leaderId, member.userId);
assert.equal(party.snapshot().members[0].leader, true);
assert.equal(party.validateStart().ok, true);

const replacement = party.addMember({
  userId: member.userId,
  sessionId: 'session-c',
  displayName: 'member',
  heroId: 'chronos',
  rank: getRankFromRating(1000, 0),
  competitiveRating: 1000,
  rankDivisionIndex: 0,
});
assert.equal(replacement.replacedSessionId, 'session-b');
assert.equal(party.getMemberBySession('session-b'), null);
assert.equal(party.getMemberBySession('session-c')?.userId, member.userId);

console.log('party-runtime tests passed');
