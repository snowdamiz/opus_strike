import type { Vec3, Team } from '@voxel-strike/shared';

export type FlagStateType = 'at_base' | 'carried' | 'dropped';

export interface FlagState {
  team: Team;
  state: FlagStateType;
  position: Vec3;
  basePosition: Vec3;
  carrierId: string | null;
  droppedAt: number | null;
}

export class FlagManager {
  private redFlag: FlagState;
  private blueFlag: FlagState;

  constructor() {
    this.redFlag = this.createDefaultFlag('red');
    this.blueFlag = this.createDefaultFlag('blue');
  }

  private createDefaultFlag(team: Team): FlagState {
    return {
      team,
      state: 'at_base',
      position: { x: 0, y: 0, z: 0 },
      basePosition: { x: 0, y: 0, z: 0 },
      carrierId: null,
      droppedAt: null,
    };
  }

  initialize(redBase: Vec3, blueBase: Vec3): void {
    this.redFlag = {
      team: 'red',
      state: 'at_base',
      position: { ...redBase },
      basePosition: { ...redBase },
      carrierId: null,
      droppedAt: null,
    };

    this.blueFlag = {
      team: 'blue',
      state: 'at_base',
      position: { ...blueBase },
      basePosition: { ...blueBase },
      carrierId: null,
      droppedAt: null,
    };
  }

  getFlag(team: Team): FlagState {
    return team === 'red' ? { ...this.redFlag } : { ...this.blueFlag };
  }

  pickupFlag(team: Team, playerId: string): void {
    const flag = team === 'red' ? this.redFlag : this.blueFlag;
    
    if (flag.state === 'carried') return;

    flag.state = 'carried';
    flag.carrierId = playerId;
    flag.droppedAt = null;
  }

  dropFlag(team: Team, position: Vec3): void {
    const flag = team === 'red' ? this.redFlag : this.blueFlag;
    
    if (flag.state !== 'carried') return;

    flag.state = 'dropped';
    flag.position = { ...position };
    flag.carrierId = null;
    flag.droppedAt = Date.now();
  }

  captureFlag(team: Team): void {
    const flag = team === 'red' ? this.redFlag : this.blueFlag;
    
    // Return flag to its base
    flag.state = 'at_base';
    flag.position = { ...flag.basePosition };
    flag.carrierId = null;
    flag.droppedAt = null;
  }

  returnFlag(team: Team): void {
    const flag = team === 'red' ? this.redFlag : this.blueFlag;
    
    flag.state = 'at_base';
    flag.position = { ...flag.basePosition };
    flag.carrierId = null;
    flag.droppedAt = null;
  }

  updateCarrierPosition(team: Team, position: Vec3): void {
    const flag = team === 'red' ? this.redFlag : this.blueFlag;
    
    if (flag.state === 'carried') {
      flag.position = { ...position };
    }
  }

  update(_deltaTime: number): void {
    // Auto-return logic is handled by CTFGameMode
  }

  reset(): void {
    this.redFlag.state = 'at_base';
    this.redFlag.position = { ...this.redFlag.basePosition };
    this.redFlag.carrierId = null;
    this.redFlag.droppedAt = null;

    this.blueFlag.state = 'at_base';
    this.blueFlag.position = { ...this.blueFlag.basePosition };
    this.blueFlag.carrierId = null;
    this.blueFlag.droppedAt = null;
  }
}

