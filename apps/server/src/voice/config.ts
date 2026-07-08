import { envFlag, isProductionEnvironment } from '../config/security';

export interface VoiceConfig {
  requested: boolean;
  enabled: boolean;
  disabledReason: string | null;
  livekitUrl: string | null;
  livekitWsUrl: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  environmentName: string;
  tokenTtlSeconds: number;
  maxParticipantsPerRoom: number;
}

const DEFAULT_TOKEN_TTL_SECONDS = 600;
const MIN_TOKEN_TTL_SECONDS = 60;
const MAX_TOKEN_TTL_SECONDS = 3600;

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function sanitizeEnvironmentName(value: string | null): string {
  const source = value || (isProductionEnvironment() ? 'production' : 'development');
  const sanitized = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'development';
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function resolveVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const requested = envFlag('VOICE_ENABLED', false);
  const livekitUrl = readString(env, 'LIVEKIT_URL');
  const livekitWsUrl = readString(env, 'LIVEKIT_WS_URL');
  const apiKey = readString(env, 'LIVEKIT_API_KEY');
  const apiSecret = readString(env, 'LIVEKIT_API_SECRET');
  const missing = [
    ['LIVEKIT_URL', livekitUrl],
    ['LIVEKIT_WS_URL', livekitWsUrl],
    ['LIVEKIT_API_KEY', apiKey],
    ['LIVEKIT_API_SECRET', apiSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    requested,
    enabled: requested && missing.length === 0,
    disabledReason: requested
      ? missing.length > 0
        ? `missing ${missing.join(', ')}`
        : null
      : 'VOICE_ENABLED is false',
    livekitUrl,
    livekitWsUrl,
    apiKey,
    apiSecret,
    environmentName: sanitizeEnvironmentName(readString(env, 'VOICE_ENV') || readString(env, 'NODE_ENV')),
    tokenTtlSeconds: readPositiveInt(
      env,
      'VOICE_TOKEN_TTL_SECONDS',
      DEFAULT_TOKEN_TTL_SECONDS,
      MIN_TOKEN_TTL_SECONDS,
      MAX_TOKEN_TTL_SECONDS
    ),
    maxParticipantsPerRoom: readPositiveInt(env, 'VOICE_MAX_PARTICIPANTS_PER_ROOM', 32, 1, 64),
  };
}
