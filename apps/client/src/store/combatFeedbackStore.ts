import { create } from 'zustand';

export type CombatTextKind = 'damage' | 'heal' | 'shieldDamage' | 'solReward';

export interface CombatTextPosition {
  x: number;
  y: number;
  z: number;
}

export interface CombatTextEvent {
  id: string;
  kind: CombatTextKind;
  amount?: number;
  amountLamports?: string;
  label?: string;
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

export interface LocalDamageEvent {
  id: string;
  amount: number;
  angleDeg: number | null;
  damageType?: string;
  sourceId?: string | null;
  createdAt: number;
}

interface CombatFeedbackStore {
  combatTextEvents: CombatTextEvent[];
  localDamageEvents: LocalDamageEvent[];
  killFeed: KillFeedEvent[];
  setSolRewardTextMinLamports: (amountLamports: string | number | bigint) => void;
  addCombatTextEvent: (event: Omit<CombatTextEvent, 'id' | 'createdAt'>) => void;
  addLocalDamageEvent: (event: Omit<LocalDamageEvent, 'id' | 'createdAt'>) => void;
  addKillFeedEvent: (event: Omit<KillFeedEvent, 'id' | 'createdAt'>) => void;
}

const COMBAT_TEXT_TTL = 1450;
const LOCAL_DAMAGE_TTL = 900;
const MAX_COMBAT_TEXT_EVENTS = 28;
const MAX_LOCAL_DAMAGE_EVENTS = 6;
const KILL_TTL = 5000;
const DEFAULT_SOL_REWARD_TEXT_MIN_LAMPORTS = 1_000n;
const SOL_REWARD_TEXT_BUFFER_MS = 260;
// Single shared sweep replaces per-event timers; expiry resolves within
// EXPIRY_SWEEP_INTERVAL_MS of the exact TTL, which is imperceptible because
// the visual fade already completes well before the TTL elapses.
const EXPIRY_SWEEP_INTERVAL_MS = 200;
let eventId = 0;
let solRewardTextMinLamports = DEFAULT_SOL_REWARD_TEXT_MIN_LAMPORTS;
let solRewardBuffer: {
  amountLamports: bigint;
  event: Omit<CombatTextEvent, 'id' | 'createdAt'>;
  timeoutId: number | null;
} | null = null;

function nextId(): string {
  eventId += 1;
  return `${Date.now()}-${eventId}`;
}

function parseLamports(value: string | undefined): bigint {
  if (!value || !/^[0-9]+$/.test(value)) return 0n;
  return BigInt(value);
}

function parseLamportsSetting(value: string | number | bigint): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return /^[0-9]+$/.test(value.trim()) ? BigInt(value.trim()) : null;
}

export function formatSolRewardLabel(amountLamports: string | bigint): string {
  const lamports = typeof amountLamports === 'bigint' ? amountLamports : parseLamports(amountLamports);
  if (lamports <= 0n) return '+0 SOL';
  const whole = lamports / 1_000_000_000n;
  const fraction = lamports % 1_000_000_000n;
  if (fraction === 0n) return `+${whole.toString()} SOL`;
  return `+${whole.toString()}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')} SOL`;
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
      const nextLocalDamage = pruneExpiredItems(state.localDamageEvents, now, LOCAL_DAMAGE_TTL);
      const nextKills = pruneExpiredItems(state.killFeed, now, KILL_TTL);
      const combatChanged = nextCombat !== state.combatTextEvents;
      const localDamageChanged = nextLocalDamage !== state.localDamageEvents;
      const killsChanged = nextKills !== state.killFeed;

      if (combatChanged || localDamageChanged || killsChanged) {
        set({
          ...(combatChanged ? { combatTextEvents: nextCombat } : {}),
          ...(localDamageChanged ? { localDamageEvents: nextLocalDamage } : {}),
          ...(killsChanged ? { killFeed: nextKills } : {}),
        });
      }

      const settled = get();
      if (
        settled.combatTextEvents.length === 0 &&
        settled.localDamageEvents.length === 0 &&
        settled.killFeed.length === 0
      ) {
        stopExpirySweep();
      }
    }, EXPIRY_SWEEP_INTERVAL_MS);
  };

  const appendCombatTextEvent = (event: Omit<CombatTextEvent, 'id' | 'createdAt'>): void => {
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
  };

  const flushSolRewardBuffer = (): void => {
    if (!solRewardBuffer || solRewardBuffer.amountLamports <= 0n) return;
    const buffered = solRewardBuffer;
    solRewardBuffer = null;
    appendCombatTextEvent({
      ...buffered.event,
      kind: 'solReward',
      amountLamports: buffered.amountLamports.toString(),
      label: formatSolRewardLabel(buffered.amountLamports),
    });
  };

  return {
    combatTextEvents: [],
    localDamageEvents: [],
    killFeed: [],
    setSolRewardTextMinLamports: (amountLamports) => {
      solRewardTextMinLamports = parseLamportsSetting(amountLamports) ?? DEFAULT_SOL_REWARD_TEXT_MIN_LAMPORTS;
    },
    addCombatTextEvent: (event) => {
      if (event.kind === 'solReward') {
        const amountLamports = parseLamports(event.amountLamports);
        if (amountLamports <= 0n) return;
        if (amountLamports < solRewardTextMinLamports) {
          solRewardBuffer = {
            amountLamports: (solRewardBuffer?.amountLamports ?? 0n) + amountLamports,
            event: {
              ...event,
              amountLamports: undefined,
              label: undefined,
              position: { ...event.position },
            },
            timeoutId: solRewardBuffer?.timeoutId ?? window.setTimeout(flushSolRewardBuffer, SOL_REWARD_TEXT_BUFFER_MS),
          };
          return;
        }
        appendCombatTextEvent({
          ...event,
          amountLamports: amountLamports.toString(),
          label: event.label ?? formatSolRewardLabel(amountLamports),
        });
        return;
      }

      appendCombatTextEvent(event);
    },
    addLocalDamageEvent: (event) => {
      const id = nextId();
      set((state) => ({
        localDamageEvents: [
          ...state.localDamageEvents.slice(-(MAX_LOCAL_DAMAGE_EVENTS - 1)),
          {
            ...event,
            id,
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
