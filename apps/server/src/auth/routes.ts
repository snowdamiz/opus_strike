import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { verifySignature, generateNonce, createSignMessage } from './verify';
import {
  createAuthToken,
  createPendingAuthToken,
  verifyAuthToken,
  verifyPendingAuthToken,
  type AuthTokenPayload,
  type PendingAuthTokenPayload,
} from './session';
import {
  createDiscordAuthorizationUrl,
  exchangeDiscordCode,
  fetchDiscordUser,
  getDiscordConfig,
  mapDiscordUserToIdentity,
  DiscordOAuthError,
} from './discord';
import { appendAuthStatus, sanitizeReturnTo } from './returnTo';
import { consumeOAuthState, createOAuthState, type OAuthStateRecord } from './oauthState';
import { consumeRateLimit } from './rateLimit';
import { serializeUser } from './userResponse';
import type { AuthAccountIdentity, AuthProviderName, PendingRegistrationIdentity } from './types';
import { getRankedSeason } from '../ranking/seasonService';

const router: RouterType = Router();

const JWT_EXPIRY = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PENDING_COOKIE_MAX_AGE = 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLIENT_ORIGIN = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000';

const AUTH_RATE_LIMITS = {
  nonce: { limit: 30, windowMs: 60 * 1000 },
  verify: { limit: 20, windowMs: 60 * 1000 },
  register: { limit: 10, windowMs: 60 * 1000 },
  oauthStart: { limit: 20, windowMs: 60 * 1000 },
  oauthCallback: { limit: 30, windowMs: 60 * 1000 },
} as const;

const LEADERBOARD_DEFAULT_LIMIT = 25;
const LEADERBOARD_MAX_LIMIT = 50;

interface NonceRecord {
  nonce: string;
  timestamp: number;
}

interface LeaderboardUserSummary {
  id: string;
  name: string;
  createdAt: Date;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCaptures: number;
  totalFlagReturns: number;
  totalScore: number;
  totalExperience: number;
  totalWagerGames: number;
  totalWagerWins: number;
  totalWagerLosses: number;
  totalWagerDraws: number;
  totalWageredLamports: bigint;
  totalWagerWonLamports: bigint;
  totalWagerLostLamports: bigint;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt: Date | null;
}

const leaderboardUserSelect = {
  id: true,
  name: true,
  createdAt: true,
  totalGames: true,
  totalWins: true,
  totalLosses: true,
  totalDraws: true,
  totalKills: true,
  totalDeaths: true,
  totalAssists: true,
  totalCaptures: true,
  totalFlagReturns: true,
  totalScore: true,
  totalExperience: true,
  totalWagerGames: true,
  totalWagerWins: true,
  totalWagerLosses: true,
  totalWagerDraws: true,
  totalWageredLamports: true,
  totalWagerWonLamports: true,
  totalWagerLostLamports: true,
  competitiveRating: true,
  rankedGames: true,
  rankedWins: true,
  rankedLosses: true,
  rankedDraws: true,
  rankedPlacementsRemaining: true,
  rankedPeakRating: true,
  rankedLastMatchAt: true,
} satisfies Prisma.UserSelect;

const leaderboardOrderBy: Prisma.UserOrderByWithRelationInput[] = [
  { totalScore: 'desc' },
  { totalWins: 'desc' },
  { totalKills: 'desc' },
  { totalGames: 'asc' },
  { createdAt: 'asc' },
];

const rankedLeaderboardOrderBy: Prisma.UserOrderByWithRelationInput[] = [
  { competitiveRating: 'desc' },
  { rankedWins: 'desc' },
  { rankedGames: 'asc' },
  { createdAt: 'asc' },
];

type LeaderboardMode = 'ranked' | 'score';

class ProviderConflictError extends Error {
  constructor(message = 'Provider account is already linked to another user') {
    super(message);
    this.name = 'ProviderConflictError';
  }
}

const nonceStore = new Map<string, NonceRecord>();

function setAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: COOKIE_MAX_AGE,
  });
}

function setPendingAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: PENDING_COOKIE_MAX_AGE,
  });
}

function clearAuthCookie(res: Response): void {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  });
}

