import assert from 'node:assert/strict';
import { getRoomMapGenerationWorkerSpec } from '../rooms/roomMapGeneration';

{
  const worker = getRoomMapGenerationWorkerSpec({
    mapSeed: 1,
    mapProfileId: 'battle_royal_large',
    mapSize: 'large',
  }, {
    NODE_ENV: 'development',
  });

  assert.ok(worker, 'battle royal maps should use a worker in development');
  assert.equal(worker.source, 'tsx');
  assert.ok(worker.filename.endsWith('roomMapGenerationWorker.ts'));
  assert.deepEqual(worker.execArgv, ['--import', 'tsx']);
}

{
  const worker = getRoomMapGenerationWorkerSpec({
    mapSeed: 1,
    mapProfileId: 'ctf_arena',
    mapSize: 'medium',
  }, {
    NODE_ENV: 'development',
  });

  assert.equal(worker, null);
}

{
  const worker = getRoomMapGenerationWorkerSpec({
    mapSeed: 1,
    mapProfileId: 'battle_royal_large',
    mapSize: 'large',
  }, {
    NODE_ENV: 'development',
    SERVER_MAP_GENERATION_WORKER: '0',
  });

  assert.equal(worker, null);
}

console.log('room map generation worker tests passed');
