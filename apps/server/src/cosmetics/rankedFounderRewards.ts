import type { Prisma } from '@prisma/client';
import { HERO_SKIN_CATALOG, type HeroSkinId } from '@voxel-strike/shared';

export const RANKED_FOUNDER_REWARD_ID = 'ranked_founder_golden';

// The golden founder skins (one per hero) granted as a single set to the first N
// players to complete a ranked match. Derived from the catalog so the list stays
// in sync with whatever skins are marked `unlockable`.
export const GOLDEN_FOUNDER_SKIN_IDS: HeroSkinId[] = HERO_SKIN_CATALOG
  .filter((skin) => skin.availability === 'unlockable')
  .map((skin) => skin.id);

/**
 * Attempt to claim one of the limited golden founder slots for `userId`, and if a
 * slot is available grant the full set of golden skins.
 *
 * Concurrency: the claim is a conditional `updateMany` that only increments while
 * `claimedCount < maxClaims`. Postgres re-evaluates the WHERE predicate after
 * acquiring the row lock, so simultaneous match finalizations serialize on the
 * counter row and can never push `claimedCount` past `maxClaims`.
 *
 * Idempotency: callers gate on the player's *first* ranked match, and a user who
 * already owns a founder skin is skipped without consuming a slot. The grant
 * itself is an upsert on the unique (userId, skinId) ownership row.
 *
 * Must be called inside the same transaction as the ranked-match persistence so
 * the grant is atomic with the `rankedGames` increment.
 *
 * @returns true if this call claimed a slot and granted the skins.
 */
export async function tryGrantRankedFounderSkins(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<boolean> {
  if (GOLDEN_FOUNDER_SKIN_IDS.length === 0) return false;

  // Defensive: the migration seeds this row, but ensure it exists for databases
  // bootstrapped via `prisma db push` (e.g. tests).
  await tx.rankedFounderReward.upsert({
    where: { id: RANKED_FOUNDER_REWARD_ID },
    create: { id: RANKED_FOUNDER_REWARD_ID },
    update: {},
  });

  // Skip players who already hold any founder skin (e.g. an admin grant) so we
  // never burn a founder slot on someone who already has the set.
  const alreadyOwned = await tx.userSkinOwnership.findFirst({
    where: {
      userId,
      skinId: { in: GOLDEN_FOUNDER_SKIN_IDS as string[] },
      revokedAt: null,
    },
    select: { id: true },
  });
  if (alreadyOwned) return false;

  const counter = await tx.rankedFounderReward.findUniqueOrThrow({
    where: { id: RANKED_FOUNDER_REWARD_ID },
    select: { maxClaims: true },
  });

  const claim = await tx.rankedFounderReward.updateMany({
    where: { id: RANKED_FOUNDER_REWARD_ID, claimedCount: { lt: counter.maxClaims } },
    data: { claimedCount: { increment: 1 } },
  });
  if (claim.count !== 1) return false;

  const grantedAt = new Date();
  for (const skinId of GOLDEN_FOUNDER_SKIN_IDS) {
    await tx.userSkinOwnership.upsert({
      where: { userId_skinId: { userId, skinId } },
      create: { userId, skinId, source: 'event', grantedAt },
      update: { source: 'event', revokedAt: null },
    });
  }

  return true;
}
