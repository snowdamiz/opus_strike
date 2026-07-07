import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Crosshair,
  Gem,
  Shirt,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';
import {
  getDailyMissionCriterionLabel,
  getDailyMissionProgressValue,
  type DailyMissionCriterion,
  type PlayerDailyMissionSnapshot,
  type PlayerDailyMissionsResponse,
} from '@voxel-strike/shared';
import { requestDailyMissions } from '../../contexts/networkApi';

interface DailyMissionTrackerProps {
  enabled: boolean;
  className?: string;
  maxVisible?: number;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function criterionIcon(criterion: DailyMissionCriterion) {
  switch (criterion.type) {
    case 'wins':
      return Trophy;
    case 'eliminations':
    case 'eliminations_as_hero':
    case 'eliminations_against_hero':
    case 'eliminations_with_ability':
      return Crosshair;
    case 'score':
    case 'experience':
      return Sparkles;
    default:
      return Target;
  }
}

function rewardChips(mission: PlayerDailyMissionSnapshot): string[] {
  const chips: string[] = [];
  for (const reward of mission.mission.rewards.items) {
    if (reward.type === 'sol') chips.push('SOL');
    else if (reward.type === 'game_token') chips.push(reward.symbol ? `$${reward.symbol}` : 'TOKEN');
    else chips.push('SKIN');
  }
  return chips.slice(0, 3);
}

function rewardIcon(chip: string) {
  if (chip === 'SOL') return Coins;
  if (chip === 'SKIN') return Shirt;
  return Gem;
}

function grantLabel(mission: PlayerDailyMissionSnapshot): string {
  if (!mission.progress?.completedAt) return '';
  const grants = mission.progress.grants;
  if (grants.some((grant) => grant.status === 'failed')) return 'Issue';
  if (grants.some((grant) => grant.status === 'pending' || grant.status === 'processing')) return 'Paying';
  return 'Done';
}

function primaryCriterion(mission: PlayerDailyMissionSnapshot): DailyMissionCriterion {
  const progress = mission.progress?.progress;
  return mission.mission.criteria.items.find((criterion) => (
    getDailyMissionProgressValue(progress, criterion.id) < criterion.target
  )) ?? mission.mission.criteria.items[0];
}

function missionProgressText(mission: PlayerDailyMissionSnapshot): string {
  const completed = grantLabel(mission);
  if (completed) return completed;

  const criterion = primaryCriterion(mission);
  const value = getDailyMissionProgressValue(mission.progress?.progress, criterion.id);
  return `${Math.min(value, criterion.target).toLocaleString('en-US')}/${criterion.target.toLocaleString('en-US')}`;
}

function missionSubtitle(mission: PlayerDailyMissionSnapshot): string {
  const criterion = primaryCriterion(mission);
  return getDailyMissionCriterionLabel(criterion.type);
}

function sortMissions(missions: PlayerDailyMissionSnapshot[]): PlayerDailyMissionSnapshot[] {
  return [...missions].sort((left, right) => {
    const leftDone = Boolean(left.progress?.completedAt);
    const rightDone = Boolean(right.progress?.completedAt);
    if (leftDone !== rightDone) return leftDone ? 1 : -1;
    return left.mission.sortOrder - right.mission.sortOrder;
  });
}

export function DailyMissionTracker({
  enabled,
  className = '',
  maxVisible = 3,
}: DailyMissionTrackerProps) {
  const [missions, setMissions] = useState<PlayerDailyMissionsResponse | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMissions(null);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const load = async () => {
      try {
        const response = await requestDailyMissions();
        if (!cancelled) setMissions(response);
      } catch {
        if (!cancelled) setMissions(null);
      } finally {
        if (!cancelled) timeoutId = window.setTimeout(load, 45_000);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [enabled]);

  const visibleMissions = useMemo(() => {
    if (!missions) return [];
    return sortMissions(missions.missions).slice(0, maxVisible);
  }, [maxVisible, missions]);
  const hiddenCount = Math.max(0, (missions?.missions.length ?? 0) - visibleMissions.length);

  if (!enabled || visibleMissions.length === 0) return null;

  return (
    <div className={cn('pointer-events-none select-none', className)} aria-label="Daily missions">
      <div className="mb-1.5 flex items-center gap-2 pl-1 font-display text-[10px] uppercase leading-none tracking-[0.18em] text-white/45">
        <span>Daily</span>
        {hiddenCount > 0 && <span className="font-body text-[10px] tracking-wide text-white/30">+{hiddenCount}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {visibleMissions.map((mission) => {
          const criterion = primaryCriterion(mission);
          const Icon = mission.progress?.completedAt ? CheckCircle2 : criterionIcon(criterion);
          const chips = rewardChips(mission);
          const percent = Math.max(0, Math.min(100, mission.percentComplete));
          return (
            <div
              key={mission.mission.id}
              className="grid grid-cols-[2px_1.65rem_minmax(0,1fr)_auto] items-center gap-2.5 border-y border-white/[0.045] bg-black/[0.18] py-2 pr-2 backdrop-blur-[2px]"
            >
              <span
                className={cn(
                  'h-full min-h-10 rounded-full',
                  mission.progress?.completedAt ? 'bg-ui-success' : 'bg-accent-primary'
                )}
              />
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-md',
                  mission.progress?.completedAt ? 'bg-ui-success/15 text-ui-success' : 'bg-accent-primary/15 text-accent-primary'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="min-w-0 truncate font-display text-sm leading-none text-white">
                    {mission.mission.displayName}
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-white/55">
                    {missionProgressText(mission)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 truncate text-[10px] uppercase tracking-wide text-white/35">
                    {missionSubtitle(mission)}
                  </p>
                  <div className="h-px min-w-4 flex-1 bg-white/[0.07]" />
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={cn('h-full rounded-full', mission.progress?.completedAt ? 'bg-ui-success' : 'bg-accent-primary')}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {chips.map((chip) => {
                  const RewardIcon = rewardIcon(chip);
                  return (
                    <span
                      key={chip}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.045] px-1.5 font-mono text-[9px] text-white/55"
                    >
                      <RewardIcon className="h-3 w-3" />
                      {chip}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
