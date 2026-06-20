import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  createProceduralTerrainLookup,
  generateProceduralVoxelMap,
  getVoxelMapTheme,
  isCollisionBlock,
  normalizeVoxelMapSizeId,
  type GameplayMode,
  type MapProfileId,
  type Team,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import {
  createVoxelCollisionWorld,
  type MovementCollisionWorld,
  type MovementTerrainAdapter,
} from '@voxel-strike/physics';
import {
  BOT_TACTICS_INTERVAL_MS,
  buildTeamTactics,
  createBotRouteGraphAdapter,
  type BotFlagSnapshot,
  type BotPlayerSnapshot,
  type BotRouteGraphAdapter,
  type BotTeamTacticsByTeam,
} from './bot-ai';
import { VoxelChunkLookup, worldToVoxelGrid } from './voxelChunkLookup';

export interface RoomMapRuntimeConfig {
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
}

export interface RoomMapRuntimeOptions {
  getMapConfig: () => RoomMapRuntimeConfig;
  getCollisionAabbs: NonNullable<MovementTerrainAdapter['getCollisionAabbs']>;
}

export interface RefreshBotTeamTacticsInput {
  now: number;
  gameplayMode: GameplayMode;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
}

export class RoomMapRuntime {
  private mapManifest: VoxelMapManifest | null = null;
  private botRouteGraph: BotRouteGraphAdapter | null = null;
  private botTeamTactics: BotTeamTacticsByTeam | null = null;
  private nextBotTacticsAt = 0;
  private botTacticsRevision = 0;
  private proceduralTerrainLookup: ReturnType<typeof createProceduralTerrainLookup> | null = null;
  private readonly mapChunks = new VoxelChunkLookup();
  private movementCollisionRevision = 0;
  private movementCollisionWorldCache: { revision: number; world: MovementCollisionWorld } | null = null;

  readonly terrain: MovementTerrainAdapter;

  constructor(private readonly options: RoomMapRuntimeOptions) {
    this.terrain = {
      getGroundY: (position) => this.getProceduralTerrainLookup().getGroundY(position),
      clampPosition: (position) => this.getProceduralTerrainLookup().clampToPlayableMap(position),
      getBlockAtWorld: (position) => this.getProceduralTerrainLookup().getBlockAtWorld(position),
      getMaxPlayableY: () => this.getProceduralTerrainLookup().getMaxPlayableY(),
      collisionRevision: 0,
      cacheStaticAabbs: true,
      getCollisionAabbs: options.getCollisionAabbs,
    };
  }

  refreshMap(): VoxelMapManifest {
    const config = this.resolveMapConfig();
    const manifest = generateProceduralVoxelMap(config.mapSeed, {
      themeId: config.mapThemeId,
      mapSize: config.mapSize,
      profileId: config.mapProfileId,
    });
    this.mapManifest = manifest;
    this.proceduralTerrainLookup = createProceduralTerrainLookup(manifest);
    this.mapChunks.reset(manifest);
    this.botRouteGraph = createBotRouteGraphAdapter(manifest);
    this.clearBotTeamTactics();
    this.terrain.origin = manifest.origin;
    this.terrain.voxelSize = manifest.voxelSize;
    this.resetMovementCollision();
    return manifest;
  }

  getMapManifest(): VoxelMapManifest {
    const config = this.resolveMapConfig();
    if (
      !this.mapManifest
      || this.mapManifest.seed !== config.mapSeed
      || this.mapManifest.themeId !== config.mapThemeId
      || this.mapManifest.mapSize !== config.mapSize
      || (this.mapManifest.profileId ?? null) !== config.mapProfileId
    ) {
      return this.refreshMap();
    }
    return this.mapManifest;
  }

  getBotRouteGraph(): BotRouteGraphAdapter | null {
    this.getMapManifest();
    return this.botRouteGraph;
  }

  getMovementCollisionRevision(): number {
    return this.movementCollisionRevision;
  }

