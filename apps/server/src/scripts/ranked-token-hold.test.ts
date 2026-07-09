import assert from 'node:assert/strict';
import { Keypair, type PublicKey } from '@solana/web3.js';

type RankedEntryGateRow = {
  id: string;
  mode: 'locked' | 'token_required';
  tokenMintAddress: string | null;
  tokenSymbol: string;
  requiredTokenAmount: string;
  updatedByUserId: string | null;
  updatedAt: Date;
};

function createFakePrisma() {
  const row: RankedEntryGateRow = {
    id: 'default',
    mode: 'locked',
    tokenMintAddress: null,
    tokenSymbol: '',
    requiredTokenAmount: '0',
    updatedByUserId: null,
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
  };

  return {
    row,
    prisma: {
      rankedEntryGateSettings: {
        upsert: async ({ where, create }: any) => {
          assert.deepEqual(where, { id: 'default' });
          if (!row.id) Object.assign(row, create);
          return { ...row };
        },
        update: async ({ where, data }: any) => {
          assert.deepEqual(where, { id: 'default' });
          Object.assign(row, data, {
            updatedAt: new Date(row.updatedAt.getTime() + 1_000),
          });
          return { ...row };
        },
      },
    },
  };
}

function tokenAccount(mint: string, amount: string, decimals: number) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: {
              amount,
              decimals,
            },
          },
        },
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

