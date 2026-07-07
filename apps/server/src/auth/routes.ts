import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { Prisma, type PlayerRewardKind, type PlayerRewardStatus } from '@prisma/client';
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
import { consumeWalletAuthNonce, storeWalletAuthNonce } from './walletNonceStore';
import { serializeUser } from './userResponse';
import type { AuthAccountIdentity, AuthProviderName, PendingRegistrationIdentity } from './types';
import { getRankedSeason } from '../ranking/seasonService';
import { getAllowedClientOrigins, normalizeClientOrigin } from '../config/clientOrigins';
import {
  buildMobileWalletCallbackUrl,
  buildMobileWalletConnectUrl,
  buildMobileWalletSignMessageUrl,
  createMobileWalletDeepLinkState,
  decryptMobileWalletConnectResponse,
  decryptMobileWalletSignMessageResponse,
  getMobileWalletAppUrl,
  parseMobileWalletProviderId,
  readMobileWalletError,
} from './mobileWalletDeepLink';
import {
  deleteMobileWalletDeepLinkState,
  readMobileWalletDeepLinkState,
  storeMobileWalletDeepLinkState,
  type MobileWalletDeepLinkState,
} from './mobileWalletDeepLinkStore';

const router: RouterType = Router();

const JWT_EXPIRY = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PENDING_COOKIE_MAX_AGE = 60 * 60 * 1000;
const DEFAULT_CLIENT_ORIGIN = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000';

const AUTH_RATE_LIMITS = {
  nonce: { limit: 30, windowMs: 60 * 1000 },
  verify: { limit: 20, windowMs: 60 * 1000 },
  register: { limit: 10, windowMs: 60 * 1000 },
  profileUpdate: { limit: 10, windowMs: 60 * 1000 },
  tutorialComplete: { limit: 12, windowMs: 60 * 1000 },
  oauthStart: { limit: 20, windowMs: 60 * 1000 },
  oauthCallback: { limit: 30, windowMs: 60 * 1000 },
  mobileWalletStart: { limit: 20, windowMs: 60 * 1000 },
  mobileWalletCallback: { limit: 30, windowMs: 60 * 1000 },
} as const;

const LEADERBOARD_DEFAULT_LIMIT = 25;
const LEADERBOARD_MAX_LIMIT = 50;
const LEADERBOARD_SOL_REWARD_STATUSES = [
  'pending',
  'processing',
  'paid',
] as const satisfies readonly PlayerRewardStatus[];
const LEADERBOARD_MATCH_SOL_REWARD_KINDS = [
  'daily_ranked_drip',
  'objective_bounty',
  'daily_mission',
  'ranked_br_combat_bounty',
] as const satisfies readonly PlayerRewardKind[];

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

interface WalletAuthResponsePayload {
  authenticated: true;
  isNewUser: boolean;
  provider: AuthProviderName;
  linked?: boolean;
  user?: ReturnType<typeof serializeUser>;
  walletAddress?: string;
  pendingRegistration?: {
    provider: AuthProviderName;
    displayName: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
  };
}

type MobileWalletJsonResponse =
  | { action: 'redirect'; url: string }
  | { action: 'complete'; returnTo: string }
  | { action: 'error'; returnTo: string };

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

function redirectWalletAuthError(
  res: Response,
  returnTo: string,
  error: string
): void {
  redirectToClient(res, returnTo, {
    auth: 'error',
    provider: 'wallet',
    error,
  });
}

function getRequestSearchParams(req: Request): URLSearchParams {
  return new URL(req.originalUrl, 'http://opus-strike.local').searchParams;
}

function getQueryStringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function getMobileWalletCluster(): string | undefined {
  const cluster = process.env.SOLANA_CLUSTER?.trim();
  return cluster === 'mainnet-beta' || cluster === 'testnet' || cluster === 'devnet'
    ? cluster
    : undefined;
}

