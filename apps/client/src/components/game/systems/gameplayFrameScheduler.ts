export type GameplayFrameCadence =
  | { kind: 'everyFrame' }
  | { kind: 'everyFrames'; frames: number }
  | { kind: 'intervalMs'; intervalMs: number };

export interface GameplayFrameContext {
  deltaSeconds: number;
  deltaMs: number;
  nowMs: number;
  elapsedSeconds: number;
}

export interface GameplayFrameSystemRegistration {
  system: string;
  label: string;
  priority?: number;
  cadence?: GameplayFrameCadence;
  callback: (context: GameplayFrameContext) => void;
}

interface GameplayFrameSystemEntry extends Required<Omit<GameplayFrameSystemRegistration, 'priority' | 'cadence'>> {
  priority: number;
  cadence: GameplayFrameCadence;
  elapsedMs: number;
  frameCount: number;
  order: number;
}

let nextSystemOrder = 0;

function normalizeCadence(cadence?: GameplayFrameCadence): GameplayFrameCadence {
  if (!cadence) return { kind: 'everyFrame' };
  if (cadence.kind === 'everyFrames') {
    return { kind: 'everyFrames', frames: Math.max(1, Math.floor(cadence.frames)) };
  }
  if (cadence.kind === 'intervalMs') {
    return { kind: 'intervalMs', intervalMs: Math.max(0, cadence.intervalMs) };
  }
  return cadence;
}

function shouldRunSystem(entry: GameplayFrameSystemEntry, deltaMs: number): boolean {
  if (entry.cadence.kind === 'everyFrame') return true;

  if (entry.cadence.kind === 'everyFrames') {
    entry.frameCount++;
    if (entry.frameCount < entry.cadence.frames) return false;
    entry.frameCount = 0;
    return true;
  }

  entry.elapsedMs += deltaMs;
  if (entry.elapsedMs < entry.cadence.intervalMs) return false;
  entry.elapsedMs = 0;
  return true;
}

export class GameplayFrameScheduler {
  private readonly entries: GameplayFrameSystemEntry[] = [];

  register(registration: GameplayFrameSystemRegistration): () => void {
    const entry: GameplayFrameSystemEntry = {
      system: registration.system,
      label: registration.label,
      priority: registration.priority ?? 0,
      cadence: normalizeCadence(registration.cadence),
      callback: registration.callback,
      elapsedMs: 0,
      frameCount: 0,
      order: nextSystemOrder++,
    };

    this.entries.push(entry);
    this.entries.sort((a, b) => a.priority - b.priority || a.order - b.order);

    return () => {
      const index = this.entries.indexOf(entry);
      if (index >= 0) {
        this.entries.splice(index, 1);
      }
    };
  }

  run(context: GameplayFrameContext): void {
    if (this.entries.length === 0) return;

    for (const entry of this.entries) {
      if (!shouldRunSystem(entry, context.deltaMs)) continue;
      entry.callback(context);
    }
  }

  get activeCallbackCount(): number {
    return this.entries.length;
  }

  getCallbacksBySystem(): Record<string, number> {
    const callbacksBySystem: Record<string, number> = {};
    for (const entry of this.entries) {
      callbacksBySystem[entry.system] = (callbacksBySystem[entry.system] ?? 0) + 1;
    }
    return callbacksBySystem;
  }

  resetForTests(): void {
    this.entries.length = 0;
  }
}

export const gameplayFrameScheduler = new GameplayFrameScheduler();
