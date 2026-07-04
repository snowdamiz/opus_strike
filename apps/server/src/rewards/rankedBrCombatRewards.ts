import type { PlayerRewardRuntimeConfig } from './config';

export const RANKED_BR_COMBAT_REWARD_FORMULA_VERSION = 'ranked_br_sol_v1';

export type RankedBrRewardTargetKind = 'human' | 'official_ranked_br_bot' | 'non_rewardable';
export type RankedBrRewardSkippedReason =
  | 'disabled'
  | 'shadow_mode'
  | 'non_rewardable_target'
  | 'self_damage'
  | 'friendly_fire'
  | 'source_victim_damage_cap'
  | 'player_match_cap'
  | 'player_daily_cap'
  | 'match_pool_cap';

export interface RankedBrCombatGrant {
  userId: string;
  playerSessionId: string;
  amountLamports: bigint;
  metadata: RankedBrCombatGrantMetadata;
}

export interface RankedBrCombatGrantMetadata {
  formulaVersion: typeof RANKED_BR_COMBAT_REWARD_FORMULA_VERSION;
  gameplayMode: 'battle_royal';
  settingsVersion: number;
  settingsVersions: number[];
  damageLamportsPerHp: string;
  killLamports: string;
  botTargetRewardBps: number;
  humanRewardableDamageHp: number;
  botRewardableDamageHp: number;
  humanKills: number;
  botKills: number;
  damageRewardLamports: string;
  killRewardLamports: string;
  cappedLamports: string;
  skippedLamportsByReason: Record<string, string>;
}

interface RankedBrUserTotals {
  userId: string;
  playerSessionId: string;
  totalLamports: bigint;
  damageRewardLamports: bigint;
  killRewardLamports: bigint;
  cappedLamports: bigint;
  humanRewardableDamageHp: number;
  botRewardableDamageHp: number;
  humanKills: number;
  botKills: number;
  settingsVersions: Set<number>;
  latestSettingsVersion: number;
  latestDamageLamportsPerHp: bigint;
  latestKillLamports: bigint;
  latestBotTargetRewardBps: number;
  skippedLamportsByReason: Map<RankedBrRewardSkippedReason, bigint>;
}

export interface RankedBrRewardAccumulatorInput {
  matchId: string;
  roomId: string;
  lobbyId: string | null;
  dailyTotalsByUserId: Map<string, bigint>;
  matchPoolLamports: bigint;
}

export interface RankedBrRewardEventInput {
  config: PlayerRewardRuntimeConfig;
  sourcePlayerId: string;
  sourceUserId: string;
  sourceTeam: string | null;
  targetPlayerId: string;
  targetTeam: string | null;
  targetKind: RankedBrRewardTargetKind;
  playerSessionId: string;
  serverAppliedDamageHp: number;
  finalEnemyElimination: boolean;
}

export interface RankedBrRewardEventResult {
  amountLamports: bigint;
  settingsVersion: number;
  targetKind: RankedBrRewardTargetKind;
}

function minBigint(...values: bigint[]): bigint {
  let min = values[0] ?? 0n;
  for (const value of values) {
    if (value < min) min = value;
  }
  return min;
}

function toRewardableHp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.floor(value));
}

function addSkippedLamports(
  totals: RankedBrUserTotals,
  reason: RankedBrRewardSkippedReason,
  amountLamports: bigint
): void {
  if (amountLamports <= 0n) return;
  totals.skippedLamportsByReason.set(
    reason,
    (totals.skippedLamportsByReason.get(reason) ?? 0n) + amountLamports
  );
}

function skippedLamportsRecord(input: Map<RankedBrRewardSkippedReason, bigint>): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [reason, amount] of input) {
    if (amount > 0n) entries.push([reason, amount.toString()]);
  }
  return Object.fromEntries(entries);
}

export function computeRankedBrDynamicMatchPoolLamports(input: {
  availableTreasuryLamports: bigint;
  maxMatchLamports: bigint;
  treasuryExposureBps: number;
}): bigint {
  if (input.availableTreasuryLamports <= 0n || input.maxMatchLamports <= 0n) return 0n;
  const exposureBps = BigInt(Math.max(0, Math.floor(input.treasuryExposureBps)));
  const exposedLamports = input.availableTreasuryLamports * exposureBps / 10_000n;
  return minBigint(input.maxMatchLamports, exposedLamports);
}

