import { Prisma } from '@prisma/client';
import {
  DEFAULT_COMPETITIVE_RATING,
  DEFAULT_RANKED_SEASON_NUMBER,
  RANKED_SEASON_MAX_NUMBER,
  RANK_PLACEMENT_MATCHES,
  getRankedSeasonIdentity,
  getRankedSeasonLabel,
  normalizeRankedSeasonNumber,
  type RankedSeasonMode,
  type RankedSeasonSnapshot,
} from '@voxel-strike/shared';
import prisma from '../db';

export const RANKED_SEASON_SETTINGS_ID = 'default';

type RankedSeasonTransaction = Pick<
  Prisma.TransactionClient,
  'rankedSeasonSettings' | 'rankedSeasonUserStats' | 'user'
>;

interface RankedSeasonRow {
  id: string;
  mode: RankedSeasonMode;
  seasonNumber: number;
  endsAt: Date | null;
  lastResetAt: Date | null;
  updatedByUserId: string | null;
  updatedAt: Date;
}

export interface RankedSeasonAdminView extends RankedSeasonSnapshot {
  updatedAt: string;
  updatedByUserId: string | null;
  lastResetAt: string | null;
}

export interface RankedSeasonUpdateInput {
  mode: RankedSeasonMode;
  seasonNumber?: number | string | null;
  endsAt?: Date | string | null;
}

export interface RankedSeasonUpdateResult {
  season: RankedSeasonAdminView;
  resetRankedStats: boolean;
}

function createDefaultSeasonData() {
  return {
    id: RANKED_SEASON_SETTINGS_ID,
    mode: 'season' as const,
    seasonNumber: DEFAULT_RANKED_SEASON_NUMBER,
  };
}

function toRankedSeasonSnapshot(row: RankedSeasonRow): RankedSeasonAdminView {
  const mode = row.mode === 'preseason' ? 'preseason' : 'season';
  const seasonNumber = normalizeRankedSeasonNumber(row.seasonNumber);

  return {
    mode,
    seasonNumber,
    label: getRankedSeasonLabel({ mode, seasonNumber }),
    endsAt: row.endsAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
    lastResetAt: row.lastResetAt?.toISOString() ?? null,
  };
}

function readSeasonNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed)) {
    throw new Error('Season number is required');
  }

  const normalized = Math.floor(parsed as number);
  if (normalized < DEFAULT_RANKED_SEASON_NUMBER || normalized > RANKED_SEASON_MAX_NUMBER) {
    throw new Error(`Season number must be between ${DEFAULT_RANKED_SEASON_NUMBER} and ${RANKED_SEASON_MAX_NUMBER}`);
  }

  return normalized;
}

function readSeasonEndsAt(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Season end date is invalid');
  }
  return date;
}

function readSeasonMode(value: RankedSeasonMode): RankedSeasonMode {
  if (value === 'preseason' || value === 'season') return value;
  throw new Error('Invalid ranked season mode');
}

export async function ensureRankedSeasonSettingsTx(tx: RankedSeasonTransaction): Promise<RankedSeasonRow> {
  return tx.rankedSeasonSettings.upsert({
    where: { id: RANKED_SEASON_SETTINGS_ID },
    create: createDefaultSeasonData(),
    update: {},
  });
}

async function ensureRankedSeasonSettings(): Promise<RankedSeasonRow> {
  return ensureRankedSeasonSettingsTx(prisma);
}

export async function getRankedSeason(): Promise<RankedSeasonAdminView> {
  return toRankedSeasonSnapshot(await ensureRankedSeasonSettings());
}

