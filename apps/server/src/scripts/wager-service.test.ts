import assert from 'node:assert/strict';
import { Keypair, type ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  calculateNetRefundLamports,
  calculateWagerPayouts,
  evaluateWagerStartEligibility,
  type WagerRosterPlayer,
} from '../wagers/math';
import { createWagerMemo, verifyParsedSolPayment } from '../wagers/solana';
import {
  assertRewardTreasuryConfigured,
  assertWagerPaymentsConfigured,
  getWagerRuntimeConfig,
} from '../wagers/config';
import { buildWagerUserStatIncrements, WagerService } from '../wagers/service';
import { extractTokenAccountMintDelta } from '../wagers/tokenConversion';

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
  const payouts = calculateWagerPayouts(100n, 2);
  assert.equal(payouts.winnerPoolLamports, 90n);
  assert.equal(payouts.winnerShareLamports, 45n);
  assert.deepEqual(payouts.winnerPayoutLamports, [45n, 45n]);
  assert.equal(payouts.burnLamports, 5n);
  assert.equal(payouts.treasuryFeeLamports, 5n);
  assert.equal(payouts.treasuryDustLamports, 0n);
  assert.equal(payouts.treasuryTotalLamports, 5n);

  const splitDust = calculateWagerPayouts(101n, 3);
  assert.equal(splitDust.winnerPoolLamports, 90n);
  assert.equal(splitDust.winnerShareLamports, 30n);
  assert.deepEqual(splitDust.winnerPayoutLamports, [30n, 30n, 30n]);
  assert.equal(splitDust.burnLamports, 5n);
  assert.equal(splitDust.treasuryFeeLamports, 5n);
  assert.equal(splitDust.treasuryDustLamports, 1n);
  assert.equal(splitDust.treasuryTotalLamports, 6n);

  const winnerDust = calculateWagerPayouts(100n, 4);
  assert.equal(winnerDust.winnerPoolLamports, 90n);
  assert.equal(winnerDust.winnerShareLamports, 22n);
  assert.deepEqual(winnerDust.winnerPayoutLamports, [23n, 23n, 22n, 22n]);
  assert.equal(winnerDust.burnLamports, 5n);
  assert.equal(winnerDust.treasuryFeeLamports, 5n);
  assert.equal(winnerDust.treasuryDustLamports, 0n);
  assert.equal(winnerDust.treasuryTotalLamports, 5n);
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

function runRewardTreasuryConfigGuardTests(): void {
  const configuredTreasury = {
    ...getWagerRuntimeConfig(),
    enabled: false,
    rpcUrl: 'http://127.0.0.1:8899',
    treasuryWallet: Keypair.generate().publicKey.toBase58(),
  };

  assert.doesNotThrow(() => assertRewardTreasuryConfigured(configuredTreasury));
  assert.throws(
    () => assertWagerPaymentsConfigured(configuredTreasury),
    /SOL wagers are not enabled/
  );
  assert.throws(
    () => assertRewardTreasuryConfigured({ ...configuredTreasury, rpcUrl: '' }),
    /SOLANA_RPC_URL is required for player rewards/
  );
  assert.throws(
    () => assertRewardTreasuryConfigured({ ...configuredTreasury, treasuryWallet: '' }),
    /WAGER_TREASURY_WALLET is required for player rewards/
  );
}

