import { useId } from 'react';
import {
  getRankFromDivisionIndex,
  getRankFromRating,
  getRankTheme,
  type PublicRankSnapshot,
  type RankTheme,
  type RankSummary,
} from '@voxel-strike/shared';
import type { UserStats } from '../../store/gameStore';
import { RANK_BADGE_COLORS } from '../../styles/colorTokens';

type RankLike = PublicRankSnapshot | RankSummary | null | undefined;

function rankLabel(rank: RankLike): string {
  return rank?.label ?? 'Unranked';
}

function rankTier(rank: RankLike): PublicRankSnapshot['tier'] {
  switch (rank?.tier) {
    case 'plastic':
    case 'bronze':
    case 'silver':
    case 'gold':
    case 'diamond':
    case 'unemployed':
    case 'unranked':
      return rank.tier;
    default:
      return 'unranked';
  }
}

function rankDivision(rank: RankLike): number {
  const division = rank?.division;
  if (typeof division !== 'number' || !Number.isFinite(division)) return 0;
  return Math.max(0, Math.min(4, Math.floor(division)));
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
  };
}

function linearizeChannel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function readableRankTextColor(theme: RankTheme): string {
  const color = parseHexColor(theme.foreground);
  if (!color) return theme.foreground;
  const luminance = 0.2126 * linearizeChannel(color.r) + 0.7152 * linearizeChannel(color.g) + 0.0722 * linearizeChannel(color.b);
  return luminance < 0.45 ? theme.accent : theme.foreground;
}

