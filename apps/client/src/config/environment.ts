// Environment configuration for server endpoints

const env = import.meta.env ?? {};

function envBoolValue(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

const isDev = envBoolValue(env.DEV, false);
const isProd = envBoolValue(env.PROD, false);
const clientDiagnosticsEnabled = isDev && envBool('VITE_CLIENT_DIAGNOSTICS', true);

// Server URL configuration
const DEV_SERVER_URL = 'ws://localhost:2567';
const PROD_SERVER_URL = env.VITE_SERVER_URL || 'wss://voxel-strike.example.com';
const serverUrl = isDev ? DEV_SERVER_URL : PROD_SERVER_URL;

function envNumber(name: string, fallback: number, options: { min?: number; max?: number } = {}): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(options.min ?? parsed, Math.min(options.max ?? parsed, parsed));
}

function envBool(name: string, fallback: boolean): boolean {
  return envBoolValue(env[name], fallback);
}

function toHttpUrl(url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://');
}

export const config = {
  serverUrl,
  serverHttpUrl: toHttpUrl(serverUrl),
  discordAuthEnabled: env.VITE_DISCORD_AUTH_ENABLED !== 'false',
  clientDiagnosticsEnabled,
  antiCheatMovementTraceRecorderEnabled: clientDiagnosticsEnabled && envBool('VITE_ANTICHEAT_MOVEMENT_TRACE_RECORDER', true),
  antiCheatMovementTraceSampleRate: clientDiagnosticsEnabled
    ? envNumber('VITE_ANTICHEAT_MOVEMENT_TRACE_SAMPLE_RATE', 1, { min: 0, max: 1 })
    : 0,
  antiCheatMovementTraceMaxFrames: clientDiagnosticsEnabled
    ? envNumber('VITE_ANTICHEAT_MOVEMENT_TRACE_MAX_FRAMES', 1800, { min: 60, max: 5000 })
    : 0,
  buildId: env.VITE_BUILD_ID || 'dev',
  isDev,
  isProd,
} as const;

export type Config = typeof config;