function getMobileWalletCallbackOrigin(req: Request): string {
  const requestedOrigin = getQueryStringValue(req.query.callbackOrigin);
  const normalizedOrigin = requestedOrigin ? normalizeClientOrigin(requestedOrigin) : null;
  if (normalizedOrigin && getAllowedClientOrigins().includes(normalizedOrigin)) {
    return normalizedOrigin;
  }

  return getClientOrigin();
}

function walletAuthSuccessParams(result: WalletAuthResponsePayload): Record<string, string> {
  return {
    auth: result.linked ? 'linked' : 'success',
    provider: 'wallet',
  };
}

function wantsMobileWalletJsonResponse(req: Request): boolean {
  return req.query.response === 'json' || req.accepts(['json', 'html']) === 'json';
}

function sendMobileWalletJsonOrRedirect(
  req: Request,
  res: Response,
  json: MobileWalletJsonResponse,
  redirectUrl: string
): void {
  if (wantsMobileWalletJsonResponse(req)) {
    res.json(json);
    return;
  }

  res.redirect(303, redirectUrl);
}

function sendMobileWalletAuthError(
  req: Request,
  res: Response,
  returnTo: string,
  error: string
): void {
  const errorReturnTo = appendAuthStatus(returnTo, {
    auth: 'error',
    provider: 'wallet',
    error,
  });

  if (wantsMobileWalletJsonResponse(req)) {
    res.json({ action: 'error', returnTo: errorReturnTo } satisfies MobileWalletJsonResponse);
    return;
  }

  redirectToClient(res, returnTo, {
    auth: 'error',
    provider: 'wallet',
    error,
  });
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

function serializeLamports(value: bigint | null | undefined): string {
  return (value ?? 0n).toString();
}

function serializeLeaderboardEntry(
  user: LeaderboardUserSummary,
  rank: number,
  solWonLamports: bigint | null | undefined = 0n
) {
  return {
    rank,
    userId: user.id,
    name: user.name,
    solWonLamports: serializeLamports(solWonLamports),
    stats: serializeLeaderboardStats(user),
  };
}

function serializeRankedSeasonLeaderboardEntry(
  user: RankedSeasonStatsSummary,
  rank: number,
  solWonLamports: bigint | null | undefined = 0n
) {
  return {
    rank,
    userId: user.userId,
    name: user.userName,
    solWonLamports: serializeLamports(solWonLamports),
    stats: serializeRankedSeasonStats(user),
  };
}

function uniqueUserIds(userIds: string[]): string[] {
  return Array.from(new Set(userIds.filter((userId) => userId.length > 0)));
}

async function getLeaderboardSolWonLamportsByUserId(
  userIds: string[],
  season: LeaderboardSeasonOption | null = null
): Promise<Map<string, bigint>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.playerReward.groupBy({
    by: ['userId'],
    where: {
      userId: { in: userIds },
      status: { in: [...LEADERBOARD_SOL_REWARD_STATUSES] },
      ...(season ? {
        OR: [
          {
            kind: { in: [...LEADERBOARD_MATCH_SOL_REWARD_KINDS] },
            match: {
              is: {
                rankedSeasonMode: season.mode,
                rankedSeasonNumber: season.seasonNumber,
              },
            },
          },
          {
            kind: 'season_top_10',
            idempotencyKey: {
              startsWith: `season_top_10:${season.mode}:${season.seasonNumber}:`,
            },
          },
        ],
      } : {}),
    },
    _sum: { amountLamports: true },
  });

  return new Map(rows.map((row) => [row.userId, row._sum.amountLamports ?? 0n]));
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

async function completeVerifiedWalletAuth(
  req: Request,
  res: Response,
  walletAddress: string,
  authenticatedPayload: AuthTokenPayload | null = null
): Promise<WalletAuthResponsePayload> {
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

  const requestAuthenticatedPayload = authenticatedPayload ?? await getAuthenticatedPayload(req);
  const authenticatedUser = requestAuthenticatedPayload
    ? await findUserForPayload(requestAuthenticatedPayload)
    : null;

  if (authenticatedUser) {
    const provider = requestAuthenticatedPayload?.provider ?? 'wallet';

    if (walletUser && walletUser.id !== authenticatedUser.id) {
      throw new ProviderConflictError('That wallet is already linked to another profile');
    }

    const user = await linkWalletAccountToUser(authenticatedUser.id, walletAddress);
    setAuthCookie(res, createAuthToken({
      userId: user.id,
      provider,
      walletAddress: user.walletAddress,
      expiresIn: JWT_EXPIRY,
    }));

    return {
      authenticated: true,
      isNewUser: false,
      provider,
      linked: true,
      user: serializeUser(user),
    };
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

    return {
      authenticated: true,
      isNewUser: false,
      provider: 'wallet',
      linked: false,
      user: serializeUser(user),
    };
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

  return {
    authenticated: true,
    isNewUser: true,
    provider: 'wallet',
    pendingRegistration: {
      provider: pendingRegistration.provider,
      displayName: pendingRegistration.displayName ?? null,
      avatarUrl: pendingRegistration.avatarUrl ?? null,
      walletAddress,
    },
  };
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

async function isPlayerNameTaken(name: string, exceptUserId?: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: {
      name: {
        equals: name,
        mode: 'insensitive',
      },
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });

  return existing !== null;
}

async function updateUserPlayerName(userId: string, name: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { name },
      include: { authAccounts: { orderBy: { createdAt: 'asc' } } },
    });

    await tx.rankedSeasonUserStats.updateMany({
      where: { userId },
      data: { userName: name },
    });

    return user;
  });
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

