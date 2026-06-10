import type { PublicRankPayload } from '../ranking/serialization';

export const AUTH_PROVIDERS = ['discord', 'phantom'] as const;

export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

export interface AuthAccountIdentity {
  provider: AuthProviderName;
  providerAccountId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailHash?: string | null;
}

export interface PendingRegistrationIdentity extends AuthAccountIdentity {
  walletAddress?: string | null;
}

export interface LinkedAccountSummary {
  provider: AuthProviderName;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserResponse {
  id: string;
  walletAddress: string | null;
  name: string;
  lastLoginAt: string | null;
  stats: {
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
    totalWageredLamports: string;
    totalWagerWonLamports: string;
    totalWagerLostLamports: string;
    competitiveRating: number;
    rankedGames: number;
    rankedWins: number;
    rankedLosses: number;
    rankedDraws: number;
    rankedPlacementsRemaining: number;
    rankedPeakRating: number;
    rankedLastMatchAt: string | null;
  };
  rank: PublicRankPayload;
  linkedAccounts: LinkedAccountSummary[];
}

export function isAuthProvider(value: unknown): value is AuthProviderName {
  return typeof value === 'string' && AUTH_PROVIDERS.includes(value as AuthProviderName);
}
