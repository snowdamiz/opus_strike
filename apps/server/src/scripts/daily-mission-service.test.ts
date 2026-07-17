import assert from 'node:assert/strict';
import {
  DEFAULT_DAILY_MISSION_ELIGIBILITY,
  type DailyMissionCriteria,
  type DailyMissionRewardBundle,
} from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import type { MatchKillEventSnapshot, MatchParticipantSnapshot } from '../persistence/matchPersistence';
import {
  MissionValidationError,
  parseMissionDefinitionPayload,
} from '../missions/validation';

type MissionRow = {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  activeStartsAt: Date | null;
  activeEndsAt: Date | null;
  resetPolicy: string;
  criteria: DailyMissionCriteria;
  rewards: DailyMissionRewardBundle;
  eligibility: typeof DEFAULT_DAILY_MISSION_ELIGIBILITY;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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
    kills: 2,
    deaths: 0,
    assists: 1,
    flagCaptures: 0,
    flagReturns: 0,
    joinedAt: new Date('2026-06-30T10:00:00.000Z'),
    leftAt: null,
    ...input,
  };
}

function killEvent(input: Partial<MatchKillEventSnapshot> = {}): MatchKillEventSnapshot {
  return {
    killerUserId: 'user-red',
    killerPlayerSessionId: 'session-red',
    victimUserId: 'user-blue',
    victimPlayerSessionId: 'session-blue',
    killerHeroId: 'phantom',
    victimHeroId: 'blaze',
    abilityId: 'blaze_rocket',
    damageType: 'ability',
    victimHadFlag: true,
    occurredAt: new Date('2026-06-30T10:05:00.000Z'),
    ...input,
  };
}

function expectValidationError(operation: () => unknown, message: RegExp): void {
  assert.throws(() => {
    try {
      operation();
    } catch (error) {
      assert.ok(error instanceof MissionValidationError);
      throw error;
    }
  }, message);
}

function missionPayload(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Carry the Day',
    description: 'Complete a compact objective bundle.',
    enabled: true,
    sortOrder: 5,
    activeStartsAt: null,
    activeEndsAt: null,
    resetPolicy: 'utc',
    criteria: {
      mode: 'all',
      items: [
        { id: 'matches', type: 'matches_completed', target: 1 },
        { id: 'vs_blaze', type: 'eliminations_against_hero', heroId: 'blaze', target: 1 },
        { id: 'rocket', type: 'eliminations_with_ability', abilityId: 'blaze_rocket', target: 1 },
      ],
    },
    rewards: {
      items: [
        { type: 'sol', amountLamports: '50000' },
        { type: 'game_token', amountBaseUnits: '1000', symbol: '$slop' },
        { type: 'skin', skinId: 'phantom.void-monarch' },
      ],
    },
    eligibility: DEFAULT_DAILY_MISSION_ELIGIBILITY,
    ...overrides,
  };
}

