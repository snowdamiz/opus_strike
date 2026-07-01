import assert from 'node:assert/strict';
import type { AntiCheatIntegrityGate } from '../anticheat';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';
import {
  buildMatchPlayerRewardGrants,
  buildSeasonTopTenRewardGrants,
  limitPlayerRewardGrantsToBudget,
} from '../rewards/service';
import type { PlayerRewardRuntimeConfig } from '../rewards/config';

function gate(input: Partial<AntiCheatIntegrityGate> = {}): AntiCheatIntegrityGate {
  return {
    status: 'clean',
    reviewRequired: false,
    rankedHoldRequired: false,
    observedOnly: false,
    reason: null,
    affectedUserIds: [],
    affectedTeams: [],
    score: 0,
    caseId: null,
    ...input,
  };
}

function participant(input: Partial<MatchParticipantSnapshot> = {}): MatchParticipantSnapshot {
  return {
    userId: 'user-red',
    playerSessionId: 'session-red',
    displayName: 'Red',
    team: 'red',
    heroId: 'phantom',
    kills: 0,
    deaths: 0,
    assists: 3,
    flagCaptures: 1,
    flagReturns: 1,
    joinedAt: new Date('2026-06-10T10:00:00.000Z'),
    leftAt: null,
    ...input,
  };
}

const config: PlayerRewardRuntimeConfig = {
  enabled: true,
  dailyRankedDripLamports: 100n,
  dailyRankedDripMaxMatches: 5,
  minMatchDurationMs: 60_000,
  objectiveWinLamports: 50n,
  objectiveFlagCaptureLamports: 40n,
  objectiveFlagReturnLamports: 10n,
  objectiveAssistLamports: 5n,
  maxPlayerMatchLamports: 180n,
  maxMatchPayoutLamports: 1_000n,
  treasuryReserveLamports: 0n,
  payoutBatchSize: 100,
};

{
  const grants = buildMatchPlayerRewardGrants({
    matchId: 'match-a',
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    matchMode: 'ranked',
    startedAt: new Date('2026-06-10T10:00:00.000Z'),
    endedAt: new Date('2026-06-10T10:10:00.000Z'),
    winningTeam: 'red',
    participants: [participant()],
    rankedEligible: true,
    integrityGate: gate(),
    config,
    dailyRewardCountsByUserId: new Map(),
  });

  assert.equal(grants.length, 2);
  assert.equal(grants[0].kind, 'daily_ranked_drip');
  assert.equal(grants[0].amountLamports, 100n);
  assert.equal(grants[1].kind, 'objective_bounty');
  assert.equal(grants[1].amountLamports, 80n);

  const limited = limitPlayerRewardGrantsToBudget(grants, 150n);
  assert.equal(limited.length, 2);
  assert.equal(limited[0].amountLamports, 100n);
  assert.equal(limited[1].amountLamports, 50n);
  assert.equal(limited[1].metadata.budgetCapped, true);
}

{
  const grants = buildMatchPlayerRewardGrants({
    matchId: 'match-b',
    roomId: 'room-b',
    lobbyId: null,
    matchMode: 'ranked',
    startedAt: new Date('2026-06-10T10:00:00.000Z'),
    endedAt: new Date('2026-06-10T10:10:00.000Z'),
    winningTeam: 'red',
    participants: [participant()],
    rankedEligible: true,
    integrityGate: gate({ reviewRequired: true }),
    config,
    dailyRewardCountsByUserId: new Map(),
  });

  assert.equal(grants.length, 0);
}

{
  const grants = buildMatchPlayerRewardGrants({
    matchId: 'match-c',
    roomId: 'room-c',
    lobbyId: null,
    matchMode: 'ranked',
    startedAt: new Date('2026-06-10T10:00:00.000Z'),
    endedAt: new Date('2026-06-10T10:10:00.000Z'),
    winningTeam: 'blue',
    participants: [participant({ leftAt: new Date('2026-06-10T10:05:00.000Z') })],
    rankedEligible: true,
    integrityGate: gate(),
    config,
    dailyRewardCountsByUserId: new Map(),
  });

  assert.equal(grants.length, 0);
}

{
  const grants = buildSeasonTopTenRewardGrants({
    mode: 'season',
    seasonNumber: 2,
    amountLamports: 600n,
    settledByUserId: 'admin-a',
    entries: [
      { userId: 'first', userName: 'First', competitiveRating: 1500, rankedGames: 8, rankedWins: 6, rankedLosses: 2, rankedDraws: 0, rankedPeakRating: 1510, rank: 1 },
      { userId: 'second', userName: 'Second', competitiveRating: 1400, rankedGames: 5, rankedWins: 4, rankedLosses: 1, rankedDraws: 0, rankedPeakRating: 1420, rank: 2 },
      { userId: 'third', userName: 'Third', competitiveRating: 1300, rankedGames: 2, rankedWins: 1, rankedLosses: 1, rankedDraws: 0, rankedPeakRating: 1300, rank: 3 },
    ],
  });

  assert.deepEqual(grants.map((grant) => grant.amountLamports), [600n, 600n, 600n]);
  assert.deepEqual(grants.map((grant) => grant.idempotencyKey), [
    'season_top_10:season:2:first',
    'season_top_10:season:2:second',
    'season_top_10:season:2:third',
  ]);
  assert.deepEqual(grants.map((grant) => grant.kind), ['season_top_10', 'season_top_10', 'season_top_10']);
  assert.equal(grants[0].metadata.rank, 1);
  assert.equal(grants[0].metadata.settledByUserId, 'admin-a');
}

console.log('player reward runtime tests passed');
