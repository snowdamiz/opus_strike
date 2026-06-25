import { config } from '../../config/environment';

const BASE = `${config.serverHttpUrl}/admin/api`;
const CSRF_HEADER = 'x-csrf-token';

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

async function parseError(res: Response): Promise<AdminApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const json = JSON.parse(text) as { error?: string };
        if (json?.error) message = json.error;
        else message = text;
      } catch {
        message = text;
      }
    }
  } catch {
    /* ignore body read errors */
  }
  if (res.status === 404 && /not found/i.test(message)) {
    message = 'Not authorized — this session is not an admin wallet.';
  }
  return new AdminApiError(message, res.status);
}

export async function adminGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function adminPost<T>(
  path: string,
  body: unknown,
  csrfToken: string,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      [CSRF_HEADER]: csrfToken,
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}
