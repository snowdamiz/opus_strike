import type {
  BattleRoyalDropSnapshot,
  GamePhase,
} from '@voxel-strike/shared';

export type BattleRoyalVisibilityMode = 'deployment' | 'runtime';

export function getBattleRoyalVisibilityMode(input: {
  gamePhase: GamePhase;
  drop: BattleRoyalDropSnapshot | null | undefined;
  localPlayerId: string | null | undefined;
}): BattleRoyalVisibilityMode {
  if (input.gamePhase === 'countdown') return 'deployment';
  if (input.gamePhase === 'deployment') return 'deployment';
  return 'runtime';
}
