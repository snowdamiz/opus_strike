import {
  RANK_DEFINITIONS,
  getRankFromRating,
} from '@voxel-strike/shared';
import { lamportsToSolDisplay } from '../../utils/sol';
import {
  ADMIN_MANUAL_RATING_MAX,
  type AdminOverview,
  type GoldenBiomeDistributionMode,
  type GoldenBiomeRewardsOverview,
  type RankedSeasonMode,
  type RankedEntryGateMode,
  type RewardEconomyDraft,
  type RewardEconomyOverview,
  type Tone,
} from './types';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value || 0);
}

export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = Math.max(0, value || 0);
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index++;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(current)} ${units[index]}`;
}

export function formatAge(ms: number): string {
  if (!ms) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

export function formatDateAge(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 'unknown' : formatAge(timestamp);
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

export function formatCompactIdentifier(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function formatSeasonBoundary(mode: RankedSeasonMode, value: string | null): string {
  const fallback = mode === 'preseason' ? 'Next season TBA' : 'End date TBA';
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return mode === 'preseason' ? `Next season begins ${formattedDate}` : `Ends ${formattedDate}`;
}

export function toDateTimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getRankedSeasonIdentity(mode: RankedSeasonMode, seasonNumber: number): string {
  return mode === 'preseason' ? 'preseason' : `season:${Math.max(1, Math.floor(seasonNumber || 1))}`;
}

export function formatRankedEntryGateMode(mode: RankedEntryGateMode): string {
  return mode === 'token_required' ? 'Token Required' : 'Locked';
}

export function isPositiveWholeNumberString(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

export function isPositiveWholeNumberInRange(value: string, max: number): boolean {
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) && BigInt(trimmed) > 0n && BigInt(trimmed) <= BigInt(max);
}

export const RANK_OPTIONS = RANK_DEFINITIONS.flatMap((tier) => (
  tier.divisionThresholds.map((rating, index) => ({
    label: `${tier.label} ${index + 1}`,
    tier: tier.id,
    division: index + 1,
    rating,
  }))
)).map((option, index, options) => {
  const nextRating = options[index + 1]?.rating ?? null;
  const maxRating = nextRating === null ? null : nextRating - 1;
  return {
    ...option,
    minRating: option.rating,
    maxRating,
    rangeLabel: maxRating === null ? `${formatNumber(option.rating)}+` : `${formatNumber(option.rating)}-${formatNumber(maxRating)}`,
  };
});

export function parseDraftRating(value: string): number | null {
  if (!value.trim()) return null;
  const rating = Math.round(Number(value));
  return Number.isFinite(rating) && rating >= 0 && rating <= ADMIN_MANUAL_RATING_MAX ? rating : null;
}

function getRankGateForRating(rating: number) {
  let current = RANK_OPTIONS[0];
  for (const option of RANK_OPTIONS) {
    if (rating >= option.minRating) current = option;
    else break;
  }
  return current;
}

export function getRankPreview(value: string, rankedGames: number) {
  const rating = parseDraftRating(value);
  if (rating === null) {
    return { rating: null, label: 'Invalid rating', rangeLabel: '', gateLabel: '' };
  }

  const rank = getRankFromRating(rating, rankedGames);
  const gate = getRankGateForRating(rating);
  return { rating, label: rank.label, rangeLabel: gate.rangeLabel, gateLabel: gate.label };
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

export function formatDraftBps(value: string): string {
  const bps = Number(value);
  return Number.isFinite(bps) ? formatBps(bps) : 'Invalid';
}

function parseDraftNumber(value: string): number | null {
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

export function formatDraftWhole(value: string): string {
  const number = parseDraftNumber(value);
  return number === null ? 'Invalid' : formatNumber(Math.round(number));
}

export function formatDraftTokenAmount(value: string, suffix: string): string {
  const number = parseDraftNumber(value);
  return number === null ? 'Invalid' : `${formatNumber(Math.round(number))} ${suffix}`;
}

export function formatDraftTokenProduct(left: string, right: string, suffix: string): string {
  const leftNumber = parseDraftNumber(left);
  const rightNumber = parseDraftNumber(right);
  if (leftNumber === null || rightNumber === null) return 'Invalid';
  return `${formatNumber(Math.round(leftNumber * rightNumber))} ${suffix}`;
}

export function formatDraftDuration(value: string): string {
  const milliseconds = parseDraftNumber(value);
  if (milliseconds === null) return 'Invalid duration';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${formatNumber(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${formatNumber(minutes)}m` : `${formatNumber(minutes)}m ${remainingSeconds}s`;
}

export function solInputToLamports(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,9}))?$/.exec(trimmed);
  if (!match) throw new Error(`${fieldName} must be a SOL amount with up to 9 decimals`);

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(9, '0') || '0');
  return (whole * 1_000_000_000n + fractional).toString();
}

