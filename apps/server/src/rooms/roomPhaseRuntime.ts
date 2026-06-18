import type {
  GamePhase,
  GameplayMode,
  MapProfileId,
  RoundEndEvent,
  VoxelMapSizeId,
} from '@voxel-strike/shared';
import {
  getWinningTeam,
  shouldEndGameAfterRound,
} from './gameModeRules';

export const ROUND_END_INTERMISSION_MS = 5000;

export interface RoomPhaseStatePatch {
  phase: GamePhase;
  phaseEndTime: number;
  roundStartTime?: number;
  roundTimeRemaining?: number;
}

export function hasPhaseDeadlineElapsed(phaseEndTime: number, now: number): boolean {
  return Boolean(phaseEndTime && now >= phaseEndTime);
}

export function shouldStartHeroSelectPhase(input: {
  playerCount: number;
  hasRequiredHumanPlayersConnected: boolean;
}): boolean {
  return input.playerCount >= 1 && input.hasRequiredHumanPlayersConnected;
}

export function shouldAutoReadyHeroSelectPhase(input: {
  phaseEndTime: number;
  now: number;
}): boolean {
  return hasPhaseDeadlineElapsed(input.phaseEndTime, input.now);
}

export function shouldRunHeroSelectPhaseTransitionCheck(input: {
  lowFrequencyStateDue: boolean;
  phaseEndTime: number;
  now: number;
}): boolean {
  return input.lowFrequencyStateDue && shouldAutoReadyHeroSelectPhase(input);
}

export function getRoomRoundTimeRemaining(input: {
  roundStartTime: number;
  roundTimeRemaining: number;
  roundTimeSeconds: number;
  now: number;
}): number {
  if (!input.roundStartTime) return input.roundTimeRemaining;

  const elapsed = Math.max(0, (input.now - input.roundStartTime) / 1000);
  return Math.max(0, input.roundTimeSeconds - elapsed);
}

export interface DevTimeFreezeStatePatch {
  gameClockFrozen: boolean;
  roundStartTime?: number;
  roundTimeRemaining?: number;
  phaseEndTime?: number;
}

export function buildDevTimeFreezeStatePatch(input: {
  enabled: boolean;
  roundStartTime: number;
  roundTimeRemaining: number;
  roundTimeSeconds: number;
  now: number;
}): DevTimeFreezeStatePatch {
  if (input.enabled) {
    const roundTimeRemaining = getRoomRoundTimeRemaining(input);
    return {
      gameClockFrozen: true,
      roundTimeRemaining,
      ...(input.roundStartTime
        ? { phaseEndTime: input.now + roundTimeRemaining * 1000 }
        : {}),
    };
  }

  if (!input.roundStartTime) {
    return { gameClockFrozen: false };
  }

  const elapsedSeconds = input.roundTimeSeconds - input.roundTimeRemaining;
  return {
    gameClockFrozen: false,
    roundStartTime: input.now - elapsedSeconds * 1000,
    phaseEndTime: input.now + input.roundTimeRemaining * 1000,
  };
}

export function buildHeroSelectPhaseStatePatch(input: {
  now: number;
  durationSeconds: number;
}): RoomPhaseStatePatch {
  return {
    phase: 'hero_select',
    phaseEndTime: input.now + input.durationSeconds * 1000,
  };
}

export function buildCountdownPhaseStatePatch(input: {
  now: number;
  durationSeconds: number;
}): RoomPhaseStatePatch {
  return {
    phase: 'countdown',
    phaseEndTime: input.now + input.durationSeconds * 1000,
  };
}

export function buildPlayingPhaseStatePatch(input: {
  now: number;
  roundTimeSeconds: number;
}): RoomPhaseStatePatch {
  return {
    phase: 'playing',
    phaseEndTime: input.now + input.roundTimeSeconds * 1000,
    roundStartTime: input.now,
    roundTimeRemaining: input.roundTimeSeconds,
  };
}

export function buildRoundEndPhaseStatePatch(input: {
  now: number;
  intermissionMs?: number;
}): RoomPhaseStatePatch {
  return {
    phase: 'round_end',
    phaseEndTime: input.now + (input.intermissionMs ?? ROUND_END_INTERMISSION_MS),
  };
}

export function buildGameEndPhaseStatePatch(): RoomPhaseStatePatch {
  return {
    phase: 'game_end',
    phaseEndTime: 0,
    roundTimeRemaining: 0,
  };
}

export function buildPhaseChangePayload(input: {
  phase: GamePhase;
  endTime: number;
  mapSeed: number;
  mapThemeId: string;
  mapSize: VoxelMapSizeId;
  mapProfileId?: MapProfileId;
}): {
  phase: GamePhase;
  endTime: number;
  mapSeed: number;
  mapThemeId: string;
  mapSize: VoxelMapSizeId;
  mapProfileId: MapProfileId;
} {
  return {
    phase: input.phase,
    endTime: input.endTime,
    mapSeed: input.mapSeed,
    mapThemeId: input.mapThemeId,
    mapSize: input.mapSize,
    mapProfileId: input.mapProfileId ?? 'ctf_arena',
  };
}

export function getNextRoundEndPhase(input: {
  gameplayMode: GameplayMode;
  redScore: number;
  blueScore: number;
  scoreToWin: number;
}): GamePhase {
  return shouldEndGameAfterRound(
    input.gameplayMode,
    input.redScore,
    input.blueScore,
    input.scoreToWin
  )
    ? 'game_end'
    : 'hero_select';
}

export function buildRoundEndPayload(input: {
  gameplayMode: GameplayMode;
  redScore: number;
  blueScore: number;
  scoreToWin: number;
}): RoundEndEvent {
  return {
    winningTeam: getWinningTeam(input.redScore, input.blueScore),
    redScore: input.redScore,
    blueScore: input.blueScore,
    nextPhase: getNextRoundEndPhase(input),
  };
}