export class RankedBrRewardAccumulator {
  private readonly perUser = new Map<string, RankedBrUserTotals>();
  private readonly sourceVictimDamageHp = new Map<string, number>();
  private matchPoolRemainingLamports: bigint;
  private matchAwardedLamports = 0n;

  constructor(private readonly input: RankedBrRewardAccumulatorInput) {
    this.matchPoolRemainingLamports = input.matchPoolLamports;
  }

  recordDamage(input: RankedBrRewardEventInput): RankedBrRewardEventResult | null {
    const settingsVersion = input.config.settingsVersion;
    const totals = this.getUserTotals(input.sourceUserId, input.playerSessionId, settingsVersion);
    totals.settingsVersions.add(settingsVersion);
    totals.latestSettingsVersion = settingsVersion;
    totals.latestDamageLamportsPerHp = input.config.rankedBrDamageLamportsPerHp;
    totals.latestKillLamports = input.config.rankedBrKillLamports;
    totals.latestBotTargetRewardBps = input.config.rankedBrBotTargetRewardBps;

    if (!input.config.enabled || !input.config.rankedBrCombatRewardsEnabled) {
      addSkippedLamports(totals, 'disabled', this.estimateGrossLamports(input));
      return null;
    }
    if (input.config.rankedBrCombatRewardsShadowMode) {
      addSkippedLamports(totals, 'shadow_mode', this.estimateGrossLamports(input));
      return null;
    }
    if (input.targetKind === 'non_rewardable') {
      addSkippedLamports(totals, 'non_rewardable_target', this.estimateGrossLamports(input));
      return null;
    }
    if (input.sourcePlayerId === input.targetPlayerId) {
      addSkippedLamports(totals, 'self_damage', this.estimateGrossLamports(input));
      return null;
    }
    if (input.sourceTeam && input.targetTeam && input.sourceTeam === input.targetTeam) {
      addSkippedLamports(totals, 'friendly_fire', this.estimateGrossLamports(input));
      return null;
    }

    const sourceVictimKey = `${input.sourcePlayerId}:${input.targetPlayerId}`;
    const previousSourceVictimDamage = this.sourceVictimDamageHp.get(sourceVictimKey) ?? 0;
    const sourceVictimCap = Math.max(0, Math.floor(input.config.rankedBrSourceVictimDamageCapHp));
    const rewardableDamageHp = Math.min(
      toRewardableHp(input.serverAppliedDamageHp),
      Math.max(0, sourceVictimCap - previousSourceVictimDamage)
    );
    const damageCapSkippedHp = toRewardableHp(input.serverAppliedDamageHp) - rewardableDamageHp;

    if (rewardableDamageHp > 0) {
      this.sourceVictimDamageHp.set(sourceVictimKey, previousSourceVictimDamage + rewardableDamageHp);
    }

    const targetBps = input.targetKind === 'official_ranked_br_bot'
      ? Math.max(0, Math.floor(input.config.rankedBrBotTargetRewardBps))
      : 10_000;
    const baseDamageLamports = BigInt(rewardableDamageHp) * input.config.rankedBrDamageLamportsPerHp;
    const baseKillLamports = input.finalEnemyElimination ? input.config.rankedBrKillLamports : 0n;
    const damageRewardLamports = baseDamageLamports * BigInt(targetBps) / 10_000n;
    const killRewardLamports = baseKillLamports * BigInt(targetBps) / 10_000n;
    const grossRewardLamports = damageRewardLamports + killRewardLamports;

    if (damageCapSkippedHp > 0) {
      const skipped = BigInt(damageCapSkippedHp) * input.config.rankedBrDamageLamportsPerHp * BigInt(targetBps) / 10_000n;
      addSkippedLamports(totals, 'source_victim_damage_cap', skipped);
    }
    if (grossRewardLamports <= 0n) return null;

    const dailyBeforeMatch = this.input.dailyTotalsByUserId.get(input.sourceUserId) ?? 0n;
    const remainingPlayerMatch = input.config.rankedBrMaxPlayerMatchLamports - totals.totalLamports;
    const remainingPlayerDaily = input.config.rankedBrMaxPlayerDailyLamports - dailyBeforeMatch - totals.totalLamports;
    const remainingMatchPool = minBigint(
      this.matchPoolRemainingLamports,
      input.config.rankedBrMaxMatchLamports - this.matchAwardedLamports
    );
    const rewardLamports = minBigint(
      grossRewardLamports,
      remainingPlayerMatch,
      remainingPlayerDaily,
      remainingMatchPool
    );

    if (rewardLamports <= 0n) {
      addSkippedLamports(
        totals,
        remainingPlayerMatch <= 0n
          ? 'player_match_cap'
          : remainingPlayerDaily <= 0n
            ? 'player_daily_cap'
            : 'match_pool_cap',
        grossRewardLamports
      );
      return null;
    }

    const cappedLamports = grossRewardLamports - rewardLamports;
    if (cappedLamports > 0n) {
      const reason = rewardLamports === remainingPlayerMatch
        ? 'player_match_cap'
        : rewardLamports === remainingPlayerDaily
          ? 'player_daily_cap'
          : 'match_pool_cap';
      addSkippedLamports(totals, reason, cappedLamports);
      totals.cappedLamports += cappedLamports;
    }

    totals.totalLamports += rewardLamports;
    totals.damageRewardLamports += damageRewardLamports;
    totals.killRewardLamports += killRewardLamports;
    if (input.targetKind === 'official_ranked_br_bot') {
      totals.botRewardableDamageHp += rewardableDamageHp;
      if (input.finalEnemyElimination) totals.botKills += 1;
    } else {
      totals.humanRewardableDamageHp += rewardableDamageHp;
      if (input.finalEnemyElimination) totals.humanKills += 1;
    }
    this.matchPoolRemainingLamports -= rewardLamports;
    this.matchAwardedLamports += rewardLamports;

    return {
      amountLamports: rewardLamports,
      settingsVersion,
      targetKind: input.targetKind,
    };
  }

