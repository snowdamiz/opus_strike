import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { Prisma } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import {
  DEFAULT_COMPETITIVE_RATING,
  RANK_PLACEMENT_MATCHES,
  getRankedSeasonIdentity,
  getRankedSeasonLabel,
  normalizeRankedSeasonNumber,
  type RankedSeasonMode,
  type RankedSeasonSnapshot,
} from '@voxel-strike/shared';
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
import { enforceJsonRateLimit, getRequestAuthToken } from './http';
import { serializeUser } from './userResponse';
import type { AuthAccountIdentity, AuthProviderName, PendingRegistrationIdentity } from './types';
import { getRankedSeason } from '../ranking/seasonService';

const router: RouterType = Router();

const JWT_EXPIRY = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PENDING_COOKIE_MAX_AGE = 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_NONCE_RECORDS = 2_000;
const DEFAULT_CLIENT_ORIGIN = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000';

const AUTH_RATE_LIMITS = {
  nonce: { limit: 30, windowMs: 60 * 1000 },
  verify: { limit: 20, windowMs: 60 * 1000 },
  register: { limit: 10, windowMs: 60 * 1000 },
  tutorialComplete: { limit: 12, windowMs: 60 * 1000 },
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

interface RankedSeasonStatsSummary {
  userId: string;
  userName: string;
  createdAt: Date;
  updatedAt: Date;
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
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
  rankedLastMatchAt: Date | null;
}

interface LeaderboardSeasonOption extends Pick<RankedSeasonSnapshot, 'mode' | 'seasonNumber' | 'label' | 'endsAt'> {
  identity: string;
  current: boolean;
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

const rankedSeasonStatsSelect = {
  userId: true,
  userName: true,
  createdAt: true,
  updatedAt: true,
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
  competitiveRating: true,
  rankedGames: true,
  rankedWins: true,
  rankedLosses: true,
  rankedDraws: true,
  rankedPlacementsRemaining: true,
  rankedPeakRating: true,
  rankedLastMatchAt: true,
} satisfies Prisma.RankedSeasonUserStatsSelect;

const leaderboardOrderBy: Prisma.UserOrderByWithRelationInput[] = [
  { totalScore: 'desc' },
  { totalWins: 'desc' },
  { totalKills: 'desc' },
  { totalGames: 'asc' },
  { createdAt: 'asc' },
];

const rankedSeasonLeaderboardOrderBy: Prisma.RankedSeasonUserStatsOrderByWithRelationInput[] = [
  { competitiveRating: 'desc' },
  { rankedWins: 'desc' },
  { rankedGames: 'asc' },
  { updatedAt: 'asc' },
];

type LeaderboardMode = 'ranked' | 'score';

class ProviderConflictError extends Error {
  constructor(message = 'Provider account is already linked to another user') {
    super(message);
    this.name = 'ProviderConflictError';
  }
}

const nonceStore = new Map<string, NonceRecord>();

function authCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, authCookieOptions(COOKIE_MAX_AGE));
}

function setPendingAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, authCookieOptions(PENDING_COOKIE_MAX_AGE));
}

function clearAuthCookie(res: Response): void {
  res.clearCookie('auth_token', authCookieOptions());
}

function cleanupNonces(): void {
  const expiresBefore = Date.now() - NONCE_TTL_MS;
  for (const [address, data] of nonceStore.entries()) {
    if (data.timestamp < expiresBefore) {
      nonceStore.delete(address);
    }
  }
}

function trimNonces(): void {
  cleanupNonces();

  while (nonceStore.size >= MAX_NONCE_RECORDS) {
    const oldestAddress = nonceStore.keys().next().value as string | undefined;
    if (!oldestAddress) break;
    nonceStore.delete(oldestAddress);
  }
}

function normalizeWalletAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return null;

  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

setInterval(cleanupNonces, 5 * 60 * 1000).unref?.();

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

function getSeasonIdentity(mode: RankedSeasonMode, seasonNumber: number): string {
  return getRankedSeasonIdentity({
    mode,
    seasonNumber,
  });
}

function toLeaderboardSeasonOption(
  season: Pick<RankedSeasonSnapshot, 'mode' | 'seasonNumber' | 'endsAt'>,
  currentIdentity: string
): LeaderboardSeasonOption {
  const mode = season.mode === 'preseason' ? 'preseason' : 'season';
  const seasonNumber = normalizeRankedSeasonNumber(season.seasonNumber);
  const identity = getSeasonIdentity(mode, seasonNumber);

  return {
    identity,
    mode,
    seasonNumber,
    label: getRankedSeasonLabel({ mode, seasonNumber }),
    endsAt: season.endsAt ?? null,
    current: identity === currentIdentity,
  };
}

