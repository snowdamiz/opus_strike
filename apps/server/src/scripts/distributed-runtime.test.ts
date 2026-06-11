import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { getColyseusRuntimeConfig, validateColyseusRuntimeConfig } from '../config/colyseus';
import {
  buildFlyReplayHeader,
  handleFlyReplayUpgradeRequest,
  lookupFlyReplayProcessRoute,
  parseColyseusProcessIdFromUrl,
  registerFlyReplayProcessRoute,
  type FlyReplayRedisClient,
} from '../runtime/flyReplayRouting';
import { WagerEventBus } from '../wagers/eventBus';
import { runWithRedisOwnerLock, type RedisOwnerLockClient } from '../wagers/workerLock';
import type { WagerPaymentStatusChanged } from '../wagers/service';

function paymentEvent(lobbyId = 'lobby-test'): WagerPaymentStatusChanged {
  return {
    lobbyId,
    userId: 'user-test',
    lobbyPlayerId: 'player-test',
    status: 'credited',
    amountLamports: '1000',
    walletAddress: 'wallet-test',
    depositSignature: 'deposit-test',
    refundSignature: null,
    refundReason: null,
    refundGrossLamports: null,
    refundOutboundFeeLamports: null,
    refundNetLamports: null,
    refundFeeSource: null,
    potLamports: '1000',
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakePresence {
  readonly subscriptions = new Map<string, Set<(payload: unknown) => void>>();
  readonly published: Array<{ topic: string; data: unknown }> = [];

  async subscribe(topic: string, callback: (payload: unknown) => void): Promise<this> {
    const callbacks = this.subscriptions.get(topic) ?? new Set();
    callbacks.add(callback);
    this.subscriptions.set(topic, callbacks);
    return this;
  }

  async unsubscribe(topic: string, callback?: (payload: unknown) => void): Promise<this> {
    if (!callback) {
      this.subscriptions.delete(topic);
      return this;
    }

    this.subscriptions.get(topic)?.delete(callback);
    return this;
  }

  async publish(topic: string, data: unknown): Promise<void> {
    this.published.push({ topic, data });
    for (const callback of this.subscriptions.get(topic) ?? []) {
      callback(data);
    }
  }
}

class FakeRedisLockClient implements RedisOwnerLockClient {
  private readonly locks = new Map<string, { ownerToken: string; expiresAt: number }>();
  extensions = 0;

  async set(
    key: string,
    value: string,
    _ttlMode: 'PX',
    ttlMs: number,
    _condition: 'NX'
  ): Promise<'OK' | null> {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) return null;

    this.locks.set(key, { ownerToken: value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    ownerToken: string,
    ttlMs?: number
  ): Promise<unknown> {
    const existing = this.locks.get(key);
    if (!existing || existing.ownerToken !== ownerToken || existing.expiresAt <= Date.now()) {
      return 0;
    }

    if (ttlMs === undefined) {
      this.locks.delete(key);
      return 1;
    }

    existing.expiresAt = Date.now() + ttlMs;
    this.extensions++;
    return 1;
  }
}

class FakeFlyReplayRedisClient implements FlyReplayRedisClient {
  readonly hashes = new Map<string, Record<string, string>>();

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.hashes.get(key) ?? {};
  }

  async eval(
    script: string,
    _numKeys: number,
    ...allArgs: Array<string | number>
  ): Promise<unknown> {
    const [key, ...args] = allArgs.map(String);
    if (!key) throw new Error('expected redis key');

    if (script.includes('HSET')) {
      const [
        processId,
        machineId,
        appName,
        region,
        publicAddress,
        pid,
        ownerToken,
        updatedAtMs,
      ] = args;

      this.hashes.set(key, {
        processId,
        machineId,
        appName,
        region,
        publicAddress,
        pid,
        ownerToken,
        updatedAtMs,
      });
      return 1;
    }

    if (script.includes('HGET')) {
      const ownerToken = String(args[0]);
      const route = this.hashes.get(key);
      if (route?.ownerToken === ownerToken) {
        this.hashes.delete(key);
        return 1;
      }
      return 0;
    }

    return 0;
  }
}

function captureSocket(): PassThrough & { text(): string } {
  const socket = new PassThrough() as PassThrough & { text(): string };
  const chunks: Buffer[] = [];
  socket.on('data', (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  socket.text = () => Buffer.concat(chunks).toString('utf8');
  return socket;
}

function upgradeRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

function runConfigTests(): void {
  const local = getColyseusRuntimeConfig({});
  assert.equal(local.distributed, false);
  assert.equal(local.redisUrl, null);
  assert.equal(local.routingStrategy, 'direct');

  const distributed = getColyseusRuntimeConfig({
    COLYSEUS_DISTRIBUTED: '1',
    REDIS_URL: 'redis://redis.example:6379',
    COLYSEUS_PUBLIC_ADDRESS: 'server-a.example',
    COLYSEUS_REQUIRE_PUBLIC_ADDRESS: 'true',
    NODE_ENV: 'production',
  });
  assert.equal(distributed.distributed, true);
  assert.equal(distributed.redisUrl, 'redis://redis.example:6379');
  assert.equal(distributed.publicAddress, 'server-a.example');
  assert.equal(distributed.routingStrategy, 'direct');
  assert.doesNotThrow(() => validateColyseusRuntimeConfig(distributed));

  const flyReplay = getColyseusRuntimeConfig({
    COLYSEUS_DISTRIBUTED: '1',
    COLYSEUS_REDIS_URL: 'redis://fly-managed-redis.internal:6379',
    COLYSEUS_ROUTING_STRATEGY: 'fly_replay',
    FLY_APP_NAME: 'opus-strike-server',
    FLY_MACHINE_ID: 'machine-local',
    FLY_REGION: 'iad',
  });
  assert.equal(flyReplay.routingStrategy, 'fly_replay');
  assert.equal(flyReplay.flyReplay.enabled, true);
  assert.equal(flyReplay.flyReplay.appName, 'opus-strike-server');
  assert.equal(flyReplay.flyReplay.machineId, 'machine-local');
  assert.equal(flyReplay.publicAddress, 'opus-strike-server.fly.dev');
  assert.doesNotThrow(() => validateColyseusRuntimeConfig(flyReplay));

  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({ COLYSEUS_DISTRIBUTED: '1' })),
    /requires COLYSEUS_REDIS_URL/
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'redis://...',
    })),
    /real Redis host/
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'http://localhost:6379',
    })),
    /redis:\/\/ or rediss:\/\//
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'redis://localhost:6379',
      COLYSEUS_REQUIRE_PUBLIC_ADDRESS: '1',
    })),
    /requires COLYSEUS_PUBLIC_ADDRESS/
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'redis://localhost:6379',
      COLYSEUS_REQUIRE_PUBLIC_ADDRESS: '1',
      COLYSEUS_PUBLIC_ADDRESS: 'host:port',
    })),
    /real host\[:port\]/
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_ROUTING_STRATEGY: 'fly_replay',
      COLYSEUS_REDIS_URL: 'redis://localhost:6379',
      FLY_APP_NAME: 'opus-strike-server',
      FLY_MACHINE_ID: 'machine-local',
    })),
    /requires COLYSEUS_DISTRIBUTED=1/
  );
  assert.throws(
    () => validateColyseusRuntimeConfig(getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'redis://localhost:6379',
      COLYSEUS_ROUTING_STRATEGY: 'fly_replay',
      FLY_APP_NAME: 'opus-strike-server',
    })),
    /requires FLY_MACHINE_ID/
  );
}

