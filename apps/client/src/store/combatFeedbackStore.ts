import { create } from 'zustand';

export type CombatTextKind = 'damage' | 'heal' | 'shieldDamage';

export interface CombatTextPosition {
  x: number;
  y: number;
  z: number;
}

export interface CombatTextEvent {
  id: string;
  kind: CombatTextKind;
  amount: number;
  damageType?: string;
  targetId?: string | null;
  position: CombatTextPosition;
  createdAt: number;
}

export interface KillFeedEvent {
  id: string;
  killerName: string;
  victimName: string;
  createdAt: number;
}

interface CombatFeedbackStore {
  combatTextEvents: CombatTextEvent[];
  killFeed: KillFeedEvent[];
  addCombatTextEvent: (event: Omit<CombatTextEvent, 'id' | 'createdAt'>) => void;
  addKillFeedEvent: (event: Omit<KillFeedEvent, 'id' | 'createdAt'>) => void;
}

const COMBAT_TEXT_TTL = 1450;
const MAX_COMBAT_TEXT_EVENTS = 28;
const KILL_TTL = 5000;
// Single shared sweep replaces per-event timers; expiry resolves within
// EXPIRY_SWEEP_INTERVAL_MS of the exact TTL, which is imperceptible because
// the visual fade already completes well before the TTL elapses.
const EXPIRY_SWEEP_INTERVAL_MS = 200;
let eventId = 0;

function nextId(): string {
  eventId += 1;
  return `${Date.now()}-${eventId}`;
}

function pruneExpiredItems<T extends { createdAt: number }>(
  items: T[],
  now: number,
  ttl: number
): T[] {
  let hasExpired = false;
  for (let index = 0; index < items.length; index++) {
    if (now - items[index].createdAt >= ttl) {
      hasExpired = true;
      break;
    }
  }
  if (!hasExpired) return items;

  const next: T[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (now - item.createdAt < ttl) {
      next.push(item);
    }
  }
  return next;
}

let expirySweepInterval: number | null = null;

function stopExpirySweep(): void {
  if (expirySweepInterval !== null) {
    window.clearInterval(expirySweepInterval);
    expirySweepInterval = null;
  }
}

export const useCombatFeedbackStore = create<CombatFeedbackStore>((set, get) => {
  const ensureExpirySweep = (): void => {
    if (expirySweepInterval !== null) return;
    expirySweepInterval = window.setInterval(() => {
      const now = Date.now();
      const state = get();
      const nextCombat = pruneExpiredItems(state.combatTextEvents, now, COMBAT_TEXT_TTL);
      const nextKills = pruneExpiredItems(state.killFeed, now, KILL_TTL);
      const combatChanged = nextCombat !== state.combatTextEvents;
      const killsChanged = nextKills !== state.killFeed;

      if (combatChanged || killsChanged) {
        set({
          ...(combatChanged ? { combatTextEvents: nextCombat } : {}),
          ...(killsChanged ? { killFeed: nextKills } : {}),
        });
      }

      const settled = get();
      if (settled.combatTextEvents.length === 0 && settled.killFeed.length === 0) {
        stopExpirySweep();
      }
    }, EXPIRY_SWEEP_INTERVAL_MS);
  };

  return {
    combatTextEvents: [],
    killFeed: [],
    addCombatTextEvent: (event) => {
      const id = nextId();
      set((state) => ({
        combatTextEvents: [
          ...state.combatTextEvents.slice(-(MAX_COMBAT_TEXT_EVENTS - 1)),
          {
            ...event,
            id,
            position: { ...event.position },
            createdAt: Date.now(),
          },
        ],
      }));
      ensureExpirySweep();
    },
    addKillFeedEvent: (event) => {
      const id = nextId();
      set((state) => ({
        killFeed: [
          { ...event, id, createdAt: Date.now() },
          ...state.killFeed.slice(0, 4),
        ],
      }));
      ensureExpirySweep();
    },
  };
});
