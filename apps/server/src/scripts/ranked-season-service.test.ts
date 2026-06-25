import assert from 'node:assert/strict';
import {
  DEFAULT_COMPETITIVE_RATING,
  RANK_PLACEMENT_MATCHES,
} from '@voxel-strike/shared';

function applyUpdate(target: Record<string, any>, update: Record<string, any>): void {
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      target[key] = (target[key] ?? 0) + value.increment;
    } else {
      target[key] = value;
    }
  }
}

function createFakePrisma() {
  const lastMatchAt = new Date('2026-06-10T10:20:00.000Z');
  const users = new Map<string, any>([
    ['user_ranked', {
      id: 'user_ranked',
      name: 'Ranked Player',
      competitiveRating: 1420,
      rankedGames: 12,
      rankedWins: 7,
      rankedLosses: 4,
      rankedDraws: 1,
      rankedPlacementsRemaining: 0,
      rankedPeakRating: 1510,
      rankedLastMatchAt: lastMatchAt,
    }],
  ]);
  const rankedSeasonStats = new Map<string, any>([
    ['season:1:user_ranked', {
      mode: 'season',
      seasonNumber: 1,
      userId: 'user_ranked',
      userName: 'Ranked Player',
      competitiveRating: 1420,
      rankedGames: 4,
      rankedWins: 3,
      rankedLosses: 1,
      rankedDraws: 0,
      rankedPlacementsRemaining: 0,
      rankedPeakRating: 1480,
      rankedLastMatchAt: lastMatchAt,
      archivedAt: null,
    }],
  ]);
  const rankedSeasonSettings = {
    id: 'default',
    mode: 'season',
    seasonNumber: 1,
    endsAt: null,
    lastResetAt: null,
    updatedByUserId: null,
    updatedAt: new Date('2026-06-10T10:00:00.000Z'),
  };

  const tx = {
    rankedSeasonSettings: {
      upsert: async () => rankedSeasonSettings,
      update: async ({ data }: any) => {
        applyUpdate(rankedSeasonSettings, data);
        rankedSeasonSettings.updatedAt = new Date('2026-06-10T11:00:00.000Z');
        return rankedSeasonSettings;
      },
    },
    rankedSeasonUserStats: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rankedSeasonStats.values()) {
          if (
            row.mode === where.mode
            && row.seasonNumber === where.seasonNumber
            && row.rankedGames > where.rankedGames.gt
          ) {
            applyUpdate(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    user: {
      updateMany: async ({ data }: any) => {
        for (const user of users.values()) {
          applyUpdate(user, data);
        }
        return { count: users.size };
      },
    },
  };

  return {
    users,
    rankedSeasonStats,
    prisma: {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
}

async function runRankedSeasonServiceTests() {
  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const { setRankedSeason } = await import('../ranking/seasonService');
  const result = await setRankedSeason({ mode: 'season', seasonNumber: 2 }, 'admin_user');

  assert.equal(result.resetRankedRating, true);
  assert.equal(result.season.mode, 'season');
  assert.equal(result.season.seasonNumber, 2);
  assert.equal(result.season.updatedByUserId, 'admin_user');
  assert.ok(result.season.lastResetAt);

  const user = fake.users.get('user_ranked');
  assert.equal(user.competitiveRating, DEFAULT_COMPETITIVE_RATING);
  assert.equal(user.rankedPlacementsRemaining, RANK_PLACEMENT_MATCHES);
  assert.equal(user.rankedPeakRating, DEFAULT_COMPETITIVE_RATING);
  assert.equal(user.rankedGames, 12);
  assert.equal(user.rankedWins, 7);
  assert.equal(user.rankedLosses, 4);
  assert.equal(user.rankedDraws, 1);
  assert.equal(user.rankedLastMatchAt.toISOString(), '2026-06-10T10:20:00.000Z');

  const archivedSeason = fake.rankedSeasonStats.get('season:1:user_ranked');
  assert.equal(archivedSeason.rankedGames, 4);
  assert.equal(archivedSeason.rankedWins, 3);
  assert.equal(archivedSeason.rankedLosses, 1);
  assert.ok(archivedSeason.archivedAt instanceof Date);
}

runRankedSeasonServiceTests()
  .then(() => {
    console.log('ranked season service tests passed');
  });