async function getMobileWalletAuthenticatedPayload(
  req: Request,
  state: MobileWalletDeepLinkState
): Promise<AuthTokenPayload | null> {
  const savedPayload = state.authToken ? verifyAuthToken(state.authToken) : null;
  return savedPayload ?? getAuthenticatedPayload(req);
}

router.get('/mobile-wallet/:providerId/start', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:mobile-wallet:start', AUTH_RATE_LIMITS.mobileWalletStart)) return;

  const providerId = parseMobileWalletProviderId(req.params.providerId);
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  const callbackOrigin = getMobileWalletCallbackOrigin(req);

  if (!providerId) {
    sendMobileWalletAuthError(req, res, returnTo, 'wallet_unsupported');
    return;
  }

  const state = createMobileWalletDeepLinkState({
    providerId,
    returnTo,
    authToken: getRequestAuthToken(req),
    callbackOrigin,
  });

  const stored = await storeMobileWalletDeepLinkState(state);
  if (!stored) {
    sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_unavailable');
    return;
  }

  const connectUrl = buildMobileWalletConnectUrl({
    state,
    appUrl: getMobileWalletAppUrl(req, callbackOrigin),
    redirectLink: buildMobileWalletCallbackUrl(req, providerId, 'connect', state.id, callbackOrigin),
    cluster: getMobileWalletCluster(),
  });

  sendMobileWalletJsonOrRedirect(req, res, { action: 'redirect', url: connectUrl }, connectUrl);
});