function runValidationTests(): void {
  const parsed = parseMissionDefinitionPayload(missionPayload());
  assert.equal(parsed.displayName, 'Carry the Day');
  assert.equal(parsed.resetPolicy, 'utc');
  assert.equal(parsed.rewards.items[1].type, 'game_token');
  if (parsed.rewards.items[1].type === 'game_token') {
    assert.equal(parsed.rewards.items[1].symbol, 'SLOP');
    assert.equal(parsed.rewards.items[1].pricingMode, 'fixed_token');
    assert.equal(parsed.rewards.items[1].playerShareBps, 10000);
    assert.equal(parsed.rewards.items[1].burnShareBps, 0);
  }

  const usdTokenParsed = parseMissionDefinitionPayload(missionPayload({
    rewards: {
      items: [
        {
          type: 'game_token',
          pricingMode: 'usd',
          usdCents: 250,
          playerShareBps: 7500,
          burnShareBps: 2500,
          symbol: 'slop',
        },
      ],
    },
  }));
  assert.equal(usdTokenParsed.rewards.items[0].type, 'game_token');
  if (usdTokenParsed.rewards.items[0].type === 'game_token') {
    assert.equal(usdTokenParsed.rewards.items[0].pricingMode, 'usd');
    assert.equal(usdTokenParsed.rewards.items[0].usdCents, 250);
    assert.equal(usdTokenParsed.rewards.items[0].playerShareBps, 7500);
    assert.equal(usdTokenParsed.rewards.items[0].burnShareBps, 2500);
  }

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      criteria: {
        mode: 'all',
        items: [
          { id: 'dup', type: 'matches_completed', target: 1 },
          { id: 'dup', type: 'wins', target: 1 },
        ],
      },
    })),
    /Duplicate criterion id/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      rewards: {
        items: [
          { type: 'sol', amountLamports: '100' },
          { type: 'sol', amountLamports: '200' },
        ],
      },
    })),
    /Only one sol reward/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      rewards: { items: [{ type: 'skin', skinId: 'phantom.missing' }] },
    })),
    /skin id is invalid/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      rewards: {
        items: [
          { type: 'game_token', pricingMode: 'usd', usdCents: 100, playerShareBps: 6000, burnShareBps: 3000 },
        ],
      },
    })),
    /player and burn shares/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      activeStartsAt: '2026-06-30T10:00:00.000Z',
      activeEndsAt: '2026-06-30T09:00:00.000Z',
    })),
    /Active end must be after active start/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      criteria: {
        mode: 'all',
        items: [{ id: 'flags', type: 'flag_captures', target: 1 }],
      },
    })),
    /Criterion type is invalid/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      eligibility: {
        ...DEFAULT_DAILY_MISSION_ELIGIBILITY,
        matchModes: ['custom'],
      },
    })),
    /quick play and ranked BR/
  );

  expectValidationError(
    () => parseMissionDefinitionPayload(missionPayload({
      eligibility: {
        ...DEFAULT_DAILY_MISSION_ELIGIBILITY,
        gameplayModes: ['battle_royal', 'team_deathmatch'],
      },
    })),
    /only target Battle Royale/
  );

  assert.deepEqual(parsed.eligibility.gameplayModes, ['battle_royal']);
}

function createMissionRow(): MissionRow {
  const parsed = parseMissionDefinitionPayload(missionPayload({
    criteria: {
      mode: 'all',
      items: [
        { id: 'matches', type: 'matches_completed', target: 1 },
        { id: 'wins', type: 'wins', target: 1 },
        { id: 'elims', type: 'eliminations', target: 2 },
        { id: 'vs_blaze', type: 'eliminations_against_hero', heroId: 'blaze', target: 1 },
        { id: 'rocket', type: 'eliminations_with_ability', abilityId: 'blaze_rocket', target: 1 },
      ],
    },
  }));

  return {
    id: 'mission-a',
    displayName: parsed.displayName,
    description: parsed.description,
    enabled: parsed.enabled,
    sortOrder: parsed.sortOrder,
    activeStartsAt: parsed.activeStartsAt,
    activeEndsAt: parsed.activeEndsAt,
    resetPolicy: parsed.resetPolicy,
    criteria: parsed.criteria,
    rewards: parsed.rewards,
    eligibility: parsed.eligibility,
    createdByUserId: 'admin-a',
    updatedByUserId: 'admin-a',
    archivedAt: null,
    createdAt: new Date('2026-06-30T09:00:00.000Z'),
    updatedAt: new Date('2026-06-30T09:00:00.000Z'),
  };
}

function createUniqueError(): Error & { code: string } {
  const error = new Error('Unique constraint') as Error & { code: string };
  error.code = 'P2002';
  return error;
}

