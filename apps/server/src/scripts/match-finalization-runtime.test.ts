import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { MatchMode, Team, VoxelMapTheme } from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import type { MatchParticipantSnapshot, PersistCompletedMatchResult } from '../persistence/matchPersistence';
import {
  MatchFinalizationRuntime,
  buildMatchFinalizationOutcomes,
  type MatchFinalizationRuntimeDeps,
} from '../rooms/matchFinalizationRuntime';
import type { MatchPersistenceLedger } from '../rooms/matchLedgerRuntime';
import type { LockedWagerContext } from '../wagers/service';

function gate(input: Partial<AntiCheatIntegrityGate> = {}): AntiCheatIntegrityGate {
  return {
    status: 'clean',
    reviewRequired: false,
    rankedHoldRequired: false,
    payoutHoldRequired: false,
    observedOnly: false,
    reason: null,
    affectedUserIds: [],
    affectedTeams: [],
    score: 0,
    caseId: null,
    ...input,
  };
}

function ledger(input: Partial<MatchPersistenceLedger> = {}): MatchPersistenceLedger {
  return {
    matchId: 'match-a',
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    matchMode: 'ranked',
    mapSeed: 123,
    mapThemeId: 'forest' as VoxelMapTheme['id'],
    rankedEligible: true,
    startedAt: new Date('2026-06-10T10:00:00.000Z'),
    endedAt: null,
    redScore: null,
    blueScore: null,
    winningTeam: null,
    state: 'active',
    participants: new Map(),
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
    kills: 1,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
    joinedAt: new Date('2026-06-10T10:00:00.000Z'),
    leftAt: null,
    ...input,
  };
}

function wagerContext(input: Partial<LockedWagerContext> = {}): LockedWagerContext {
  return {
    wageredLobbyId: 'wager-a',
    lobbyId: 'lobby-a',
    token: 'SOL',
    coverChargeLamports: '1000',
    treasuryWallet: 'treasury',
    platformFeeBps: 500,
    matchMode: 'custom_wager',
    paidPlayers: [],
    ...input,
  };
}