async function archiveCurrentRankedSeason(
  tx: RankedSeasonTransaction,
  season: RankedSeasonRow,
  archivedAt: Date
): Promise<void> {
  const mode = season.mode === 'preseason' ? 'preseason' : 'season';
  const seasonNumber = normalizeRankedSeasonNumber(season.seasonNumber);
  const rankedUsers = await tx.user.findMany({
    where: { rankedGames: { gt: 0 } },
    select: {
      id: true,
      name: true,
      competitiveRating: true,
      rankedGames: true,
      rankedWins: true,
      rankedLosses: true,
      rankedDraws: true,
      rankedPlacementsRemaining: true,
      rankedPeakRating: true,
      rankedLastMatchAt: true,
    },
  });

  for (const user of rankedUsers) {
    await tx.rankedSeasonUserStats.upsert({
      where: {
        mode_seasonNumber_userId: {
          mode,
          seasonNumber,
          userId: user.id,
        },
      },
      create: {
        mode,
        seasonNumber,
        userId: user.id,
        userName: user.name,
        totalGames: user.rankedGames,
        totalWins: user.rankedWins,
        totalLosses: user.rankedLosses,
        totalDraws: user.rankedDraws,
        competitiveRating: user.competitiveRating,
        rankedGames: user.rankedGames,
        rankedWins: user.rankedWins,
        rankedLosses: user.rankedLosses,
        rankedDraws: user.rankedDraws,
        rankedPlacementsRemaining: user.rankedPlacementsRemaining,
        rankedPeakRating: user.rankedPeakRating,
        rankedLastMatchAt: user.rankedLastMatchAt,
        archivedAt,
      },
      update: {
        userName: user.name,
        competitiveRating: user.competitiveRating,
        rankedGames: user.rankedGames,
        rankedWins: user.rankedWins,
        rankedLosses: user.rankedLosses,
        rankedDraws: user.rankedDraws,
        rankedPlacementsRemaining: user.rankedPlacementsRemaining,
        rankedPeakRating: user.rankedPeakRating,
        rankedLastMatchAt: user.rankedLastMatchAt,
        archivedAt,
      },
    });
  }
}

export async function setRankedSeason(
  input: RankedSeasonUpdateInput,
  updatedByUserId?: string | null
): Promise<RankedSeasonUpdateResult> {
  const mode = readSeasonMode(input.mode);
  const seasonNumber = mode === 'season'
    ? readSeasonNumber(input.seasonNumber)
    : normalizeRankedSeasonNumber(
      input.seasonNumber === null || input.seasonNumber === undefined || input.seasonNumber === ''
        ? DEFAULT_RANKED_SEASON_NUMBER
        : readSeasonNumber(input.seasonNumber)
    );
  const endsAt = readSeasonEndsAt(input.endsAt);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const current = await ensureRankedSeasonSettingsTx(tx);
    const currentMode = current.mode === 'preseason' ? 'preseason' : 'season';
    const currentIdentity = getRankedSeasonIdentity({
      mode: currentMode,
      seasonNumber: current.seasonNumber,
    });
    const nextIdentity = getRankedSeasonIdentity({ mode, seasonNumber });
    const resetRankedStats = currentIdentity !== nextIdentity;

    if (resetRankedStats) {
      await archiveCurrentRankedSeason(tx, current, now);
      await tx.user.updateMany({
        data: {
          competitiveRating: DEFAULT_COMPETITIVE_RATING,
          rankedGames: 0,
          rankedWins: 0,
          rankedLosses: 0,
          rankedDraws: 0,
          rankedPlacementsRemaining: RANK_PLACEMENT_MATCHES,
          rankedPeakRating: DEFAULT_COMPETITIVE_RATING,
          rankedLastMatchAt: null,
        },
      });
    }

    const season = await tx.rankedSeasonSettings.update({
      where: { id: RANKED_SEASON_SETTINGS_ID },
      data: {
        mode,
        seasonNumber,
        endsAt,
        updatedByUserId: updatedByUserId ?? null,
        lastResetAt: resetRankedStats ? now : current.lastResetAt,
      },
    });

    return {
      season: toRankedSeasonSnapshot(season),
      resetRankedStats,
    };
  });
}