  buildGrants(): RankedBrCombatGrant[] {
    const grants: RankedBrCombatGrant[] = [];
    for (const totals of this.perUser.values()) {
      if (totals.totalLamports <= 0n) continue;
      const settingsVersions = Array.from(totals.settingsVersions).sort((a, b) => a - b);
      grants.push({
        userId: totals.userId,
        playerSessionId: totals.playerSessionId,
        amountLamports: totals.totalLamports,
        metadata: {
          formulaVersion: RANKED_BR_COMBAT_REWARD_FORMULA_VERSION,
          gameplayMode: 'battle_royal',
          settingsVersion: totals.latestSettingsVersion,
          settingsVersions,
          damageLamportsPerHp: totals.latestDamageLamportsPerHp.toString(),
          killLamports: totals.latestKillLamports.toString(),
          botTargetRewardBps: totals.latestBotTargetRewardBps,
          humanRewardableDamageHp: totals.humanRewardableDamageHp,
          botRewardableDamageHp: totals.botRewardableDamageHp,
          humanKills: totals.humanKills,
          botKills: totals.botKills,
          damageRewardLamports: totals.damageRewardLamports.toString(),
          killRewardLamports: totals.killRewardLamports.toString(),
          cappedLamports: totals.cappedLamports.toString(),
          skippedLamportsByReason: skippedLamportsRecord(totals.skippedLamportsByReason),
        },
      });
    }
    return grants;
  }

  private getUserTotals(userId: string, playerSessionId: string, settingsVersion: number): RankedBrUserTotals {
    const existing = this.perUser.get(userId);
    if (existing) {
      existing.playerSessionId = playerSessionId;
      return existing;
    }

    const created: RankedBrUserTotals = {
      userId,
      playerSessionId,
      totalLamports: 0n,
      damageRewardLamports: 0n,
      killRewardLamports: 0n,
      cappedLamports: 0n,
      humanRewardableDamageHp: 0,
      botRewardableDamageHp: 0,
      humanKills: 0,
      botKills: 0,
      settingsVersions: new Set([settingsVersion]),
      latestSettingsVersion: settingsVersion,
      latestDamageLamportsPerHp: 0n,
      latestKillLamports: 0n,
      latestBotTargetRewardBps: 0,
      skippedLamportsByReason: new Map(),
    };
    this.perUser.set(userId, created);
    return created;
  }

  private estimateGrossLamports(input: RankedBrRewardEventInput): bigint {
    const targetBps = input.targetKind === 'official_ranked_br_bot'
      ? BigInt(Math.max(0, Math.floor(input.config.rankedBrBotTargetRewardBps)))
      : input.targetKind === 'human'
        ? 10_000n
        : 0n;
    const damageLamports = BigInt(toRewardableHp(input.serverAppliedDamageHp)) * input.config.rankedBrDamageLamportsPerHp;
    const killLamports = input.finalEnemyElimination ? input.config.rankedBrKillLamports : 0n;
    return (damageLamports + killLamports) * targetBps / 10_000n;
  }

}
