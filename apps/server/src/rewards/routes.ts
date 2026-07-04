import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import prisma from '../db';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { verifyAuthToken } from '../auth/session';
import { getRankedEntryGateSettings } from '../matchmaking/rankedTokenHold';
import { wagerService } from '../wagers/service';
import { playerRewardService } from './service';

const router: ExpressRouter = Router();

async function requireAuthUser(req: Request): Promise<{ userId: string }> {
  const token = req.cookies?.auth_token;
  const payload = typeof token === 'string' ? verifyAuthToken(token) : null;
  if (!payload) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true },
  });
  if (!user) {
    throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  }
  await assertGameplayAccountEligible(user.id);

  return { userId: user.id };
}

function sendRouteError(res: Response, error: unknown): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : 500;
  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
}

router.get('/economy', async (_req, res) => {
  try {
    const [playerRewards, wagers, goldenBiome, rankedEntryGate] = await Promise.all([
      playerRewardService.getSettingsOverview(),
      wagerService.getWagerEconomy(),
      wagerService.getGoldenBiomeSettings(),
      getRankedEntryGateSettings(),
    ]);
    const rewardTokenSymbol = rankedEntryGate.tokenMintAddress ? rankedEntryGate.tokenSymbol : null;
    res.json({
      economy: {
        rewardTokenSymbol,
        rankedEntryGate: {
          mode: rankedEntryGate.mode,
          tokenAddress: rankedEntryGate.tokenAddress,
          requiredTokenAmount: rankedEntryGate.requiredTokenAmount,
        },
        playerRewards,
        wagers,
        goldenBiome,
      },
    });
  } catch (error) {
    sendRouteError(res, error);
  }
});

router.get('/', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    res.json({ rewards: await playerRewardService.getUserRewardSummary(user.userId) });
  } catch (error) {
    sendRouteError(res, error);
  }
});

export default router;
