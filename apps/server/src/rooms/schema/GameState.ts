import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { DEFAULT_VOXEL_MAP_SIZE_ID, type GameConfig } from '@voxel-strike/shared';
import { Player } from './Player';
import { TeamState, Flag, Vec3Schema } from './Components';

export class GameState extends Schema {
  roomId: string = '';
  phase: string = 'waiting';
  tick: number = 0;
  serverTime: number = 0;
  mapSeed: number = 0;
  mapThemeId: string = '';
  mapSize: string = DEFAULT_VOXEL_MAP_SIZE_ID;
  gameplayMode: string = 'capture_the_flag';

  // Teams
  redTeam: TeamState = new TeamState();
  blueTeam: TeamState = new TeamState();

  // Players
  players = new MapSchema<Player>();

  // Timing
  roundStartTime: number = 0;
  roundTimeRemaining: number = 0;
  phaseEndTime: number = 0;

  // Config (not synced, server-side only)
  config!: GameConfig;

  constructor() {
    super();
    // Initialize team flags
    this.redTeam.flag = new Flag();
    this.redTeam.flag.team = 'red';
    this.redTeam.flag.position = new Vec3Schema();
    this.redTeam.flag.basePosition = new Vec3Schema();

    this.blueTeam.flag = new Flag();
    this.blueTeam.flag.team = 'blue';
    this.blueTeam.flag.position = new Vec3Schema();
    this.blueTeam.flag.basePosition = new Vec3Schema();
  }
}

defineTypes(GameState, {
  roomId: 'string',
  phase: 'string',
  mapSeed: 'number',
  mapThemeId: 'string',
  mapSize: 'string',
  gameplayMode: 'string',
  players: { map: Player },
  phaseEndTime: 'number',
});
