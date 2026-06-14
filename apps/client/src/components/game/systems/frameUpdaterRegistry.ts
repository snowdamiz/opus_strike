export type FrameUpdater<TState> = (state: TState, delta: number) => void;

interface FrameUpdaterEntry<TState> {
  updater: FrameUpdater<TState>;
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
      const entry: FrameUpdaterEntry<TState> = { updater };
      const existing = entriesById.get(effectId);
      if (existing) {
        const index = entries.indexOf(existing);
        if (index >= 0) {
          entries[index] = entry;
        } else {
          entries.push(entry);
        }
      } else {
        entries.push(entry);
      }
      entriesById.set(effectId, entry);

      return () => {
        if (entriesById.get(effectId) !== entry) return;
        entriesById.delete(effectId);
        const index = entries.indexOf(entry);
        if (index < 0) return;
        const last = entries.pop();
        if (last && index < entries.length) {
          entries[index] = last;
        }
      };
    },

    run(state, delta) {
      for (let index = 0; index < entries.length; index++) {
        entries[index].updater(state, delta);
      }
    },
  };
}
