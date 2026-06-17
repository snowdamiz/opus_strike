import assert from 'node:assert/strict';
import type { HeroId } from '@voxel-strike/shared';
import { BotRuntimeRegistry, type BotRuntimeBrainSchedule } from '../rooms/botRuntimeRegistry';

interface TestBrain extends BotRuntimeBrainSchedule {
  label: string;
}

function brain(label: string, nextThinkAt = 1_000, nextBlackboardAt = 2_000): TestBrain {
  return { label, nextThinkAt, nextBlackboardAt };
}

{
  const registry = new BotRuntimeRegistry<TestBrain>();

  assert.equal(registry.createDevBotIndex(), 0);
  assert.equal(registry.createDevBotIndex(), 1);
}

{
  const registry = new BotRuntimeRegistry<TestBrain>();
  const first = brain('first');
  const second = brain('second');

  registry.setBrain('bot-a', first);
  registry.setBrain('bot-b', second);

  assert.equal(registry.getBrain('bot-a'), first);
  const entries: string[] = [];
  registry.forEachBrain((value, botId) => entries.push(`${botId}:${value.label}`));
  assert.deepEqual(entries, ['bot-a:first', 'bot-b:second']);

  registry.resetBrainSchedules();
  assert.equal(first.nextThinkAt, 0);
  assert.equal(first.nextBlackboardAt, 0);
  assert.equal(second.nextThinkAt, 0);
  assert.equal(second.nextBlackboardAt, 0);

  assert.equal(registry.deleteBrain('bot-a'), true);
  assert.equal(registry.deleteBrain('bot-a'), false);
  assert.equal(registry.getBrain('bot-a'), undefined);
}

{
  const registry = new BotRuntimeRegistry<TestBrain>();
  const hero: HeroId = 'phantom';

  registry.setPreferredHero('bot-a', hero);
  assert.equal(registry.getPreferredHero('bot-a'), hero);
  assert.equal(registry.getPreferredHero('bot-b'), undefined);
}

{
  const registry = new BotRuntimeRegistry<TestBrain>();

  registry.beginFrameSchedule();
  registry.scheduleForFrame('deferred-a', false);
  registry.scheduleForFrame('urgent-a', true);
  registry.scheduleForFrame('deferred-b', false);
  registry.scheduleForFrame('urgent-b', true);

  const scheduled: string[] = [];
  registry.forEachScheduledFrameBot((botId) => scheduled.push(botId));
  assert.deepEqual(scheduled, ['urgent-a', 'urgent-b', 'deferred-a', 'deferred-b']);

  registry.beginFrameSchedule();
  const nextFrameScheduled: string[] = [];
  registry.forEachScheduledFrameBot((botId) => nextFrameScheduled.push(botId));
  assert.deepEqual(nextFrameScheduled, []);
}

console.log('bot runtime registry tests passed');
