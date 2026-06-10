import assert from 'node:assert/strict';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  calculateNetRefundLamports,
  calculateWagerPayouts,
  evaluateWagerStartEligibility,
  type WagerRosterPlayer,
} from '../wagers/math';
import { createWagerMemo, verifyParsedSolPayment } from '../wagers/solana';
import { buildWagerUserStatIncrements } from '../wagers/service';

const createdAt = new Date('2026-06-10T10:00:00.000Z');
const expiresAt = new Date('2026-06-10T10:15:00.000Z');

function parsedPaymentTx(options: {
  sender?: string;
  recipient?: string;
  amountLamports?: number;
  memo?: string;
  blockTime?: number;
  signer?: string;
  err?: unknown;
} = {}): ParsedTransactionWithMeta {
  const sender = options.sender ?? 'Sender1111111111111111111111111111111111111';
  const recipient = options.recipient ?? 'Treasury1111111111111111111111111111111111';
  const amountLamports = options.amountLamports ?? 1_000_000;
  const signer = options.signer ?? sender;

  return {
    slot: 123,
    blockTime: options.blockTime ?? Math.floor(createdAt.getTime() / 1000) + 30,
    meta: {
      err: options.err ?? null,
      fee: 5000,
      preBalances: [2_000_000, 0],
      postBalances: [2_000_000 - amountLamports - 5000, amountLamports],
      innerInstructions: [],
      logMessages: [],
      postTokenBalances: [],
      preTokenBalances: [],
      rewards: [],
    },
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          { pubkey: { toBase58: () => sender }, signer: signer === sender, writable: true },
          { pubkey: { toBase58: () => recipient }, signer: signer === recipient, writable: true },
        ],
        instructions: [
          {
            program: 'system',
            programId: { toBase58: () => '11111111111111111111111111111111' },
            parsed: {
              type: 'transfer',
              info: {
                source: sender,
                destination: recipient,
                lamports: amountLamports,
              },
            },
          },
          {
            program: 'spl-memo',
            programId: { toBase58: () => 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' },
            parsed: options.memo ?? createWagerMemo('intent-a'),
          },
        ],
      },
    },
    version: 'legacy',
  } as unknown as ParsedTransactionWithMeta;
}

function runPayoutMathTests(): void {
  const payouts = calculateWagerPayouts(101n, 3, 500);
  assert.equal(payouts.developerFeeLamports, 5n);
  assert.equal(payouts.winnerPoolLamports, 96n);
  assert.equal(payouts.winnerShareLamports, 32n);
  assert.equal(payouts.dustLamports, 0n);
  assert.equal(payouts.developerTotalLamports, 5n);

  const dusty = calculateWagerPayouts(100n, 3, 500);
  assert.equal(dusty.developerFeeLamports, 5n);
  assert.equal(dusty.winnerShareLamports, 31n);
  assert.equal(dusty.dustLamports, 2n);
  assert.equal(dusty.developerTotalLamports, 7n);
}

function runStartGateTests(): void {
  const roster: WagerRosterPlayer[] = [
    { lobbyPlayerId: 'red-a', userId: 'user-red-a', name: 'Red A', team: 'red', isBot: false },
    { lobbyPlayerId: 'red-bot', userId: null, name: 'Red Bot', team: 'red', isBot: true },
    { lobbyPlayerId: 'blue-a', userId: 'user-blue-a', name: 'Blue A', team: 'blue', isBot: false },
  ];

  const blocked = evaluateWagerStartEligibility(roster, new Set(['user-red-a']));
  assert.equal(blocked.canStart, false);
  assert.equal(blocked.unpaidPlayers.length, 1);
  assert.equal(blocked.unpaidPlayers[0].name, 'Blue A');
  assert.deepEqual(blocked.paidHumanCountByTeam, { red: 1, blue: 0 });
  assert.ok(blocked.reasons.includes('missing_blue_paid_human'));

  const allowed = evaluateWagerStartEligibility(roster, new Set(['user-red-a', 'user-blue-a']));
  assert.equal(allowed.canStart, true);
  assert.deepEqual(allowed.unpaidPlayers, []);
}

