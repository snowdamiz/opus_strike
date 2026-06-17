export interface PlayerPressState {
  primaryFire: boolean;
  secondaryFire: boolean;
  reload: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
}

export class PlayerPressStateTracker {
  private readonly states = new Map<string, PlayerPressState>();

  initialize(playerId: string): PlayerPressState {
    const state = createEmptyPlayerPressState();
    this.states.set(playerId, state);
    return state;
  }

  get(playerId: string): PlayerPressState | undefined {
    return this.states.get(playerId);
  }

  getOrCreate(playerId: string): PlayerPressState {
    return this.states.get(playerId) ?? this.initialize(playerId);
  }

  reset(playerId: string): PlayerPressState {
    const state = this.getOrCreate(playerId);
    state.primaryFire = false;
    state.secondaryFire = false;
    state.reload = false;
    state.ability1 = false;
    state.ability2 = false;
    state.ultimate = false;
    return state;
  }

  applyInput(playerId: string, input: PlayerPressState): PlayerPressState {
    const state = this.getOrCreate(playerId);
    state.primaryFire = input.primaryFire;
    state.secondaryFire = input.secondaryFire;
    state.reload = input.reload;
    state.ability1 = input.ability1;
    state.ability2 = input.ability2;
    state.ultimate = input.ultimate;
    return state;
  }

  clear(playerId: string): boolean {
    return this.states.delete(playerId);
  }

  clearAll(): void {
    this.states.clear();
  }
}

export function createEmptyPlayerPressState(): PlayerPressState {
  return {
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
  };
}
