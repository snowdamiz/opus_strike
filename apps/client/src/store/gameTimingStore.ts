import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface GameTimingState {
  tick: number;
  serverTime: number;
}

const initialGameTimingState: GameTimingState = {
  tick: 0,
  serverTime: 0,
};

export const gameTimingStore = createStore<GameTimingState>(() => initialGameTimingState);

export function setGameTiming(tick: number, serverTime: number): void {
  const state = gameTimingStore.getState();
  if (state.tick === tick && state.serverTime === serverTime) return;
  gameTimingStore.setState({ tick, serverTime });
}

export function resetGameTiming(serverTime = 0): void {
  const state = gameTimingStore.getState();
  if (state.tick === 0 && state.serverTime === serverTime) return;
  gameTimingStore.setState({ tick: 0, serverTime });
}

export const useGameTimingStore = <T>(selector: (state: GameTimingState) => T): T => (
  useStore(gameTimingStore, selector)
);
