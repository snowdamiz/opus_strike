import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import prisma from '../db';
import { verifyAuthToken } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { isAdminRetryAllowed } from './config';
import { wagerService } from './service';

const router: ExpressRouter = Router();

async function requireAuthUser(req: Request): Promise<{ userId: string; walletAddress: string | null }> {
  const token = req.cookies?.auth_token;
  const payload = typeof token === 'string' ? verifyAuthToken(token) : null;
  if (!payload) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, walletAddress: true },
  });
  if (!user) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }
  await assertGameplayAccountEligible(user.id);

  return { userId: user.id, walletAddress: user.walletAddress };
}

function sendRouteError(res: Response, error: unknown): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : 500;
  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
}

router.get('/lobbies/:lobbyId', async (req, res) => {
  try {
    res.json({ wager: await wagerService.getLobbySnapshot(req.params.lobbyId) });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/lobbies/preflight', async (req, res) => {
  try {
    const normalized = wagerService.normalizeCreateOptions(req.body?.wager);
    if (!normalized.enabled) {
      res.json({ wager: { enabled: false } });
      return;
    }

    res.json({
      wager: {
        enabled: true,
        token: normalized.token,
        coverChargeLamports: normalized.coverChargeLamports.toString(),
        cluster: wagerService.getConfig().cluster,
        minCoverChargeLamports: wagerService.getConfig().minCoverChargeLamports.toString(),
        maxCoverChargeLamports: wagerService.getConfig().maxCoverChargeLamports.toString(),
        platformFeeBps: normalized.platformFeeBps,
      },
    });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/lobbies/:lobbyId/intents', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const walletAddress = typeof req.body?.walletAddress === 'string'
      ? req.body.walletAddress
      : user.walletAddress;
    if (!walletAddress) {
      throw Object.assign(new Error('A connected Solana wallet is required'), { statusCode: 400 });
    }

    const intent = await wagerService.createPaymentIntent({
      lobbyId: req.params.lobbyId,
      userId: user.userId,
      walletAddress,
      lobbyPlayerId: typeof req.body?.lobbyPlayerId === 'string' ? req.body.lobbyPlayerId : null,
      rankedEntryQuoteId: typeof req.body?.rankedEntryQuoteId === 'string' ? req.body.rankedEntryQuoteId : null,
    });
    res.json({ intent });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/intents/:intentId/signature', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : '';
    const intent = await wagerService.submitPaymentSignature({
      intentId: req.params.intentId,
      userId: user.userId,
      signature,
    });
    res.json({ intent });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/intents/:intentId/transaction', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const transaction = await wagerService.buildPaymentTransaction({
      intentId: req.params.intentId,
      userId: user.userId,
    });
    res.json({ transaction });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/intents/:intentId/signed-transaction', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const signedTransactionBase64 = typeof req.body?.signedTransactionBase64 === 'string'
      ? req.body.signedTransactionBase64
      : '';
    const intent = await wagerService.submitSignedPaymentTransaction({
      intentId: req.params.intentId,
      userId: user.userId,
      signedTransactionBase64,
    });
    res.json({ intent });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.post('/settlements/:settlementId/retry', async (req, res) => {
  try {
    const token = typeof req.headers['x-wager-admin-token'] === 'string'
      ? req.headers['x-wager-admin-token']
      : undefined;
    if (!isAdminRetryAllowed(token)) {
      throw Object.assign(new Error('Admin token required'), { statusCode: 403 });
    }

    const settlement = await wagerService.retrySettlement(req.params.settlementId);
    res.json({ settlement });
  } catch (error) {
    sendRouteError(res, error);
  }
});

export default router;
