import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import prisma from '../db';
import { enforceJsonRateLimit, getRequestAuthToken } from '../auth/http';
import { verifyAuthToken } from '../auth/session';
import {
  LootboxServiceError,
  buildLootboxOpenTransaction,
  createLootboxOpenIntent,
  getLootboxOpenIntent,
  getLootboxStateForUser,
  openLootboxWithFreeCredit,
  submitLootboxOpenSignature,
  submitSignedLootboxOpenTransaction,
} from './service';

const router: RouterType = Router();

const LOOTBOX_RATE_LIMITS = {
  read: { limit: 90, windowMs: 60 * 1000 },
  open: { limit: 12, windowMs: 60 * 1000 },
} as const;

interface AuthenticatedLootboxUser {
  id: string;
  walletAddress: string | null;
  name: string;
}

async function readAuthenticatedUser(req: Request): Promise<AuthenticatedLootboxUser | null> {
  const token = getRequestAuthToken(req, { allowBearer: true });
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      walletAddress: true,
      name: true,
    },
  });
  if (!user || (payload.walletAddress && user.walletAddress !== payload.walletAddress)) {
    return null;
  }
  return user;
}

async function requireUser(req: Request, res: Response): Promise<AuthenticatedLootboxUser | null> {
  const user = await readAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to open lootboxes' });
    return null;
  }
  return user;
}

function sendLootboxError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof LootboxServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : 500;
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
    error: error instanceof Error ? error.message : fallback,
  });
}

router.get('/state', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:state', LOOTBOX_RATE_LIMITS.read)) return;
  try {
    const user = await readAuthenticatedUser(req);
    res.json(await getLootboxStateForUser(user?.id));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to load lootbox state');
  }
});

router.post('/opens', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-intent', LOOTBOX_RATE_LIMITS.open)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const walletAddress = typeof req.body?.walletAddress === 'string'
      ? req.body.walletAddress
      : '';
    res.json(await createLootboxOpenIntent({ userId: user.id, walletAddress }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to create lootbox open intent');
  }
});

// Free opens (admin-granted credits) skip the payment flow entirely and
// resolve to a credited intent in one call.
router.post('/opens/free', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-free', LOOTBOX_RATE_LIMITS.open)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const walletAddress = typeof req.body?.walletAddress === 'string'
      ? req.body.walletAddress
      : undefined;
    res.json(await openLootboxWithFreeCredit({ userId: user.id, walletAddress }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to open free crate');
  }
});

router.get('/opens/:intentId', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-status', LOOTBOX_RATE_LIMITS.read)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await getLootboxOpenIntent({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to load lootbox open intent');
  }
});

router.post('/opens/:intentId/transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-transaction', LOOTBOX_RATE_LIMITS.open)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await buildLootboxOpenTransaction({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to build lootbox transaction');
  }
});

router.post('/opens/:intentId/signature', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-signature', LOOTBOX_RATE_LIMITS.open)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    res.json(await submitLootboxOpenSignature({
      userId: user.id,
      intentId: req.params.intentId,
      signature,
    }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to submit lootbox signature');
  }
});

router.post('/opens/:intentId/signed-transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'lootbox:open-signed-transaction', LOOTBOX_RATE_LIMITS.open)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signedTransactionBase64 = typeof req.body?.signedTransactionBase64 === 'string'
      ? req.body.signedTransactionBase64.trim()
      : '';
    res.json(await submitSignedLootboxOpenTransaction({
      userId: user.id,
      intentId: req.params.intentId,
      signedTransactionBase64,
    }));
  } catch (error) {
    sendLootboxError(res, error, 'Failed to submit signed lootbox transaction');
  }
});

export default router;