  bumpMovementCollisionRevision(): number {
    this.movementCollisionRevision = (this.movementCollisionRevision + 1) >>> 0;
    if (this.movementCollisionRevision === 0) {
      this.movementCollisionRevision = 1;
    }
    this.terrain.collisionRevision = this.movementCollisionRevision;
    this.movementCollisionWorldCache = null;
    return this.movementCollisionRevision;
  }

  getMovementCollisionWorld(): MovementCollisionWorld {
    this.getMapManifest();
    const revision = this.movementCollisionRevision;
    const cached = this.movementCollisionWorldCache;
    if (cached && cached.revision === revision) {
      return cached.world;
    }

    this.terrain.collisionRevision = revision;
    const world = createVoxelCollisionWorld(this.terrain);
    this.movementCollisionWorldCache = { revision, world };
    return world;
  }

  getBlockAtWorld(position: { x: number; y: number; z: number }): number {
    const manifest = this.getLoadedMapManifest();
    return this.mapChunks.getBlockAtWorld(manifest, position);
  }

  getProceduralGroundY(position: { x: number; y: number; z: number }): number | null {
    const manifest = this.getLoadedMapManifest();
    const gx = worldToVoxelGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gz = worldToVoxelGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gz < 0 || gz >= manifest.size.z) {
      return null;
    }

    const topRow = manifest.heightfield.topSolidRows[gx + gz * manifest.heightfield.size.x];
    if (topRow > 0) {
      const topY = manifest.origin.y + topRow * manifest.voxelSize.y;
      if (position.y >= topY - 0.75) {
        return topY;
      }
    }

    const startY = Math.max(0, Math.min(
      manifest.size.y - 1,
      worldToVoxelGrid(position.y - 0.15, manifest.origin.y, manifest.voxelSize.y)
    ));

    for (let gy = startY; gy >= 0; gy--) {
      const block = this.getBlockAtWorld({
        x: position.x,
        y: manifest.origin.y + (gy + 0.5) * manifest.voxelSize.y,
        z: position.z,
      });
      if (isCollisionBlock(block)) {
        return manifest.origin.y + (gy + 1) * manifest.voxelSize.y;
      }
    }

    return null;
  }

  clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return this.getProceduralTerrainLookup().clampToPlayableMap(position);
  }

  refreshBotTeamTactics(input: RefreshBotTeamTacticsInput): BotTeamTacticsByTeam {
    if (this.botTeamTactics && input.now < this.nextBotTacticsAt) {
      return this.botTeamTactics;
    }

    this.botTacticsRevision++;
    this.botTeamTactics = buildTeamTactics({
      now: input.now,
      revision: this.botTacticsRevision,
      gameplayMode: input.gameplayMode,
      players: input.players,
      flags: input.flags,
    });
    this.nextBotTacticsAt = input.now + BOT_TACTICS_INTERVAL_MS;
    return this.botTeamTactics;
  }

  private getProceduralTerrainLookup(): ReturnType<typeof createProceduralTerrainLookup> {
    if (this.proceduralTerrainLookup) return this.proceduralTerrainLookup;
    const manifest = this.getLoadedMapManifest();
    this.proceduralTerrainLookup = createProceduralTerrainLookup(manifest);
    return this.proceduralTerrainLookup;
  }

  private getLoadedMapManifest(): VoxelMapManifest {
    return this.mapManifest ?? this.refreshMap();
  }

  private resolveMapConfig(): Required<RoomMapRuntimeConfig> {
    const config = this.options.getMapConfig();
    const mapSeed = config.mapSeed;
    const mapThemeId = config.mapThemeId ?? getVoxelMapTheme(mapSeed).id;
    const mapSize = normalizeVoxelMapSizeId(config.mapSize || DEFAULT_VOXEL_MAP_SIZE_ID);
    const mapProfileId = config.mapProfileId ?? 'ctf_arena';
    return { mapSeed, mapThemeId, mapSize, mapProfileId };
  }

  private clearBotTeamTactics(): void {
    this.botTeamTactics = null;
    this.nextBotTacticsAt = 0;
  }

  private resetMovementCollision(): void {
    this.movementCollisionRevision = 0;
    this.terrain.collisionRevision = 0;
    this.movementCollisionWorldCache = null;
  }
}
