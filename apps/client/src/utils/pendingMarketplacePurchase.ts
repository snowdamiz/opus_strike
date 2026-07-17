import type { MarketplacePurchaseIntentSnapshot } from '@voxel-strike/shared';

export const PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY = 'voxel_strike_pending_marketplace_purchase:v1';
export const MARKETPLACE_PURCHASE_POLL_MS = 1_800;
export const MARKETPLACE_SUBMISSION_HANDOFF_GRACE_MS = 30_000;

const INTENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingMarketplacePurchase {
  intentId: string;
  savedAt: number;
}

function parsePendingMarketplacePurchase(value: string | null): PendingMarketplacePurchase | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingMarketplacePurchase>;
    if (!INTENT_ID_PATTERN.test(parsed.intentId ?? '')) return null;
    if (!Number.isFinite(parsed.savedAt) || Number(parsed.savedAt) <= 0) return null;
    return { intentId: parsed.intentId!, savedAt: Number(parsed.savedAt) };
  } catch {
    return null;
  }
}

export function loadPendingMarketplacePurchase(): PendingMarketplacePurchase | null {
  if (typeof window === 'undefined') return null;
  try {
    return parsePendingMarketplacePurchase(
      window.localStorage.getItem(PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function savePendingMarketplacePurchase(
  intentId: string,
  savedAt = Date.now()
): PendingMarketplacePurchase | null {
  if (!INTENT_ID_PATTERN.test(intentId) || !Number.isFinite(savedAt) || savedAt <= 0) return null;
  const pending = { intentId, savedAt };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY, JSON.stringify(pending));
    } catch {
      // The server reconciliation worker remains authoritative.
    }
  }
  return pending;
}

export function clearPendingMarketplacePurchase(intentId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (intentId) {
      const current = parsePendingMarketplacePurchase(
        window.localStorage.getItem(PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY)
      );
      if (current?.intentId !== intentId) return;
    }
    window.localStorage.removeItem(PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY);
  } catch {
    // Best-effort client recovery; server settlement remains durable.
  }
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolvePendingMarketplacePurchase(input: {
  pending: PendingMarketplacePurchase;
  initialIntent?: MarketplacePurchaseIntentSnapshot;
  loadIntent: (intentId: string) => Promise<MarketplacePurchaseIntentSnapshot>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  isCancelled?: () => boolean;
}): Promise<MarketplacePurchaseIntentSnapshot | null> {
  const wait = input.wait ?? defaultWait;
  const now = input.now ?? Date.now;
  const isCancelled = input.isCancelled ?? (() => false);
  if (isCancelled()) return null;

  let latest = input.initialIntent ?? await input.loadIntent(input.pending.intentId);
  while (!isCancelled()) {
    if (latest.status === 'credited' || latest.status === 'failed' || latest.status === 'expired') {
      return latest;
    }

    let waitMs = MARKETPLACE_PURCHASE_POLL_MS;
    if (latest.status === 'intent_created' || latest.status === 'transaction_built') {
      const handoffRemainingMs = (
        input.pending.savedAt + MARKETPLACE_SUBMISSION_HANDOFF_GRACE_MS - now()
      );
      if (handoffRemainingMs <= 0) return latest;
      waitMs = Math.min(waitMs, handoffRemainingMs);
    }

    await wait(waitMs);
    if (isCancelled()) return null;
    latest = await input.loadIntent(input.pending.intentId);
  }
  return null;
}
