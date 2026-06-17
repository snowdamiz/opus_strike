import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { RoomTimeoutRegistry } from '../rooms/roomTimeouts';

async function main(): Promise<void> {
  const registry = new RoomTimeoutRegistry();
  let firedCount = 0;

  registry.schedule(() => {
    firedCount++;
  }, 5);

  assert.equal(registry.size, 1);
  await delay(25);
  assert.equal(firedCount, 1);
  assert.equal(registry.size, 0);

  registry.schedule(() => {
    firedCount++;
  }, 25);

  assert.equal(registry.size, 1);
  registry.clear();
  assert.equal(registry.size, 0);
  await delay(40);
  assert.equal(firedCount, 1);

  registry.schedule(() => {
    firedCount++;
  }, 5);
  registry.schedule(() => {
    firedCount++;
  }, 10);

  assert.equal(registry.size, 2);
  registry.clear();
  await delay(25);
  assert.equal(firedCount, 1);
  assert.equal(registry.size, 0);

  console.log('room timeout registry tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