function createFakePrisma() {
  const mission = createMissionRow();
  const missions = [mission];
  const progressRows = new Map<string, any>();
  const contributions = new Set<string>();
  const grants = new Map<string, any>();
  const playerRewards = new Map<string, any>();
  const tokenPayouts = new Map<string, any>();
  const skinOwnerships = new Map<string, any>();
  const users = new Map<string, any>([
    ['user-red', { id: 'user-red', walletAddress: 'Wallet11111111111111111111111111111111111111' }],
  ]);

  const progressKey = (userId: string, missionId: string, dayKey: string) => `${userId}:${missionId}:${dayKey}`;
  const matchMissionIdFilter = (missionId: string, filter: any) => {
    if (!filter) return true;
    if (typeof filter === 'string') return missionId === filter;
    if (Array.isArray(filter.in)) return filter.in.includes(missionId);
    return true;
  };
  const matchProgressWhere = (row: any, where: any) => (
    (!where?.userId || row.userId === where.userId)
    && (!where?.missionId || matchMissionIdFilter(row.missionId, where.missionId))
    && (!where?.dayKey || row.dayKey === where.dayKey)
    && (!where?.completedAt || (where.completedAt.not === null ? row.completedAt !== null : true))
  );
  const sortProgressRows = (rows: any[], orderBy: any) => {
    const orderItems = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return rows.sort((left, right) => {
      for (const item of orderItems) {
        const [field, direction] = Object.entries(item)[0] ?? [];
        if (!field) continue;
        const leftValue = left[field] instanceof Date ? left[field].getTime() : left[field] ?? 0;
        const rightValue = right[field] instanceof Date ? right[field].getTime() : right[field] ?? 0;
        if (leftValue === rightValue) continue;
        return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }
      return 0;
    });
  };

  const tx = {
    userDailyMissionProgress: {
      findUnique: async ({ where }: any) => {
        const key = progressKey(
          where.userId_missionId_dayKey.userId,
          where.userId_missionId_dayKey.missionId,
          where.userId_missionId_dayKey.dayKey
        );
        return progressRows.get(key) ?? null;
      },
      findFirst: async ({ where, orderBy }: any) => {
        const rows = Array.from(progressRows.values()).filter((row) => matchProgressWhere(row, where));
        return sortProgressRows(rows, orderBy)[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row = {
          id: `progress-${progressRows.size + 1}`,
          completedAt: null,
          grantedAt: null,
          lastContributingMatchId: null,
          createdAt: new Date('2026-06-30T10:00:00.000Z'),
          updatedAt: new Date('2026-06-30T10:00:00.000Z'),
          ...data,
        };
        progressRows.set(progressKey(row.userId, row.missionId, row.dayKey), row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = Array.from(progressRows.values()).find((candidate) => candidate.id === where.id);
        assert.ok(row);
        Object.assign(row, data, { updatedAt: new Date('2026-06-30T10:10:00.000Z') });
        return row;
      },
    },
    userDailyMissionContribution: {
      create: async ({ data }: any) => {
        const key = `${data.userId}:${data.missionId}:${data.dayKey}:${data.matchId}`;
        if (contributions.has(key)) throw createUniqueError();
        contributions.add(key);
        return { id: `contribution-${contributions.size}`, createdAt: new Date(), ...data };
      },
    },
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
    },
    missionRewardGrant: {
      findUnique: async ({ where }: any) => grants.get(where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = {
          id: `grant-${grants.size + 1}`,
          status: 'pending',
          playerRewardId: null,
          tokenPayoutId: null,
          skinId: null,
          lastError: null,
          grantedAt: null,
          createdAt: new Date('2026-06-30T10:10:00.000Z'),
          updatedAt: new Date('2026-06-30T10:10:00.000Z'),
          ...data,
        };
        grants.set(row.idempotencyKey, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = Array.from(grants.values()).find((candidate) => candidate.id === where.id);
        assert.ok(row);
        Object.assign(row, data, { updatedAt: new Date('2026-06-30T10:11:00.000Z') });
        return row;
      },
    },
    playerReward: {
      findUnique: async ({ where }: any) => playerRewards.get(where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = {
          id: `player-reward-${playerRewards.size + 1}`,
          status: 'pending',
          createdAt: new Date('2026-06-30T10:10:00.000Z'),
          updatedAt: new Date('2026-06-30T10:10:00.000Z'),
          paidAt: null,
          ...data,
        };
        playerRewards.set(row.idempotencyKey, row);
        return { id: row.id };
      },
    },
    gameTokenPayout: {
      create: async ({ data }: any) => {
        const row = {
          id: `token-payout-${tokenPayouts.size + 1}`,
          status: 'pending',
          createdAt: new Date('2026-06-30T10:10:00.000Z'),
          updatedAt: new Date('2026-06-30T10:10:00.000Z'),
          grantedAt: null,
          recipientAmountBaseUnits: null,
          burnAmountBaseUnits: null,
          playerShareBps: 10000,
          burnShareBps: 0,
          rewardUsdCents: null,
          rewardSolLamports: null,
          solUsdPriceMicroUsd: null,
          priceSource: null,
          priceObservedAt: null,
          tokenProgramId: null,
          conversionSignature: null,
          convertedTokenBaseUnits: null,
          burnSignature: null,
          lastError: null,
          ...data,
        };
        tokenPayouts.set(row.id, row);
        return row;
      },
    },
    userSkinOwnership: {
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.userId_skinId.userId}:${where.userId_skinId.skinId}`;
        const existing = skinOwnerships.get(key);
        const row = existing ? { ...existing, ...update } : { grantedAt: new Date(), revokedAt: null, ...create };
        skinOwnerships.set(key, row);
        return row;
      },
    },
  };

  return {
    mission,
    missions,
    progressRows,
    contributions,
    grants,
    playerRewards,
    tokenPayouts,
    skinOwnerships,
    prisma: {
      dailyMissionDefinition: {
        findMany: async () => missions,
      },
      userDailyMissionProgress: {
        findMany: async ({ where }: any) => (
          Array.from(progressRows.values()).filter((row) => matchProgressWhere(row, where))
        ),
      },
      missionRewardGrant: {
        findMany: async ({ where }: any) => (
          Array.from(grants.values())
            .filter((row) => (
              (!where?.userId || row.userId === where.userId)
              && (!where?.missionId || matchMissionIdFilter(row.missionId, where.missionId))
              && (!where?.dayKey || row.dayKey === where.dayKey)
            ))
            .map((row) => ({
              ...row,
              playerReward: Array.from(playerRewards.values()).find((reward) => reward.id === row.playerRewardId) ?? null,
              tokenPayout: null,
            }))
        ),
      },
      gameTokenPayout: {
        findMany: async () => [],
      },
      $transaction: async (operation: any) => {
        if (Array.isArray(operation)) return Promise.all(operation);
        return operation(tx);
      },
    },
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function runSettlementTests(): Promise<void> {
  const previousEnv = {
    GAME_TOKEN_MINT: process.env.GAME_TOKEN_MINT,
    GAME_TOKEN_SYMBOL: process.env.GAME_TOKEN_SYMBOL,
    SKIN_SHOP_TOKEN_MINT: process.env.SKIN_SHOP_TOKEN_MINT,
    SKIN_SHOP_TOKEN_SYMBOL: process.env.SKIN_SHOP_TOKEN_SYMBOL,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    RANKED_TOKEN_HOLD_RPC_URL: process.env.RANKED_TOKEN_HOLD_RPC_URL,
  };
  delete process.env.GAME_TOKEN_MINT;
  delete process.env.GAME_TOKEN_SYMBOL;
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RANKED_TOKEN_HOLD_RPC_URL;

  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const missionServiceModule = await import('../missions/service');
  assert.equal(missionServiceModule.decideGameTokenPayoutSignature({
    status: { err: null, confirmationStatus: 'confirmed', confirmations: 1 },
    lastValidBlockHeight: 100n,
    currentBlockHeight: null,
  }), 'granted');
  assert.equal(missionServiceModule.decideGameTokenPayoutSignature({
    status: null,
    lastValidBlockHeight: 100n,
    currentBlockHeight: 101n,
  }), 'expired');
  assert.equal(missionServiceModule.decideGameTokenPayoutSignature({
    status: null,
    lastValidBlockHeight: 100n,
    currentBlockHeight: 100n,
  }), 'pending');
  assert.equal(missionServiceModule.decideGameTokenPayoutSignature({
    status: { err: { InstructionError: [0, 'Custom'] } },
    lastValidBlockHeight: 100n,
    currentBlockHeight: null,
  }), 'failed');
  const rewardsModule = await import('../rewards/service');
  delete process.env.GAME_TOKEN_MINT;
  delete process.env.GAME_TOKEN_SYMBOL;
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RANKED_TOKEN_HOLD_RPC_URL;
  const originalPayPendingRewards = rewardsModule.playerRewardService.payPendingRewards.bind(rewardsModule.playerRewardService);
  const payCalls: unknown[] = [];
  (rewardsModule.playerRewardService as any).payPendingRewards = async (input: unknown) => {
    payCalls.push(input);
    return { payoutCount: 0, rewardCount: 0, totalLamports: '0' };
  };

  try {
    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'ctf-match',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'capture_the_flag',
      startedAt: new Date('2026-06-30T10:00:00.000Z'),
      endedAt: new Date('2026-06-30T10:10:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    assert.equal(fake.progressRows.size, 0);
    assert.equal(fake.contributions.size, 0);

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-a',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-06-30T10:00:00.000Z'),
      endedAt: new Date('2026-06-30T10:10:00.000Z'),
      winningTeam: 'red',
      participants: [
        participant(),
        participant({ userId: 'user-left', playerSessionId: 'session-left', leftAt: new Date('2026-06-30T10:04:00.000Z') }),
      ],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    const progress = Array.from(fake.progressRows.values())[0];
    assert.ok(progress);
    assert.deepEqual(progress.progress, {
      matches: 1,
      wins: 1,
      elims: 2,
      vs_blaze: 1,
      rocket: 1,
    });
    assert.equal(progress.dayKey, 'lifetime');
    assert.ok(progress.completedAt instanceof Date);
    assert.ok(progress.grantedAt instanceof Date);
    assert.equal(fake.contributions.size, 1);
    assert.equal(fake.playerRewards.size, 1);
    assert.equal(fake.playerRewards.values().next().value.kind, 'daily_mission');
    assert.equal(fake.playerRewards.values().next().value.amountLamports, 50000n);
    assert.equal(fake.skinOwnerships.get('user-red:phantom.void-monarch').source, 'event');

    const grants = Array.from(fake.grants.values());
    assert.equal(grants.length, 3);
    assert.ok(grants.some((grant) => (
      grant.rewardType === 'sol'
      && grant.playerRewardId === 'player-reward-1'
      && grant.idempotencyKey === 'mission:lifetime:mission-a:user-red:sol'
    )));
    assert.ok(grants.some((grant) => (
      grant.rewardType === 'skin'
      && grant.status === 'granted'
      && grant.skinId === 'phantom.void-monarch'
    )));
    assert.ok(grants.some((grant) => (
      grant.rewardType === 'game_token'
      && grant.status === 'failed'
      && grant.lastError === 'Game token payout configuration is incomplete'
    )));
    assert.deepEqual(payCalls, [{
      idempotencyKeys: ['mission:lifetime:mission-a:user-red:sol'],
      limit: 1,
    }]);

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-a',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-06-30T10:00:00.000Z'),
      endedAt: new Date('2026-06-30T10:10:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    assert.equal(fake.contributions.size, 1);
    assert.equal(fake.grants.size, 3);
    assert.equal(fake.playerRewards.size, 1);
    assert.equal(payCalls.length, 1);

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-next-day',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-07-01T10:00:00.000Z'),
      endedAt: new Date('2026-07-01T10:10:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    assert.equal(fake.contributions.size, 1);
    assert.equal(fake.grants.size, 3);
    assert.equal(fake.playerRewards.size, 1);
    assert.equal(payCalls.length, 1);

    const nextDayMissions = await missionServiceModule.dailyMissionService.getPlayerDailyMissions(
      'user-red',
      new Date('2026-07-01T12:00:00.000Z')
    );
    assert.equal(nextDayMissions.missions.length, 1);
    assert.equal(nextDayMissions.missions[0].mission.id, 'mission-a');
    assert.equal(nextDayMissions.missions[0].progress?.dayKey, 'lifetime');
    assert.ok(nextDayMissions.missions[0].progress?.completedAt);
    assert.equal(nextDayMissions.missions[0].percentComplete, 100);

    fake.missions.push({
      ...fake.mission,
      id: 'mission-b',
      displayName: 'Second Mission',
      createdAt: new Date('2026-07-01T12:05:00.000Z'),
      updatedAt: new Date('2026-07-01T12:05:00.000Z'),
    });
    const afterAdminAddsMission = await missionServiceModule.dailyMissionService.getPlayerDailyMissions(
      'user-red',
      new Date('2026-07-01T12:10:00.000Z')
    );
    assert.equal(afterAdminAddsMission.missions.length, 2);
    assert.ok(afterAdminAddsMission.missions.find((item) => item.mission.id === 'mission-a')?.progress?.completedAt);
    assert.equal(afterAdminAddsMission.missions.find((item) => item.mission.id === 'mission-b')?.progress, null);

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-new-mission',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-07-01T12:15:00.000Z'),
      endedAt: new Date('2026-07-01T12:25:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    assert.equal(fake.progressRows.size, 2);
    assert.equal(fake.playerRewards.size, 2);
    assert.equal(payCalls.length, 2);
    assert.deepEqual(payCalls[1], {
      idempotencyKeys: ['mission:lifetime:mission-b:user-red:sol'],
      limit: 1,
    });

    fake.missions.push({
      ...fake.mission,
      id: 'mission-c',
      displayName: 'Legacy Completed Mission',
      createdAt: new Date('2026-07-01T12:30:00.000Z'),
      updatedAt: new Date('2026-07-01T12:30:00.000Z'),
    });
    fake.progressRows.set('user-red:mission-c:2026-06-29', {
      id: 'legacy-progress',
      userId: 'user-red',
      missionId: 'mission-c',
      dayKey: '2026-06-29',
      progress: {
        matches: 1,
        wins: 1,
        elims: 2,
        vs_blaze: 1,
        rocket: 1,
      },
      completedAt: new Date('2026-06-29T10:10:00.000Z'),
      grantedAt: new Date('2026-06-29T10:10:00.000Z'),
      lastContributingMatchId: 'legacy-match',
      createdAt: new Date('2026-06-29T10:10:00.000Z'),
      updatedAt: new Date('2026-06-29T10:10:00.000Z'),
    });

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-legacy-completed',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-07-01T12:35:00.000Z'),
      endedAt: new Date('2026-07-01T12:45:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    assert.equal(fake.playerRewards.size, 2);
    assert.equal(payCalls.length, 2);

    const afterLegacyMission = await missionServiceModule.dailyMissionService.getPlayerDailyMissions(
      'user-red',
      new Date('2026-07-01T12:50:00.000Z')
    );
    const legacyMission = afterLegacyMission.missions.find((item) => item.mission.id === 'mission-c');
    assert.equal(legacyMission?.progress?.dayKey, '2026-06-29');
    assert.ok(legacyMission?.progress?.completedAt);

    process.env.GAME_TOKEN_MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    process.env.GAME_TOKEN_SYMBOL = 'SLOP';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    fake.missions.push({
      ...fake.mission,
      id: 'mission-d',
      displayName: 'Configured Token Mission',
      createdAt: new Date('2026-07-01T13:00:00.000Z'),
      updatedAt: new Date('2026-07-01T13:00:00.000Z'),
    });

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-configured-token',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-07-01T13:05:00.000Z'),
      endedAt: new Date('2026-07-01T13:15:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    const tokenPayout = Array.from(fake.tokenPayouts.values()).find((payout) => (
      payout.idempotencyKey === 'mission:lifetime:mission-d:user-red:game_token'
    ));
    assert.ok(tokenPayout);
    assert.equal(tokenPayout.tokenMintAddress, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    assert.equal(tokenPayout.tokenSymbol, 'SLOP');
    assert.equal(tokenPayout.tokenAmountBaseUnits, 1000n);
    assert.equal(tokenPayout.recipientAmountBaseUnits, 1000n);
    assert.equal(tokenPayout.burnAmountBaseUnits, 0n);
    assert.equal(tokenPayout.playerShareBps, 10000);
    assert.equal(tokenPayout.burnShareBps, 0);
    assert.ok(Array.from(fake.grants.values()).some((grant) => (
      grant.rewardType === 'game_token'
      && grant.missionId === 'mission-d'
      && grant.status === 'pending'
      && grant.tokenPayoutId === tokenPayout.id
    )));
    assert.deepEqual(payCalls[2], {
      idempotencyKeys: ['mission:lifetime:mission-d:user-red:sol'],
      limit: 1,
    });

    const usdTokenMission = parseMissionDefinitionPayload(missionPayload({
      rewards: {
        items: [
          {
            type: 'game_token',
            pricingMode: 'usd',
            usdCents: 375,
            playerShareBps: 8000,
            burnShareBps: 2000,
            symbol: 'SLOP',
          },
        ],
      },
    }));
    fake.missions.push({
      ...fake.mission,
      id: 'mission-e',
      displayName: 'USD Token Mission',
      rewards: usdTokenMission.rewards,
      createdAt: new Date('2026-07-01T13:20:00.000Z'),
      updatedAt: new Date('2026-07-01T13:20:00.000Z'),
    });

    await missionServiceModule.dailyMissionService.settleMatchMissions({
      matchId: 'match-usd-token',
      roomId: 'room-a',
      lobbyId: 'lobby-a',
      matchMode: 'ranked',
      gameplayMode: 'battle_royal',
      startedAt: new Date('2026-07-01T13:25:00.000Z'),
      endedAt: new Date('2026-07-01T13:35:00.000Z'),
      winningTeam: 'red',
      participants: [participant()],
      killEvents: [killEvent()],
      rankedEligible: true,
      integrityGate: gate(),
    });

    const usdTokenPayout = Array.from(fake.tokenPayouts.values()).find((payout) => (
      payout.idempotencyKey === 'mission:lifetime:mission-e:user-red:game_token'
    ));
    assert.ok(usdTokenPayout);
    assert.equal(usdTokenPayout.tokenAmountBaseUnits, 0n);
    assert.equal(usdTokenPayout.recipientAmountBaseUnits, null);
    assert.equal(usdTokenPayout.burnAmountBaseUnits, null);
    assert.equal(usdTokenPayout.rewardUsdCents, 375);
    assert.equal(usdTokenPayout.playerShareBps, 8000);
    assert.equal(usdTokenPayout.burnShareBps, 2000);
  } finally {
    (rewardsModule.playerRewardService as any).payPendingRewards = originalPayPendingRewards;
    restoreEnv(previousEnv);
  }
}

runValidationTests();
runSettlementTests()
  .then(() => {
    console.log('daily mission service tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
