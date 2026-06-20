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
  const skipped: string[] = [];
  assert.deepEqual(
    registry.runScheduledFrameBots({
      deferredBudget: 1,
      run: (botId) => scheduled.push(botId),
      skipDeferred: (botId) => skipped.push(botId),
    }),
    {
      urgentCount: 2,
      urgentProcessedCount: 2,
      urgentSkippedCount: 0,
      deferredCount: 2,
      deferredProcessedCount: 1,
      deferredSkippedCount: 1,
    }
  );
  assert.deepEqual(scheduled, ['urgent-a', 'urgent-b', 'deferred-a']);
  assert.deepEqual(skipped, ['deferred-b']);

  const nextScheduled: string[] = [];
  const nextSkipped: string[] = [];
  registry.beginFrameSchedule();
  registry.scheduleForFrame('deferred-a', false);
  registry.scheduleForFrame('urgent-a', true);
  registry.scheduleForFrame('deferred-b', false);
  registry.runScheduledFrameBots({
    deferredBudget: 1,
    run: (botId) => nextScheduled.push(botId),
    skipDeferred: (botId) => nextSkipped.push(botId),
  });
  assert.deepEqual(nextScheduled, ['urgent-a', 'deferred-b']);
  assert.deepEqual(nextSkipped, ['deferred-a']);

  registry.beginFrameSchedule();
  const nextFrameScheduled: string[] = [];
  registry.runScheduledFrameBots({
    deferredBudget: 1,
    run: (botId) => nextFrameScheduled.push(botId),
  });
  assert.deepEqual(nextFrameScheduled, []);
}

{
  const registry = new BotRuntimeRegistry<TestBrain>();

  registry.beginFrameSchedule();
  registry.scheduleForFrame('urgent-a', true);
  registry.scheduleForFrame('urgent-b', true);
  registry.scheduleForFrame('urgent-c', true);

  const scheduled: string[] = [];
  const skipped: string[] = [];
  assert.deepEqual(
    registry.runScheduledFrameBots({
      urgentBudget: 2,
      deferredBudget: 0,
      run: (botId) => scheduled.push(botId),
      skipUrgent: (botId) => skipped.push(botId),
    }),
    {
      urgentCount: 3,
      urgentProcessedCount: 2,
      urgentSkippedCount: 1,
      deferredCount: 0,
      deferredProcessedCount: 0,
      deferredSkippedCount: 0,
    }
  );
  assert.deepEqual(scheduled, ['urgent-a', 'urgent-b']);
  assert.deepEqual(skipped, ['urgent-c']);

  const nextScheduled: string[] = [];
  const nextSkipped: string[] = [];
  registry.beginFrameSchedule();
  registry.scheduleForFrame('urgent-a', true);
  registry.scheduleForFrame('urgent-b', true);
  registry.scheduleForFrame('urgent-c', true);
  registry.runScheduledFrameBots({
    urgentBudget: 2,
    deferredBudget: 0,
    run: (botId) => nextScheduled.push(botId),
    skipUrgent: (botId) => nextSkipped.push(botId),
  });
  assert.deepEqual(nextScheduled, ['urgent-c', 'urgent-a']);
  assert.deepEqual(nextSkipped, ['urgent-b']);
}

console.log('bot runtime registry tests passed');