function cleanupNonces(): void {
  const expiresBefore = Date.now() - NONCE_TTL_MS;
  for (const [address, data] of nonceStore.entries()) {
    if (data.timestamp < expiresBefore) {
      nonceStore.delete(address);
    }
  }
}

setInterval(cleanupNonces, 5 * 60 * 1000).unref?.();

function enforceJsonRateLimit(req: Request, res: Response, keyPrefix: string, options: {
  limit: number;
  windowMs: number;
}): boolean {
  const result = consumeRateLimit(req, { keyPrefix, ...options });
  if (result.ok) return true;

  res.setHeader('Retry-After', result.retryAfterSeconds.toString());
  res.status(429).json({ error: 'Too many requests' });
  return false;
}

function isPrismaUniqueError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isUserNameUniqueError(error: unknown): boolean {
  if (!isPrismaUniqueError(error)) return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('name');
  }

  return typeof target === 'string' && (
    target.includes('User_name_lower_key') ||
    target.includes('User_name_key') ||
    target.includes('name')
  );
}

function getRequestToken(req: Request): string | null {
  const token = req.cookies?.auth_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function getClientOrigin(): string {
  return process.env.CLIENT_ORIGIN
    || process.env.CLIENT_URL
    || process.env.PUBLIC_CLIENT_ORIGIN
    || DEFAULT_CLIENT_ORIGIN;
}

function redirectToClient(res: Response, returnTo: string, params: Record<string, string>): void {
  const returnPath = appendAuthStatus(returnTo, params);
  const clientOrigin = getClientOrigin();

  if (!clientOrigin) {
    res.redirect(303, returnPath);
    return;
  }

  res.redirect(303, new URL(returnPath, clientOrigin).toString());
}

function getSafeOAuthReturnTo(record: OAuthStateRecord | null): string {
  return record?.returnTo ?? '/';
}

function getAccountData(identity: AuthAccountIdentity) {
  return {
    provider: identity.provider,
    providerAccountId: identity.providerAccountId,
    displayName: identity.displayName ?? null,
    avatarUrl: identity.avatarUrl ?? null,
    emailHash: identity.emailHash ?? null,
  };
}

function validatePlayerName(value: unknown): {
  ok: true;
  name: string;
} | {
  ok: false;
  error: string;
} {
  if (typeof value !== 'string') {
    return { ok: false, error: 'Name is required' };
  }

  const name = value.trim();
  if (name.length < 2 || name.length > 16) {
    return { ok: false, error: 'Name must be between 2 and 16 characters' };
  }

  return { ok: true, name };
}

function getLeaderboardLimit(value: unknown): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = typeof rawValue === 'string'
    ? Number.parseInt(rawValue, 10)
    : LEADERBOARD_DEFAULT_LIMIT;

  if (!Number.isFinite(parsed)) return LEADERBOARD_DEFAULT_LIMIT;
  return Math.max(1, Math.min(LEADERBOARD_MAX_LIMIT, parsed));
}

function getLeaderboardMode(value: unknown): LeaderboardMode {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue === 'score' ? 'score' : 'ranked';
}

function serializeLeaderboardStats(user: LeaderboardUserSummary) {
  return {
    totalGames: user.totalGames,
    totalWins: user.totalWins,
    totalLosses: user.totalLosses,
    totalDraws: user.totalDraws,
    totalKills: user.totalKills,
    totalDeaths: user.totalDeaths,
    totalAssists: user.totalAssists,
    totalCaptures: user.totalCaptures,
    totalFlagReturns: user.totalFlagReturns,
    totalScore: user.totalScore,
    totalExperience: user.totalExperience,
    totalWagerGames: user.totalWagerGames,
    totalWagerWins: user.totalWagerWins,
    totalWagerLosses: user.totalWagerLosses,
    totalWagerDraws: user.totalWagerDraws,
    totalWageredLamports: user.totalWageredLamports.toString(),
    totalWagerWonLamports: user.totalWagerWonLamports.toString(),
    totalWagerLostLamports: user.totalWagerLostLamports.toString(),
    competitiveRating: user.competitiveRating,
    rankedGames: user.rankedGames,
    rankedWins: user.rankedWins,
    rankedLosses: user.rankedLosses,
    rankedDraws: user.rankedDraws,
    rankedPlacementsRemaining: user.rankedPlacementsRemaining,
    rankedPeakRating: user.rankedPeakRating,
    rankedLastMatchAt: user.rankedLastMatchAt?.toISOString() ?? null,
  };
}

