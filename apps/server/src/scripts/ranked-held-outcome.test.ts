import assert from 'node:assert/strict';
import {
  applyHeldRankedOutcome,
  cancelHeldRankedOutcome,
} from '../anticheat/service';

const endedAt = new Date('2026-06-12T10:20:00.000Z');

function applyUpdate(target: Record<string, any>, update: Record<string, any>): void {
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      target[key] = (target[key] ?? 0) + value.increment;
    } else {
      target[key] = value;
    }
  }
}

function createUser(id: string) {
  return {
    id,
    name: id,
    competitiveRating: 900,
    rankedGames: 2,
    rankedWins: 1,
    rankedLosses: 1,
    rankedDraws: 0,
    rankedPlacementsRemaining: 0,
    rankedPeakRating: 920,
    rankedLastMatchAt: null,
    totalExperience: 1_200,
  };
}

function createParticipant(input: {
  id: string;
  matchId: string;
  userId: string;
  team: 'red' | 'blue';
  outcome: 'win' | 'loss';
}) {
  return {
    id: input.id,
    matchId: input.matchId,
    userId: input.userId,
    team: input.team,
    outcome: input.outcome,
    score: input.outcome === 'win' ? 1_150 : 650,
    kills: input.outcome === 'win' ? 4 : 2,
    deaths: input.outcome === 'win' ? 1 : 4,
    assists: 2,
    flagCaptures: input.outcome === 'win' ? 1 : 0,
    flagReturns: 1,
    experienceGained: input.outcome === 'win' ? 710 : 360,
    leftAt: null,
    rankedEligible: true,
    ratingBefore: null,
    ratingAfter: null,
    ratingDelta: null,
    visibleRankBefore: null,
    visibleRankAfter: null,
    leaverPenaltyApplied: false,
  };
}