function RankDivisionMarks({ division, theme }: { division: number; theme: RankTheme }) {
  if (division <= 0) return null;

  const startX = 32 - ((division - 1) * 6) / 2;

  return (
    <g>
      {Array.from({ length: division }, (_, index) => {
        const cx = startX + index * 6;
        const path = `M${cx - 2} 55h4`;

        return (
          <g key={index}>
            <path d={path} stroke={RANK_BADGE_COLORS.divisionMarkShadow} strokeOpacity="0.42" strokeWidth="4.8" strokeLinecap="round" />
            <path d={path} stroke={theme.foreground} strokeWidth="2.6" strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
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
  const label = rankLabel(rank);
  const division = rankDivision(rank);
  const aria = labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  const id = useId().replace(/:/g, '');
  const gradientId = `rank-gradient-${id}`;
  const edgeGradientId = `rank-edge-${id}`;
  const shineGradientId = `rank-shine-${id}`;

  return (
    <svg
      {...aria}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: theme.primary, filter: `drop-shadow(0 0 8px ${theme.glow})` }}
    >
      <defs>
        <linearGradient id={gradientId} x1="12" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor={theme.accent} />
          <stop offset="0.42" stopColor={theme.primary} />
          <stop offset="1" stopColor={theme.secondary} />
        </linearGradient>
        <linearGradient id={edgeGradientId} x1="13" y1="7" x2="51" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor={theme.foreground} stopOpacity="0.95" />
          <stop offset="0.62" stopColor={theme.accent} stopOpacity="0.82" />
          <stop offset="1" stopColor={theme.secondary} stopOpacity="0.95" />
        </linearGradient>
        <radialGradient
          id={shineGradientId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(23 16) rotate(45) scale(30 24)"
        >
          <stop stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {tier === 'plastic' && (
        <>
          <path
            d="M17 14.5L39 9l14 12-5 26-17 9.5-18-11-3-22.5 7-8.5Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M17 14.5L39 9l14 12-5 26-17 9.5-18-11-3-22.5 7-8.5Z" fill={`url(#${shineGradientId})`} />
          <path d="M25 19l9 8-7 6 11 10" stroke={theme.secondary} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.72" />
          <path d="M41 18l-5 9 10 2" stroke={theme.foreground} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.62" />
        </>
      )}
      {tier === 'bronze' && (
        <>
          <path
            d="M15 12.5h34l4.5 7.5-4.5 21.5C46.8 49.5 40.8 55 32 58.5c-8.8-3.5-14.8-9-17-17L10.5 20 15 12.5Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M15 12.5h34l4.5 7.5-4.5 21.5C46.8 49.5 40.8 55 32 58.5c-8.8-3.5-14.8-9-17-17L10.5 20 15 12.5Z" fill={`url(#${shineGradientId})`} />
          <path d="M20 20h24l-3 18.5c-1.5 5.8-4.5 10-9 12.5-4.5-2.5-7.5-6.7-9-12.5L20 20Z" stroke={theme.foreground} strokeWidth="2.4" strokeLinejoin="round" strokeOpacity="0.44" />
          <path d="M32 18v30" stroke={theme.secondary} strokeWidth="2.2" strokeLinecap="round" strokeOpacity="0.58" />
        </>
      )}
      {tier === 'silver' && (
        <>
          <path
            d="M32 6.5l8.5 11 14 3.5-8.5 11 2 15.5L32 42l-16 5.5 2-15.5-8.5-11 14-3.5L32 6.5Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M32 6.5l8.5 11 14 3.5-8.5 11 2 15.5L32 42l-16 5.5 2-15.5-8.5-11 14-3.5L32 6.5Z" fill={`url(#${shineGradientId})`} />
          <path d="M32 14v27M20 24.5h24M23 40.5l9-26 9 26" stroke={theme.secondary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.72" />
        </>
      )}
      {tier === 'gold' && (
        <>
          <path
            d="M9 49h46l3-31-14.5 10L32 8.5 20.5 28 6 18l3 31Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M9 49h46l3-31-14.5 10L32 8.5 20.5 28 6 18l3 31Z" fill={`url(#${shineGradientId})`} />
          <path d="M16 48h32M21 38h22M32 13v23" stroke={theme.foreground} strokeWidth="2.6" strokeLinecap="round" strokeOpacity="0.62" />
          <circle cx="32" cy="31" r="3" fill={theme.foreground} fillOpacity="0.78" />
        </>
      )}
      {tier === 'diamond' && (
        <>
          <path
            d="M32 5.5l22 17.5-22 36-22-36L32 5.5Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M32 5.5l22 17.5-22 36-22-36L32 5.5Z" fill={`url(#${shineGradientId})`} />
          <path d="M10 23h44M20.5 23L32 59M43.5 23L32 59M20.5 23L32 5.5l11.5 17.5M32 5.5V23" stroke={theme.foreground} strokeOpacity="0.68" strokeWidth="1.9" strokeLinejoin="round" />
        </>
      )}
      {tier === 'unemployed' && (
        <>
          <path
            d="M18 22h28l7 7v21l-7 7H18l-7-7V29l7-7Z"
            fill={`url(#${gradientId})`}
            stroke={`url(#${edgeGradientId})`}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M18 22h28l7 7v21l-7 7H18l-7-7V29l7-7Z" fill={`url(#${shineGradientId})`} />
          <path d="M24 22v-7h16v7M12 34h40M25 44h14" stroke={theme.foreground} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.72" />
          <path d="M23 51l18-20" stroke={theme.accent} strokeWidth="3.1" strokeLinecap="round" strokeOpacity="0.86" />
        </>
      )}
      {tier === 'unranked' && (
        <>
          <circle cx="32" cy="32" r="22" fill={`url(#${gradientId})`} stroke={`url(#${edgeGradientId})`} strokeWidth="2.2" />
          <circle cx="32" cy="32" r="22" fill={`url(#${shineGradientId})`} />
          <path d="M21 32h22M32 21v22" stroke={theme.foreground} strokeWidth="4" strokeLinecap="round" strokeOpacity="0.72" />
        </>
      )}
      <RankDivisionMarks division={division} theme={theme} />
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
  const textColor = readableRankTextColor(theme);

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 border px-2 py-1 font-display text-xs uppercase leading-none ${className}`}
      style={{
        borderColor: `${theme.primary}66`,
        backgroundColor: `${theme.secondary}33`,
        color: textColor,
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
  const textColor = readableRankTextColor(theme);

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 font-display text-xs uppercase leading-none ${className}`}
      style={{ color: textColor }}
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
