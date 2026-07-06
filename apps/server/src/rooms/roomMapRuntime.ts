import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  createProceduralTerrainLookup,
  generateProceduralVoxelMap,
  getVoxelMapTheme,
  isCollisionBlock,
  normalizeVoxelMapSizeId,
  type GameplayMode,
  type MapProfileId,
  type PregeneratedMapArtifactId,
  type PregeneratedMapCatalogSummary,
  type PregeneratedMapId,
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
import { generateRoomMapManifest } from './roomMapGeneration';
import {
  isPublicSeedGenerationFallbackEnabled,
  pregeneratedMapCatalogService,
  type LoadedPregeneratedMapManifest,
} from '../maps/pregeneratedMapCatalog';

export interface RoomMapRuntimeConfig {
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  pregeneratedMapId?: PregeneratedMapId | null;
  mapArtifactId?: PregeneratedMapArtifactId | null;
}

export interface RoomMapRuntimeOptions {
  getMapConfig: () => RoomMapRuntimeConfig;
  getCollisionAabbs: NonNullable<MovementTerrainAdapter['getCollisionAabbs']>;
  loadPregeneratedMapManifest?: (mapId: PregeneratedMapId) => Promise<LoadedPregeneratedMapManifest>;
  isMapGenerationFallbackEnabled?: () => boolean;
  recordMapFallbackGeneration?: (input: {
    mapId: PregeneratedMapId;
    reason: string;
  }) => Promise<void>;
}

export interface RefreshBotTeamTacticsInput {
  now: number;
  gameplayMode: GameplayMode;
  players: BotPlayerSnapshot[];
  flags: Record<Team, BotFlagSnapshot>;
}