function getLeaderboardSeasonIdentity(value: unknown, currentIdentity: string): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string' || rawValue.trim() === '' || rawValue === 'current') {
    return currentIdentity;
  }

  const valueText = rawValue.trim().toLowerCase();
  const explicitSeason = /^season:(\d+)$/.exec(valueText);
  if (explicitSeason) {
    return getSeasonIdentity('season', Number.parseInt(explicitSeason[1], 10));
  }

  const numericSeason = Number.parseInt(valueText, 10);
  return Number.isFinite(numericSeason)
    ? getSeasonIdentity('season', numericSeason)
    : currentIdentity;
}

async function getLeaderboardSeasonOptions(currentSeason: RankedSeasonSnapshot): Promise<LeaderboardSeasonOption[]> {
  const currentIdentity = getRankedSeasonIdentity(currentSeason);
  const options = new Map<string, LeaderboardSeasonOption>();
  if (currentSeason.mode === 'season') {
    options.set(currentIdentity, toLeaderboardSeasonOption(currentSeason, currentIdentity));
  }

  const seasonRows = await prisma.rankedSeasonUserStats.findMany({
    where: { mode: 'season' },
    distinct: ['mode', 'seasonNumber'],
    select: {
      mode: true,
      seasonNumber: true,
    },
    orderBy: [
      { seasonNumber: 'desc' },
      { mode: 'asc' },
    ],
  });

  for (const row of seasonRows) {
    const option = toLeaderboardSeasonOption({
      mode: row.mode,
      seasonNumber: row.seasonNumber,
      endsAt: null,
    }, currentIdentity);
    options.set(option.identity, option);
  }

  return Array.from(options.values()).sort((a, b) => {
    if (a.current) return -1;
    if (b.current) return 1;
    return b.seasonNumber - a.seasonNumber;
  });
}

