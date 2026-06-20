import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import type { AntiCheatIntegrityGate } from '../anticheat';
import type { MatchParticipantSnapshot, PersistCompletedMatchResult } from '../persistence/matchPersistence';
import {
  MatchFinalizationRuntime,
  buildMatchFinalizationOutcomes,
  type MatchFinalizationRuntimeDeps,
} from '../rooms/matchFinalizationRuntime';
import type { MatchPersistenceLedger } from '../rooms/matchLedgerRuntime';

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

function createRuntime(options: {
  persistError?: Error;
} = {}) {
  const calls = {
    persisted: [] as unknown[],
    integrity: [] as unknown[],
    actions: [] as unknown[],
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

async function run(): Promise<void> {
{
  assert.deepEqual(buildMatchFinalizationOutcomes({
    matchMode: 'ranked',
    rankedEligible: true,
    integrityGate: gate({ rankedHoldRequired: true, reviewRequired: true }),
  }), {
    rankedOutcomeStatus: 'held',
    rankedImpact: 'held',
  });

  assert.deepEqual(buildMatchFinalizationOutcomes({
    matchMode: 'ranked',
    rankedEligible: false,
    integrityGate: gate(),
  }), {
    rankedOutcomeStatus: 'canceled',
    rankedImpact: 'none',
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
  });

  assert.equal(persisted, true);
  assert.equal(currentLedger.state, 'failed');
  assert.ok(calls.logs.some((entry) => entry.level === 'error' && entry.message === 'Match persistence failed'));
}

console.log('match finalization runtime tests passed');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
