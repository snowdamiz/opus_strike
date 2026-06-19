import type {
  BattleRoyalDropPlayerSnapshot,
  BattleRoyalDropSnapshot,
  GamePhase,
} from '@voxel-strike/shared';

export type BattleRoyalVisibilityMode = 'deployment' | 'runtime';

function findDropPlayer(
  drop: BattleRoyalDropSnapshot | null | undefined,
  playerId: string | null | undefined
): BattleRoyalDropPlayerSnapshot | null {
  if (!drop || !playerId) return null;
  return drop.players.find((player) => player.playerId === playerId) ?? null;
}

export function getBattleRoyalVisibilityMode(input: {
  gamePhase: GamePhase;
  drop: BattleRoyalDropSnapshot | null | undefined;
  localPlayerId: string | null | undefined;
}): BattleRoyalVisibilityMode {
  if (input.gamePhase === 'countdown') return 'deployment';
  if (input.gamePhase !== 'deployment') return 'runtime';

  const dropPlayer = findDropPlayer(input.drop, input.localPlayerId);
  return dropPlayer?.status === 'landed' ? 'runtime' : 'deployment';
}