function getSelectedLeaderboardSeason(
  seasons: LeaderboardSeasonOption[],
  requestedIdentity: string,
  currentSeason: RankedSeasonSnapshot
): LeaderboardSeasonOption {
  const currentIdentity = getRankedSeasonIdentity(currentSeason);
  return seasons.find((season) => season.identity === requestedIdentity)
    ?? seasons.find((season) => season.current)
    ?? seasons[0]
    ?? toLeaderboardSeasonOption(currentSeason, currentIdentity);
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

function serializeRankedSeasonStats(stats: RankedSeasonStatsSummary) {
  return {
    totalGames: stats.totalGames,
    totalWins: stats.totalWins,
    totalLosses: stats.totalLosses,
    totalDraws: stats.totalDraws,
    totalKills: stats.totalKills,
    totalDeaths: stats.totalDeaths,
    totalAssists: stats.totalAssists,
    totalCaptures: stats.totalCaptures,
    totalFlagReturns: stats.totalFlagReturns,
    totalScore: stats.totalScore,
    totalExperience: stats.totalExperience,
    totalWagerGames: 0,
    totalWagerWins: 0,
    totalWagerLosses: 0,
    totalWagerDraws: 0,
    totalWageredLamports: '0',
    totalWagerWonLamports: '0',
    totalWagerLostLamports: '0',
    competitiveRating: stats.competitiveRating,
    rankedGames: stats.rankedGames,
    rankedWins: stats.rankedWins,
    rankedLosses: stats.rankedLosses,
    rankedDraws: stats.rankedDraws,
    rankedPlacementsRemaining: stats.rankedPlacementsRemaining,
    rankedPeakRating: stats.rankedPeakRating,
    rankedLastMatchAt: stats.rankedLastMatchAt?.toISOString() ?? null,
  };
}

function serializeEmptyRankedSeasonStats() {
  return {
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    totalDraws: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalCaptures: 0,
    totalFlagReturns: 0,
    totalScore: 0,
    totalExperience: 0,
    totalWagerGames: 0,
    totalWagerWins: 0,
    totalWagerLosses: 0,
    totalWagerDraws: 0,
    totalWageredLamports: '0',
    totalWagerWonLamports: '0',
    totalWagerLostLamports: '0',
    competitiveRating: DEFAULT_COMPETITIVE_RATING,
    rankedGames: 0,
    rankedWins: 0,
    rankedLosses: 0,
    rankedDraws: 0,
    rankedPlacementsRemaining: RANK_PLACEMENT_MATCHES,
    rankedPeakRating: DEFAULT_COMPETITIVE_RATING,
    rankedLastMatchAt: null,
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

function serializeRankedSeasonLeaderboardEntry(user: RankedSeasonStatsSummary, rank: number) {
  return {
    rank,
    userId: user.userId,
    name: user.userName,
    stats: serializeRankedSeasonStats(user),
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

  if (payload.provider === 'wallet') {
    const hasWalletAccount = Boolean(payload.walletAddress) && user.authAccounts.some((account) => (
      account.provider === 'wallet' &&
      account.providerAccountId === payload.walletAddress
    ));
    return hasWalletAccount ? user : null;
  }

  if (payload.provider && !user.authAccounts.some((account) => account.provider === payload.provider)) {
    return null;
  }

  if (!payload.provider && payload.walletAddress && user.walletAddress !== payload.walletAddress) {
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

async function getRankedSeasonLeaderboardRank(
  user: RankedSeasonStatsSummary,
  season: LeaderboardSeasonOption
): Promise<number | null> {
  if (user.rankedGames <= 0) return null;

  const higherRankedUsers = await prisma.rankedSeasonUserStats.count({
    where: {
      mode: season.mode,
      seasonNumber: season.seasonNumber,
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
          updatedAt: { lt: user.updatedAt },
        },
      ],
    },
  });

  return higherRankedUsers + 1;
}

async function getAuthenticatedPayload(req: Request): Promise<AuthTokenPayload | null> {
  const token = getRequestAuthToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}

async function linkWalletAccountToUser(userId: string, walletAddress: string) {
  return prisma.$transaction(async (tx) => {
    const [currentUser, existingAccount, walletUser] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
      }),
      tx.authAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'wallet',
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
      throw new ProviderConflictError('This profile already has a different wallet linked');
    }

    const currentWalletAccount = currentUser.authAccounts.find((account) => account.provider === 'wallet');
    if (currentWalletAccount && currentWalletAccount.providerAccountId !== walletAddress) {
      throw new ProviderConflictError('This profile already has a different wallet linked');
    }

    if (existingAccount && existingAccount.userId !== userId) {
      throw new ProviderConflictError('That wallet is already linked to another profile');
    }

    if (walletUser && walletUser.id !== userId) {
      throw new ProviderConflictError('That wallet is already linked to another profile');
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
          provider: 'wallet',
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
        provider: 'wallet',
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
  if (identity.provider === 'wallet' && !identity.walletAddress) {
    throw new ProviderConflictError('Wallet address is required');
  }

  return prisma.user.create({
    data: {
      walletAddress: identity.provider === 'wallet' ? identity.walletAddress! : null,
      name,
      lastLoginAt: new Date(),
      authAccounts: {
        create: getAccountData(identity),
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
    providerAccountId: pending.providerAccountId,
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

  const walletAddress = normalizeWalletAddress(req.query.walletAddress);
  if (!walletAddress) {
    res.status(400).json({ error: 'Valid wallet address is required' });
    return;
  }

  trimNonces();
  const nonce = generateNonce();
  const message = createSignMessage(nonce);
  nonceStore.set(walletAddress, { nonce, timestamp: Date.now() });
  res.json({ nonce, message });
});

router.post('/verify', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:verify', AUTH_RATE_LIMITS.verify)) return;

  try {
    const { signature, nonce } = req.body;
    const walletAddress = normalizeWalletAddress(req.body?.walletAddress);

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

    const linkedAccount = await prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'wallet',
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

    if (authenticatedUser) {
      if (walletUser && walletUser.id !== authenticatedUser.id) {
        res.status(409).json({ error: 'That wallet is already linked to another profile' });
        return;
      }

      const user = await linkWalletAccountToUser(authenticatedUser.id, walletAddress);
      const provider = authenticatedPayload?.provider ?? 'wallet';
      setAuthCookie(res, createAuthToken({
        userId: user.id,
        provider,
        walletAddress: user.walletAddress,
        expiresIn: JWT_EXPIRY,
      }));

      res.json({
        authenticated: true,
        isNewUser: false,
        provider,
        linked: true,
        user: serializeUser(user),
      });
      return;
    }

    if (walletUser) {
      const user = await prisma.user.update({
        where: { id: walletUser.id },
        data: { lastLoginAt: new Date() },
        include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
      });
      setAuthCookie(res, createAuthToken({
        userId: user.id,
        provider: 'wallet',
        walletAddress: user.walletAddress,
        expiresIn: JWT_EXPIRY,
      }));

      res.json({
        authenticated: true,
        isNewUser: false,
        provider: 'wallet',
        linked: false,
        user: serializeUser(user),
      });
      return;
    }

    const pendingRegistration: PendingRegistrationIdentity = {
      provider: 'wallet',
      providerAccountId: walletAddress,
      displayName: walletAddress,
      avatarUrl: null,
      emailHash: null,
      walletAddress,
    };
    setPendingAuthCookie(res, createPendingAuthToken(pendingRegistration));

    res.json({
      authenticated: true,
      isNewUser: true,
      provider: 'wallet',
      pendingRegistration: {
        provider: pendingRegistration.provider,
        displayName: pendingRegistration.displayName,
        avatarUrl: pendingRegistration.avatarUrl,
        walletAddress,
      },
    });
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (isPrismaUniqueError(error)) {
      res.status(409).json({ error: 'That wallet is already linked to another profile' });
      return;
    }

    console.error('[auth] Wallet verification error:', error);
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

    const token = getRequestAuthToken(req);
    const pending = token ? verifyPendingAuthToken(token) : null;

    if (!pending) {
      res.status(401).json({ error: 'No pending registration found' });
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
    const token = getRequestAuthToken(req);
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
      sendUnauthenticated('Authentication is required', true);
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

router.post('/tutorial/complete', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:tutorial:complete', AUTH_RATE_LIMITS.tutorialComplete)) return;

  try {
    const payload = await getAuthenticatedPayload(req);
    const user = payload ? await findUserForPayload(payload) : null;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const completedAt = user.tutorialCompletedAt ?? new Date();
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        tutorialCompletedAt: completedAt,
        lastLoginAt: new Date(),
      },
      include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
    });

    res.json({
      success: true,
      user: serializeUser(updatedUser),
    });
  } catch (error) {
    console.error('[auth] Tutorial completion error:', error);
    res.status(500).json({ error: 'Failed to save tutorial completion' });
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
    const currentSeason = await getRankedSeason();
    const seasons = await getLeaderboardSeasonOptions(currentSeason);
    const selectedSeason = getSelectedLeaderboardSeason(
      seasons,
      getLeaderboardSeasonIdentity(req.query.season, getRankedSeasonIdentity(currentSeason)),
      currentSeason
    );
    const payload = await getAuthenticatedPayload(req);
    const user = payload ? await findUserForPayload(payload) : null;

    if (mode === 'ranked') {
      const leaderboardUsers = await prisma.rankedSeasonUserStats.findMany({
        where: {
          mode: selectedSeason.mode,
          seasonNumber: selectedSeason.seasonNumber,
          rankedGames: { gt: 0 },
        },
        orderBy: rankedSeasonLeaderboardOrderBy,
        take: limit,
        select: rankedSeasonStatsSelect,
      });
      const seasonUser = user ? await prisma.rankedSeasonUserStats.findUnique({
        where: {
          mode_seasonNumber_userId: {
            mode: selectedSeason.mode,
            seasonNumber: selectedSeason.seasonNumber,
            userId: user.id,
          },
        },
        select: rankedSeasonStatsSelect,
      }) : null;
      const personalRank = seasonUser
        ? await getRankedSeasonLeaderboardRank(seasonUser, selectedSeason)
        : null;

      res.json({
        mode,
        seasons,
        selectedSeason,
        leaderboard: leaderboardUsers.map((leaderboardUser, index) => (
          serializeRankedSeasonLeaderboardEntry(leaderboardUser, index + 1)
        )),
        currentUser: user ? {
          rank: personalRank,
          userId: user.id,
          name: seasonUser?.userName ?? user.name,
          stats: seasonUser ? serializeRankedSeasonStats(seasonUser) : serializeEmptyRankedSeasonStats(),
        } : null,
      });
      return;
    }

    const leaderboardUsers = await prisma.user.findMany({
      where: { totalGames: { gt: 0 } },
      orderBy: leaderboardOrderBy,
      take: limit,
      select: leaderboardUserSelect,
    });
    const personalRank = user
      ? await getScoreLeaderboardRank(user)
      : null;

    res.json({
      mode,
      seasons,
      selectedSeason,
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
