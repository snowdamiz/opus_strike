import {
  getSegmentHitAgainstChronosAegis,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { getPlayerVisualLookPitch, visualStore } from '../../../store/visualStore';

const CHRONOS_AEGIS_VISUAL_COLLISION_STALE_MS = 360;

export interface ChronosAegisVisualHit {
  playerId: string;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

export function getFirstChronosAegisVisualHit(
  start: Vec3,
  direction: Vec3,
  distance: number,
  ownerTeam: Team | null | undefined,
  ownerId: string,
  projectileRadius = 0
): ChronosAegisVisualHit | null {
  if (!ownerTeam || distance <= 0.0001) return null;

  const game = useGameStore.getState();
  const visual = visualStore.getState();
  const now = Date.now();
  let bestHit: ChronosAegisVisualHit | null = null;

  for (const [playerId, aegis] of visual.chronosAegisStates) {
    if (playerId === ownerId) continue;

    const player = game.players.get(playerId) ?? (game.localPlayer?.id === playerId ? game.localPlayer : null);
    if (!player || !aegis?.active) continue;
    if (player.team === ownerTeam || player.state !== 'alive') continue;
    if (now - aegis.updatedAtMs > CHRONOS_AEGIS_VISUAL_COLLISION_STALE_MS) continue;

    const position = visual.playerPositions.get(playerId) ?? player.position;
    const lookYaw = visual.playerRotations.get(playerId) ?? player.lookYaw;
    const lookPitch = getPlayerVisualLookPitch(visual, player);
    const hit = getSegmentHitAgainstChronosAegis(
      start,
      direction,
      distance,
      { playerId, position, lookYaw, lookPitch },
      { projectileRadius }
    );
    if (!hit) continue;
    if (bestHit && hit.distance >= bestHit.distance) continue;

    bestHit = {
      playerId,
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance,
    };
  }

  return bestHit;
}