function serializeLeaderboardEntry(user: LeaderboardUserSummary, rank: number) {
  return {
    rank,
    userId: user.id,
    name: user.name,
    stats: serializeLeaderboardStats(user),
  };
}

async function findUserForPayload(payload: AuthTokenPayload) {
  const filters: Prisma.UserWhereInput[] = [{ id: payload.userId }];
  if (payload.walletAddress) {
    filters.push({ walletAddress: payload.walletAddress });
  }

  const user = await prisma.user.findFirst({
    where: { OR: filters },
    include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
  });

  if (!user || (payload.walletAddress && user.walletAddress !== payload.walletAddress)) {
    return null;
  }

  return user;
}

async function getScoreLeaderboardRank(user: LeaderboardUserSummary): Promise<number | null> {
  if (user.totalGames <= 0) return null;

  const higherRankedUsers = await prisma.user.count({
    where: {
      totalGames: { gt: 0 },
      OR: [
        { totalScore: { gt: user.totalScore } },
        {
          totalScore: user.totalScore,
          totalWins: { gt: user.totalWins },
        },
        {
          totalScore: user.totalScore,
          totalWins: user.totalWins,
          totalKills: { gt: user.totalKills },
        },
        {
          totalScore: user.totalScore,
          totalWins: user.totalWins,
          totalKills: user.totalKills,
          totalGames: { lt: user.totalGames },
        },
        {
          totalScore: user.totalScore,
          totalWins: user.totalWins,
          totalKills: user.totalKills,
          totalGames: user.totalGames,
          createdAt: { lt: user.createdAt },
        },
      ],
    },
  });

  return higherRankedUsers + 1;
}

async function getRankedLeaderboardRank(user: LeaderboardUserSummary): Promise<number | null> {
  if (user.rankedGames <= 0) return null;

  const higherRankedUsers = await prisma.user.count({
    where: {
      rankedGames: { gt: 0 },
      OR: [
        { competitiveRating: { gt: user.competitiveRating } },
        {
          competitiveRating: user.competitiveRating,
          rankedWins: { gt: user.rankedWins },
        },
        {
          competitiveRating: user.competitiveRating,
          rankedWins: user.rankedWins,
          rankedGames: { lt: user.rankedGames },
        },
        {
          competitiveRating: user.competitiveRating,
          rankedWins: user.rankedWins,
          rankedGames: user.rankedGames,
          createdAt: { lt: user.createdAt },
        },
      ],
    },
  });

  return higherRankedUsers + 1;
}

async function getAuthenticatedPayload(req: Request): Promise<AuthTokenPayload | null> {
  const token = getRequestToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}

async function ensureProviderAccount(userId: string, identity: AuthAccountIdentity): Promise<void> {
  const existingAccount = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
  });

  if (existingAccount && existingAccount.userId !== userId) {
    throw new ProviderConflictError();
  }

  if (existingAccount) {
    await prisma.authAccount.update({
      where: { id: existingAccount.id },
      data: getAccountData(identity),
    });
    return;
  }

  await prisma.authAccount.create({
    data: {
      userId,
      ...getAccountData(identity),
    },
  });
}

async function linkPhantomAccountToUser(userId: string, walletAddress: string) {
  return prisma.$transaction(async (tx) => {
    const [currentUser, existingAccount, walletUser] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
      }),
      tx.authAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'phantom',
            providerAccountId: walletAddress,
          },
        },
      }),
      tx.user.findUnique({
        where: { walletAddress },
        select: { id: true },
      }),
    ]);

    if (!currentUser) {
      throw new ProviderConflictError('Authenticated user was not found');
    }

    if (currentUser.walletAddress && currentUser.walletAddress !== walletAddress) {
      throw new ProviderConflictError('This profile already has a different Phantom wallet linked');
    }

    const currentPhantomAccount = currentUser.authAccounts.find((account) => account.provider === 'phantom');
    if (currentPhantomAccount && currentPhantomAccount.providerAccountId !== walletAddress) {
      throw new ProviderConflictError('This profile already has a different Phantom wallet linked');
    }

    if (existingAccount && existingAccount.userId !== userId) {
      throw new ProviderConflictError('That Phantom wallet is already linked to another profile');
    }

    if (walletUser && walletUser.id !== userId) {
      throw new ProviderConflictError('That Phantom wallet is already linked to another profile');
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        walletAddress,
        lastLoginAt: new Date(),
      },
    });

    await tx.authAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'phantom',
          providerAccountId: walletAddress,
        },
      },
      update: {
        displayName: walletAddress,
        avatarUrl: null,
        emailHash: null,
      },
      create: {
        userId,
        provider: 'phantom',
        providerAccountId: walletAddress,
        displayName: walletAddress,
      },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
    });
  });
}

