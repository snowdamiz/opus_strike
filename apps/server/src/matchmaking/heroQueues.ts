import {
  createTeamCountMap,
  isKnownHeroId,
  type HeroId,
  type Team,
} from '@voxel-strike/shared';

export interface MatchmakingHeroQueuePlayer {
  id?: string;
  team?: string | null;
  heroId?: string | null;
}

export interface MatchmakingHeroQueueState {
  teamCounts: Record<string, number>;
  teamHeroIds: Record<string, HeroId[]>;
}

function normalizeTeamCounts(
  teamIds: readonly Team[],
  rawCounts?: Record<string, unknown> | null
): Record<string, number> {
  const counts = createTeamCountMap(teamIds);
  if (!rawCounts || typeof rawCounts !== 'object') return counts;

  for (const teamId of teamIds) {
    const count = rawCounts[teamId];
    counts[teamId] = typeof count === 'number' && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : counts[teamId] ?? 0;
  }

  return counts;
}

function normalizeTeamHeroIds(
  teamIds: readonly Team[],
  rawHeroIds?: Record<string, unknown> | null
): Record<string, HeroId[]> {
  const heroIds: Record<string, HeroId[]> = {};
  for (const teamId of teamIds) {
    heroIds[teamId] = [];
  }
  if (!rawHeroIds || typeof rawHeroIds !== 'object') return heroIds;

  for (const teamId of teamIds) {
    const values = rawHeroIds[teamId];
    if (!Array.isArray(values)) continue;
    const picked = new Set<HeroId>();
    for (const value of values) {
      if (isKnownHeroId(value)) {
        picked.add(value);
      }
    }
    heroIds[teamId] = Array.from(picked);
  }

  return heroIds;
}

export function buildMatchmakingHeroQueueState(input: {
  players: Iterable<MatchmakingHeroQueuePlayer>;
  teamIds: readonly Team[];
}): MatchmakingHeroQueueState {
  const allowedTeamIds = new Set(input.teamIds);
  const teamCounts = createTeamCountMap(input.teamIds);
  const teamHeroSets = new Map<Team, Set<HeroId>>();
  for (const teamId of input.teamIds) {
    teamHeroSets.set(teamId, new Set());
  }

  for (const player of input.players) {
    const team = player.team;
    if (!team || !allowedTeamIds.has(team)) continue;
    teamCounts[team] = (teamCounts[team] ?? 0) + 1;
    if (isKnownHeroId(player.heroId)) {
      teamHeroSets.get(team)?.add(player.heroId);
    }
  }

  const teamHeroIds: Record<string, HeroId[]> = {};
  for (const teamId of input.teamIds) {
    teamHeroIds[teamId] = Array.from(teamHeroSets.get(teamId) ?? []);
  }

  return { teamCounts, teamHeroIds };
}

export function readMatchmakingHeroQueueStateFromMetadata(input: {
  metadata: Record<string, unknown>;
  teamIds: readonly Team[];
}): MatchmakingHeroQueueState | null {
  const rawCounts = input.metadata.matchmakingTeamCounts;
  const rawHeroIds = input.metadata.matchmakingTeamHeroIds;
  if (!rawCounts || !rawHeroIds) return null;

  return {
    teamCounts: normalizeTeamCounts(input.teamIds, rawCounts as Record<string, unknown>),
    teamHeroIds: normalizeTeamHeroIds(input.teamIds, rawHeroIds as Record<string, unknown>),
  };
}

export function resolveMatchmakingHeroTeam(input: {
  teamIds: readonly Team[];
  maxTeamSize: number;
  teamCounts: Record<string, number>;
  teamHeroIds: Record<string, readonly HeroId[]>;
  selectedHero?: HeroId | string | null;
  preferredTeam?: Team | null;
  requirePreferredTeam?: boolean;
}): Team | null {
  const selectedHero = isKnownHeroId(input.selectedHero) ? input.selectedHero : null;
  const preferredTeam = input.preferredTeam && input.teamIds.includes(input.preferredTeam)
    ? input.preferredTeam
    : null;

  const canUseTeam = (teamId: Team): boolean => {
    if ((input.teamCounts[teamId] ?? 0) >= input.maxTeamSize) return false;
    return !selectedHero || !(input.teamHeroIds[teamId] ?? []).includes(selectedHero);
  };

  if (preferredTeam) {
    if (canUseTeam(preferredTeam)) return preferredTeam;
    if (input.requirePreferredTeam) return null;
  }

  const candidates = input.teamIds.filter(canUseTeam);
  if (candidates.length === 0) return null;

  let selected = candidates[0];
  let selectedCount = input.teamCounts[selected] ?? 0;
  for (const teamId of candidates.slice(1)) {
    const count = input.teamCounts[teamId] ?? 0;
    if (count < selectedCount) {
      selected = teamId;
      selectedCount = count;
    }
  }

  return selected;
}
