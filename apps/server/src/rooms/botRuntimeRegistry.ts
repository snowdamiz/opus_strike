import type { HeroId } from '@voxel-strike/shared';

export interface BotRuntimeBrainSchedule {
  nextThinkAt: number;
  nextBlackboardAt: number;
}

export class BotRuntimeRegistry<TBrain extends BotRuntimeBrainSchedule> {
  private nextDevBotIndex = 0;
  private readonly brains = new Map<string, TBrain>();
  private readonly preferredHeroes = new Map<string, HeroId>();
  private readonly urgentFrameBotIds: string[] = [];
  private readonly deferredFrameBotIds: string[] = [];

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

  forEachScheduledFrameBot(callback: (botId: string) => void): void {
    for (const botId of this.urgentFrameBotIds) {
      callback(botId);
    }
    for (const botId of this.deferredFrameBotIds) {
      callback(botId);
    }
  }

  setPreferredHero(botId: string, heroId: HeroId): void {
    this.preferredHeroes.set(botId, heroId);
  }

  getPreferredHero(botId: string): HeroId | undefined {
    return this.preferredHeroes.get(botId);
  }
}