export class RoomMapRuntime {
  private mapManifest: VoxelMapManifest | null = null;
  private loadedPregeneratedMap: PregeneratedMapCatalogSummary | null = null;
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
    if (config.pregeneratedMapId) {
      this.assertFallbackAllowed(config.pregeneratedMapId, 'synchronous refresh requested before artifact load');
      void this.recordFallbackGeneration(config.pregeneratedMapId, 'synchronous refresh requested before artifact load');
    }
    const manifest = generateProceduralVoxelMap(config.mapSeed, {
      themeId: config.mapThemeId,
      mapSize: config.mapSize,
      profileId: config.mapProfileId,
    });
    return this.applyMapManifest(manifest);
  }

  /**
   * Generate a manifest off-thread WITHOUT applying it. Lets callers finish
   * worker generation for an upcoming map config (e.g. post-game reset seed)
   * while the current map stays live, then swap synchronously via
   * applyGeneratedMapManifest — avoiding any window where room state and the
   * loaded manifest disagree (which would trigger a blocking sync regen).
   */
  generateMapManifestAsync(overrides: Partial<RoomMapRuntimeConfig> = {}): Promise<VoxelMapManifest> {
    const base = this.resolveMapConfig();
    return generateRoomMapManifest({
      mapSeed: overrides.mapSeed ?? base.mapSeed,
      mapThemeId: overrides.mapThemeId !== undefined ? overrides.mapThemeId : base.mapThemeId,
      mapSize: overrides.mapSize !== undefined ? overrides.mapSize : base.mapSize,
      mapProfileId: overrides.mapProfileId !== undefined ? overrides.mapProfileId : base.mapProfileId,
    });
  }

  applyGeneratedMapManifest(manifest: VoxelMapManifest): VoxelMapManifest {
    return this.applyMapManifest(manifest);
  }

  async refreshMapAsync(): Promise<VoxelMapManifest> {
    const config = this.resolveMapConfig();
    if (config.pregeneratedMapId) {
      try {
        const loaded = await this.loadPregeneratedMapManifest(config.pregeneratedMapId);
        this.validatePregeneratedManifest(config, loaded);
        return this.applyMapManifest(loaded.manifest, loaded.summary);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!config.mapGenerationFallbackEnabled) {
          throw error;
        }
        await this.recordFallbackGeneration(config.pregeneratedMapId, reason);
      }
    }

    const manifest = await generateRoomMapManifest(config);
    return this.applyMapManifest(manifest);
  }

  private applyMapManifest(
    manifest: VoxelMapManifest,
    pregeneratedMap: PregeneratedMapCatalogSummary | null = null
  ): VoxelMapManifest {
    this.mapManifest = manifest;
    this.loadedPregeneratedMap = pregeneratedMap;
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
      config.pregeneratedMapId
      && (!this.loadedPregeneratedMap || this.loadedPregeneratedMap.id !== config.pregeneratedMapId)
    ) {
      this.assertFallbackAllowed(config.pregeneratedMapId, 'synchronous manifest access before artifact load');
      return this.refreshMap();
    }
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

  getLoadedPregeneratedMapSummary(): PregeneratedMapCatalogSummary | null {
    return this.loadedPregeneratedMap;
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

  private resolveMapConfig(): Required<RoomMapRuntimeConfig> & { mapGenerationFallbackEnabled: boolean } {
    const config = this.options.getMapConfig();
    const mapSeed = config.mapSeed;
    const mapThemeId = config.mapThemeId ?? getVoxelMapTheme(mapSeed).id;
    const mapSize = normalizeVoxelMapSizeId(config.mapSize || DEFAULT_VOXEL_MAP_SIZE_ID);
    const mapProfileId = config.mapProfileId ?? 'ctf_arena';
    const pregeneratedMapId = config.pregeneratedMapId ?? null;
    const mapArtifactId = config.mapArtifactId ?? null;
    const mapGenerationFallbackEnabled = this.options.isMapGenerationFallbackEnabled?.()
      ?? isPublicSeedGenerationFallbackEnabled();
    return {
      mapSeed,
      mapThemeId,
      mapSize,
      mapProfileId,
      pregeneratedMapId,
      mapArtifactId,
      mapGenerationFallbackEnabled,
    };
  }

  private loadPregeneratedMapManifest(mapId: PregeneratedMapId): Promise<LoadedPregeneratedMapManifest> {
    return this.options.loadPregeneratedMapManifest?.(mapId)
      ?? pregeneratedMapCatalogService.loadMapManifest(mapId);
  }

  private validatePregeneratedManifest(
    config: Required<RoomMapRuntimeConfig> & { mapGenerationFallbackEnabled: boolean },
    loaded: LoadedPregeneratedMapManifest
  ): void {
    if (loaded.summary.generatorVersion !== CONSTRUCTED_MAP_MANIFEST_VERSION) {
      throw new Error(`Pregenerated map ${loaded.summary.id} uses outdated generator version ${loaded.summary.generatorVersion}; expected ${CONSTRUCTED_MAP_MANIFEST_VERSION}`);
    }
    if (loaded.manifest.version !== CONSTRUCTED_MAP_MANIFEST_VERSION) {
      throw new Error(`Pregenerated map ${loaded.summary.id} artifact uses outdated generator version ${loaded.manifest.version}; expected ${CONSTRUCTED_MAP_MANIFEST_VERSION}`);
    }
    if (config.mapArtifactId && loaded.summary.artifactId !== config.mapArtifactId) {
      throw new Error(`Pregenerated map artifact mismatch: expected ${config.mapArtifactId}, got ${loaded.summary.artifactId}`);
    }
    if (loaded.summary.seed !== config.mapSeed) {
      throw new Error(`Pregenerated map seed mismatch: expected ${config.mapSeed}, got ${loaded.summary.seed}`);
    }
    if (loaded.summary.themeId !== config.mapThemeId) {
      throw new Error(`Pregenerated map theme mismatch: expected ${config.mapThemeId}, got ${loaded.summary.themeId}`);
    }
    if (loaded.summary.mapSize !== config.mapSize) {
      throw new Error(`Pregenerated map size mismatch: expected ${config.mapSize}, got ${loaded.summary.mapSize}`);
    }
    if (loaded.summary.profileId !== config.mapProfileId) {
      throw new Error(`Pregenerated map profile mismatch: expected ${config.mapProfileId}, got ${loaded.summary.profileId}`);
    }
  }

  private assertFallbackAllowed(mapId: PregeneratedMapId, reason: string): void {
    if (this.resolveMapConfig().mapGenerationFallbackEnabled) return;
    throw new Error(`Pregenerated map ${mapId} is required but cannot be loaded synchronously: ${reason}`);
  }

  private async recordFallbackGeneration(mapId: PregeneratedMapId, reason: string): Promise<void> {
    await this.options.recordMapFallbackGeneration?.({ mapId, reason }).catch(() => undefined);
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
