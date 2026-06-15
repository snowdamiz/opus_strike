const LOCAL_CLIENT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
] as const;

const PRODUCTION_CLIENT_ORIGINS = [
  'https://slopheroes.xyz',
  'https://www.slopheroes.xyz',
  'https://opus-strike-client.fly.dev',
] as const;

const ENV_ORIGIN_KEYS = [
  'CLIENT_ORIGIN',
  'CLIENT_URL',
  'PUBLIC_CLIENT_ORIGIN',
  'ALLOWED_ORIGINS',
] as const;

function isProductionEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

export function normalizeClientOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function readClientOriginList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => normalizeClientOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));
}

export function getAllowedClientOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredOrigins = ENV_ORIGIN_KEYS.flatMap((key) => readClientOriginList(env[key]));
  const defaultOrigins = isProductionEnvironment(env)
    ? PRODUCTION_CLIENT_ORIGINS
    : [...LOCAL_CLIENT_ORIGINS, ...PRODUCTION_CLIENT_ORIGINS];

  return Array.from(new Set([...defaultOrigins, ...configuredOrigins]));
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!origin) return false;
  if (!isProductionEnvironment(env)) return true;

  const normalizedOrigin = normalizeClientOrigin(origin);
  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
}
