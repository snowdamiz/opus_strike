import assert from 'node:assert/strict';
import { PARTY_MAX_MEMBERS, getRankFromRating, type HeroId } from '@voxel-strike/shared';
import { PartyRosterRuntime } from '../party/partyRuntime';

function addMember(
  party: PartyRosterRuntime,
  userId: string,
  sessionId: string,
  rating: number,
  heroId: HeroId = 'blaze'
) {
  const result = party.addMember({
    userId,
    sessionId,
    displayName: userId,
    heroId,
    rank: getRankFromRating(rating, 0),
    competitiveRating: rating,
    rankDivisionIndex: 0,
  });
  return result.member;
}

const defaultParty = new PartyRosterRuntime('party-default');
assert.equal(defaultParty.maxMembers, PARTY_MAX_MEMBERS);

const initializedParty = new PartyRosterRuntime('party-initialized');
initializedParty.initializeSelection({
  selectedMode: 'quick_play',
  gameplayMode: 'battle_royal',
});
assert.equal(initializedParty.mode, 'quick_play');
assert.equal(initializedParty.selectedGameplayMode, 'battle_royal');
assert.equal(initializedParty.snapshot().gameplayMode, 'battle_royal');

const party = new PartyRosterRuntime('party-test', 4);
const leader = addMember(party, 'leader', 'session-a', 900);
assert.equal(party.leaderId, leader.userId);
assert.equal(party.snapshot().members[0].leader, true);

const member = addMember(party, 'member', 'session-b', 1000);
assert.notEqual(member.heroId, leader.heroId);
assert.equal(party.validateStart().ok, false);

party.setReady(member.userId, true);
assert.equal(party.validateStart().ok, true);
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, true);

assert.throws(() => party.updateHero(member.userId, leader.heroId), /Hero is already picked/);
party.updateHero(member.userId, 'phantom');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.heroId, 'phantom');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);

party.setReady(member.userId, true);
party.setMode(leader.userId, 'ranked');
assert.equal(party.mode, 'ranked');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);

party.setReady(member.userId, true);
party.setBotFillEnabled(leader.userId, 'team_deathmatch', true);
assert.equal(party.getBotFillEnabled('team_deathmatch'), true);
assert.equal(party.snapshot().botFillEnabledByMode.team_deathmatch, true);
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);
assert.throws(
  () => party.setBotFillEnabled(member.userId, 'team_deathmatch', false),
  /Only the party leader/
);

party.setReady(member.userId, true);
party.setMatchPerspective(leader.userId, 'team_deathmatch', 'third_person');
assert.equal(party.snapshot().perspectiveByMode.team_deathmatch, 'third_person');
assert.equal(party.getActiveMatchPerspective('quick_play', 'team_deathmatch'), 'third_person');
assert.equal(party.snapshot().members.find((snapshot) => snapshot.userId === member.userId)?.ready, false);
assert.throws(
  () => party.setMatchPerspective(member.userId, 'team_deathmatch', 'first_person'),
  /Only the party leader/
);

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
assert.equal(replacement.member.ready, false);

const botParty = new PartyRosterRuntime('party-bots', 4);
const botLeader = addMember(botParty, 'bot-leader', 'session-bot-leader', 900);
const bot = botParty.addBot(botLeader.userId, {
  displayName: 'Hard Bot',
  difficulty: 'hard',
  heroId: botLeader.heroId,
});
assert.equal(bot.isBot, true);
assert.equal(bot.ready, true);
assert.equal(bot.botDifficulty, 'hard');
assert.notEqual(bot.heroId, botLeader.heroId);
assert.equal(botParty.validateStart().ok, true);
assert.equal(botParty.snapshot().members.find((snapshot) => snapshot.userId === bot.userId)?.isBot, true);

const botOccupiedHero = bot.heroId;
botParty.updateHero(botLeader.userId, botOccupiedHero);
assert.equal(botLeader.heroId, botOccupiedHero);
assert.notEqual(bot.heroId, botOccupiedHero);
assert.equal(new Set(botParty.getMembers().map((candidate) => candidate.heroId)).size, botParty.size);

botParty.setMode(botLeader.userId, 'custom');
assert.equal(botParty.snapshot().members.find((snapshot) => snapshot.userId === bot.userId)?.ready, true);
assert.throws(() => botParty.addBot('not-leader', { difficulty: 'easy' }), /Only the party leader/);

const removedBot = botParty.kickMember(botLeader.userId, bot.userId);
assert.equal(removedBot?.userId, bot.userId);
assert.equal(botParty.getBotMembers().length, 0);

botParty.addBot(botLeader.userId, { difficulty: 'easy' });
botParty.addBot(botLeader.userId, { difficulty: 'normal' });
botParty.addBot(botLeader.userId, { difficulty: 'hard' });
assert.throws(() => botParty.addBot(botLeader.userId, { difficulty: 'normal' }), /Party is full/);

