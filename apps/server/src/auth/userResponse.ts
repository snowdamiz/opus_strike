import type { AuthAccount, User } from '@prisma/client';
import type { LinkedAccountSummary, UserResponse } from './types';
import { serializeRankPayload } from '../ranking/serialization';

type UserWithAccounts = User & {
  authAccounts?: AuthAccount[];
};

function serializeLinkedAccount(account: AuthAccount): LinkedAccountSummary {
  return {
    provider: account.provider,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function serializeUser(user: UserWithAccounts): UserResponse {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    name: user.name,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    stats: {
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
    },
    rank: serializeRankPayload(user),
    linkedAccounts: (user.authAccounts ?? []).map(serializeLinkedAccount),
  };
}
