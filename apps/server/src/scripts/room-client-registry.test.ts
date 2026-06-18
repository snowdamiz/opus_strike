import assert from 'node:assert/strict';
import { RoomClientRegistry } from '../rooms/roomClientRegistry';

{
  const registry = new RoomClientRegistry<string>();

  registry.setClient('session-a', 'client-a');
  assert.equal(registry.getClient('session-a'), 'client-a');
  assert.equal(registry.getConnectedClientIds().has('session-a'), true);
  assert.equal(registry.deleteClient('session-a'), true);
  assert.equal(registry.getClient('session-a'), undefined);
}

{
  const registry = new RoomClientRegistry<string>();

  registry.setIdentity('user-a', 'session-a');
  assert.equal(registry.getSessionIdForIdentity('user-a'), 'session-a');

  registry.setIdentity('user-a', 'session-b');
  assert.equal(registry.clearIdentityForSession('session-a'), 'user-a');
  assert.equal(registry.getSessionIdForIdentity('user-a'), 'session-b');

  assert.equal(registry.clearIdentityForSession('session-b'), 'user-a');
  assert.equal(registry.getSessionIdForIdentity('user-a'), undefined);
}

{
  const registry = new RoomClientRegistry<string>();

  registry.setClient('session-a', 'client-a');
  registry.setIdentity('user-a', 'session-a');
  registry.clearSession('session-a');

  assert.equal(registry.getClient('session-a'), undefined);
  assert.equal(registry.getSessionIdForIdentity('user-a'), undefined);
}

console.log('room client registry tests passed');
