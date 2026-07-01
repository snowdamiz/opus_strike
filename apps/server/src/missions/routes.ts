import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import prisma from '../db';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { verifyAuthToken } from '../auth/session';
import { dailyMissionService } from './service';

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

router.get('/daily', async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    res.json(await dailyMissionService.getPlayerDailyMissions(user.userId));
  } catch (error) {
    sendRouteError(res, error);
  }
});

export default router;

