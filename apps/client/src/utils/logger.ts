type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMethod = (...args: unknown[]) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = import.meta.env.DEV ? 'warn' : 'error';

function envFlag(name: string): boolean {
  const value = import.meta.env[name];
  return value === '1' || value === 'true' || value === 'TRUE';
}

function envLevel(): LogLevel {
  const value = String(import.meta.env.VITE_LOG_LEVEL || '').toLowerCase();
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return DEFAULT_LEVEL;
}

function namespaceEnabled(namespace: string, level: LogLevel): boolean {
  if (level === 'error') return true;
  if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[envLevel()]) return true;
  if (envFlag('VITE_DEBUG_ALL')) return true;
  const key = `VITE_DEBUG_${namespace.toUpperCase()}`;
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

export function createLogger(namespace: string) {
  return {
    debug: (...args: unknown[]) => write('debug', namespace, args),
    info: (...args: unknown[]) => write('info', namespace, args),
    warn: (...args: unknown[]) => write('warn', namespace, args),
    error: (...args: unknown[]) => write('error', namespace, args),
    sample: (sampleKey: string, intervalMs: number, ...args: unknown[]) => {
      const now = performance.now();
      const key = `${namespace}:${sampleKey}`;
      const last = sampleLogTimes.get(key) ?? 0;
      if (now - last < intervalMs) return;
      sampleLogTimes.set(key, now);
      write('debug', namespace, args);
    },
  };
}

const sampleLogTimes = new Map<string, number>();

export const loggers = {
  audio: createLogger('audio'),
  auth: createLogger('auth'),
  effects: createLogger('effects'),
  network: createLogger('network'),
  perf: createLogger('perf'),
  physics: createLogger('physics'),
  room: createLogger('room'),
  voice: createLogger('voice'),
  viewmodel: createLogger('viewmodel'),
};
