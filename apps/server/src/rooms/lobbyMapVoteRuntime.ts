import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  VOXEL_MAP_SIZE_IDS,
  VOXEL_MAP_THEMES,
  createProceduralMapPreview,
  createRandomSeed,
  getVoxelMapSizeDefinition,
  getVoxelMapTheme,
  getGameplayModeRules,
  hashSeed,
  type BlueprintPreview,
  type GameplayMode,
  type GameplayModeRules,
  type MapProfileId,
  type MapTopologyId,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

export interface MapVoteOption {
  id: string;
  seed: number;
  name: string;
  mapSize: VoxelMapSizeId;
  mapSizeLabel: string;
  mapProfileId: MapProfileId;
  themeId: string;
  themeName: string;
  mapThemeId?: VoxelMapTheme['id'] | null;
  topologyId: MapTopologyId;
  preview: BlueprintPreview;
  score: number;
}

export interface MapVoteRecord {
  playerId: string;
  optionId: string;
}

export interface MapVotePlayer {
  id: string;
  isBot?: boolean;
}

export interface MapVoteStartedPayload {
  options: MapVoteOption[];
  votes: MapVoteRecord[];
  phaseEndTime: number | null;
  gameplayMode: GameplayMode;
}

export interface MapVoteUpdatedPayload {
  votes: MapVoteRecord[];
}

export interface CreateMapVoteOptionsInput {
  gameplayMode?: GameplayMode;
  source: number;
  participantCount?: number;
}

export interface MapLaunchSelection {
  id: string;
  seed: number;
  mapSize: VoxelMapSizeId;
  mapProfileId: MapProfileId;
}

const MAP_NAME_SUFFIXES = [
  'Crucible',
  'Relay',
  'Bastion',
  'Run',
  'Vault',
  'Array',
  'Ridge',
  'Gate',
];

function getShuffledThemeIndices(source: number): number[] {
  const themeIndices = VOXEL_MAP_THEMES.map((_, index) => index);

  for (let index = themeIndices.length - 1; index > 0; index--) {
    const swapIndex = createRandomSeed(source + index * 0x9e3779b1) % (index + 1);
    [themeIndices[index], themeIndices[swapIndex]] = [themeIndices[swapIndex], themeIndices[index]];
  }

  return themeIndices;
}

function createSeedForTheme(themeIndex: number, source: number): number {
  const seed = createRandomSeed(source ^ Math.imul(themeIndex + 1, 0x9e3779b1));
  const stride = hashSeed(seed ^ source ^ 0xa5a5a5a5) | 1;
  const targetTheme = VOXEL_MAP_THEMES[themeIndex];
  if (!targetTheme) return seed;

  for (let attempt = 0; attempt < 512; attempt++) {
    const candidate = (seed + Math.imul(attempt, stride)) >>> 0;
    if (getVoxelMapTheme(candidate).id === targetTheme.id) {
      return candidate;
    }
  }

  return themeIndex >>> 0;
}

export function createMapVoteOption(
  seed: number,
  index: number,
  mapThemeId: VoxelMapTheme['id'] | null = null,
  mapSize: VoxelMapSizeId = DEFAULT_VOXEL_MAP_SIZE_ID,
  mapProfileId: MapProfileId = 'ctf_arena'
): MapVoteOption {
  const normalizedSeed = seed >>> 0;
  const theme = getVoxelMapTheme(normalizedSeed, mapThemeId);
  const preview = createProceduralMapPreview(normalizedSeed, mapSize, { profileId: mapProfileId, themeId: mapThemeId });
  const mapSizeDefinition = getVoxelMapSizeDefinition(mapSize);
  const suffix = MAP_NAME_SUFFIXES[hashSeed(normalizedSeed ^ index) % MAP_NAME_SUFFIXES.length];
  const themeName = mapThemeId ? theme.name : preview.themeName || theme.name;

  return {
    id: `map_${index + 1}`,
    seed: normalizedSeed,
    name: `${themeName} ${suffix}`,
    mapSize: mapSizeDefinition.id,
    mapSizeLabel: mapSizeDefinition.label,
    mapProfileId,
    themeId: theme.id,
    themeName,
    mapThemeId,
    topologyId: preview.topologyId,
    preview: preview.preview,
    score: preview.diagnostics.score,
  };
}

