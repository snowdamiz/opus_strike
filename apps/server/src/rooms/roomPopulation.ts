export interface RoomPopulationPlayer {
  id: string;
  isBot?: boolean | null;
  role?: string | null;
}

export interface RoomPopulationCounts {
  humanCount: number;
  combatHumanCount: number;
  regularObserverCount: number;
  botCount: number;
  npcCount: number;
  participantCount: number;
  entityCount: number;
}

export function getRoomPopulationCounts(input: {
  players: Iterable<RoomPopulationPlayer>;
  npcIds: ReadonlySet<string>;
}): RoomPopulationCounts {
  let humanCount = 0;
  let combatHumanCount = 0;
  let regularObserverCount = 0;
  let botCount = 0;
  let npcCount = 0;

  for (const player of input.players) {
    if (input.npcIds.has(player.id)) {
      npcCount++;
    } else if (player.isBot) {
      botCount++;
    } else {
      humanCount++;
      if (player.role === 'observer') {
        regularObserverCount++;
      } else {
        combatHumanCount++;
      }
    }
  }

  return {
    humanCount,
    combatHumanCount,
    regularObserverCount,
    botCount,
    npcCount,
    participantCount: humanCount + botCount,
    entityCount: humanCount + botCount + npcCount,
  };
}