export function rewardEconomyDraftFromOverview(
  rewardEconomy?: RewardEconomyOverview,
  goldenBiomeRewards?: GoldenBiomeRewardsOverview,
): RewardEconomyDraft {
  const playerRewards = rewardEconomy?.playerRewards;
  const wagers = rewardEconomy?.wagers;
  const golden = goldenBiomeRewards?.settings;

  return {
    enabled: playerRewards?.enabled ?? true,
    dailyRankedDripLamports: playerRewards?.dailyRankedDripLamports ?? '20000',
    dailyRankedDripMaxMatches: String(playerRewards?.dailyRankedDripMaxMatches ?? 5),
    minMatchDurationMs: String(playerRewards?.minMatchDurationMs ?? 180000),
    objectiveWinLamports: playerRewards?.objectiveWinLamports ?? '10000',
    objectiveFlagCaptureLamports: playerRewards?.objectiveFlagCaptureLamports ?? '15000',
    objectiveFlagReturnLamports: playerRewards?.objectiveFlagReturnLamports ?? '5000',
    objectiveAssistLamports: playerRewards?.objectiveAssistLamports ?? '2000',
    maxPlayerMatchLamports: playerRewards?.maxPlayerMatchLamports ?? '50000',
    maxMatchPayoutLamports: playerRewards?.maxMatchPayoutLamports ?? '250000',
    treasuryReserveLamports: playerRewards?.treasuryReserveLamports ?? '1000000000',
    payoutBatchSize: String(playerRewards?.payoutBatchSize ?? 100),
    weeklyEnabled: playerRewards?.weeklyEnabled ?? true,
    weeklyPoolLamports: playerRewards?.weeklyPoolLamports ?? '1000000',
    weeklyTopPlayers: String(playerRewards?.weeklyTopPlayers ?? 10),
    platformFeeBps: String(wagers?.platformFeeBps ?? 500),
    goldenBiomeEnabled: golden?.enabled ?? true,
    goldenBiomeChanceBps: String(golden?.chanceBps ?? 200),
    goldenBiomeWinnerRewardSol: lamportsToSolDisplay(golden?.winnerRewardLamports ?? '200000000'),
    goldenBiomeTreasuryMinSol: lamportsToSolDisplay(golden?.treasuryMinLamports ?? '1000000000'),
    goldenBiomeDistributionMode: golden?.distributionMode ?? 'manual',
  };
}

export function rewardEconomyPayloadFromDraft(draft: RewardEconomyDraft) {
  return {
    playerRewards: {
      enabled: draft.enabled,
      dailyRankedDripLamports: draft.dailyRankedDripLamports,
      dailyRankedDripMaxMatches: draft.dailyRankedDripMaxMatches,
      minMatchDurationMs: draft.minMatchDurationMs,
      objectiveWinLamports: draft.objectiveWinLamports,
      objectiveFlagCaptureLamports: draft.objectiveFlagCaptureLamports,
      objectiveFlagReturnLamports: draft.objectiveFlagReturnLamports,
      objectiveAssistLamports: draft.objectiveAssistLamports,
      maxPlayerMatchLamports: draft.maxPlayerMatchLamports,
      maxMatchPayoutLamports: draft.maxMatchPayoutLamports,
      treasuryReserveLamports: draft.treasuryReserveLamports,
      payoutBatchSize: draft.payoutBatchSize,
      weeklyEnabled: draft.weeklyEnabled,
      weeklyPoolLamports: draft.weeklyPoolLamports,
      weeklyTopPlayers: draft.weeklyTopPlayers,
    },
    wagers: {
      platformFeeBps: draft.platformFeeBps,
    },
    goldenBiome: {
      distributionMode: draft.goldenBiomeDistributionMode,
      enabled: draft.goldenBiomeEnabled,
      chanceBps: draft.goldenBiomeChanceBps,
      winnerRewardLamports: solInputToLamports(draft.goldenBiomeWinnerRewardSol, 'Golden winner payout'),
      treasuryMinLamports: solInputToLamports(draft.goldenBiomeTreasuryMinSol, 'Golden reserve'),
    },
  };
}

// --- Derived counts and tone helpers ----------------------------------------

export function getActiveReportCount(overview: AdminOverview): number {
  return (overview.playerReports?.counts.open ?? 0) + (overview.playerReports?.counts.reviewing ?? 0);
}

export function getPendingGoldenRewardCount(overview: AdminOverview): number {
  return overview.goldenBiomeRewards?.rewards.filter((reward) => reward.status !== 'complete').length ?? 0;
}

export function getPurchasableSkinCount(overview: AdminOverview): number {
  return overview.skinShop.items.filter((item) => (
    item.settings.saleEnabled && item.settings.remainingSupply !== 0
  )).length;
}

export function toneForSystemStatus(status: string): Tone {
  if (status === 'ok' || status === 'complete' || status === 'cleared') return 'success';
  if (status === 'degraded' || status === 'pending' || status === 'reviewing') return 'warning';
  if (status === 'failed' || status === 'ban') return 'danger';
  return 'neutral';
}

export function toneForPressure(value: number): Tone {
  if (value >= 0.9) return 'danger';
  if (value >= 0.7) return 'warning';
  return 'info';
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value * 100));
}

export { getRankFromRating, lamportsToSolDisplay };
export type { GoldenBiomeDistributionMode };