async function issueUserSession(res: Response, userId: string, provider: AuthProviderName): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
    include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
  });

  setAuthCookie(res, createAuthToken({
    userId: user.id,
    provider,
    walletAddress: user.walletAddress,
    expiresIn: JWT_EXPIRY,
  }));
}

async function createRegisteredUser(identity: PendingRegistrationIdentity, name: string) {
  const walletAddress = identity.provider === 'phantom' ? identity.walletAddress ?? identity.providerAccountId : null;
  if (identity.provider === 'phantom' && !walletAddress) {
    throw new Error('Wallet address is required');
  }

  return prisma.user.create({
    data: {
      walletAddress,
      name,
      lastLoginAt: new Date(),
      authAccounts: {
        create: getAccountData({
          ...identity,
          providerAccountId: identity.provider === 'phantom' ? walletAddress! : identity.providerAccountId,
          displayName: identity.displayName ?? (identity.provider === 'phantom' ? walletAddress : null),
        }),
      },
    },
    include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
  });
}

async function isPlayerNameTaken(name: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: {
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
    select: { id: true },
  });

  return existing !== null;
}

async function completePendingRegistration(pending: PendingAuthTokenPayload, name: string) {
  const identity: PendingRegistrationIdentity = {
    provider: pending.provider,
    providerAccountId: pending.provider === 'phantom'
      ? pending.walletAddress ?? pending.providerAccountId
      : pending.providerAccountId,
    displayName: pending.displayName,
    avatarUrl: pending.avatarUrl,
    emailHash: pending.emailHash,
    walletAddress: pending.walletAddress,
  };

  const existingAccount = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
  });

  if (existingAccount) {
    throw new ProviderConflictError('Provider account already exists');
  }

  if (identity.provider === 'phantom') {
    const existingWalletUser = await prisma.user.findUnique({
      where: { walletAddress: identity.providerAccountId },
    });

    if (existingWalletUser) {
      throw new ProviderConflictError('User already exists');
    }
  }

  return createRegisteredUser(identity, name);
}

function getOAuthErrorReason(error: unknown): string {
  if (error instanceof DiscordOAuthError) return error.reason;
  if (error instanceof ProviderConflictError) return 'provider_conflict';
  if (isPrismaUniqueError(error)) return 'provider_conflict';
  return 'discord_failed';
}

function logOAuthFailure(reason: string, details?: unknown): void {
  if (details instanceof DiscordOAuthError || details instanceof ProviderConflictError) {
    console.warn('[auth] Discord OAuth failed', { provider: 'discord', reason });
    return;
  }

  console.error('[auth] Discord OAuth failed', { provider: 'discord', reason, error: details });
}

router.get('/nonce', (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:nonce', AUTH_RATE_LIMITS.nonce)) return;

  const walletAddress = typeof req.query.walletAddress === 'string' ? req.query.walletAddress : '';
  if (!walletAddress) {
    res.status(400).json({ error: 'Wallet address is required' });
    return;
  }

  cleanupNonces();
  const nonce = generateNonce();
  const message = createSignMessage(nonce);
  nonceStore.set(walletAddress, { nonce, timestamp: Date.now() });
  res.json({ nonce, message });
});