async function runEventBusTests(): Promise<void> {
  const localBus = new WagerEventBus(() => getColyseusRuntimeConfig({}));
  const localReceived: WagerPaymentStatusChanged[] = [];
  const unsubscribeLocal = await localBus.subscribeToLobby('lobby-local', (payload) => {
    localReceived.push(payload);
  });
  await localBus.publishPaymentStatusChanged(paymentEvent('lobby-local'));
  assert.equal(localReceived.length, 1);
  await unsubscribeLocal();
  await localBus.publishPaymentStatusChanged(paymentEvent('lobby-local'));
  assert.equal(localReceived.length, 1);

  const fakePresence = new FakePresence();
  const distributedBus = new WagerEventBus(
    () => getColyseusRuntimeConfig({
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: 'redis://localhost:6379',
    }),
    () => fakePresence as any
  );
  const distributedReceived: WagerPaymentStatusChanged[] = [];
  const unsubscribeDistributed = await distributedBus.subscribeToLobby('lobby-distributed', (payload) => {
    distributedReceived.push(payload);
  });
  await distributedBus.publishPaymentStatusChanged(paymentEvent('lobby-distributed'));
  assert.equal(fakePresence.published[0]?.topic, 'wager:lobby:lobby-distributed');
  assert.equal(distributedReceived.length, 1);
  await unsubscribeDistributed();
  await distributedBus.publishPaymentStatusChanged(paymentEvent('lobby-distributed'));
  assert.equal(distributedReceived.length, 1);
}

