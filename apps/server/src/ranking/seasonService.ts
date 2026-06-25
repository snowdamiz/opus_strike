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
const RANKED_SEASON_CACHE_TTL_MS = 60_000;

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
  resetRankedRating: boolean;
}

let rankedSeasonCache: { value: RankedSeasonAdminView; expiresAt: number } | null = null;

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

function setRankedSeasonCache(value: RankedSeasonAdminView): void {
  rankedSeasonCache = {
    value,
    expiresAt: Date.now() + RANKED_SEASON_CACHE_TTL_MS,
  };
}

export async function getRankedSeason(): Promise<RankedSeasonAdminView> {
  const now = Date.now();
  if (rankedSeasonCache && rankedSeasonCache.expiresAt > now) {
    return rankedSeasonCache.value;
  }

  const season = toRankedSeasonSnapshot(await ensureRankedSeasonSettings());
  setRankedSeasonCache(season);
  return season;
}

async function archiveCurrentRankedSeason(
  tx: RankedSeasonTransaction,
  season: RankedSeasonRow,
  archivedAt: Date
): Promise<void> {
  const mode = season.mode === 'preseason' ? 'preseason' : 'season';
  const seasonNumber = normalizeRankedSeasonNumber(season.seasonNumber);
  await tx.rankedSeasonUserStats.updateMany({
    where: {
      mode,
      seasonNumber,
      rankedGames: { gt: 0 },
    },
    data: { archivedAt },
  });
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

  const result = await prisma.$transaction(async (tx) => {
    const current = await ensureRankedSeasonSettingsTx(tx);
    const currentMode = current.mode === 'preseason' ? 'preseason' : 'season';
    const currentIdentity = getRankedSeasonIdentity({
      mode: currentMode,
      seasonNumber: current.seasonNumber,
    });
    const nextIdentity = getRankedSeasonIdentity({ mode, seasonNumber });
    const resetRankedRating = currentIdentity !== nextIdentity;

    if (resetRankedRating) {
      await archiveCurrentRankedSeason(tx, current, now);
      await tx.user.updateMany({
        data: {
          competitiveRating: DEFAULT_COMPETITIVE_RATING,
          rankedPlacementsRemaining: RANK_PLACEMENT_MATCHES,
          rankedPeakRating: DEFAULT_COMPETITIVE_RATING,
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
        lastResetAt: resetRankedRating ? now : current.lastResetAt,
      },
    });

    return {
      season: toRankedSeasonSnapshot(season),
      resetRankedRating,
    };
  });

  setRankedSeasonCache(result.season);
  return result;
}
