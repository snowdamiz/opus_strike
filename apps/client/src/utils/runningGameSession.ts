import type { Team } from '@voxel-strike/shared';

export interface RunningGameSession {
  roomId: string;
  playerName: string;
  team?: Team;
  savedAt: number;
}

export const RUNNING_GAME_SESSION_STORAGE_KEY = 'voxel_strike_running_game';
export const RUNNING_GAME_SESSION_EVENT = 'voxel-running-game-session-changed';

function notifySessionChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(RUNNING_GAME_SESSION_EVENT));
}

function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{4,128}$/.test(value);
}

function normalizeTeam(value: unknown): Team | undefined {
  return value === 'red' || value === 'blue' ? value : undefined;
}

function parseSession(value: string | null): RunningGameSession | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<RunningGameSession>;
    if (!isValidRoomId(parsed.roomId)) return null;

    const playerName = typeof parsed.playerName === 'string'
      ? parsed.playerName.trim().slice(0, 24)
      : '';

    return {
      roomId: parsed.roomId,
      playerName,
      team: normalizeTeam(parsed.team),
      savedAt: Number.isFinite(parsed.savedAt) ? Number(parsed.savedAt) : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadRunningGameSession(): RunningGameSession | null {
  if (typeof window === 'undefined') return null;
  return parseSession(window.localStorage.getItem(RUNNING_GAME_SESSION_STORAGE_KEY));
}

export function saveRunningGameSession(input: Omit<RunningGameSession, 'savedAt'>): void {
  if (typeof window === 'undefined' || !isValidRoomId(input.roomId)) return;

  const session: RunningGameSession = {
    roomId: input.roomId,
    playerName: input.playerName.trim().slice(0, 24),
    team: input.team,
    savedAt: Date.now(),
  };

  window.localStorage.setItem(RUNNING_GAME_SESSION_STORAGE_KEY, JSON.stringify(session));
  notifySessionChanged();
}

export function clearRunningGameSession(roomId?: string | null): void {
  if (typeof window === 'undefined') return;

  const current = loadRunningGameSession();
  if (roomId && current?.roomId !== roomId) return;

  window.localStorage.removeItem(RUNNING_GAME_SESSION_STORAGE_KEY);
  notifySessionChanged();
}
