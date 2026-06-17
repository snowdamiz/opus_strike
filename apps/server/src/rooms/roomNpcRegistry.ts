export interface RoomNpcIdentity {
  id: string;
  name: string;
}

export class RoomNpcRegistry {
  private nextNpcIndex = 0;
  private readonly npcIds = new Set<string>();

  get ids(): ReadonlySet<string> {
    return this.npcIds;
  }

  get size(): number {
    return this.npcIds.size;
  }

  createIdentity(heroName: string, requestedName?: string): RoomNpcIdentity {
    const index = this.nextNpcIndex++;
    return {
      id: `npc_${index}`,
      name: requestedName || `${heroName}_${index + 1}`,
    };
  }

  add(id: string): void {
    this.npcIds.add(id);
  }

  delete(id: string): boolean {
    return this.npcIds.delete(id);
  }

  has(id: string): boolean {
    return this.npcIds.has(id);
  }

  resolveId(query: string): string | null {
    if (this.npcIds.has(query)) return query;
    for (const id of this.npcIds) {
      if (id.includes(query)) return id;
    }
    return null;
  }

  snapshotIds(): string[] {
    return Array.from(this.npcIds);
  }
}