export function createMapVoteOptions(input: CreateMapVoteOptionsInput): MapVoteOption[] {
  const rules = getGameplayModeRules(input.gameplayMode);
  const mapProfileId = rules.mapProfileId;
  if (mapProfileId === 'battle_royal_large') return [];

  const mapSizes = VOXEL_MAP_SIZE_IDS;

  const themeIndices = getShuffledThemeIndices(input.source);

  return Array.from({ length: mapSizes.length }, (_, index) => {
    const themeIndex = themeIndices[index % themeIndices.length];
    const seed = createSeedForTheme(themeIndex, input.source ^ Math.imul(index + 1, 0x85ebca6b));
    const mapSize = mapSizes[index % mapSizes.length];
    return createMapVoteOption(seed, index, null, mapSize, mapProfileId);
  });
}

export function getBattleRoyalMapSizeForParticipantCount(input: {
  participantCount: number;
  rules?: GameplayModeRules;
}): VoxelMapSizeId {
  const rules = input.rules ?? getGameplayModeRules('battle_royal');
  const participantCount = Math.max(0, Math.floor(input.participantCount));
  const mapSizeBandWidth = Math.max(1, Math.floor((rules.maxPlayers - rules.minPlayers + 1) / 3));
  const smallMaxPlayers = rules.minPlayers + mapSizeBandWidth - 1;
  const largeMinPlayers = rules.maxPlayers - mapSizeBandWidth + 1;
  if (participantCount <= smallMaxPlayers) return 'small';
  if (participantCount >= largeMinPlayers) return 'large';
  return 'medium';
}

export function createMapLaunchSelection(input: CreateMapVoteOptionsInput): MapLaunchSelection {
  const rules = getGameplayModeRules(input.gameplayMode);
  const themeIndex = getShuffledThemeIndices(input.source)[0] ?? 0;
  const seed = createSeedForTheme(themeIndex, input.source ^ 0x85ebca6b);
  const mapSize = rules.mapProfileId === 'battle_royal_large'
    ? getBattleRoyalMapSizeForParticipantCount({
      participantCount: input.participantCount ?? rules.maxPlayers,
      rules,
    })
    : DEFAULT_VOXEL_MAP_SIZE_ID;

  return {
    id: 'map_1',
    seed,
    mapSize,
    mapProfileId: rules.mapProfileId,
  };
}

export function getMapVoteRecords(
  votes: Iterable<readonly [string, string]>
): MapVoteRecord[] {
  return Array.from(votes, ([playerId, optionId]) => ({ playerId, optionId }));
}

export function haveAllHumanPlayersVoted(input: {
  players: Iterable<MapVotePlayer>;
  votes: Iterable<readonly [string, string]>;
}): boolean {
  const votedPlayerIds = new Set(Array.from(input.votes, ([playerId]) => playerId));
  let hasHumanPlayer = false;

  for (const player of input.players) {
    if (player.isBot) continue;
    hasHumanPlayer = true;
    if (!votedPlayerIds.has(player.id)) return false;
  }

  return hasHumanPlayer;
}

export function getWinningMapOption(input: {
  options: readonly MapVoteOption[];
  votes: Iterable<readonly [string, string]>;
  hostId: string;
}): MapVoteOption {
  const firstOption = input.options[0];
  if (!firstOption) {
    throw new Error('Cannot choose map without map options');
  }

  const voteEntries = Array.from(input.votes);
  const voteCounts = new Map(input.options.map((option) => [option.id, 0]));
  for (const [, optionId] of voteEntries) {
    voteCounts.set(optionId, (voteCounts.get(optionId) || 0) + 1);
  }

  const hostVote = input.hostId
    ? voteEntries.find(([playerId]) => playerId === input.hostId)?.[1] ?? null
    : null;
  let bestOption = firstOption;
  let bestCount = voteCounts.get(bestOption.id) || 0;

  for (const option of input.options.slice(1)) {
    const count = voteCounts.get(option.id) || 0;
    const hostBreaksTie = count === bestCount && hostVote === option.id && hostVote !== bestOption.id;

    if (count > bestCount || hostBreaksTie) {
      bestOption = option;
      bestCount = count;
    }
  }

  return bestOption;
}

export function buildMapVoteStartedPayload(input: {
  options: MapVoteOption[];
  votes: Iterable<readonly [string, string]>;
  phaseEndTime: number | null;
  gameplayMode: GameplayMode;
}): MapVoteStartedPayload {
  return {
    options: input.options,
    votes: getMapVoteRecords(input.votes),
    phaseEndTime: input.phaseEndTime,
    gameplayMode: input.gameplayMode,
  };
}

export function buildMapVoteUpdatedPayload(
  votes: Iterable<readonly [string, string]>
): MapVoteUpdatedPayload {
  return {
    votes: getMapVoteRecords(votes),
  };
}