router.get('/mobile-wallet/:providerId/connect', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:mobile-wallet:connect', AUTH_RATE_LIMITS.mobileWalletCallback)) return;

  const providerId = parseMobileWalletProviderId(req.params.providerId);
  const stateId = getQueryStringValue(req.query.state);
  const state = stateId ? await readMobileWalletDeepLinkState(stateId) : null;
  const returnTo = state?.returnTo ?? '/';

  if (!providerId || !state || state.providerId !== providerId || state.phase !== 'connect') {
    sendMobileWalletAuthError(req, res, returnTo, 'wallet_expired');
    return;
  }

  const params = getRequestSearchParams(req);
  const walletError = readMobileWalletError(params);
  if (walletError) {
    await deleteMobileWalletDeepLinkState(state.id);
    sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_denied');
    return;
  }

  try {
    const connectResponse = decryptMobileWalletConnectResponse(state, params);
    const walletAddress = normalizeWalletAddress(connectResponse.data.public_key);
    if (!walletAddress || typeof connectResponse.data.session !== 'string' || !connectResponse.data.session) {
      throw new Error('Wallet connection callback returned an invalid session');
    }

    const authNonce = generateNonce();
    const message = createSignMessage(authNonce);
    const storedNonce = await storeWalletAuthNonce(walletAddress, authNonce);
    if (!storedNonce) {
      await deleteMobileWalletDeepLinkState(state.id);
      sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_unavailable');
      return;
    }

    const signState: MobileWalletDeepLinkState = {
      ...state,
      phase: 'sign',
      walletEncryptionPublicKey: connectResponse.walletEncryptionPublicKey,
      walletAddress,
      walletSession: connectResponse.data.session,
      authNonce,
    };
    const storedState = await storeMobileWalletDeepLinkState(signState);
    if (!storedState) {
      await deleteMobileWalletDeepLinkState(state.id);
      sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_unavailable');
      return;
    }

    const signUrl = buildMobileWalletSignMessageUrl({
      state: signState,
      message,
      redirectLink: buildMobileWalletCallbackUrl(
        req,
        providerId,
        'sign',
        state.id,
        state.callbackOrigin || getMobileWalletCallbackOrigin(req)
      ),
    });

    sendMobileWalletJsonOrRedirect(req, res, { action: 'redirect', url: signUrl }, signUrl);
  } catch (error) {
    await deleteMobileWalletDeepLinkState(state.id);
    console.error('[auth] Mobile wallet connect callback error:', error);
    sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_failed');
  }
});

router.get('/mobile-wallet/:providerId/sign', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:mobile-wallet:sign', AUTH_RATE_LIMITS.mobileWalletCallback)) return;

  const providerId = parseMobileWalletProviderId(req.params.providerId);
  const stateId = getQueryStringValue(req.query.state);
  const state = stateId ? await readMobileWalletDeepLinkState(stateId) : null;
  const returnTo = state?.returnTo ?? '/';

  if (!providerId || !state || state.providerId !== providerId || state.phase !== 'sign') {
    sendMobileWalletAuthError(req, res, returnTo, 'wallet_expired');
    return;
  }

  const params = getRequestSearchParams(req);
  const walletError = readMobileWalletError(params);
  if (walletError) {
    await deleteMobileWalletDeepLinkState(state.id);
    sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_denied');
    return;
  }

  try {
    if (!state.walletAddress || !state.authNonce) {
      throw new Error('Mobile wallet signature state is incomplete');
    }

    const signResponse = decryptMobileWalletSignMessageResponse(state, params);
    if (typeof signResponse.signature !== 'string' || !signResponse.signature) {
      throw new Error('Wallet signature callback returned an invalid signature');
    }

    const hasValidNonce = await consumeWalletAuthNonce(state.walletAddress, state.authNonce);
    if (!hasValidNonce) {
      await deleteMobileWalletDeepLinkState(state.id);
      sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_expired');
      return;
    }

    const message = createSignMessage(state.authNonce);
    if (!verifySignature(message, signResponse.signature, state.walletAddress)) {
      await deleteMobileWalletDeepLinkState(state.id);
      sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_invalid_signature');
      return;
    }

    const result = await completeVerifiedWalletAuth(
      req,
      res,
      state.walletAddress,
      await getMobileWalletAuthenticatedPayload(req, state)
    );

    await deleteMobileWalletDeepLinkState(state.id);
    const completeReturnTo = appendAuthStatus(state.returnTo, walletAuthSuccessParams(result));
    const clientOrigin = getClientOrigin();
    sendMobileWalletJsonOrRedirect(
      req,
      res,
      { action: 'complete', returnTo: completeReturnTo },
      clientOrigin ? new URL(completeReturnTo, clientOrigin).toString() : completeReturnTo
    );
  } catch (error) {
    await deleteMobileWalletDeepLinkState(state.id);

    if (error instanceof ProviderConflictError || isPrismaUniqueError(error)) {
      sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_conflict');
      return;
    }

    console.error('[auth] Mobile wallet sign callback error:', error);
    sendMobileWalletAuthError(req, res, state.returnTo, 'wallet_failed');
  }
});

