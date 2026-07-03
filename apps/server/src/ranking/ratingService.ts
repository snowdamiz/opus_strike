import {
  DEFAULT_COMPETITIVE_RATING,
  BATTLE_ROYAL_GAMEPLAY_MODE,
  getRankDivisionIndex,
  getRankFromRating,
  type GameplayMode,
  type MatchOutcome,
  type RankTierId,
  type Team,
} from '@voxel-strike/shared';

export const PROVISIONAL_K_FACTOR = 48;
export const NORMAL_K_FACTOR = 32;
export const VETERAN_K_FACTOR = 24;
export const TOP_TIER_K_FACTOR = 16;
export const PROVISIONAL_MATCHES = 10;
export const VETERAN_MATCHES = 50;
export const PERFORMANCE_MODIFIER_CAP = 8;
export const LEAVER_PENALTY = 10;
export const MATCH_DELTA_MIN = -50;
export const MATCH_DELTA_MAX = 50;
export const UNEMPLOYED_DIVISION_START_INDEX = 20;
export const RANKED_BATTLE_ROYAL_RULES_VERSION = 'ranked_br_v1';
export const BATTLE_ROYAL_MATCH_DELTA_MIN = -75;
export const BATTLE_ROYAL_COMBAT_RP_CAP = 75;

export interface RankedUserState {
  id: string;
  competitiveRating: number;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
  rankedPlacementsRemaining: number;
  rankedPeakRating: number;
}

export interface RankedMatchParticipant {
  userId: string;
  team: Team;
  outcome: MatchOutcome;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  leftAt: Date | null;
  placement?: number | null;
  activeTeamCount?: number | null;
  teamEliminatedAt?: Date | null;
  humanKills?: number;
  botKills?: number;
  humanAssists?: number;
  botAssists?: number;
  rankedEntryCost?: number;
}

export interface RankedBattleRoyalBreakdown {
  rulesVersion: typeof RANKED_BATTLE_ROYAL_RULES_VERSION;
  placement: number;
  activeTeamCount: number;
  normalizedPlacement: number;
  placementPoints: number;
  humanKills: number;
  botKills: number;
  humanAssists: number;
  botAssists: number;
  rawCombatPoints: number;
  placementMultiplier: number;
  combatPoints: number;
  entryCost: number;
  qualityMultiplier: number;
  humanParticipants: number;
  botParticipants: number;
  totalParticipants: number;
  grossPoints: number;
  positiveCap: number;
  earlyLeaver: boolean;
  teamEliminatedAt: string | null;
}

export interface RankedRatingUpdate {
  userId: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  visibleRankBefore: string;
  visibleRankAfter: string;
  leaverPenaltyApplied: boolean;
  rankedGamesAfter: number;
  rankedPlacementsRemainingAfter: number;
  rankedPeakRatingAfter: number;
  placement?: number;
  rankedPlacementPoints?: number;
  rankedCombatPoints?: number;
  rankedEntryCost?: number;
  rankedQualityMultiplier?: number;
  rankedRulesVersion?: string;
  rankedBreakdown?: RankedBattleRoyalBreakdown;
}

const BATTLE_ROYAL_PLACEMENT_POINTS = [125, 85, 60, 40, 20, 10, 0, -10, -15] as const;

