export interface RoomPopulationPlayer {
  id: string;
  isBot?: boolean | null;
}

export interface RoomPopulationCounts {
  humanCount: number;
  botCount: number;
  observerCount: number;
  npcCount: number;
  participantCount: number;
  entityCount: number;
}

export function getRoomPopulationCounts(input: {
  players: Iterable<RoomPopulationPlayer>;
  npcIds: ReadonlySet<string>;
  observerCount: number;
}): RoomPopulationCounts {
  let humanCount = 0;
  let botCount = 0;
  let npcCount = 0;

  for (const player of input.players) {
    if (input.npcIds.has(player.id)) {
      npcCount++;
    } else if (player.isBot) {
      botCount++;
    } else {
      humanCount++;
    }
  }

  return {
    humanCount,
    botCount,
    observerCount: Math.max(0, Math.floor(input.observerCount)),
    npcCount,
    participantCount: humanCount + botCount,
    entityCount: humanCount + botCount + npcCount,
  };
}
