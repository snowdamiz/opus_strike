import { Router, type Request, type Response } from 'express';
import type { Router as RouterType } from 'express';
import prisma from '../db';
import { enforceJsonRateLimit, getRequestAuthToken } from '../auth/http';
import { verifyAuthToken } from '../auth/session';
import {
  MarketplaceServiceError,
  buildMarketplacePurchaseTransaction,
  cancelMarketplaceListing,
  createMarketplaceListing,
  createMarketplacePurchaseIntent,
  getMarketplaceListings,
  getMarketplacePurchaseIntent,
  getMarketplaceStateForUser,
  getMyMarketplaceListings,
  submitMarketplacePurchaseSignature,
  submitSignedMarketplacePurchaseTransaction,
} from './service';

const router: RouterType = Router();

const MARKETPLACE_RATE_LIMITS = {
  read: { limit: 90, windowMs: 60 * 1000 },
  mutate: { limit: 30, windowMs: 60 * 1000 },
  purchase: { limit: 12, windowMs: 60 * 1000 },
} as const;

interface AuthenticatedMarketplaceUser {
  id: string;
  walletAddress: string | null;
  name: string;
}

async function readAuthenticatedUser(req: Request): Promise<AuthenticatedMarketplaceUser | null> {
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

async function requireUser(req: Request, res: Response): Promise<AuthenticatedMarketplaceUser | null> {
  const user = await readAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to use the marketplace' });
    return null;
  }
  return user;
}

function sendMarketplaceError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof MarketplaceServiceError) {
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
  if (!enforceJsonRateLimit(req, res, 'marketplace:state', MARKETPLACE_RATE_LIMITS.read)) return;
  try {
    const user = await readAuthenticatedUser(req);
    res.json(await getMarketplaceStateForUser(user));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to load marketplace state');
  }
});

router.get('/listings', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:listings', MARKETPLACE_RATE_LIMITS.read)) return;
  try {
    const user = await readAuthenticatedUser(req);
    res.json(await getMarketplaceListings(user?.id));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to load marketplace listings');
  }
});

router.get('/listings/mine', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:my-listings', MARKETPLACE_RATE_LIMITS.read)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await getMyMarketplaceListings(user.id));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to load your listings');
  }
});

router.post('/listings', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:create-listing', MARKETPLACE_RATE_LIMITS.mutate)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await createMarketplaceListing({
      userId: user.id,
      skinId: req.body?.skinId,
      priceLamports: req.body?.priceLamports,
    }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to create listing');
  }
});

router.post('/listings/:listingId/cancel', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:cancel-listing', MARKETPLACE_RATE_LIMITS.mutate)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await cancelMarketplaceListing({ userId: user.id, listingId: req.params.listingId }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to cancel listing');
  }
});

router.post('/listings/:listingId/intents', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:purchase-intent', MARKETPLACE_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const walletAddress = typeof req.body?.walletAddress === 'string'
      ? req.body.walletAddress
      : '';
    res.json(await createMarketplacePurchaseIntent({
      userId: user.id,
      listingId: req.params.listingId,
      walletAddress,
    }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to create purchase intent');
  }
});

router.get('/intents/:intentId', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:purchase-status', MARKETPLACE_RATE_LIMITS.read)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await getMarketplacePurchaseIntent({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to load purchase intent');
  }
});

router.post('/intents/:intentId/transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:purchase-transaction', MARKETPLACE_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json(await buildMarketplacePurchaseTransaction({ userId: user.id, intentId: req.params.intentId }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to build purchase transaction');
  }
});

router.post('/intents/:intentId/signature', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:purchase-signature', MARKETPLACE_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    res.json(await submitMarketplacePurchaseSignature({
      userId: user.id,
      intentId: req.params.intentId,
      signature,
    }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to submit purchase signature');
  }
});

router.post('/intents/:intentId/signed-transaction', async (req, res) => {
  if (!enforceJsonRateLimit(req, res, 'marketplace:purchase-signed-transaction', MARKETPLACE_RATE_LIMITS.purchase)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const signedTransactionBase64 = typeof req.body?.signedTransactionBase64 === 'string'
      ? req.body.signedTransactionBase64.trim()
      : '';
    res.json(await submitSignedMarketplacePurchaseTransaction({
      userId: user.id,
      intentId: req.params.intentId,
      signedTransactionBase64,
    }));
  } catch (error) {
    sendMarketplaceError(res, error, 'Failed to submit signed purchase transaction');
  }
});

export default router;