function createRuntime(options: {
  persistError?: Error;
  attachError?: Error;
  payoutHoldId?: string | null;
} = {}) {
  const calls = {
    persisted: [] as unknown[],
    integrity: [] as unknown[],
    actions: [] as unknown[],
    payoutHolds: [] as unknown[],
    wagerSettlements: [] as unknown[],
    attached: [] as unknown[],
    goldenRewards: [] as unknown[],
    logs: [] as Array<{ level: string; message: string; detail?: Record<string, unknown> }>,
  };
  const deps: MatchFinalizationRuntimeDeps = {
    prisma: {} as PrismaClient,
    persistCompletedMatch: async (_prisma, input): Promise<PersistCompletedMatchResult> => {
      calls.persisted.push(input);
      if (options.persistError) throw options.persistError;
      return {
        matchId: input.matchId,
        alreadyPersisted: false,
        participantCount: input.participants.length,
        skippedUserIds: ['skipped-user'],
      };
    },
    evidenceStore: {
      upsertMatchIntegrity: async (input) => {
        calls.integrity.push(input);
      },
      recordAction: async (input) => {
        calls.actions.push(input);
      },
      createPayoutHold: async (input) => {
        calls.payoutHolds.push(input);
        return options.payoutHoldId ?? 'hold-a';
      },
    },
    wagerService: {
      attachMatchId: async (wageredLobbyId, matchId) => {
        calls.attached.push({ wageredLobbyId, matchId });
        if (options.attachError) throw options.attachError;
      },
      settleWageredLobby: async (input) => {
        calls.wagerSettlements.push(input);
        return {
          settlementId: 'settlement-a',
          wageredLobbyId: input.wageredLobbyId,
          status: 'pending',
          totalPotLamports: '1000',
          developerFeeLamports: '50',
          winnerPoolLamports: '950',
          winningTeam: input.winningTeam,
        };
      },
      settleGoldenBiomeReward: async (input) => {
        calls.goldenRewards.push(input);
        return {
          rewardId: 'reward-a',
          matchId: input.matchId,
          status: 'pending',
          distributionMode: 'manual',
          winningTeam: input.winningTeam,
          rewardUsdCents: 500,
          rewardLamports: '100',
          totalRewardLamports: String(100 * input.winners.length),
          paidPlayerCount: input.winners.length,
        };
      },
    },
    log: {
      info: (message, detail) => calls.logs.push({ level: 'info', message, detail }),
      warn: (message, detail) => calls.logs.push({ level: 'warn', message, detail }),
      error: (message, detail) => calls.logs.push({ level: 'error', message, detail }),
    },
    serializeError: (error) => ({
      message: error instanceof Error ? error.message : String(error),
    }),
  };

  return {
    runtime: new MatchFinalizationRuntime(deps),
    calls,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(): Promise<void> {
{
  assert.deepEqual(buildMatchFinalizationOutcomes({
    matchMode: 'ranked',
    rankedEligible: true,
    wagered: true,
    integrityGate: gate({ rankedHoldRequired: true, payoutHoldRequired: true, reviewRequired: true }),
  }), {
    rankedOutcomeStatus: 'held',
    rankedImpact: 'held',
    wagerImpact: 'held',
  });

  assert.deepEqual(buildMatchFinalizationOutcomes({
    matchMode: 'ranked',
    rankedEligible: false,
    wagered: false,
    integrityGate: gate(),
  }), {
    rankedOutcomeStatus: 'canceled',
    rankedImpact: 'none',
    wagerImpact: 'none',
  });

  assert.deepEqual(buildMatchFinalizationOutcomes({
    matchMode: 'custom_wager',
    rankedEligible: false,
    wagered: true,
    integrityGate: gate({ reviewRequired: true }),
  }), {
    rankedOutcomeStatus: 'not_applicable',
    rankedImpact: 'none',
    wagerImpact: 'reported',
  });
}

{
  const { runtime, calls } = createRuntime();
  const currentLedger = ledger();
  const participants = [participant(), participant({ userId: 'user-blue', playerSessionId: 'session-blue', team: 'blue' })];
  const persisted = await runtime.persistLedger({
    ledger: currentLedger,
    finalScore: { red: 3, blue: 2 },
    winningTeam: 'red',
    participants,
    rankedEligible: true,
    integrityGate: gate({ reviewRequired: true, observedOnly: true, reason: 'watching', score: 12 }),
    wagered: true,
    endedAt: new Date('2026-06-10T10:15:00.000Z'),
  });

  assert.equal(persisted, true);
  assert.equal(currentLedger.state, 'persisted');
  assert.equal(currentLedger.redScore, 3);
  assert.equal(currentLedger.winningTeam, 'red');
  assert.equal(calls.persisted.length, 1);
  assert.equal((calls.persisted[0] as { rankedOutcomeStatus: string }).rankedOutcomeStatus, 'applied');
  assert.equal(calls.integrity.length, 1);
  assert.equal(calls.actions.length, 1);
  assert.equal((calls.actions[0] as { observedOnly: boolean }).observedOnly, true);
  assert.ok(calls.logs.some((entry) => entry.message === 'Match persistence completed'));
}

{
  const { runtime, calls } = createRuntime({ persistError: new Error('db down') });
  const currentLedger = ledger();
  const persisted = await runtime.persistLedger({
    ledger: currentLedger,
    finalScore: { red: 0, blue: 1 },
    winningTeam: 'blue',
    participants: [participant()],
    rankedEligible: false,
    integrityGate: gate(),
    wagered: false,
  });

  assert.equal(persisted, true);
  assert.equal(currentLedger.state, 'failed');
  assert.ok(calls.logs.some((entry) => entry.level === 'error' && entry.message === 'Match persistence failed'));
}

{
  const { runtime, calls } = createRuntime();
  const requested = runtime.settleWagerAfterGame({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    wagerContext: wagerContext(),
    matchId: 'match-a',
    winningTeam: 'red',
    integrityGate: gate({ payoutHoldRequired: true, reviewRequired: true, reason: 'hold' }),
  });
  await flushAsync();

  assert.equal(requested, true);
  assert.equal(calls.payoutHolds.length, 1);
  assert.equal(calls.wagerSettlements.length, 0);
  assert.ok(calls.logs.some((entry) => entry.message === 'Wager settlement paused for anti-cheat review'));
}

{
  const { runtime, calls } = createRuntime();
  const requested = runtime.settleWagerAfterGame({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    wagerContext: wagerContext(),
    matchId: 'match-a',
    winningTeam: 'blue',
    integrityGate: gate({ reviewRequired: true, observedOnly: true, score: 3 }),
  });
  await flushAsync();

  assert.equal(requested, true);
  assert.equal(calls.actions.length, 1);
  assert.equal((calls.actions[0] as { type: string }).type, 'payout_hold');
  assert.equal(calls.wagerSettlements.length, 1);
}

{
  const { runtime, calls } = createRuntime();
  assert.equal(runtime.settleWagerNoContest({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    wagerContext: wagerContext(),
    settlementAlreadyRequested: false,
    matchId: 'match-a',
    reason: 'room_dispose',
  }), true);
  assert.equal(runtime.settleWagerNoContest({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    wagerContext: wagerContext(),
    settlementAlreadyRequested: true,
    matchId: 'match-a',
    reason: 'room_dispose',
  }), false);
  await flushAsync();

  assert.equal(calls.wagerSettlements.length, 1);
  assert.equal((calls.wagerSettlements[0] as { winningTeam: Team | null }).winningTeam, null);
}

{
  const { runtime, calls } = createRuntime();
  const settled = runtime.settleGoldenBiomeReward({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    ledger: ledger({ mapThemeId: 'golden' as VoxelMapTheme['id'] }),
    mapThemeId: 'golden',
    mapSeed: 999,
    matchMode: 'ranked' as MatchMode,
    winningTeam: 'red',
    participants: [
      participant({ userId: 'winner-a', playerSessionId: 'session-a', team: 'red' }),
      participant({ userId: 'loser-a', playerSessionId: 'session-b', team: 'blue' }),
    ],
    rankedEligible: true,
    integrityGate: gate(),
  });
  await flushAsync();

  assert.equal(settled, true);
  assert.equal(calls.goldenRewards.length, 1);
  assert.deepEqual((calls.goldenRewards[0] as { winners: unknown[] }).winners, [
    { userId: 'winner-a', playerSessionId: 'session-a' },
  ]);

  const held = runtime.settleGoldenBiomeReward({
    roomId: 'room-a',
    lobbyId: 'lobby-a',
    ledger: ledger({ mapThemeId: 'golden' as VoxelMapTheme['id'] }),
    mapThemeId: 'golden',
    mapSeed: 999,
    matchMode: 'ranked',
    winningTeam: 'red',
    participants: [participant()],
    rankedEligible: true,
    integrityGate: gate({ rankedHoldRequired: true, reason: 'review' }),
  });
  assert.equal(held, false);
  assert.ok(calls.logs.some((entry) => entry.message === 'Golden biome reward held for match integrity review'));
}

console.log('match finalization runtime tests passed');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
