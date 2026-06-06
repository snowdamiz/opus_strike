import { create } from 'zustand';

export interface DamageNumberEvent {
  id: string;
  damage: number;
  damageType: string;
  createdAt: number;
}

export interface KillFeedEvent {
  id: string;
  killerName: string;
  victimName: string;
  createdAt: number;
}

interface CombatFeedbackStore {
  damageNumbers: DamageNumberEvent[];
  killFeed: KillFeedEvent[];
  addDamageNumber: (event: Omit<DamageNumberEvent, 'id' | 'createdAt'>) => void;
  addKillFeedEvent: (event: Omit<KillFeedEvent, 'id' | 'createdAt'>) => void;
}

const DAMAGE_TTL = 1200;
const KILL_TTL = 5000;
let eventId = 0;

function nextId(): string {
  eventId += 1;
  return `${Date.now()}-${eventId}`;
}

export const useCombatFeedbackStore = create<CombatFeedbackStore>((set) => ({
  damageNumbers: [],
  killFeed: [],
  addDamageNumber: (event) => {
    const id = nextId();
    set((state) => ({
      damageNumbers: [
        ...state.damageNumbers.slice(-4),
        { ...event, id, createdAt: Date.now() },
      ],
    }));

    window.setTimeout(() => {
      set((state) => ({
        damageNumbers: state.damageNumbers.filter((item) => item.id !== id),
      }));
    }, DAMAGE_TTL);
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
