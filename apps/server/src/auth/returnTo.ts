const DEFAULT_RETURN_TO = '/';
const LOCAL_ORIGIN = 'http://opus-strike.local';

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RETURN_TO;

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 2048 ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const parsed = new URL(trimmed, LOCAL_ORIGIN);
    if (parsed.origin !== LOCAL_ORIGIN) return DEFAULT_RETURN_TO;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export function appendAuthStatus(returnTo: string, params: Record<string, string>): string {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const parsed = new URL(safeReturnTo, LOCAL_ORIGIN);

  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
