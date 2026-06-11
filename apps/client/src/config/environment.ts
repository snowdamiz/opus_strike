// Environment configuration for server endpoints

const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;

// Server URL configuration
const DEV_SERVER_URL = 'ws://localhost:2567';
const PROD_SERVER_URL = import.meta.env.VITE_SERVER_URL || 'wss://voxel-strike.example.com';
const serverUrl = isDev ? DEV_SERVER_URL : PROD_SERVER_URL;

function envNumber(name: string, fallback: number, options: { min?: number; max?: number } = {}): number {
  const raw = import.meta.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min ?? parsed, Math.min(options.max ?? parsed, parsed));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = import.meta.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function toHttpUrl(url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://');
}

export const config = {
  serverUrl,
  serverHttpUrl: toHttpUrl(serverUrl),
  discordAuthEnabled: import.meta.env.VITE_DISCORD_AUTH_ENABLED !== 'false',
  antiCheatMovementTraceRecorderEnabled: envBool('VITE_ANTICHEAT_MOVEMENT_TRACE_RECORDER', isDev),
  antiCheatMovementTraceSampleRate: envNumber('VITE_ANTICHEAT_MOVEMENT_TRACE_SAMPLE_RATE', isDev ? 1 : 0, { min: 0, max: 1 }),
  antiCheatMovementTraceMaxFrames: envNumber('VITE_ANTICHEAT_MOVEMENT_TRACE_MAX_FRAMES', 1800, { min: 60, max: 5000 }),
  buildId: import.meta.env.VITE_BUILD_ID || 'dev',
  isDev,
  isProd,
} as const;

export type Config = typeof config;
