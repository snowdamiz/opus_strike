export type FrameUpdater<TState> = (state: TState, delta: number) => void;

interface FrameUpdaterEntry<TState> {
  updater: FrameUpdater<TState>;
  index: number;
}

export interface FrameUpdaterRegistry<TState> {
  readonly size: number;
  register(effectId: string, updater: FrameUpdater<TState>): () => void;
  run(state: TState, delta: number): void;
}

export function createFrameUpdaterRegistry<TState>(): FrameUpdaterRegistry<TState> {
  const entries: FrameUpdaterEntry<TState>[] = [];
  const entriesById = new Map<string, FrameUpdaterEntry<TState>>();

  return {
    get size() {
      return entries.length;
    },

    register(effectId, updater) {
      const existing = entriesById.get(effectId);
      const entry: FrameUpdaterEntry<TState> = {
        updater,
        index: existing?.index ?? entries.length,
      };

      if (existing) {
        if (existing.index >= 0 && existing.index < entries.length && entries[existing.index] === existing) {
          entries[existing.index] = entry;
        } else {
          entry.index = entries.length;
          entries.push(entry);
        }
      } else {
        entries.push(entry);
      }
      entriesById.set(effectId, entry);

      return () => {
        if (entriesById.get(effectId) !== entry) return;
        entriesById.delete(effectId);
        const index = entry.index;
        if (index < 0) return;
        const last = entries.pop();
        if (last && index < entries.length) {
          entries[index] = last;
          last.index = index;
        }
        entry.index = -1;
      };
    },

    run(state, delta) {
      for (let index = 0; index < entries.length; index++) {
        entries[index].updater(state, delta);
      }
    },
  };
}
