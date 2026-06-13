import { create } from 'zustand';

export type CombatTextKind = 'damage' | 'heal';

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
let eventId = 0;

function nextId(): string {
  eventId += 1;
  return `${Date.now()}-${eventId}`;
}

export const useCombatFeedbackStore = create<CombatFeedbackStore>((set) => ({
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

    window.setTimeout(() => {
      set((state) => ({
        combatTextEvents: state.combatTextEvents.filter((item) => item.id !== id),
      }));
    }, COMBAT_TEXT_TTL);
  },
  addKillFeedEvent: (event) => {
    const id = nextId();
    set((state) => ({
      killFeed: [
        { ...event, id, createdAt: Date.now() },
        ...state.killFeed.slice(0, 4),
      ],
    }));

    window.setTimeout(() => {
      set((state) => ({
        killFeed: state.killFeed.filter((item) => item.id !== id),
      }));
    }, KILL_TTL);
  },
}));
