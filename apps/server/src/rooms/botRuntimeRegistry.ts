import type { HeroId } from '@voxel-strike/shared';

export interface BotRuntimeBrainSchedule {
  nextThinkAt: number;
  nextBlackboardAt: number;
}

export interface BotFrameScheduleResult {
  urgentCount: number;
  urgentProcessedCount: number;
  urgentSkippedCount: number;
  deferredCount: number;
  deferredProcessedCount: number;
  deferredSkippedCount: number;
}

export class BotRuntimeRegistry<TBrain extends BotRuntimeBrainSchedule> {
  private nextDevBotIndex = 0;
  private readonly brains = new Map<string, TBrain>();
  private readonly preferredHeroes = new Map<string, HeroId>();
  private readonly urgentFrameBotIds: string[] = [];
  private readonly deferredFrameBotIds: string[] = [];
  private urgentFrameCursor = 0;
  private deferredFrameCursor = 0;

  createDevBotIndex(): number {
    return this.nextDevBotIndex++;
  }

  setBrain(botId: string, brain: TBrain): void {
    this.brains.set(botId, brain);
  }

  getBrain(botId: string): TBrain | undefined {
    return this.brains.get(botId);
  }

  deleteBrain(botId: string): boolean {
    return this.brains.delete(botId);
  }

  forEachBrain(callback: (brain: TBrain, botId: string) => void): void {
    this.brains.forEach(callback);
  }

  resetBrainSchedules(): void {
    this.brains.forEach((brain) => {
      brain.nextThinkAt = 0;
      brain.nextBlackboardAt = 0;
    });
  }

  beginFrameSchedule(): void {
    this.urgentFrameBotIds.length = 0;
    this.deferredFrameBotIds.length = 0;
  }

  scheduleForFrame(botId: string, urgent: boolean): void {
    if (urgent) {
      this.urgentFrameBotIds.push(botId);
    } else {
      this.deferredFrameBotIds.push(botId);
    }
  }

  runScheduledFrameBots(input: {
    urgentBudget?: number;
    deferredBudget: number;
    run: (botId: string) => void;
    skipUrgent?: (botId: string) => void;
    skipDeferred?: (botId: string) => void;
  }): BotFrameScheduleResult {
    const urgentCount = this.urgentFrameBotIds.length;
    const urgentBudget = input.urgentBudget === undefined
      ? urgentCount
      : Math.max(0, Math.trunc(input.urgentBudget));
    const urgentStart = urgentCount > 0 ? this.urgentFrameCursor % urgentCount : 0;
    let urgentProcessedCount = 0;

    if (urgentCount > 0 && urgentBudget > 0) {
      const limit = Math.min(urgentBudget, urgentCount);
      for (let offset = 0; offset < limit; offset++) {
        const index = (urgentStart + offset) % urgentCount;
        const botId = this.urgentFrameBotIds[index];
        if (!botId) continue;
        urgentProcessedCount++;
        input.run(botId);
      }
      this.urgentFrameCursor = (urgentStart + limit) % urgentCount;
    }

    if (input.skipUrgent) {
      for (let index = 0; index < urgentCount; index++) {
        if (!isCircularIndexInWindow(index, urgentStart, urgentProcessedCount, urgentCount)) {
          const botId = this.urgentFrameBotIds[index];
          if (!botId) continue;
          input.skipUrgent(botId);
        }
      }
    }

    const deferredCount = this.deferredFrameBotIds.length;
    const deferredBudget = Math.max(0, Math.trunc(input.deferredBudget));
    const deferredStart = deferredCount > 0 ? this.deferredFrameCursor % deferredCount : 0;
    let deferredProcessedCount = 0;

    if (deferredCount > 0 && deferredBudget > 0) {
      const limit = Math.min(deferredBudget, deferredCount);
      for (let offset = 0; offset < limit; offset++) {
        const index = (deferredStart + offset) % deferredCount;
        const botId = this.deferredFrameBotIds[index];
        if (!botId) continue;
        deferredProcessedCount++;
        input.run(botId);
      }
      this.deferredFrameCursor = (deferredStart + limit) % deferredCount;
    }

    if (input.skipDeferred) {
      for (let index = 0; index < deferredCount; index++) {
        if (!isCircularIndexInWindow(index, deferredStart, deferredProcessedCount, deferredCount)) {
          const botId = this.deferredFrameBotIds[index];
          if (!botId) continue;
          input.skipDeferred(botId);
        }
      }
    }

    return {
      urgentCount,
      urgentProcessedCount,
      urgentSkippedCount: Math.max(0, urgentCount - urgentProcessedCount),
      deferredCount,
      deferredProcessedCount,
      deferredSkippedCount: Math.max(0, deferredCount - deferredProcessedCount),
    };
  }

  setPreferredHero(botId: string, heroId: HeroId): void {
    this.preferredHeroes.set(botId, heroId);
  }

  getPreferredHero(botId: string): HeroId | undefined {
    return this.preferredHeroes.get(botId);
  }
}

function isCircularIndexInWindow(index: number, start: number, count: number, total: number): boolean {
  if (count <= 0 || total <= 0) return false;
  if (count >= total) return true;
  const end = start + count;
  return end <= total
    ? index >= start && index < end
    : index >= start || index < end % total;
}
