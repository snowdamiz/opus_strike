type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMethod = (...args: unknown[]) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'TRUE';
}

function envLevel(): LogLevel {
  const value = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'warn';
}

function namespaceEnabled(namespace: string, level: LogLevel): boolean {
  if (level === 'error') return true;
  if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[envLevel()]) return true;
  if (envFlag('DEBUG_ALL')) return true;
  const key = `DEBUG_${namespace.toUpperCase()}`;
  return envFlag(key);
}

function write(level: LogLevel, namespace: string, args: unknown[]): void {
  if (!namespaceEnabled(namespace, level)) return;

  const method: LogMethod =
    level === 'debug'
      ? console.debug
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;

  method(`[${namespace}]`, ...args);
}

const sampleLogTimes = new Map<string, number>();

export function createLogger(namespace: string) {
  return {
    debug: (...args: unknown[]) => write('debug', namespace, args),
    info: (...args: unknown[]) => write('info', namespace, args),
    warn: (...args: unknown[]) => write('warn', namespace, args),
    error: (...args: unknown[]) => write('error', namespace, args),
    sample: (sampleKey: string, intervalMs: number, ...args: unknown[]) => {
      const now = Date.now();
      const key = `${namespace}:${sampleKey}`;
      const last = sampleLogTimes.get(key) ?? 0;
      if (now - last < intervalMs) return;
      sampleLogTimes.set(key, now);
      write('debug', namespace, args);
    },
  };
}

export const loggers = {
  auth: createLogger('auth'),
  network: createLogger('network'),
  nft: createLogger('nft'),
  physics: createLogger('physics'),
  room: createLogger('room'),
  voice: createLogger('voice'),
};
