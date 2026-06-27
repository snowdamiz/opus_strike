import assert from 'node:assert/strict';
import {
  GOLDEN_FOUNDER_SKIN_IDS,
  RANKED_FOUNDER_REWARD_ID,
  tryGrantRankedFounderSkins,
} from '../cosmetics/rankedFounderRewards';

// The founder set should cover every hero.
assert.equal(GOLDEN_FOUNDER_SKIN_IDS.length, 4, 'expected one golden founder skin per hero');
assert.ok(
  GOLDEN_FOUNDER_SKIN_IDS.every((id) => id.endsWith('.golden')),
  'founder skins should be the `.golden` variants'
);

function createFakeTx(maxClaims = 50) {
  const counter = { id: RANKED_FOUNDER_REWARD_ID, claimedCount: 0, maxClaims, exists: false };
  const ownership = new Map<string, { userId: string; skinId: string; source: string; revokedAt: Date | null }>();
  const key = (userId: string, skinId: string) => `${userId}::${skinId}`;

  const tx = {
    rankedFounderReward: {
      upsert: async ({ create }: any) => {
        if (!counter.exists) {
          counter.exists = true;
          if (typeof create?.maxClaims === 'number') counter.maxClaims = create.maxClaims;
        }
        return { ...counter };
      },
      findUniqueOrThrow: async ({ select }: any) => {
        if (!counter.exists) throw new Error('RankedFounderReward row missing');
        return select?.maxClaims ? { maxClaims: counter.maxClaims } : { ...counter };
      },
      // Emulates the conditional increment with Postgres' post-lock predicate re-check.
      updateMany: async ({ where, data }: any) => {
        if (where.id !== RANKED_FOUNDER_REWARD_ID) return { count: 0 };
        const lt = where.claimedCount?.lt;
        if (lt !== undefined && !(counter.claimedCount < lt)) return { count: 0 };
        if (data.claimedCount?.increment) counter.claimedCount += data.claimedCount.increment;
        return { count: 1 };
      },
    },
    userSkinOwnership: {
      findFirst: async ({ where }: any) => {
        const ids: string[] = where.skinId?.in ?? [];
        for (const [id, row] of ownership) {
          if (row.userId === where.userId && ids.includes(row.skinId) && row.revokedAt == null) {
            return { id };
          }
        }
        return null;
      },
      upsert: async ({ where, create, update }: any) => {
        const k = key(where.userId_skinId.userId, where.userId_skinId.skinId);
        const existing = ownership.get(k);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { revokedAt: null, ...create };
        ownership.set(k, row);
        return row;
      },
    },
  };

  return { tx, counter, ownership };
}

async function run() {
  // 1. A fresh player claims a slot and receives the full golden set.
  {
    const { tx, counter, ownership } = createFakeTx();
    const granted = await tryGrantRankedFounderSkins(tx as any, 'user_a');
    assert.equal(granted, true, 'first founder should be granted');
    assert.equal(counter.claimedCount, 1, 'one slot consumed');
    assert.equal(ownership.size, GOLDEN_FOUNDER_SKIN_IDS.length, 'all founder skins granted');
    for (const skinId of GOLDEN_FOUNDER_SKIN_IDS) {
      const row = ownership.get(`user_a::${skinId}`);
      assert.ok(row, `granted ${skinId}`);
      assert.equal(row.source, 'event', `${skinId} granted via event entitlement`);
    }
  }

  // 2. The cap holds: once claimedCount reaches maxClaims, no further grants.
  {
    const { tx, counter, ownership } = createFakeTx(1);
    assert.equal(await tryGrantRankedFounderSkins(tx as any, 'user_first'), true);
    assert.equal(await tryGrantRankedFounderSkins(tx as any, 'user_second'), false, 'cap reached');
    assert.equal(counter.claimedCount, 1, 'cap is never exceeded');
    assert.equal(
      [...ownership.values()].some((row) => row.userId === 'user_second'),
      false,
      'capped-out player receives nothing'
    );
  }

  // 3. Idempotent per user: a player who already owns a founder skin never burns a slot.
  {
    const { tx, counter } = createFakeTx();
    assert.equal(await tryGrantRankedFounderSkins(tx as any, 'user_dup'), true);
    assert.equal(counter.claimedCount, 1);
    assert.equal(await tryGrantRankedFounderSkins(tx as any, 'user_dup'), false, 'second call is a no-op');
    assert.equal(counter.claimedCount, 1, 'no extra slot consumed on repeat');
  }

  // 4. Exactly maxClaims distinct players can be rewarded across many attempts.
  {
    const { tx, counter, ownership } = createFakeTx(3);
    let grants = 0;
    for (let i = 0; i < 10; i += 1) {
      if (await tryGrantRankedFounderSkins(tx as any, `player_${i}`)) grants += 1;
    }
    assert.equal(grants, 3, 'exactly maxClaims players rewarded');
    assert.equal(counter.claimedCount, 3);
    assert.equal(ownership.size, 3 * GOLDEN_FOUNDER_SKIN_IDS.length);
  }

  console.log('ranked-founder-reward tests passed');
}

run();