async function runWorkerLockTests(): Promise<void> {
  const redis = new FakeRedisLockClient();
  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  let completedWorkers = 0;

  const first = runWithRedisOwnerLock(redis, { key: 'lock:test', ttlMs: 3_000, heartbeatMs: 1_000 }, async () => {
    activeWorkers++;
    maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
    await delay(50);
    activeWorkers--;
    completedWorkers++;
  });
  const second = runWithRedisOwnerLock(redis, { key: 'lock:test', ttlMs: 3_000, heartbeatMs: 1_000 }, async () => {
    activeWorkers++;
    maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
    activeWorkers--;
    completedWorkers++;
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.acquired, true);
  assert.equal(secondResult.acquired, false);
  assert.equal(maxActiveWorkers, 1);
  assert.equal(completedWorkers, 1);

  const thirdResult = await runWithRedisOwnerLock(redis, { key: 'lock:test', ttlMs: 3_000, heartbeatMs: 1_000 }, async () => {
    completedWorkers++;
  });
  assert.equal(thirdResult.acquired, true);
  assert.equal(completedWorkers, 2);

  await runWithRedisOwnerLock(redis, { key: 'lock:heartbeat', ttlMs: 3_000, heartbeatMs: 1_000 }, async () => {
    await delay(1_200);
  });
  assert.ok(redis.extensions > 0, 'expected the lock heartbeat to extend the lease');
}

async function runFlyReplayRoutingTests(): Promise<void> {
  assert.equal(parseColyseusProcessIdFromUrl('/process_1/room-1?sessionId=s1'), 'process_1');
  assert.equal(parseColyseusProcessIdFromUrl('/health'), null);
  assert.equal(parseColyseusProcessIdFromUrl('/matchmake/joinOrCreate/lobby_room'), null);

  const redis = new FakeFlyReplayRedisClient();
  const localConfig = getColyseusRuntimeConfig({
    COLYSEUS_DISTRIBUTED: '1',
    COLYSEUS_REDIS_URL: 'redis://fly-managed-redis.internal:6379',
    COLYSEUS_ROUTING_STRATEGY: 'fly_replay',
    COLYSEUS_PUBLIC_ADDRESS: 'opus-strike-server.fly.dev',
    FLY_APP_NAME: 'opus-strike-server',
    FLY_MACHINE_ID: 'machine-local',
    FLY_REGION: 'iad',
  });
  const remoteConfig = getColyseusRuntimeConfig({
    COLYSEUS_DISTRIBUTED: '1',
    COLYSEUS_REDIS_URL: 'redis://fly-managed-redis.internal:6379',
    COLYSEUS_ROUTING_STRATEGY: 'fly_replay',
    COLYSEUS_PUBLIC_ADDRESS: 'opus-strike-server.fly.dev',
    FLY_APP_NAME: 'opus-strike-server',
    FLY_MACHINE_ID: 'machine-remote',
    FLY_REGION: 'iad',
  });

  const remoteHandle = await registerFlyReplayProcessRoute(redis, remoteConfig, 'remote-process');
  const route = await lookupFlyReplayProcessRoute(redis, 'remote-process');
  assert.equal(route?.machineId, 'machine-remote');
  assert.equal(route?.appName, 'opus-strike-server');

  let passThroughCount = 0;
  const localSocket = captureSocket();
  await handleFlyReplayUpgradeRequest({
    request: upgradeRequest('/local-process/room-1?sessionId=s1'),
    socket: localSocket,
    head: Buffer.alloc(0),
    config: localConfig,
    redis,
    getLocalProcessId: () => 'local-process',
    passThrough: () => {
      passThroughCount++;
    },
  });
  assert.equal(passThroughCount, 1);
  assert.equal(localSocket.text(), '');

  const remoteSocket = captureSocket();
  await handleFlyReplayUpgradeRequest({
    request: upgradeRequest('/remote-process/room-1?sessionId=s1'),
    socket: remoteSocket,
    head: Buffer.alloc(0),
    config: localConfig,
    redis,
    getLocalProcessId: () => 'local-process',
    passThrough: () => {
      passThroughCount++;
    },
  });
  assert.equal(passThroughCount, 1);
  assert.match(remoteSocket.text(), /HTTP\/1\.1 307 Temporary Redirect/);
  assert.match(remoteSocket.text(), new RegExp(`fly-replay: ${buildFlyReplayHeader('machine-remote', localConfig)}`));

  const missingSocket = captureSocket();
  await handleFlyReplayUpgradeRequest({
    request: upgradeRequest('/missing-process/room-1?sessionId=s1'),
    socket: missingSocket,
    head: Buffer.alloc(0),
    config: localConfig,
    redis,
    getLocalProcessId: () => 'local-process',
    passThrough: () => {
      passThroughCount++;
    },
  });
  assert.match(missingSocket.text(), /503 Service Unavailable/);
  assert.match(missingSocket.text(), /Room owner route is not registered/);

  const failedSocket = captureSocket();
  await handleFlyReplayUpgradeRequest({
    request: upgradeRequest('/remote-process/room-1?sessionId=s1', { 'fly-replay-failed': 'timeout' }),
    socket: failedSocket,
    head: Buffer.alloc(0),
    config: localConfig,
    redis,
    getLocalProcessId: () => 'local-process',
    passThrough: () => {
      passThroughCount++;
    },
  });
  assert.match(failedSocket.text(), /503 Service Unavailable/);
  assert.match(failedSocket.text(), /Fly replay failed/);

  const staleHandle = await registerFlyReplayProcessRoute(redis, localConfig, 'stale-process');
  const staleSocket = captureSocket();
  await handleFlyReplayUpgradeRequest({
    request: upgradeRequest('/stale-process/room-1?sessionId=s1'),
    socket: staleSocket,
    head: Buffer.alloc(0),
    config: localConfig,
    redis,
    getLocalProcessId: () => 'local-process',
    passThrough: () => {
      passThroughCount++;
    },
  });
  assert.match(staleSocket.text(), /410 Gone/);
  assert.match(staleSocket.text(), /Room owner route is stale/);

  await staleHandle.close();
  await remoteHandle.close();
  assert.equal(await lookupFlyReplayProcessRoute(redis, 'remote-process'), null);
}

async function main(): Promise<void> {
  runConfigTests();
  await runEventBusTests();
  await runWorkerLockTests();
  await runFlyReplayRoutingTests();
  console.log('distributed runtime tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
