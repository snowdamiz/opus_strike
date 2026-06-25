import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import prisma from '../db';
import { enforceJsonRateLimit, getRequestAuthToken } from '../auth/http';
import { verifyAuthToken } from '../auth/session';
import {
  SkinShopServiceError,
  buildSkinPurchaseTransaction,
  createSkinPurchaseIntent,
  getSkinCatalogForUser,
  getSkinPurchaseIntent,
  parseHeroIdParam,
  parseSkinIdInput,
  simulateSkinPurchaseTransaction,
  submitSignedSkinPurchaseTransaction,
  submitSkinPurchaseSignature,
  updateUserHeroLoadout,
} from './skinShopService';

const router: RouterType = Router();

const COSMETICS_RATE_LIMITS = {
  read: { limit: 90, windowMs: 60 * 1000 },
  mutate: { limit: 30, windowMs: 60 * 1000 },
  purchase: { limit: 12, windowMs: 60 * 1000 },
} as const;

interface AuthenticatedCosmeticsUser {
  id: string;
  walletAddress: string | null;
  name: string;
}

async function readAuthenticatedUser(req: Request): Promise<AuthenticatedCosmeticsUser | null> {
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

async function requireUser(req: Request, res: Response): Promise<AuthenticatedCosmeticsUser | null> {
  const user = await readAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to manage skins' });
    return null;
  }
  return user;
}

function sendCosmeticsError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SkinShopServiceError) {
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

router.get('/catalog', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:catalog', COSMETICS_RATE_LIMITS.read)) return;
  try {
    const user = await readAuthenticatedUser(req);
    res.json(await getSkinCatalogForUser(user?.id));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to load skin catalog');
  }
});

router.put('/loadouts/:heroId', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:loadout', COSMETICS_RATE_LIMITS.mutate)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const heroId = parseHeroIdParam(req.params.heroId);
    const skinId = parseSkinIdInput(req.body?.skinId);
    if (!heroId || !skinId) {
      res.status(400).json({ error: 'Invalid hero or skin' });
      return;
    }
    res.json(await updateUserHeroLoadout({ userId: user.id, heroId, skinId }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to update loadout');
  }
});

router.post('/purchases/intents', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-intent', COSMETICS_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const skinId = parseSkinIdInput(req.body?.skinId);
    if (!skinId) {
      res.status(400).json({ error: 'Invalid skin' });
      return;
    }
    res.json(await createSkinPurchaseIntent({ userId: user.id, skinId }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to create purchase intent');
  }
});

router.get('/purchases/intents/:intentId', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-status', COSMETICS_RATE_LIMITS.read)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await getSkinPurchaseIntent({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to load purchase intent');
  }
});

router.post('/purchases/intents/:intentId/transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-transaction', COSMETICS_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await buildSkinPurchaseTransaction({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to build purchase transaction');
  }
});

router.post('/purchases/intents/:intentId/simulate', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-simulate', COSMETICS_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const transactionBase64 = typeof req.body?.transactionBase64 === 'string'
      ? req.body.transactionBase64.trim()
      : '';
    res.json(await simulateSkinPurchaseTransaction({
      userId: user.id,
      intentId: req.params.intentId,
      transactionBase64,
    }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to simulate purchase transaction');
  }
});

router.post('/purchases/intents/:intentId/signature', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-signature', COSMETICS_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    res.json(await submitSkinPurchaseSignature({
      userId: user.id,
      intentId: req.params.intentId,
      signature,
    }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to submit purchase signature');
  }
});

router.post('/purchases/intents/:intentId/signed-transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'cosmetics:purchase-signed-transaction', COSMETICS_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signedTransactionBase64 = typeof req.body?.signedTransactionBase64 === 'string'
      ? req.body.signedTransactionBase64.trim()
      : '';
    res.json(await submitSignedSkinPurchaseTransaction({
      userId: user.id,
      intentId: req.params.intentId,
      signedTransactionBase64,
    }));
  } catch (error) {
    sendCosmeticsError(res, error, 'Failed to submit signed purchase transaction');
  }
});

export default router;