router.get('/nonce', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:nonce', AUTH_RATE_LIMITS.nonce)) return;

  const walletAddress = normalizeWalletAddress(req.query.walletAddress);
  if (!walletAddress) {
    res.status(400).json({ error: 'Valid wallet address is required' });
    return;
  }

  const nonce = generateNonce();
  const message = createSignMessage(nonce);
  const stored = await storeWalletAuthNonce(walletAddress, nonce);
  if (!stored) {
    res.status(503).json({ error: 'Wallet authentication is temporarily unavailable' });
    return;
  }

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

    const hasValidNonce = await consumeWalletAuthNonce(walletAddress, nonce);
    if (!hasValidNonce) {
      res.status(401).json({ error: 'Invalid or expired nonce' });
      return;
    }

    const message = createSignMessage(nonce);
    const isValid = verifySignature(message, signature, walletAddress);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    res.json(await completeVerifiedWalletAuth(req, res, walletAddress));
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

router.patch('/profile', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'auth:profile:update', AUTH_RATE_LIMITS.profileUpdate)) return;

  try {
    const payload = await getAuthenticatedPayload(req);
    const user = payload ? await findUserForPayload(payload) : null;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const validation = validatePlayerName(req.body?.name);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    if (await isPlayerNameTaken(validation.name, user.id)) {
      res.status(409).json({ error: 'Callsign is already taken' });
      return;
    }

    const updatedUser = await updateUserPlayerName(user.id, validation.name);
    setAuthCookie(res, createAuthToken({
      userId: updatedUser.id,
      provider: payload?.provider,
      walletAddress: updatedUser.walletAddress,
      expiresIn: JWT_EXPIRY,
    }));

    res.json({
      success: true,
      user: serializeUser(updatedUser),
    });
  } catch (error) {
    if (isUserNameUniqueError(error)) {
      res.status(409).json({ error: 'Callsign is already taken' });
      return;
    }

    console.error('[auth] Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
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
      const solWonByUserId = await getLeaderboardSolWonLamportsByUserId(
        uniqueUserIds([
          ...leaderboardUsers.map((leaderboardUser) => leaderboardUser.userId),
          ...(user ? [user.id] : []),
        ]),
        selectedSeason
      );

      res.json({
        mode,
        seasons,
        selectedSeason,
        leaderboard: leaderboardUsers.map((leaderboardUser, index) => (
          serializeRankedSeasonLeaderboardEntry(
            leaderboardUser,
            index + 1,
            solWonByUserId.get(leaderboardUser.userId)
          )
        )),
        currentUser: user ? {
          rank: personalRank,
          userId: user.id,
          name: seasonUser?.userName ?? user.name,
          solWonLamports: serializeLamports(solWonByUserId.get(user.id)),
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
    const solWonByUserId = await getLeaderboardSolWonLamportsByUserId(
      uniqueUserIds([
        ...leaderboardUsers.map((leaderboardUser) => leaderboardUser.id),
        ...(user ? [user.id] : []),
      ])
    );

    res.json({
      mode,
      seasons,
      selectedSeason,
      leaderboard: leaderboardUsers.map((leaderboardUser, index) => (
        serializeLeaderboardEntry(
          leaderboardUser,
          index + 1,
          solWonByUserId.get(leaderboardUser.id)
        )
      )),
      currentUser: user ? {
        rank: personalRank,
        userId: user.id,
        name: user.name,
        solWonLamports: serializeLamports(solWonByUserId.get(user.id)),
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