router.post('/verify', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:verify', AUTH_RATE_LIMITS.verify)) return;

  try {
    const { walletAddress, signature, nonce } = req.body;

    if (!walletAddress || !signature || !nonce) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const storedData = nonceStore.get(walletAddress);
    if (!storedData || storedData.nonce !== nonce || Date.now() - storedData.timestamp > NONCE_TTL_MS) {
      nonceStore.delete(walletAddress);
      res.status(401).json({ error: 'Invalid or expired nonce' });
      return;
    }

    const message = createSignMessage(nonce);
    const isValid = verifySignature(message, signature, walletAddress);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    nonceStore.delete(walletAddress);

    const providerIdentity: AuthAccountIdentity = {
      provider: 'phantom',
      providerAccountId: walletAddress,
      displayName: walletAddress,
    };

    const linkedAccount = await prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'phantom',
          providerAccountId: walletAddress,
        },
      },
      include: { user: { include: { authAccounts: { orderBy: { createdAt: 'asc' } } } } },
    });
    const walletUser = linkedAccount?.user ?? await prisma.user.findUnique({
      where: { walletAddress },
      include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
    });

    const authenticatedPayload = await getAuthenticatedPayload(req);
    const authenticatedUser = authenticatedPayload ? await findUserForPayload(authenticatedPayload) : null;

    if (authenticatedUser && (!walletUser || walletUser.id === authenticatedUser.id)) {
      const user = await linkPhantomAccountToUser(authenticatedUser.id, walletAddress);
      setAuthCookie(res, createAuthToken({
        userId: user.id,
        provider: 'phantom',
        walletAddress: user.walletAddress,
        expiresIn: JWT_EXPIRY,
      }));

      res.json({
        authenticated: true,
        isNewUser: false,
        provider: 'phantom',
        linked: true,
        user: serializeUser(user),
      });
      return;
    }

    if (authenticatedUser && walletUser && walletUser.id !== authenticatedUser.id) {
      res.status(409).json({ error: 'That Phantom wallet is already linked to another profile' });
      return;
    }

    if (walletUser) {
      await ensureProviderAccount(walletUser.id, providerIdentity);
      await issueUserSession(res, walletUser.id, 'phantom');

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: walletUser.id },
        include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
      });

      res.json({
        authenticated: true,
        isNewUser: false,
        provider: 'phantom',
        user: serializeUser(user),
      });
      return;
    }

    const tempToken = createPendingAuthToken({
      provider: 'phantom',
      providerAccountId: walletAddress,
      walletAddress,
      displayName: walletAddress,
    });
    setPendingAuthCookie(res, tempToken);

    res.json({
      authenticated: true,
      isNewUser: true,
      provider: 'phantom',
      walletAddress,
      pendingRegistration: {
        provider: 'phantom',
        walletAddress,
        displayName: walletAddress,
      },
    });
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (isPrismaUniqueError(error)) {
      res.status(409).json({ error: 'That Phantom wallet is already linked to another profile' });
      return;
    }

    console.error('[auth] Phantom verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:register', AUTH_RATE_LIMITS.register)) return;

  try {
    const validation = validatePlayerName(req.body?.name);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const token = getRequestToken(req);
    const pending = token ? verifyPendingAuthToken(token) : null;

    if (!pending) {
      res.status(401).json({ error: 'No pending registration found' });
      return;
    }

    if (
      pending.provider === 'phantom' &&
      typeof req.body?.walletAddress === 'string' &&
      pending.walletAddress &&
      req.body.walletAddress !== pending.walletAddress
    ) {
      res.status(400).json({ error: 'Wallet address does not match pending registration' });
      return;
    }

    if (await isPlayerNameTaken(validation.name)) {
      res.status(409).json({ error: 'Callsign is already taken' });
      return;
    }

    const newUser = await completePendingRegistration(pending, validation.name);
    setAuthCookie(res, createAuthToken({
      userId: newUser.id,
      provider: pending.provider,
      walletAddress: newUser.walletAddress,
      expiresIn: JWT_EXPIRY,
    }));

    res.json({
      success: true,
      provider: pending.provider,
      user: serializeUser(newUser),
    });
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      res.status(409).json({ error: error.message || 'User already exists' });
      return;
    }

    if (isUserNameUniqueError(error)) {
      res.status(409).json({ error: 'Callsign is already taken' });
      return;
    }

    if (isPrismaUniqueError(error)) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    console.error('[auth] Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/session', async (req: Request, res: Response) => {
  const quiet = req.query.quiet === '1' || req.query.quiet === 'true';
  const sendUnauthenticated = (error: string, clearCookie = false) => {
    if (clearCookie) {
      clearAuthCookie(res);
    }

    const body = { authenticated: false, error };
    if (quiet) {
      res.json(body);
      return;
    }

    res.status(401).json(body);
  };

  try {
    const token = getRequestToken(req);
    if (!token) {
      sendUnauthenticated('No session found');
      return;
    }

    const pending = verifyPendingAuthToken(token);
    if (pending) {
      res.json({
        authenticated: true,
        isNewUser: true,
        provider: pending.provider,
        pendingRegistration: {
          provider: pending.provider,
          displayName: pending.displayName,
          avatarUrl: pending.avatarUrl,
          walletAddress: pending.walletAddress,
        },
      });
      return;
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      sendUnauthenticated('Invalid or expired session', true);
      return;
    }

    const user = await findUserForPayload(payload);
    if (!user) {
      sendUnauthenticated('User not found', true);
      return;
    }

    setAuthCookie(res, createAuthToken({
      userId: user.id,
      provider: payload.provider,
      walletAddress: user.walletAddress,
      expiresIn: JWT_EXPIRY,
    }));

    res.json({
      authenticated: true,
      isNewUser: false,
      provider: payload.provider,
      user: serializeUser(user),
    });
  } catch (error) {
    console.error('[auth] Session validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/discord/start', (req: Request, res: Response) => {
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  const rateLimit = consumeRateLimit(req, {
    keyPrefix: 'auth:discord:start',
    ...AUTH_RATE_LIMITS.oauthStart,
  });

  if (!rateLimit.ok) {
    redirectToClient(res, returnTo, { auth: 'error', error: 'rate_limited' });
    return;
  }

  try {
    const state = createOAuthState({
      provider: 'discord',
      mode: 'login',
      returnTo,
    });
    const url = createDiscordAuthorizationUrl(getDiscordConfig(req), state.state);
    res.redirect(303, url);
  } catch (error) {
    const reason = getOAuthErrorReason(error);
    logOAuthFailure(reason, error);
    redirectToClient(res, returnTo, { auth: 'error', error: reason });
  }
});

router.get('/discord/link/start', async (req: Request, res: Response) => {
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  const rateLimit = consumeRateLimit(req, {
    keyPrefix: 'auth:discord:link:start',
    ...AUTH_RATE_LIMITS.oauthStart,
  });

  if (!rateLimit.ok) {
    redirectToClient(res, returnTo, { auth: 'error', error: 'rate_limited' });
    return;
  }

  try {
    const payload = await getAuthenticatedPayload(req);
    const user = payload ? await findUserForPayload(payload) : null;
    if (!user) {
      redirectToClient(res, returnTo, { auth: 'error', error: 'login_required' });
      return;
    }

    const alreadyLinked = user.authAccounts.some((account) => account.provider === 'discord');
    if (alreadyLinked) {
      redirectToClient(res, returnTo, { auth: 'linked', provider: 'discord' });
      return;
    }

    const state = createOAuthState({
      provider: 'discord',
      mode: 'link',
      returnTo,
      linkUserId: user.id,
    });
    const url = createDiscordAuthorizationUrl(getDiscordConfig(req), state.state);
    res.redirect(303, url);
  } catch (error) {
    const reason = getOAuthErrorReason(error);
    logOAuthFailure(reason, error);
    redirectToClient(res, returnTo, { auth: 'error', error: reason });
  }
});

router.get('/discord/callback', async (req: Request, res: Response) => {
  const consumedState = consumeOAuthState(req.query.state);
  const stateRecord = consumedState.ok ? consumedState.record : null;
  const returnTo = getSafeOAuthReturnTo(stateRecord);

  const rateLimit = consumeRateLimit(req, {
    keyPrefix: 'auth:discord:callback',
    ...AUTH_RATE_LIMITS.oauthCallback,
  });

  if (!rateLimit.ok) {
    redirectToClient(res, returnTo, { auth: 'error', error: 'rate_limited' });
    return;
  }

  if (!consumedState.ok || stateRecord?.provider !== 'discord') {
    redirectToClient(res, returnTo, { auth: 'error', error: `invalid_state_${consumedState.ok ? 'provider' : consumedState.reason}` });
    return;
  }

  if (typeof req.query.error === 'string') {
    redirectToClient(res, returnTo, { auth: 'error', error: 'oauth_denied' });
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    redirectToClient(res, returnTo, { auth: 'error', error: 'missing_code' });
    return;
  }

  try {
    const config = getDiscordConfig(req);
    const accessToken = await exchangeDiscordCode({ config, code });
    const discordUser = await fetchDiscordUser(accessToken);
    const identity = mapDiscordUserToIdentity(discordUser);

    const existingAccount = await prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'discord',
          providerAccountId: identity.providerAccountId,
        },
      },
      include: { user: { include: { authAccounts: { orderBy: { createdAt: 'asc' } } } } },
    });

    if (existingAccount) {
      if (stateRecord.mode === 'link' && existingAccount.userId !== stateRecord.linkUserId) {
        redirectToClient(res, returnTo, { auth: 'error', error: 'provider_conflict' });
        return;
      }

      await prisma.authAccount.update({
        where: { id: existingAccount.id },
        data: getAccountData(identity),
      });
      await issueUserSession(res, existingAccount.userId, 'discord');

      redirectToClient(res, returnTo, {
        auth: stateRecord.mode === 'link' ? 'linked' : 'success',
        provider: 'discord',
      });
      return;
    }

    if (stateRecord.mode === 'link') {
      if (!stateRecord.linkUserId) {
        redirectToClient(res, returnTo, { auth: 'error', error: 'invalid_link_state' });
        return;
      }

      const linkedUser = await prisma.user.update({
        where: { id: stateRecord.linkUserId },
        data: {
          lastLoginAt: new Date(),
          authAccounts: {
            create: getAccountData(identity),
          },
        },
        include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
      });

      setAuthCookie(res, createAuthToken({
        userId: linkedUser.id,
        provider: 'discord',
        walletAddress: linkedUser.walletAddress,
        expiresIn: JWT_EXPIRY,
      }));

      redirectToClient(res, returnTo, { auth: 'linked', provider: 'discord' });
      return;
    }

    const pendingToken = createPendingAuthToken(identity);
    setPendingAuthCookie(res, pendingToken);
    redirectToClient(res, returnTo, { auth: 'pending_registration', provider: 'discord' });
  } catch (error) {
    const reason = getOAuthErrorReason(error);
    logOAuthFailure(reason, error);
    redirectToClient(res, returnTo, { auth: 'error', error: reason });
  }
});