const battleRoyalParty = new PartyRosterRuntime('party-br-limit', 4);
const battleRoyalLeader = addMember(battleRoyalParty, 'br-leader', 'session-br-leader', 900);
battleRoyalParty.setMode(battleRoyalLeader.userId, 'quick_play', 'battle_royal');
battleRoyalParty.addBot(battleRoyalLeader.userId, { difficulty: 'easy' });
battleRoyalParty.addBot(battleRoyalLeader.userId, { difficulty: 'normal' });
assert.equal(battleRoyalParty.validateStart().ok, true);
battleRoyalParty.addBot(battleRoyalLeader.userId, { difficulty: 'hard' });
assert.deepEqual(
  battleRoyalParty.validateStart(),
  { ok: false, message: 'Battle Royal squads are limited to 3 players' }
);

const botOnlyParty = new PartyRosterRuntime('party-bot-only', 4);
const botOnlyLeader = addMember(botOnlyParty, 'solo-leader', 'session-solo-leader', 900);
botOnlyParty.addBot(botOnlyLeader.userId);
botOnlyParty.removeSession('session-solo-leader');
assert.equal(botOnlyParty.leaderId, null);

const rejoinParty = new PartyRosterRuntime('party-rejoin', 4);
const rejoinLeader = addMember(rejoinParty, 'rejoin-leader', 'session-rejoin-a', 900);
rejoinParty.setMode(rejoinLeader.userId, 'quick_play', 'battle_royal');
rejoinParty.setBotFillEnabled(rejoinLeader.userId, 'battle_royal', true);
rejoinParty.setMatchPerspective(rejoinLeader.userId, 'battle_royal', 'third_person');
const rejoinBot = rejoinParty.addBot(rejoinLeader.userId, { difficulty: 'hard' });
rejoinParty.removeSession('session-rejoin-a');
assert.equal(rejoinParty.leaderId, null);
assert.equal(rejoinParty.getBotMembers().length, 1);
assert.equal(rejoinParty.snapshot().members.find((snapshot) => snapshot.userId === rejoinBot.userId)?.isBot, true);
assert.equal(rejoinParty.snapshot().gameplayMode, 'battle_royal');
assert.equal(rejoinParty.snapshot().botFillEnabledByMode.battle_royal, true);
assert.equal(rejoinParty.snapshot().perspectiveByMode.battle_royal, 'third_person');
addMember(rejoinParty, 'rejoin-leader', 'session-rejoin-b', 900);
assert.equal(rejoinParty.leaderId, 'rejoin-leader');
assert.equal(rejoinParty.getBotMembers().length, 1);
assert.equal(rejoinParty.snapshot().gameplayMode, 'battle_royal');
assert.equal(rejoinParty.snapshot().botFillEnabledByMode.battle_royal, true);
assert.equal(rejoinParty.snapshot().perspectiveByMode.battle_royal, 'third_person');

const restoredParty = new PartyRosterRuntime('party-restored', 4);
restoredParty.restorePersistentSnapshot(rejoinParty.snapshot());
assert.equal(restoredParty.getBotMembers().length, 1);
assert.equal(restoredParty.snapshot().gameplayMode, 'battle_royal');
assert.equal(restoredParty.snapshot().botFillEnabledByMode.battle_royal, true);
assert.equal(restoredParty.snapshot().perspectiveByMode.battle_royal, 'third_person');
addMember(restoredParty, 'rejoin-leader', 'session-restored-leader', 900);
assert.equal(restoredParty.leaderId, 'rejoin-leader');
assert.equal(restoredParty.getBotMembers().length, 1);
assert.equal(restoredParty.validateStart().ok, true);

const kickParty = new PartyRosterRuntime('party-kick', 4);
const kickLeader = addMember(kickParty, 'kick-leader', 'session-kick-leader', 900);
const kickedMember = addMember(kickParty, 'kicked-member', 'session-kicked-member', 950);
const kickedBot = kickParty.addBot(kickLeader.userId, { difficulty: 'easy' });
assert.throws(() => kickParty.kickMember(kickedMember.userId, kickedBot.userId), /Only the party leader/);
assert.throws(() => kickParty.kickMember(kickLeader.userId, kickLeader.userId), /Cannot kick yourself/);
assert.equal(kickParty.kickMember(kickLeader.userId, kickedMember.userId)?.userId, kickedMember.userId);
assert.equal(kickParty.getMember(kickedMember.userId), null);
assert.equal(kickParty.getMemberBySession('session-kicked-member'), null);
assert.equal(kickParty.kickMember(kickLeader.userId, kickedBot.userId)?.isBot, true);
assert.equal(kickParty.getMember(kickedBot.userId), null);

console.log('party-runtime tests passed');
