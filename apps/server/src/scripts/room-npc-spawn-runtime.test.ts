import assert from 'node:assert/strict';
import {
  buildAllNpcsKilledPayload,
  buildNpcDamagedPayload,
  buildNpcErrorPayload,
  buildNpcJoinedPayload,
  buildNpcKilledPayload,
  buildNpcLeftPayload,
  buildNpcSpawnedPayload,
  resolveNpcDamageSourceContext,
  resolveNpcSpawnPosition,
  resolveNpcSpawnTeam,
} from '../rooms/roomNpcSpawnRuntime';

{
  assert.equal(resolveNpcSpawnTeam('red', 'blue'), 'red');
  assert.equal(resolveNpcSpawnTeam(undefined, 'red'), 'blue');
  assert.equal(resolveNpcSpawnTeam(undefined, 'blue'), 'red');
  assert.equal(resolveNpcSpawnTeam(undefined, 'spectating'), 'red');
  assert.equal(resolveNpcSpawnTeam(undefined, null), 'blue');
  assert.equal(resolveNpcSpawnTeam(undefined, undefined), 'blue');
}

{
  const requested = { x: 1, y: 2, z: 3 };
  const resolved = resolveNpcSpawnPosition({
    requestedPosition: requested,
    requester: {
      team: 'red',
      lookYaw: 1,
      position: { x: 100, y: 100, z: 100 },
    },
  });

  assert.deepEqual(resolved, requested);
  assert.notEqual(resolved, requested);
}

{
  assert.deepEqual(resolveNpcSpawnPosition({}), { x: 0, y: 5, z: 0 });
}

{
  const values = [0.5, 0.4];
  const resolved = resolveNpcSpawnPosition({
    requester: {
      team: 'red',
      lookYaw: 0,
      position: { x: 10, y: 7, z: -3 },
    },
    random: () => values.shift() ?? 0,
  });

  assert.deepEqual(resolved, {
    x: 10,
    y: 7,
    z: 4,
  });
}

{
  assert.deepEqual(
    resolveNpcDamageSourceContext({
      source: null,
      target: { position: { x: 5, y: 2, z: -3 } },
    }),
    {
      sourcePosition: null,
      sourceDirection: null,
    }
  );
}

{
  const source = { position: { x: 1, y: 2, z: 3 } };
  const resolved = resolveNpcDamageSourceContext({
    source,
    target: { position: { x: 4, y: 6, z: 3 } },
  });

  assert.deepEqual(resolved, {
    sourcePosition: { x: 1, y: 2, z: 3 },
    sourceDirection: { x: 0.6, y: 0.8, z: 0 },
  });
  assert.notEqual(resolved.sourcePosition, source.position);
}

{
  assert.deepEqual(
    resolveNpcDamageSourceContext({
      source: { position: { x: 1, y: 1, z: 1 } },
      target: { position: { x: 1, y: 1, z: 1 } },
    }),
    {
      sourcePosition: { x: 1, y: 1, z: 1 },
      sourceDirection: null,
    }
  );
}

{
  const position = { x: 1, y: 2, z: 3 };
  assert.deepEqual(
    buildNpcJoinedPayload({
      npcId: 'npc-1',
      npcName: 'Training Bot',
      team: 'red',
      heroId: 'blaze',
      position,
      includePosition: true,
    }),
    {
      playerId: 'npc-1',
      playerName: 'Training Bot',
      team: 'red',
      heroId: 'blaze',
      isNpc: true,
      position: { x: 1, y: 2, z: 3 },
    }
  );

  assert.deepEqual(
    buildNpcJoinedPayload({
      npcId: 'npc-1',
      npcName: 'Training Bot',
      team: 'red',
      heroId: 'blaze',
      position,
      includePosition: false,
    }),
    {
      playerId: 'npc-1',
      playerName: 'Training Bot',
      team: 'red',
      heroId: 'blaze',
      isNpc: true,
    }
  );
  assert.notEqual(
    buildNpcJoinedPayload({
      npcId: 'npc-1',
      npcName: 'Training Bot',
      team: 'red',
      heroId: 'blaze',
      position,
      includePosition: true,
    }).position,
    position
  );
}

{
  const position = { x: 5, y: 6, z: 7 };
  const payload = buildNpcSpawnedPayload({
    npcId: 'npc-2',
    npcName: 'Practice Target',
    team: 'blue',
    heroId: 'phantom',
    position,
  });

  assert.deepEqual(payload, {
    npcId: 'npc-2',
    name: 'Practice Target',
    heroId: 'phantom',
    team: 'blue',
    position: { x: 5, y: 6, z: 7 },
  });
  assert.notEqual(payload.position, position);
}

{
  assert.deepEqual(buildNpcErrorPayload('NPC not found: npc-1'), {
    message: 'NPC not found: npc-1',
  });

  assert.deepEqual(
    buildNpcDamagedPayload({
      npcId: 'npc-1',
      npcName: 'Training Bot',
      damage: 25,
      health: 75,
      maxHealth: 100,
      killed: false,
    }),
    {
      npcId: 'npc-1',
      name: 'Training Bot',
      damage: 25,
      health: 75,
      maxHealth: 100,
      killed: false,
    }
  );

  assert.deepEqual(
    buildNpcKilledPayload({
      npcId: 'npc-1',
      npcName: 'Training Bot',
    }),
    {
      npcId: 'npc-1',
      name: 'Training Bot',
    }
  );

  assert.deepEqual(buildAllNpcsKilledPayload(3), { count: 3 });
  assert.deepEqual(buildNpcLeftPayload('npc-1'), {
    playerId: 'npc-1',
    isNpc: true,
  });
}

console.log('room npc spawn runtime tests passed');