router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = getLeaderboardLimit(req.query.limit);
    const mode = getLeaderboardMode(req.query.mode);
    const leaderboardUsers = await prisma.user.findMany({
      where: mode === 'ranked' ? { rankedGames: { gt: 0 } } : { totalGames: { gt: 0 } },
      orderBy: mode === 'ranked' ? rankedLeaderboardOrderBy : leaderboardOrderBy,
      take: limit,
      select: leaderboardUserSelect,
    });

    const payload = await getAuthenticatedPayload(req);
    const user = payload ? await findUserForPayload(payload) : null;
    const personalRank = user
      ? await (mode === 'ranked' ? getRankedLeaderboardRank(user) : getScoreLeaderboardRank(user))
      : null;

    res.json({
      mode,
      leaderboard: leaderboardUsers.map((leaderboardUser, index) => (
        serializeLeaderboardEntry(leaderboardUser, index + 1)
      )),
      currentUser: user ? {
        rank: personalRank,
        userId: user.id,
        name: user.name,
        stats: serializeLeaderboardStats(user),
      } : null,
    });
  } catch (error) {
    console.error('[auth] Leaderboard lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ranked-season', async (_req: Request, res: Response) => {
  try {
    const { mode, seasonNumber, label, endsAt } = await getRankedSeason();
    res.json({ mode, seasonNumber, label, endsAt });
  } catch (error) {
    console.error('[auth] Ranked season lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

router.get('/user/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    const user = await prisma.user.findUnique({
      where: { walletAddress },
      include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: serializeUser(user) });
  } catch (error) {
    console.error('[auth] User lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
