import assert from 'node:assert/strict';
import { TUTORIAL_WORLD_PROMPTS, getTutorialWorldPromptOpacity } from './TutorialWorldPrompts';

const baseInput = {
  promptId: 'slide' as const,
  promptZ: -13.2,
  playerZ: -20,
  hasFlag: false,
  boostCollected: false,
  healthCollected: false,
};

assert.equal(getTutorialWorldPromptOpacity(baseInput), 1, 'nearby upcoming slide prompt should be fully visible');
assert.equal(
  getTutorialWorldPromptOpacity({ ...baseInput, playerZ: -8 }),
  0,
  'slide prompt should hide once the player has passed it'
);
assert.equal(
  getTutorialWorldPromptOpacity({ ...baseInput, promptId: 'boost', promptZ: 14, playerZ: 12, boostCollected: true }),
  0,
  'boost prompt should hide after boost collection'
);
assert.equal(
  getTutorialWorldPromptOpacity({ ...baseInput, promptId: 'flag', promptZ: 39, playerZ: 22 }),
  0,
  'flag prompt should wait until the player is near the objective lane'
);
assert.ok(
  getTutorialWorldPromptOpacity({ ...baseInput, promptId: 'flag', promptZ: 39, playerZ: 30 }) > 0,
  'flag prompt should appear near the objective lane'
);
assert.equal(
  getTutorialWorldPromptOpacity({ ...baseInput, promptId: 'capture', promptZ: -31, playerZ: 20 }),
  0,
  'capture prompt should stay hidden before flag pickup'
);
assert.ok(
  getTutorialWorldPromptOpacity({ ...baseInput, promptId: 'capture', promptZ: -31, playerZ: 20, hasFlag: true }) > 0,
  'capture prompt should appear after flag pickup'
);

const boostPrompt = TUTORIAL_WORLD_PROMPTS.find((prompt) => prompt.id === 'boost');
const healthPrompt = TUTORIAL_WORLD_PROMPTS.find((prompt) => prompt.id === 'health');
const targetPrompt = TUTORIAL_WORLD_PROMPTS.find((prompt) => prompt.id === 'target');
assert.ok(boostPrompt && healthPrompt && targetPrompt, 'pickup and target prompts should exist');
assert.ok(
  boostPrompt.position[2] < healthPrompt.position[2] && healthPrompt.position[2] < targetPrompt.position[2],
  'boost and health prompts should appear before target practice'
);

console.log('tutorial world prompt visibility tests passed');
