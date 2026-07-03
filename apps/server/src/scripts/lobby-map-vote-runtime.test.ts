import assert from 'node:assert/strict';
import {
  getGameplayModeRules,
  INDEPENDENCE_VOXEL_MAP_THEME_ID,
  VOXEL_MAP_SIZE_IDS,
  createProceduralMapPreview,
  type PregeneratedMapCatalogSummary,
} from '@voxel-strike/shared';
import {
  addMissingBotMapVotes,
  BATTLE_ROYAL_EVENT_BIOME_CHANCE_BPS,
  buildMapVoteStartedPayload,
  buildMapVoteUpdatedPayload,
  createMapLaunchSelection,
  createMapVoteOptionFromCatalog,
  createMapVoteOption,
  createMapVoteOptions,
  getBattleRoyalEventBiomeThemeId,
  getBattleRoyalMapSizeForParticipantCount,
  getMapVoteRecords,
  getWinningMapOption,
  haveAllHumanPlayersVoted,
  type MapVoteOption,
} from '../rooms/lobbyMapVoteRuntime';

function option(id: string): MapVoteOption {
  return {
    ...createMapVoteOption(1000 + Number(id.replace('map_', '')), Number(id.replace('map_', '')) - 1),
    id,
  };
}

{
  const options = createMapVoteOptions({
    source: 123,
  });

  assert.equal(options.length, VOXEL_MAP_SIZE_IDS.length);
  assert.deepEqual(options.map((mapOption) => mapOption.id), VOXEL_MAP_SIZE_IDS.map((_, index) => `map_${index + 1}`));
  assert.deepEqual(options.map((mapOption) => mapOption.mapSize), VOXEL_MAP_SIZE_IDS);
  assert.equal(options.every((mapOption) => mapOption.mapThemeId === null), true);
}

// Event biome: when forced, exactly one of the three CTF/TDM vote options carries it, across
// many seed sources, and its theme threads through both mapThemeId and the resolved themeId.
for (const gameplayMode of ['capture_the_flag', 'team_deathmatch'] as const) {
  for (let source = 1; source <= 40; source++) {
    const options = createMapVoteOptions({
      gameplayMode,
      source: source * 0x9e3779b1,
      eventThemeId: INDEPENDENCE_VOXEL_MAP_THEME_ID,
    });

    const eventOptions = options.filter(
      (mapOption) => mapOption.mapThemeId === INDEPENDENCE_VOXEL_MAP_THEME_ID
    );
    assert.equal(options.length, VOXEL_MAP_SIZE_IDS.length);
    assert.equal(eventOptions.length, 1, `expected exactly one event map for ${gameplayMode} source ${source}`);
    assert.equal(eventOptions[0].themeId, INDEPENDENCE_VOXEL_MAP_THEME_ID);
    assert.equal(eventOptions[0].themeName, 'Independence Day');
    // The other two remain seed-derived (standard rotation only).
    assert.equal(options.filter((mapOption) => mapOption.mapThemeId === null).length, 2);
  }
}

// Battle royal skips map voting; event-biome selection happens during direct launch instead.
{
  const options = createMapVoteOptions({
    gameplayMode: 'battle_royal',
    source: 777,
    eventThemeId: INDEPENDENCE_VOXEL_MAP_THEME_ID,
  });
  assert.deepEqual(options, []);
}

{
  const options = createMapVoteOptions({
    gameplayMode: 'battle_royal',
    source: 0x51f15eed,
  });

  assert.deepEqual(options, []);
}

{
  let eventRolls = 0;
  const sampleSize = 10_000;
  for (let seed = 0; seed < sampleSize; seed++) {
    if (getBattleRoyalEventBiomeThemeId({
      seed,
      eventThemeId: INDEPENDENCE_VOXEL_MAP_THEME_ID,
    }) === INDEPENDENCE_VOXEL_MAP_THEME_ID) {
      eventRolls++;
    }
  }

  const expectedRolls = sampleSize * (BATTLE_ROYAL_EVENT_BIOME_CHANCE_BPS / 10_000);
  assert.ok(
    Math.abs(eventRolls - expectedRolls) <= sampleSize * 0.03,
    `expected battle royal event biome rolls near 33%, got ${eventRolls}/${sampleSize}`
  );
  assert.equal(getBattleRoyalEventBiomeThemeId({
    seed: 0,
    eventThemeId: null,
  }), null);
}

{
  const rules = getGameplayModeRules('battle_royal');
  const mapSizeBandWidth = Math.max(1, Math.floor((rules.maxPlayers - rules.minPlayers + 1) / 3));
  const smallMaxPlayers = rules.minPlayers + mapSizeBandWidth - 1;
  const mediumMinPlayers = smallMaxPlayers + 1;
  const largeMinPlayers = rules.maxPlayers - mapSizeBandWidth + 1;
  const mediumMaxPlayers = largeMinPlayers - 1;

  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: rules.minPlayers, rules }), 'small');
  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: smallMaxPlayers, rules }), 'small');
  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: mediumMinPlayers, rules }), 'medium');
  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: mediumMaxPlayers, rules }), 'medium');
  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: largeMinPlayers, rules }), 'large');
  assert.equal(getBattleRoyalMapSizeForParticipantCount({ participantCount: rules.maxPlayers, rules }), 'large');

  assert.equal(createMapLaunchSelection({
    gameplayMode: 'battle_royal',
    source: 0x51f15eed,
    participantCount: smallMaxPlayers,
  }).mapSize, 'small');
  assert.equal(createMapLaunchSelection({
    gameplayMode: 'battle_royal',
    source: 0x51f15eed,
    participantCount: Math.ceil((rules.minPlayers + rules.maxPlayers) / 2),
  }).mapSize, 'medium');
  assert.equal(createMapLaunchSelection({
    gameplayMode: 'battle_royal',
    source: 0x51f15eed,
    participantCount: largeMinPlayers,
  }).mapSize, 'large');
}

