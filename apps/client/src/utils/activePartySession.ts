import { ALL_HERO_IDS, type HeroId } from '@voxel-strike/shared';

export interface ActivePartySession {
  partyId: string;
  userId: string;
  playerName: string;
  heroId?: HeroId;
  savedAt: number;
}

export const ACTIVE_PARTY_SESSION_STORAGE_KEY = 'voxel_strike_active_party_session:v1';
export const ACTIVE_PARTY_SESSION_EVENT = 'voxel-active-party-session-changed';

function notifySessionChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ACTIVE_PARTY_SESSION_EVENT));
}

function isValidStorageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{2,160}$/.test(value);
}

function normalizeHeroId(value: unknown): HeroId | undefined {
  return typeof value === 'string' && (ALL_HERO_IDS as readonly string[]).includes(value)
    ? value as HeroId
    : undefined;
}

function parseSession(value: string | null): ActivePartySession | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<ActivePartySession>;
    if (!isValidStorageId(parsed.partyId) || !isValidStorageId(parsed.userId)) return null;

    const playerName = typeof parsed.playerName === 'string'
      ? parsed.playerName.trim().slice(0, 24)
      : '';

    return {
      partyId: parsed.partyId,
      userId: parsed.userId,
      playerName,
      heroId: normalizeHeroId(parsed.heroId),
      savedAt: Number.isFinite(parsed.savedAt) ? Number(parsed.savedAt) : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadActivePartySession(): ActivePartySession | null {
  if (typeof window === 'undefined') return null;

  try {
    return parseSession(window.localStorage.getItem(ACTIVE_PARTY_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveActivePartySession(input: Omit<ActivePartySession, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  if (!isValidStorageId(input.partyId) || !isValidStorageId(input.userId)) return;

  const session: ActivePartySession = {
    partyId: input.partyId,
    userId: input.userId,
    playerName: input.playerName.trim().slice(0, 24),
    heroId: normalizeHeroId(input.heroId),
    savedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(ACTIVE_PARTY_SESSION_STORAGE_KEY, JSON.stringify(session));
    notifySessionChanged();
  } catch {
    // Reload recovery is best-effort only; avoid breaking party UI when storage is unavailable.
  }
}

export function clearActivePartySession(partyId?: string | null): void {
  if (typeof window === 'undefined') return;

  const current = loadActivePartySession();
  if (partyId && current?.partyId !== partyId) return;

  try {
    window.localStorage.removeItem(ACTIVE_PARTY_SESSION_STORAGE_KEY);
    notifySessionChanged();
  } catch {
    // Ignore storage failures; the current in-memory party state is still authoritative.
  }
}
