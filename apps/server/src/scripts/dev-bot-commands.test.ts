import assert from 'node:assert/strict';
import {
  DEV_BOT_LOOK_PITCH,
  applyDevBotLookOverride,
  applyDevBotSkillOverride,
  resolveDevBotLookDirection,
  resolveDevBotSkillOverride,
} from '../rooms/devBotCommands';

function createSkillInput() {
  return {
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: true,
    ultimate: true,
  };
}

assert.deepEqual(resolveDevBotSkillOverride('Key E'), { slot: 'ability1', skillKey: 'e' });
assert.deepEqual(resolveDevBotSkillOverride('mouse-left'), { slot: 'primary', skillKey: 'lmb' });
assert.deepEqual(resolveDevBotSkillOverride('alt fire'), { slot: 'secondary', skillKey: 'rmb' });
assert.equal(resolveDevBotSkillOverride('dance'), null);

assert.equal(resolveDevBotLookDirection(' Up '), 'up');
assert.equal(resolveDevBotLookDirection('DOWN'), 'down');
assert.equal(resolveDevBotLookDirection('sideways'), null);

{
  const input = createSkillInput();
  const result = applyDevBotSkillOverride(input, 'phantom', {
    slot: 'secondary',
    skillKey: 'rmb',
    expiresAt: 1,
  });

  assert.equal(result, input);
  assert.deepEqual(result, {
    primaryFire: false,
    secondaryFire: true,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
  });
}

{
  const result = applyDevBotSkillOverride(createSkillInput(), 'chronos', {
    slot: 'ability1',
    skillKey: 'e',
    expiresAt: 1,
  });

  assert.deepEqual(result, {
    primaryFire: true,
    secondaryFire: false,
    reload: false,
    ability1: true,
    ability2: false,
    ultimate: false,
  });
}

{
  const input = createSkillInput();
  assert.equal(applyDevBotSkillOverride(input, 'blaze', null), input);
}

{
  const input = { lookPitch: 0 };
  assert.equal(applyDevBotLookOverride(input, null), input);
  assert.equal(input.lookPitch, 0);
  applyDevBotLookOverride(input, {
    direction: 'up',
    pitch: DEV_BOT_LOOK_PITCH.up,
    expiresAt: 1,
  });
  assert.equal(input.lookPitch, Math.PI / 2);
}

console.log('dev bot command tests passed');