{
  const votes = new Map<string, string>([
    ['player-a', 'map_2'],
    ['player-b', 'map_1'],
  ]);

  assert.deepEqual(getMapVoteRecords(votes), [
    { playerId: 'player-a', optionId: 'map_2' },
    { playerId: 'player-b', optionId: 'map_1' },
  ]);
}

{
  assert.equal(haveAllHumanPlayersVoted({
    players: [
      { id: 'player-a' },
      { id: 'player-b' },
      { id: 'bot-a', isBot: true },
    ],
    votes: new Map<string, string>([
      ['player-a', 'map_1'],
      ['player-b', 'map_2'],
      ['bot-a', 'map_2'],
    ]),
  }), true);
}

{
  assert.equal(haveAllHumanPlayersVoted({
    players: [
      { id: 'player-a' },
      { id: 'player-b' },
      { id: 'bot-a', isBot: true },
    ],
    votes: new Map<string, string>([
      ['player-a', 'map_1'],
      ['bot-a', 'map_2'],
    ]),
  }), false);
}

{
  assert.equal(haveAllHumanPlayersVoted({
    players: [
      { id: 'bot-a', isBot: true },
      { id: 'bot-b', isBot: true },
    ],
    votes: new Map<string, string>([
      ['bot-a', 'map_1'],
      ['bot-b', 'map_2'],
    ]),
  }), false);
}

{
  const options = [option('map_1'), option('map_2'), option('map_3')];
  const votes = new Map<string, string>([
    ['human-a', 'map_1'],
    ['bot-a', 'map_2'],
  ]);
  const added = addMissingBotMapVotes({
    players: [
      { id: 'human-a' },
      { id: 'human-b' },
      { id: 'bot-a', isBot: true },
      { id: 'bot-b', isBot: true },
    ],
    options,
    votes,
    pickOptionIndex: () => 2,
  });

  assert.equal(added, 1);
  assert.equal(votes.get('bot-a'), 'map_2');
  assert.equal(votes.get('bot-b'), 'map_3');
  assert.equal(votes.has('human-b'), false);
}

{
  const added = addMissingBotMapVotes({
    players: [{ id: 'bot-a', isBot: true }],
    options: [],
    votes: new Map<string, string>(),
  });

  assert.equal(added, 0);
}

{
  const options = [option('map_1'), option('map_2'), option('map_3')];
  const votes = new Map<string, string>([
    ['host', 'map_2'],
    ['player-a', 'map_1'],
  ]);

  assert.equal(getWinningMapOption({ options, votes, hostId: 'host' }).id, 'map_2');
}

{
  const options = [option('map_1'), option('map_2'), option('map_3')];
  const votes = new Map<string, string>([
    ['host', 'map_2'],
    ['player-a', 'map_3'],
    ['player-b', 'map_3'],
  ]);

  assert.equal(getWinningMapOption({ options, votes, hostId: 'host' }).id, 'map_3');
}

{
  assert.throws(
    () => getWinningMapOption({ options: [], votes: [], hostId: 'host' }),
    /Cannot choose map without map options/
  );
}

{
  const preview = createProceduralMapPreview(0x701, 'medium', {
    profileId: 'tdm_arena',
    themeId: 'verdant',
  });
  const catalogMap: PregeneratedMapCatalogSummary = {
    id: 'pgmap_vote_runtime',
    artifactId: 'pgartifact_vote_runtime',
    seed: 0x701,
    themeId: 'verdant',
    profileId: 'tdm_arena',
    gameplayMode: 'ctf',
    familyId: 'ctf_semantic_arena',
    mapSize: 'medium',
    topologyId: preview.topologyId,
    displayName: 'Verdant Relay',
    previewTags: ['verdant', 'medium', preview.topologyId],
    preview: preview.preview,
    stats: {
      solidBlockCount: 100,
      renderableChunkCount: 8,
      colliderCount: 12,
      estimatedTriangles: 400,
    },
    diagnosticsScore: 91,
    diagnosticsWarnings: [],
    status: 'ready',
    visibility: 'public',
    generatorVersion: 13,
    lastSelectedAt: null,
    selectionCount: 0,
    failureCount: 0,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
  const catalogOption = createMapVoteOptionFromCatalog(catalogMap, 1);
  assert.equal(catalogOption.id, 'map_2');
  assert.equal(catalogOption.name, catalogMap.displayName);
  assert.equal(catalogOption.pregeneratedMapId, catalogMap.id);
  assert.equal(catalogOption.mapArtifactId, catalogMap.artifactId);
  assert.deepEqual(catalogOption.catalogTags, catalogMap.previewTags);
  assert.equal(catalogOption.stats, catalogMap.stats);
  assert.equal(catalogOption.generatorVersion, catalogMap.generatorVersion);
}

{
  const options = [option('map_1'), option('map_2')];
  const votes = new Map<string, string>([['player-a', 'map_2']]);
  const started = buildMapVoteStartedPayload({
    options,
    votes,
    phaseEndTime: 12345,
    gameplayMode: 'battle_royal',
  });
  const updated = buildMapVoteUpdatedPayload(votes);

  assert.deepEqual(started, {
    options,
    votes: [{ playerId: 'player-a', optionId: 'map_2' }],
    phaseEndTime: 12345,
    gameplayMode: 'battle_royal',
  });
  assert.deepEqual(updated, {
    votes: [{ playerId: 'player-a', optionId: 'map_2' }],
  });
}

console.log('lobby map vote runtime tests passed');