function runTransactionParserTests(): void {
  const expected = {
    senderWallet: 'Sender1111111111111111111111111111111111111',
    treasuryWallet: 'Treasury1111111111111111111111111111111111',
    amountLamports: 1_000_000n,
    memo: createWagerMemo('intent-a'),
    createdAt,
    expiresAt,
    expiryGraceMs: 120_000,
  };

  assert.equal(verifyParsedSolPayment(parsedPaymentTx(), expected).ok, true);
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ amountLamports: 999_999 }), expected).reason,
    'underpayment'
  );
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ memo: createWagerMemo('intent-b') }), expected).reason,
    'wrong_memo'
  );
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ recipient: 'Other111111111111111111111111111111111111111' }), expected).reason,
    'wrong_recipient'
  );
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ sender: 'OtherSender111111111111111111111111111111111' }), expected).reason,
    'missing_sender_signature'
  );
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ blockTime: Math.floor(new Date('2026-06-10T11:00:00.000Z').getTime() / 1000) }), expected).reason,
    'expired_intent'
  );
  assert.equal(
    verifyParsedSolPayment(parsedPaymentTx({ err: { InstructionError: [0, 'Custom'] } }), expected).reason,
    'transaction_failed'
  );
}

function getIncrementValue(data: unknown, key: string): number | bigint {
  const value = (data as Record<string, { increment: number | bigint }>)[key]?.increment;
  if (value === undefined) {
    throw new Error(`missing increment for ${key}`);
  }
  return value;
}

function runRefundMathTests(): void {
  assert.equal(calculateNetRefundLamports(1_000_000n, 5_000n), 995_000n);
  assert.throws(() => calculateNetRefundLamports(5_000n, 5_000n), /manual review/);
  assert.throws(() => calculateNetRefundLamports(5_000n, 6_000n), /manual review/);
}

function runWagerStatsTests(): void {
  const settled = buildWagerUserStatIncrements({
    winningTeam: 'red',
    payments: [
      {
        userId: 'user-red',
        walletAddress: 'wallet-red',
        teamAtLock: 'red',
        amountLamports: 1_000n,
        status: 'credited',
      },
      {
        userId: 'user-blue',
        walletAddress: 'wallet-blue',
        teamAtLock: 'blue',
        amountLamports: 1_000n,
        status: 'credited',
      },
    ],
    transfers: [
      {
        kind: 'winner_payout',
        recipientWallet: 'wallet-red',
        amountLamports: 1_900n,
        status: 'confirmed',
      },
      {
        kind: 'developer_fee',
        recipientWallet: 'wallet-treasury',
        amountLamports: 100n,
        status: 'confirmed',
      },
    ],
  });

  const winner = settled.find((increment) => increment.userId === 'user-red');
  const loser = settled.find((increment) => increment.userId === 'user-blue');
  assert.ok(winner);
  assert.ok(loser);
  assert.equal(getIncrementValue(winner.data, 'totalWagerGames'), 1);
  assert.equal(getIncrementValue(winner.data, 'totalWagerWins'), 1);
  assert.equal(getIncrementValue(winner.data, 'totalWagerWonLamports'), 900n);
  assert.equal(getIncrementValue(winner.data, 'totalWagerLostLamports'), 0n);
  assert.equal(getIncrementValue(loser.data, 'totalWagerLosses'), 1);
  assert.equal(getIncrementValue(loser.data, 'totalWagerWonLamports'), 0n);
  assert.equal(getIncrementValue(loser.data, 'totalWagerLostLamports'), 1_000n);

  const refunded = buildWagerUserStatIncrements({
    winningTeam: null,
    payments: [
      {
        userId: 'user-draw',
        walletAddress: 'wallet-draw',
        teamAtLock: 'red',
        amountLamports: 2_000n,
        status: 'settled',
      },
    ],
    transfers: [
      {
        kind: 'refund',
        recipientWallet: 'wallet-draw',
        amountLamports: 2_000n,
        status: 'confirmed',
      },
    ],
  });

  assert.equal(refunded.length, 1);
  assert.equal(getIncrementValue(refunded[0].data, 'totalWagerDraws'), 1);
  assert.equal(getIncrementValue(refunded[0].data, 'totalWageredLamports'), 2_000n);
  assert.equal(getIncrementValue(refunded[0].data, 'totalWagerWonLamports'), 0n);
  assert.equal(getIncrementValue(refunded[0].data, 'totalWagerLostLamports'), 0n);
}

runPayoutMathTests();
runRefundMathTests();
runStartGateTests();
runTransactionParserTests();
runWagerStatsTests();

console.log('wager service tests passed');