async function runRewardTreasuryServiceGuardTests(): Promise<void> {
  const previous = {
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    WAGER_SOL_ENABLED: process.env.WAGER_SOL_ENABLED,
    WAGER_TREASURY_WALLET: process.env.WAGER_TREASURY_WALLET,
  };
  const rpcUrl = 'http://127.0.0.1:8899';
  const service = new WagerService();

  try {
    process.env.WAGER_SOL_ENABLED = 'false';
    process.env.SOLANA_RPC_URL = rpcUrl;
    process.env.WAGER_TREASURY_WALLET = Keypair.generate().publicKey.toBase58();
    (service as unknown as {
      connection: { rpcEndpoint: string; getBalance: () => Promise<number> };
    }).connection = {
      rpcEndpoint: rpcUrl,
      getBalance: async () => 123_456_789,
    };

    assert.equal(await service.getRewardTreasuryBalanceLamports(), 123_456_789n);
    await assert.rejects(
      () => service.getTreasuryBalanceLamports(),
      /SOL wagers are not enabled/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function runTokenConversionAccountingTests(): void {
  const tokenAccount = 'TokenAcct111111111111111111111111111111111';
  const mint = 'Mint111111111111111111111111111111111111111';
  const transaction = {
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      innerInstructions: [],
      logMessages: [],
      rewards: [],
      preTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: 'Treasury1111111111111111111111111111111111',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1000',
            decimals: 6,
            uiAmount: 0.001,
            uiAmountString: '0.001',
          },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: 'Treasury1111111111111111111111111111111111',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1750',
            decimals: 6,
            uiAmount: 0.00175,
            uiAmountString: '0.00175',
          },
        },
      ],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: { toBase58: () => 'Other111111111111111111111111111111111111111' } },
          { pubkey: { toBase58: () => tokenAccount } },
        ],
        instructions: [],
      },
      signatures: ['sig'],
    },
    blockTime: null,
    slot: 123,
    version: 0,
  } as unknown as ParsedTransactionWithMeta;

  assert.equal(extractTokenAccountMintDelta(transaction, tokenAccount, mint), 750n);
  assert.equal(extractTokenAccountMintDelta(transaction, tokenAccount, 'OtherMint111111111111111111111111111111111'), 0n);
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
        amountLamports: 1_800n,
        status: 'confirmed',
      },
      {
        kind: 'treasury_fee',
        recipientWallet: 'wallet-treasury',
        amountLamports: 100n,
        status: 'confirmed',
      },
      {
        kind: 'burn',
        recipientWallet: 'burn',
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
  assert.equal(getIncrementValue(winner.data, 'totalWagerWonLamports'), 800n);
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

async function runSettlementConfigGuardTests(): Promise<void> {
  const previous = {
    GAME_TOKEN_MINT: process.env.GAME_TOKEN_MINT,
    JUPITER_API_KEY: process.env.JUPITER_API_KEY,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    WAGER_SETTLEMENT_SECRET_KEY: process.env.WAGER_SETTLEMENT_SECRET_KEY,
    WAGER_SOL_ENABLED: process.env.WAGER_SOL_ENABLED,
    WAGER_TREASURY_WALLET: process.env.WAGER_TREASURY_WALLET,
  };
  const signer = Keypair.generate();
  const tokenMint = Keypair.generate().publicKey.toBase58();
  const service = new WagerService();
  const wagerOptions = {
    enabled: true,
    token: 'SOL' as const,
    coverChargeLamports: '1000000',
  };

  try {
    process.env.WAGER_SOL_ENABLED = 'true';
    process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
    process.env.WAGER_TREASURY_WALLET = signer.publicKey.toBase58();
    process.env.WAGER_SETTLEMENT_SECRET_KEY = JSON.stringify(Array.from(signer.secretKey));
    process.env.JUPITER_API_KEY = 'test-jupiter-key';
    delete process.env.GAME_TOKEN_MINT;

    await assert.rejects(
      () => service.normalizeCreateOptions(wagerOptions),
      /GAME_TOKEN_MINT/
    );

    process.env.GAME_TOKEN_MINT = 'not-a-public-key';
    await assert.rejects(
      () => service.normalizeCreateOptions(wagerOptions),
      /GAME_TOKEN_MINT must be a valid Solana public key/
    );

    process.env.GAME_TOKEN_MINT = tokenMint;
    delete process.env.JUPITER_API_KEY;
    await assert.rejects(
      () => service.normalizeCreateOptions(wagerOptions),
      /JUPITER_API_KEY/
    );

    process.env.JUPITER_API_KEY = 'test-jupiter-key';
    const normalized = await service.normalizeCreateOptions(wagerOptions);
    assert.equal(normalized.enabled, true);
    if (normalized.enabled) {
      assert.equal(normalized.treasuryWallet, signer.publicKey.toBase58());
      assert.equal(normalized.coverChargeLamports, 1_000_000n);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main(): Promise<void> {
  runPayoutMathTests();
  runRefundMathTests();
  runRewardTreasuryConfigGuardTests();
  await runRewardTreasuryServiceGuardTests();
  runStartGateTests();
  runTransactionParserTests();
  runTokenConversionAccountingTests();
  runWagerStatsTests();
  await runSettlementConfigGuardTests();

  console.log('wager service tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