const BATTLE_ROYAL_ENTRY_COST_BY_TIER: Record<RankTierId, number> = {
  plastic: 0,
  bronze: 6,
  silver: 14,
  gold: 26,
  diamond: 40,
  unemployed: 58,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getActualScore(outcome: MatchOutcome): number {
  if (outcome === 'win') return 1;
  if (outcome === 'loss') return 0;
  return 0.5;
}

function getExpectedScore(rating: number, opponentAverageRating: number): number {
  return 1 / (1 + 10 ** ((opponentAverageRating - rating) / 400));
}

function getAverageRating(participants: RankedMatchParticipant[], usersById: Map<string, RankedUserState>): number {
  if (participants.length === 0) return DEFAULT_COMPETITIVE_RATING;

  const total = participants.reduce((sum, participant) => {
    return sum + (usersById.get(participant.userId)?.competitiveRating ?? DEFAULT_COMPETITIVE_RATING);
  }, 0);

  return total / participants.length;
}

function getKFactor(user: RankedUserState): number {
  if (getRankDivisionIndex(user.competitiveRating) >= UNEMPLOYED_DIVISION_START_INDEX) {
    return TOP_TIER_K_FACTOR;
  }

  if (user.rankedGames < PROVISIONAL_MATCHES) {
    return PROVISIONAL_K_FACTOR;
  }

  if (user.rankedGames >= VETERAN_MATCHES) {
    return VETERAN_K_FACTOR;
  }

  return NORMAL_K_FACTOR;
}

function getPerformanceScore(participant: RankedMatchParticipant): number {
  return participant.score
    + participant.flagCaptures * 220
    + participant.flagReturns * 90
    + participant.kills * 35
    + participant.assists * 20
    - participant.deaths * 20;
}

function getPerformanceModifier(participant: RankedMatchParticipant, matchAveragePerformance: number): number {
  if (matchAveragePerformance <= 0) return 0;

  const relativeContribution = (getPerformanceScore(participant) - matchAveragePerformance) / matchAveragePerformance;
  return clamp(Math.round(relativeContribution * 6), -PERFORMANCE_MODIFIER_CAP, PERFORMANCE_MODIFIER_CAP);
}

function constrainOutcomeDelta(delta: number, outcome: MatchOutcome): number {
  if (outcome === 'win') return Math.max(0, delta);
  if (outcome === 'loss') return Math.min(0, delta);
  return delta;
}

export function calculateLegacyTeamRankedRatingUpdates(input: {
  participants: RankedMatchParticipant[];
  users: RankedUserState[];
  winningTeam: Team | null;
  endedAt: Date;
}): RankedRatingUpdate[] {
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const participants = input.participants.filter((participant) => usersById.has(participant.userId));
  const redParticipants = participants.filter((participant) => participant.team === 'red');
  const blueParticipants = participants.filter((participant) => participant.team === 'blue');
  const redAverageRating = getAverageRating(redParticipants, usersById);
  const blueAverageRating = getAverageRating(blueParticipants, usersById);
  const averagePerformance = participants.reduce((sum, participant) => sum + getPerformanceScore(participant), 0)
    / Math.max(1, participants.length);

  return participants.map((participant) => {
    const user = usersById.get(participant.userId);
    if (!user) {
      throw new Error(`Missing ranked user state for ${participant.userId}`);
    }

    const ratingBefore = user.competitiveRating;
    const expectedScore = getExpectedScore(
      ratingBefore,
      participant.team === 'red' ? blueAverageRating : redAverageRating
    );
    const actualScore = getActualScore(participant.outcome);
    const baseDelta = getKFactor(user) * (actualScore - expectedScore);
    const performanceDelta = getPerformanceModifier(participant, averagePerformance);
    const leftBeforeEnd = participant.leftAt !== null && participant.leftAt.getTime() < input.endedAt.getTime();
    let ratingDelta = constrainOutcomeDelta(Math.round(baseDelta + performanceDelta), participant.outcome);

    if (leftBeforeEnd) {
      ratingDelta = participant.outcome === 'win'
        ? Math.min(0, ratingDelta - LEAVER_PENALTY)
        : ratingDelta - LEAVER_PENALTY;
    }

    ratingDelta = clamp(ratingDelta, MATCH_DELTA_MIN, MATCH_DELTA_MAX);
    const ratingAfter = Math.max(0, ratingBefore + ratingDelta);
    const rankedGamesAfter = user.rankedGames + 1;
    const visibleRankBefore = getRankFromRating(ratingBefore, user.rankedGames).label;
    const visibleRankAfter = getRankFromRating(ratingAfter, rankedGamesAfter).label;
    const rankedPlacementsRemainingAfter = Math.max(0, user.rankedPlacementsRemaining - 1);

    return {
      userId: participant.userId,
      ratingBefore,
      ratingAfter,
      ratingDelta,
      visibleRankBefore,
      visibleRankAfter,
      leaverPenaltyApplied: leftBeforeEnd,
      rankedGamesAfter,
      rankedPlacementsRemainingAfter,
      rankedPeakRatingAfter: Math.max(user.rankedPeakRating, ratingAfter),
    };
  });
}

function normalizeBattleRoyalPlacement(placement: number, activeTeamCount: number): number {
  const safeActiveTeamCount = Math.max(1, Math.floor(activeTeamCount));
  const safePlacement = clamp(Math.floor(placement), 1, safeActiveTeamCount);
  if (safeActiveTeamCount <= 1) return 1;
  return clamp(
    Math.round(((safePlacement - 1) / (safeActiveTeamCount - 1)) * (BATTLE_ROYAL_PLACEMENT_POINTS.length - 1)) + 1,
    1,
    BATTLE_ROYAL_PLACEMENT_POINTS.length
  );
}

function getBattleRoyalPlacementPoints(placement: number, activeTeamCount: number): { normalizedPlacement: number; points: number } {
  const normalizedPlacement = normalizeBattleRoyalPlacement(placement, activeTeamCount);
  return {
    normalizedPlacement,
    points: BATTLE_ROYAL_PLACEMENT_POINTS[normalizedPlacement - 1]
      ?? BATTLE_ROYAL_PLACEMENT_POINTS[BATTLE_ROYAL_PLACEMENT_POINTS.length - 1],
  };
}

function getBattleRoyalPlacementMultiplier(normalizedPlacement: number): number {
  if (normalizedPlacement <= 1) return 1.5;
  if (normalizedPlacement <= 3) return 1.25;
  if (normalizedPlacement <= 5) return 1;
  if (normalizedPlacement <= 7) return 0.75;
  return 0.5;
}

function getBattleRoyalEntryCost(user: RankedUserState): number {
  const tier = getRankFromRating(user.competitiveRating, user.rankedGames).tier;
  return tier === 'unranked' ? 0 : BATTLE_ROYAL_ENTRY_COST_BY_TIER[tier];
}

function getBattleRoyalParticipantEntryCost(participant: RankedMatchParticipant, user: RankedUserState): number {
  if (typeof participant.rankedEntryCost === 'number' && Number.isFinite(participant.rankedEntryCost)) {
    return Math.max(0, Math.floor(participant.rankedEntryCost));
  }
  return getBattleRoyalEntryCost(user);
}

function getBattleRoyalPositiveCap(humanParticipants: number): number {
  if (humanParticipants <= 1) return 35;
  if (humanParticipants <= 5) return 60;
  if (humanParticipants <= 15) return 90;
  return 125;
}

function calculateBattleRoyalRankedRatingUpdates(input: {
  participants: RankedMatchParticipant[];
  users: RankedUserState[];
  endedAt: Date;
  totalParticipants?: number;
  humanParticipants?: number;
  botParticipants?: number;
  activeTeamCount?: number;
}): RankedRatingUpdate[] {
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const participants = input.participants.filter((participant) => usersById.has(participant.userId));
  const humanParticipants = Math.max(1, Math.floor(input.humanParticipants ?? participants.length));
  const totalParticipants = Math.max(
    humanParticipants,
    Math.floor(input.totalParticipants ?? humanParticipants + Math.max(0, input.botParticipants ?? 0))
  );
  const botParticipants = Math.max(0, Math.floor(input.botParticipants ?? totalParticipants - humanParticipants));
  const qualityMultiplier = clamp(0.45 + (humanParticipants / Math.max(1, totalParticipants)) * 0.55, 0.45, 1);
  const defaultActiveTeamCount = Math.max(
    1,
    Math.floor(input.activeTeamCount ?? Math.max(...participants.map((participant) => participant.activeTeamCount ?? 0), 0, 1))
  );
  const positiveCap = getBattleRoyalPositiveCap(humanParticipants);

  return participants.map((participant) => {
    const user = usersById.get(participant.userId);
    if (!user) {
      throw new Error(`Missing ranked user state for ${participant.userId}`);
    }

    const ratingBefore = user.competitiveRating;
    const activeTeamCount = Math.max(1, Math.floor(participant.activeTeamCount ?? defaultActiveTeamCount));
    const placement = clamp(Math.floor(participant.placement ?? activeTeamCount), 1, activeTeamCount);
    const placementResult = getBattleRoyalPlacementPoints(placement, activeTeamCount);
    const placementMultiplier = getBattleRoyalPlacementMultiplier(placementResult.normalizedPlacement);
    const humanKills = Math.max(0, Math.floor(participant.humanKills ?? participant.kills));
    const botKills = Math.max(0, Math.floor(participant.botKills ?? 0));
    const humanAssists = Math.max(0, Math.floor(participant.humanAssists ?? participant.assists));
    const botAssists = Math.max(0, Math.floor(participant.botAssists ?? 0));
    const rawCombatPoints = humanKills * 14 + humanAssists * 7 + botKills * 5 + botAssists * 2;
    const combatPoints = Math.min(BATTLE_ROYAL_COMBAT_RP_CAP, Math.round(rawCombatPoints * placementMultiplier));
    const entryCost = getBattleRoyalParticipantEntryCost(participant, user);
    const grossPoints = Math.round((placementResult.points + combatPoints) * qualityMultiplier);
    const teamFinishedAt = participant.teamEliminatedAt ?? input.endedAt;
    const earlyLeaver = Boolean(
      participant.leftAt &&
      participant.leftAt.getTime() < teamFinishedAt.getTime()
    );
    let ratingDelta = grossPoints - entryCost;
    if (earlyLeaver) {
      const leaverPenalty = -Math.min(Math.abs(BATTLE_ROYAL_MATCH_DELTA_MIN), entryCost + 25);
      ratingDelta = Math.min(0, ratingDelta, leaverPenalty);
    }
    ratingDelta = clamp(ratingDelta, BATTLE_ROYAL_MATCH_DELTA_MIN, positiveCap);

    const ratingAfter = Math.max(0, ratingBefore + ratingDelta);
    const rankedGamesAfter = user.rankedGames + 1;
    const visibleRankBefore = getRankFromRating(ratingBefore, user.rankedGames).label;
    const visibleRankAfter = getRankFromRating(ratingAfter, rankedGamesAfter).label;
    const rankedPlacementsRemainingAfter = Math.max(0, user.rankedPlacementsRemaining - 1);
    const rankedBreakdown: RankedBattleRoyalBreakdown = {
      rulesVersion: RANKED_BATTLE_ROYAL_RULES_VERSION,
      placement,
      activeTeamCount,
      normalizedPlacement: placementResult.normalizedPlacement,
      placementPoints: placementResult.points,
      humanKills,
      botKills,
      humanAssists,
      botAssists,
      rawCombatPoints,
      placementMultiplier,
      combatPoints,
      entryCost,
      qualityMultiplier,
      humanParticipants,
      botParticipants,
      totalParticipants,
      grossPoints,
      positiveCap,
      earlyLeaver,
      teamEliminatedAt: participant.teamEliminatedAt?.toISOString() ?? null,
    };

    return {
      userId: participant.userId,
      ratingBefore,
      ratingAfter,
      ratingDelta,
      visibleRankBefore,
      visibleRankAfter,
      leaverPenaltyApplied: earlyLeaver,
      rankedGamesAfter,
      rankedPlacementsRemainingAfter,
      rankedPeakRatingAfter: Math.max(user.rankedPeakRating, ratingAfter),
      placement,
      rankedPlacementPoints: placementResult.points,
      rankedCombatPoints: combatPoints,
      rankedEntryCost: entryCost,
      rankedQualityMultiplier: qualityMultiplier,
      rankedRulesVersion: RANKED_BATTLE_ROYAL_RULES_VERSION,
      rankedBreakdown,
    };
  });
}

export function calculateRankedRatingUpdates(input: {
  gameplayMode?: GameplayMode;
  participants: RankedMatchParticipant[];
  users: RankedUserState[];
  winningTeam: Team | null;
  endedAt: Date;
  totalParticipants?: number;
  humanParticipants?: number;
  botParticipants?: number;
  activeTeamCount?: number;
}): RankedRatingUpdate[] {
  if (input.gameplayMode === BATTLE_ROYAL_GAMEPLAY_MODE) {
    return calculateBattleRoyalRankedRatingUpdates(input);
  }

  return calculateLegacyTeamRankedRatingUpdates(input);
}
