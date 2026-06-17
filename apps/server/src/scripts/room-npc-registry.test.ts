import assert from 'node:assert/strict';
import { RoomNpcRegistry } from '../rooms/roomNpcRegistry';

{
  const registry = new RoomNpcRegistry();

  assert.deepEqual(registry.createIdentity('Phantom'), { id: 'npc_0', name: 'Phantom_1' });
  assert.deepEqual(registry.createIdentity('Blaze', 'Training Dummy'), { id: 'npc_1', name: 'Training Dummy' });
  assert.equal(registry.size, 0);
}

{
  const registry = new RoomNpcRegistry();

  registry.add('npc_0');
  registry.add('npc_alpha');
  assert.equal(registry.size, 2);
  assert.equal(registry.has('npc_0'), true);
  assert.equal(registry.resolveId('npc_0'), 'npc_0');
  assert.equal(registry.resolveId('alpha'), 'npc_alpha');
  assert.equal(registry.resolveId('missing'), null);
  assert.deepEqual(registry.snapshotIds(), ['npc_0', 'npc_alpha']);

  const ids = registry.ids;
  assert.equal(ids.has('npc_alpha'), true);

  assert.equal(registry.delete('npc_0'), true);
  assert.equal(registry.delete('npc_0'), false);
  assert.equal(registry.has('npc_0'), false);
  assert.deepEqual(registry.snapshotIds(), ['npc_alpha']);
}

{
  const registry = new RoomNpcRegistry();

  registry.add('first');
  const snapshot = registry.snapshotIds();
  registry.add('second');

  assert.deepEqual(snapshot, ['first']);
  assert.deepEqual(registry.snapshotIds(), ['first', 'second']);
}

console.log('room npc registry tests passed');
