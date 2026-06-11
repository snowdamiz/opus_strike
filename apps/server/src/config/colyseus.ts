import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import type { ServerOptions } from 'colyseus';

export interface ColyseusRuntimeConfig {
  distributed: boolean;
  redisUrl: string | null;
  publicAddress: string | undefined;
  requirePublicAddress: boolean;
  routingStrategy: ColyseusRoutingStrategy;
  flyReplay: FlyReplayRuntimeConfig;
  nodeEnv: string;
}

export type ColyseusRoutingStrategy = 'direct' | 'fly_replay';

export interface FlyReplayRuntimeConfig {
  enabled: boolean;
  appName: string | undefined;
  machineId: string | undefined;
  region: string | undefined;
  processRegistryTtlMs: number;
  processRegistryHeartbeatMs: number;
  replayTimeout: string;
  replayFallback: 'force_self' | 'prefer_self';
}

function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function positiveIntegerEnv(value: string | undefined, fallback: number): number {
  const trimmed = optionalEnv(value);
  if (!trimmed) return fallback;

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRoutingStrategy(env: NodeJS.ProcessEnv): ColyseusRoutingStrategy {
  if (envFlag(env.COLYSEUS_FLY_REPLAY)) return 'fly_replay';

  const value = optionalEnv(env.COLYSEUS_ROUTING_STRATEGY);
  if (!value) return 'direct';

  if (value === 'direct' || value === 'fly_replay') return value;
  throw new Error(`Unsupported COLYSEUS_ROUTING_STRATEGY "${value}"`);
}

function parseFlyReplayFallback(value: string | undefined): 'force_self' | 'prefer_self' {
  const fallback = optionalEnv(value);
  if (!fallback) return 'force_self';

  if (fallback === 'force_self' || fallback === 'prefer_self') return fallback;
  throw new Error(`Unsupported COLYSEUS_FLY_REPLAY_FALLBACK "${fallback}"`);
}

export function getColyseusRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ColyseusRuntimeConfig {
  const distributed = envFlag(env.COLYSEUS_DISTRIBUTED);
  const redisUrl = optionalEnv(env.COLYSEUS_REDIS_URL) ?? optionalEnv(env.REDIS_URL) ?? null;
  const routingStrategy = parseRoutingStrategy(env);
  const flyAppName = optionalEnv(env.COLYSEUS_FLY_APP_NAME) ?? optionalEnv(env.FLY_APP_NAME);
  const flyReplayEnabled = routingStrategy === 'fly_replay';
  const publicAddress = optionalEnv(env.COLYSEUS_PUBLIC_ADDRESS)
    ?? (flyReplayEnabled && flyAppName ? `${flyAppName}.fly.dev` : undefined);

  const processRegistryTtlMs = positiveIntegerEnv(env.COLYSEUS_FLY_PROCESS_REGISTRY_TTL_MS, 30_000);
  const processRegistryHeartbeatMs = Math.min(
    positiveIntegerEnv(env.COLYSEUS_FLY_PROCESS_REGISTRY_HEARTBEAT_MS, 10_000),
    Math.max(1_000, Math.floor(processRegistryTtlMs / 2))
  );

  return {
    distributed,
    redisUrl,
    publicAddress,
    requirePublicAddress: envFlag(env.COLYSEUS_REQUIRE_PUBLIC_ADDRESS),
    routingStrategy,
    flyReplay: {
      enabled: flyReplayEnabled,
      appName: flyAppName,
      machineId: optionalEnv(env.COLYSEUS_FLY_MACHINE_ID) ?? optionalEnv(env.FLY_MACHINE_ID),
      region: optionalEnv(env.COLYSEUS_FLY_REGION) ?? optionalEnv(env.FLY_REGION),
      processRegistryTtlMs,
      processRegistryHeartbeatMs,
      replayTimeout: optionalEnv(env.COLYSEUS_FLY_REPLAY_TIMEOUT) ?? '5s',
      replayFallback: parseFlyReplayFallback(env.COLYSEUS_FLY_REPLAY_FALLBACK),
    },
    nodeEnv: env.NODE_ENV || 'development',
  };
}

export function validateColyseusRuntimeConfig(config: ColyseusRuntimeConfig): void {
  if (config.flyReplay.enabled && !config.distributed) {
    throw new Error('COLYSEUS_ROUTING_STRATEGY=fly_replay requires COLYSEUS_DISTRIBUTED=1');
  }

  if (!config.distributed) return;

  if (!config.redisUrl) {
    throw new Error('COLYSEUS_DISTRIBUTED=1 requires COLYSEUS_REDIS_URL or REDIS_URL');
  }

  if (config.requirePublicAddress && !config.publicAddress) {
    throw new Error('COLYSEUS_REQUIRE_PUBLIC_ADDRESS=1 requires COLYSEUS_PUBLIC_ADDRESS');
  }

  if (!config.flyReplay.enabled) return;

  if (!config.flyReplay.appName) {
    throw new Error('COLYSEUS_ROUTING_STRATEGY=fly_replay requires FLY_APP_NAME or COLYSEUS_FLY_APP_NAME');
  }

  if (!config.flyReplay.machineId) {
    throw new Error('COLYSEUS_ROUTING_STRATEGY=fly_replay requires FLY_MACHINE_ID or COLYSEUS_FLY_MACHINE_ID');
  }

  if (!config.publicAddress) {
    throw new Error('COLYSEUS_ROUTING_STRATEGY=fly_replay requires COLYSEUS_PUBLIC_ADDRESS or FLY_APP_NAME');
  }
}

export function createDistributedColyseusOptions(config: ColyseusRuntimeConfig): Pick<ServerOptions, 'presence' | 'driver' | 'publicAddress'> {
  validateColyseusRuntimeConfig(config);
  if (!config.distributed) return {};

  return {
    presence: new RedisPresence(config.redisUrl!),
    driver: new RedisDriver(config.redisUrl!),
    publicAddress: config.publicAddress,
  };
}