function selectFields(row: Record<string, any>, select: Record<string, boolean>): Record<string, any> {
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

function createFakePrisma() {
  const users = new Map<string, any>([
    ['red', createUser('red')],
    ['blue', createUser('blue')],
    ['cancel_red', createUser('cancel_red')],
    ['cancel_blue', createUser('cancel_blue')],
  ]);
  const matches = new Map<string, any>([
    ['held_match', {
      id: 'held_match',
      matchMode: 'ranked',
      rankedOutcomeStatus: 'held',
      rankedEligible: false,
      rankedSeasonMode: 'season',
      rankedSeasonNumber: 1,
      winningTeam: 'red',
      endedAt,
      antiCheatReviewRequired: true,
    }],
    ['held_cancel', {
      id: 'held_cancel',
      matchMode: 'ranked',
      rankedOutcomeStatus: 'held',
      rankedEligible: false,
      rankedSeasonMode: 'season',
      rankedSeasonNumber: 1,
      winningTeam: 'red',
      endedAt,
      antiCheatReviewRequired: true,
    }],
    ['already_applied', {
      id: 'already_applied',
      matchMode: 'ranked',
      rankedOutcomeStatus: 'applied',
      rankedEligible: true,
      rankedSeasonMode: 'season',
      rankedSeasonNumber: 1,
      winningTeam: 'red',
      endedAt,
      antiCheatReviewRequired: false,
    }],
  ]);
  const participants = [
    createParticipant({ id: 'p-red', matchId: 'held_match', userId: 'red', team: 'red', outcome: 'win' }),
    createParticipant({ id: 'p-blue', matchId: 'held_match', userId: 'blue', team: 'blue', outcome: 'loss' }),
    createParticipant({ id: 'p-cancel-red', matchId: 'held_cancel', userId: 'cancel_red', team: 'red', outcome: 'win' }),
    createParticipant({ id: 'p-cancel-blue', matchId: 'held_cancel', userId: 'cancel_blue', team: 'blue', outcome: 'loss' }),
  ];
  const rankedSeasonStats = new Map<string, any>();
  const actions: any[] = [];
  const integrityRows = new Map<string, any>([
    ['held_match', { matchId: 'held_match', rankedImpact: 'held', resolvedAt: null, resolvedByUserId: null, resolution: null }],
    ['held_cancel', { matchId: 'held_cancel', rankedImpact: 'held', resolvedAt: null, resolvedByUserId: null, resolution: null }],
  ]);
  const rankedSeasonSettings = {
    id: 'default',
    mode: 'season',
    seasonNumber: 2,
  };

  const tx = {
    gameMatchParticipant: {
      update: async ({ where, data }: any) => {
        const participant = participants.find((row) => row.id === where.id);
        assert.ok(participant);
        applyUpdate(participant, data);
        return participant;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const participant of participants) {
          if (participant.matchId !== where.matchId) continue;
          applyUpdate(participant, data);
          count += 1;
        }
        return { count };
      },
    },
    user: {
      update: async ({ where, data }: any) => {
        const user = users.get(where.id);
        assert.ok(user);
        applyUpdate(user, data);
        return user;
      },
    },
    rankedSeasonSettings: {
      upsert: async () => rankedSeasonSettings,
    },
    rankedSeasonUserStats: {
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.mode_seasonNumber_userId.mode}:${where.mode_seasonNumber_userId.seasonNumber}:${where.mode_seasonNumber_userId.userId}`;
        const existing = rankedSeasonStats.get(key);
        if (existing) {
          applyUpdate(existing, update);
          return existing;
        }
        const row = { id: key, ...create };
        rankedSeasonStats.set(key, row);
        return row;
      },
    },
    rankedFounderReward: {
      upsert: async () => ({ id: 'ranked_founder_golden' }),
      findUniqueOrThrow: async () => ({ maxClaims: 50 }),
      updateMany: async () => ({ count: 1 }),
    },
    userSkinOwnership: {
      findFirst: async () => ({ id: 'already-owned' }),
      upsert: async () => ({}),
    },
    gameMatch: {
      update: async ({ where, data }: any) => {
        const match = matches.get(where.id);
        assert.ok(match);
        applyUpdate(match, data);
        return match;
      },
    },
    antiCheatMatchIntegrity: {
      updateMany: async ({ where, data }: any) => {
        const row = integrityRows.get(where.matchId);
        if (!row) return { count: 0 };
        applyUpdate(row, data);
        return { count: 1 };
      },
    },
    antiCheatAction: {
      create: async ({ data }: any) => {
        actions.push(data);
        return data;
      },
    },
  };

  return {
    users,
    matches,
    participants,
    rankedSeasonStats,
    actions,
    integrityRows,
    prisma: {
      gameMatch: {
        findUnique: async ({ where, include, select }: any) => {
          const match = matches.get(where.id);
          if (!match) return null;
          if (include?.participants) {
            return {
              ...match,
              participants: participants.filter((participant) => participant.matchId === where.id),
            };
          }
          if (select) return selectFields(match, select);
          return match;
        },
      },
      user: {
        findMany: async ({ where, select }: any) => where.id.in
          .map((id: string) => users.get(id))
          .filter(Boolean)
          .map((user: any) => selectFields(user, select)),
      },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
}

async function run(): Promise<void> {
  const fake = createFakePrisma();
  const redExperienceBefore = fake.users.get('red').totalExperience;

  await applyHeldRankedOutcome(fake.prisma as any, {
    matchId: 'held_match',
    actorUserId: 'admin',
    reason: 'manual integrity release',
  });

  const heldMatch = fake.matches.get('held_match');
  assert.equal(heldMatch.rankedEligible, true);
  assert.equal(heldMatch.rankedOutcomeStatus, 'applied');
  assert.equal(heldMatch.rankedSeasonMode, 'season');
  assert.equal(heldMatch.rankedSeasonNumber, 1);
  assert.equal(fake.users.get('red').rankedGames, 3);
  assert.equal(fake.users.get('red').rankedWins, 2);
  assert.equal(fake.users.get('red').totalExperience, redExperienceBefore);
  assert.equal(fake.rankedSeasonStats.has('season:2:red'), false);

  const redSeason = fake.rankedSeasonStats.get('season:1:red');
  assert.ok(redSeason);
  assert.equal(redSeason.rankedGames, 1);
  assert.equal(redSeason.totalGames, 1);
  assert.equal(redSeason.totalExperience, 710);
  assert.equal(redSeason.rankedWins, 1);
  assert.equal(typeof fake.participants.find((participant) => participant.id === 'p-red')?.ratingDelta, 'number');
  assert.equal(fake.integrityRows.get('held_match').rankedImpact, 'none');
  assert.equal(fake.actions.at(-1).actionType, 'ranked_release');

  const cancelRedGamesBefore = fake.users.get('cancel_red').rankedGames;
  await cancelHeldRankedOutcome(fake.prisma as any, {
    matchId: 'held_cancel',
    actorUserId: 'admin',
    reason: 'manual integrity cancel',
  });

  const canceledMatch = fake.matches.get('held_cancel');
  assert.equal(canceledMatch.rankedEligible, false);
  assert.equal(canceledMatch.rankedOutcomeStatus, 'canceled');
  assert.equal(fake.users.get('cancel_red').rankedGames, cancelRedGamesBefore);
  assert.equal(fake.participants.find((participant) => participant.id === 'p-cancel-red')?.rankedEligible, false);
  assert.equal(fake.integrityRows.get('held_cancel').rankedImpact, 'none');
  assert.equal(fake.actions.at(-1).actionType, 'ranked_cancel');

  await assert.rejects(
    () => cancelHeldRankedOutcome(fake.prisma as any, {
      matchId: 'already_applied',
      actorUserId: 'admin',
      reason: 'should not cancel applied match',
    }),
    /Ranked outcome is not held/
  );
}

void run()
  .then(() => {
    console.log('ranked held outcome tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