async function main(): Promise<void> {
  const previousEnv = {
    GAME_TOKEN_MINT: process.env.GAME_TOKEN_MINT,
    GAME_TOKEN_SYMBOL: process.env.GAME_TOKEN_SYMBOL,
    SKIN_SHOP_TOKEN_MINT: process.env.SKIN_SHOP_TOKEN_MINT,
    SKIN_SHOP_TOKEN_SYMBOL: process.env.SKIN_SHOP_TOKEN_SYMBOL,
    SOLANA_CLUSTER: process.env.SOLANA_CLUSTER,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    RANKED_TOKEN_HOLD_RPC_URL: process.env.RANKED_TOKEN_HOLD_RPC_URL,
    RANKED_TOKEN_HOLD_STATUS_CACHE_MS: process.env.RANKED_TOKEN_HOLD_STATUS_CACHE_MS,
  };

  delete process.env.GAME_TOKEN_MINT;
  delete process.env.GAME_TOKEN_SYMBOL;
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RANKED_TOKEN_HOLD_RPC_URL;
  process.env.SOLANA_CLUSTER = 'localnet';
  process.env.RANKED_TOKEN_HOLD_STATUS_CACHE_MS = '60000';

  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const mint = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  let accountFetches = 0;
  let supplyFetches = 0;
  let balances = ['6000', '4000'];

  const rankedTokenHold = await import('../matchmaking/rankedTokenHold');
  delete process.env.GAME_TOKEN_MINT;
  delete process.env.GAME_TOKEN_SYMBOL;
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RANKED_TOKEN_HOLD_RPC_URL;
  process.env.SOLANA_CLUSTER = 'localnet';
  process.env.RANKED_TOKEN_HOLD_STATUS_CACHE_MS = '60000';
  rankedTokenHold.setRankedTokenHoldConnectionFactoryForTests((rpcUrl) => {
    assert.equal(rpcUrl, 'http://127.0.0.1:8899');
    return {
      getParsedTokenAccountsByOwner: async (
        owner: PublicKey,
        filter: { mint?: PublicKey }
      ) => {
        accountFetches += 1;
        assert.equal(owner.toBase58(), wallet.toBase58());
        assert.equal(filter.mint?.toBase58(), mint.toBase58());
        return {
          value: balances.map((amount) => tokenAccount(mint.toBase58(), amount, 2)),
        };
      },
      getTokenSupply: async (tokenMint: PublicKey) => {
        supplyFetches += 1;
        assert.equal(tokenMint.toBase58(), mint.toBase58());
        return { value: { decimals: 2 } };
      },
    } as never;
  });

  try {
    const locked = await rankedTokenHold.getRankedTokenHoldingStatus(null);
    assert.equal(locked.rankedPlayEligible, true);
    assert.equal(locked.eligible, false);
    assert.equal(locked.rewardEligible, false);
    assert.equal(locked.mode, 'locked');
    assert.equal(locked.rewardIneligibleReason, 'reward_gate_disabled');
    assert.match(locked.lockedReason ?? '', /SOL rewards are disabled/);
    assert.equal(locked.cluster, 'localnet');
    assert.equal(accountFetches, 0);

    await assert.rejects(
      () => rankedTokenHold.setRankedEntryGateSettings({
        mode: 'token_required',
        requiredTokenAmount: '1',
      }, 'admin-a'),
      /GAME_TOKEN_MINT/
    );

    process.env.GAME_TOKEN_MINT = mint.toBase58();
    process.env.GAME_TOKEN_SYMBOL = 'test';

    await assert.rejects(
      () => rankedTokenHold.setRankedEntryGateSettings({
        mode: 'token_required',
        requiredTokenAmount: '0',
      }, 'admin-a'),
      /greater than zero/
    );
    await assert.rejects(
      () => rankedTokenHold.setRankedEntryGateSettings({
        mode: 'token_required',
        requiredTokenAmount: '1.5',
      }, 'admin-a'),
      /whole number/
    );

    const enabled = await rankedTokenHold.setRankedEntryGateSettings({
      mode: 'token_required',
      requiredTokenAmount: '100',
    }, 'admin-a');
    assert.equal(enabled.mode, 'token_required');
    assert.equal(enabled.tokenMintAddress, mint.toBase58());
    assert.equal(enabled.tokenSymbol, 'TEST');
    assert.equal(enabled.requiredTokenAmount, '100');

    const noWallet = await rankedTokenHold.getRankedTokenHoldingStatus(null);
    assert.equal(noWallet.rankedPlayEligible, true);
    assert.equal(noWallet.rewardEligible, false);
    assert.equal(noWallet.rewardIneligibleReason, 'wallet_not_linked');

    const noRpc = await rankedTokenHold.getRankedTokenHoldingStatus(wallet.toBase58());
    assert.equal(noRpc.rankedPlayEligible, true);
    assert.equal(noRpc.rewardEligible, false);
    assert.equal(noRpc.rewardIneligibleReason, 'rpc_unconfigured');

    process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
    const invalidWallet = await rankedTokenHold.getRankedTokenHoldingStatus('not-a-wallet');
    assert.equal(invalidWallet.rankedPlayEligible, true);
    assert.equal(invalidWallet.rewardEligible, false);
    assert.equal(invalidWallet.rewardIneligibleReason, 'invalid_wallet');
    assert.equal(accountFetches, 0);

    const eligible = await rankedTokenHold.getRankedTokenHoldingStatus(wallet.toBase58());
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.rewardEligible, true);
    assert.equal(eligible.tokenDecimals, 2);
    assert.equal(eligible.requiredTokenAmount, '100');
    assert.equal(eligible.requiredTokenBaseUnits, '10000');
    assert.equal(eligible.balanceTokenBaseUnits, '10000');
    assert.equal(accountFetches, 1);
    assert.equal(supplyFetches, 0);

    const cached = await rankedTokenHold.getRankedTokenHoldingStatus(wallet.toBase58());
    assert.equal(cached.checkedAt, eligible.checkedAt);
    assert.equal(accountFetches, 1, 'status cache should avoid a duplicate RPC balance check');

    balances = ['9999'];
    await rankedTokenHold.setRankedEntryGateSettings({
      mode: 'token_required',
      requiredTokenAmount: '101',
    }, 'admin-b');
    const ineligible = await rankedTokenHold.getRankedTokenHoldingStatus(wallet.toBase58());
    assert.equal(ineligible.eligible, false);
    assert.equal(ineligible.rewardEligible, false);
    assert.equal(ineligible.rankedPlayEligible, true);
    assert.equal(ineligible.rewardIneligibleReason, 'insufficient_balance');
    assert.equal(ineligible.requiredTokenBaseUnits, '10100');
    assert.equal(ineligible.balanceTokenBaseUnits, '9999');
    assert.equal(accountFetches, 2, 'admin gate changes must clear the status cache');
  } finally {
    rankedTokenHold.setRankedTokenHoldConnectionFactoryForTests(null);
    restoreEnv(previousEnv);
  }

  console.log('ranked token hold tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
