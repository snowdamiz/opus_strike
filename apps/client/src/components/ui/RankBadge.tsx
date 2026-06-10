import { useId } from 'react';
import {
  getRankFromDivisionIndex,
  getRankFromRating,
  getRankTheme,
  type PublicRankSnapshot,
  type RankSummary,
} from '@voxel-strike/shared';
import type { UserStats } from '../../store/gameStore';

type RankLike = PublicRankSnapshot | RankSummary | null | undefined;

function rankLabel(rank: RankLike): string {
  return rank?.label ?? 'Unranked';
}

function rankTier(rank: RankLike): PublicRankSnapshot['tier'] {
  return (rank?.tier ?? 'unranked') as PublicRankSnapshot['tier'];
}

function rankIconKey(rank: RankLike): string {
  return rank?.iconKey ?? 'unranked';
}

export function getRankForStats(stats: UserStats | null | undefined): RankSummary {
  return getRankFromRating(stats?.competitiveRating ?? 800, stats?.rankedGames ?? 0);
}

export function RankIcon({
  rank,
  size = 24,
  labelled = false,
  className = '',
}: {
  rank?: RankLike;
  size?: number;
  labelled?: boolean;
  className?: string;
}) {
  const tier = rankTier(rank);
  const theme = getRankTheme(tier);
  const iconKey = rankIconKey(rank);
  const label = rankLabel(rank);
  const aria = labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  const gradientId = `rank-gradient-${useId().replace(/:/g, '')}`;

  return (
    <svg
      {...aria}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: theme.primary }}
    >
      <defs>
        <linearGradient id={gradientId} x1="12" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor={theme.accent} />
          <stop offset="0.55" stopColor={theme.primary} />
          <stop offset="1" stopColor={theme.secondary} />
        </linearGradient>
      </defs>
      {iconKey === 'plastic-plate' && (
        <>
          <path d="M16 18l16-8 16 8v24L32 54 16 42V18z" fill={`url(#${gradientId})`} stroke={theme.foreground} strokeWidth="2" />
          <path d="M25 17l5 9-7 8 10 5-2 10" stroke={theme.secondary} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {iconKey === 'bronze-shield' && (
        <>
          <path d="M14 14h36v18c0 12-7.2 20-18 24-10.8-4-18-12-18-24V14z" fill={`url(#${gradientId})`} stroke={theme.accent} strokeWidth="2" />
          <path d="M23 25h18M21 34h22M26 43h12" stroke={theme.foreground} strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {iconKey === 'silver-crest' && (
        <>
          <path d="M32 7l20 14-8 32H20l-8-32L32 7z" fill={`url(#${gradientId})`} stroke={theme.accent} strokeWidth="2" />
          <path d="M32 13v34M18 24h28M23 44l18-20" stroke={theme.secondary} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {iconKey === 'gold-crown' && (
        <>
          <path d="M13 48h38l4-29-13 11L32 12 22 30 9 19l4 29z" fill={`url(#${gradientId})`} stroke={theme.foreground} strokeWidth="2" strokeLinejoin="round" />
          <path d="M18 54h28" stroke={theme.accent} strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {iconKey === 'diamond-crystal' && (
        <>
          <path d="M32 6l20 18-20 34L12 24 32 6z" fill={`url(#${gradientId})`} stroke={theme.accent} strokeWidth="2" />
          <path d="M12 24h40M22 24l10 34 10-34M22 24l10-18 10 18" stroke={theme.foreground} strokeOpacity="0.72" strokeWidth="2" />
        </>
      )}
      {iconKey === 'unemployed-briefcase' && (
        <>
          <path d="M14 24h36v27H14V24z" fill={`url(#${gradientId})`} stroke={theme.accent} strokeWidth="2" />
          <path d="M25 24v-6h14v6M14 34h36M29 36h6" stroke={theme.foreground} strokeWidth="3" strokeLinecap="round" />
          <path d="M24 10l8 7 8-7" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {iconKey === 'unranked' && (
        <>
          <circle cx="32" cy="32" r="22" fill={`url(#${gradientId})`} stroke={theme.accent} strokeWidth="2" />
          <path d="M22 32h20M32 22v20" stroke={theme.foreground} strokeWidth="4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function RankBadge({
  rank,
  compact = false,
  className = '',
}: {
  rank?: RankLike;
  compact?: boolean;
  className?: string;
}) {
  const theme = getRankTheme(rankTier(rank));
  const label = rankLabel(rank);

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 border px-2 py-1 font-display text-xs uppercase leading-none ${className}`}
      style={{
        borderColor: `${theme.primary}66`,
        backgroundColor: `${theme.secondary}33`,
        color: theme.foreground,
        boxShadow: `0 0 16px ${theme.glow}`,
      }}
      title={label}
    >
      <RankIcon rank={rank} size={compact ? 16 : 20} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function RankInlineLabel({
  rank,
  compact = false,
  iconSize,
  className = '',
}: {
  rank?: RankLike;
  compact?: boolean;
  iconSize?: number;
  className?: string;
}) {
  const theme = getRankTheme(rankTier(rank));
  const label = rankLabel(rank);

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 font-display text-xs uppercase leading-none ${className}`}
      style={{ color: theme.foreground }}
      title={label}
    >
      <RankIcon rank={rank} size={iconSize ?? (compact ? 16 : 20)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function PlacementBadge({ rank, className = '' }: { rank?: RankLike; className?: string }) {
  const remaining = rank?.placementRemaining ?? 0;
  return (
    <RankBadge
      rank={{
        tier: 'unranked',
        tierLabel: 'Unranked',
        division: null,
        divisionIndex: null,
        label: remaining > 0 ? `Unranked ${remaining} left` : 'Unranked',
        iconKey: 'unranked',
        isRanked: false,
        placementRemaining: remaining,
      }}
      compact
      className={className}
    />
  );
}

export function RankProgress({ stats }: { stats: UserStats }) {
  const rank = getRankForStats(stats);
  const theme = getRankTheme(rank.tier);
  const nextRank = rank.divisionIndex !== null && rank.progress.nextDivisionFloor !== null
    ? getRankFromDivisionIndex(rank.divisionIndex + 1)
    : null;
  const progressLabel = nextRank
    ? `Progress to ${nextRank.label}`
    : rank.isRanked
      ? 'Peak division progress'
      : 'Competitive progress';
  const ratingLabel = rank.progress.nextDivisionFloor !== null
    ? `${stats.competitiveRating}/${rank.progress.nextDivisionFloor}`
    : `${stats.competitiveRating} rating`;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate font-body text-[10px] uppercase tracking-widest text-white/35">{progressLabel}</span>
        <span className="shrink-0 font-mono text-xs text-white/45">{ratingLabel}</span>
      </div>
      <div className="h-2 overflow-hidden border border-white/10 bg-white/10">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${Math.round(rank.progress.progress * 100)}%`,
            background: `linear-gradient(90deg, ${theme.secondary}, ${theme.primary})`,
          }}
        />
      </div>
    </div>
  );
}

export function RankChangeSummary({
  delta,
  before,
  after,
}: {
  delta?: number | null;
  before?: PublicRankSnapshot | null;
  after?: PublicRankSnapshot | null;
}) {
  if (typeof delta !== 'number') {
    return (
      <div className="border border-white/10 bg-black/35 p-4">
        <p className="font-body text-xs uppercase text-white/35">Competitive</p>
        <p className="mt-1 font-display text-2xl leading-none text-white/55">Unranked Match</p>
      </div>
    );
  }

  const tone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-white/70';

  return (
    <div className="border border-white/10 bg-black/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-body text-xs uppercase text-white/35">Competitive</p>
          <p className={`mt-1 font-display text-4xl leading-none ${tone}`}>
            {delta > 0 ? '+' : ''}{delta}
          </p>
        </div>
        <RankBadge rank={after ?? before} compact />
      </div>
      {before && after && before.label !== after.label ? (
        <p className="mt-3 font-body text-xs text-white/45">{before.label} to {after.label}</p>
      ) : null}
    </div>
  );
}
