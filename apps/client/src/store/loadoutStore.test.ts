import assert from 'node:assert/strict';

const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

(globalThis as any).window = { localStorage };

const {
  applyHeroAbilityBindings,
  LOADOUT_STORAGE_KEY,
  loadStoredLoadout,
  resolveHeroAbilityBindings,
  useLoadoutStore,
} = await import('./loadoutStore');

assert.equal(loadStoredLoadout().blazePrimarySkill, 'fireball_rockets');
assert.equal(loadStoredLoadout().blazeSecondarySkill, 'meteor_strike');
assert.deepEqual(loadStoredLoadout().heroAbilityBindings, {});

localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'phosphor_flare',
  heroAbilityBindings: {
    phantom: {
      ability1: 'phantom_personal_shield',
      ability2: 'phantom_blink',
    },
  },
}));
const storedLoadout = loadStoredLoadout();
assert.equal(storedLoadout.blazePrimarySkill, 'scrapshot');
assert.equal(storedLoadout.blazeSecondarySkill, 'phosphor_flare');
assert.deepEqual(storedLoadout.heroAbilityBindings.phantom, {
  ability1: 'phantom_personal_shield',
  ability2: 'phantom_blink',
});

localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({
  blazePrimarySkill: 'invalid',
  blazeSecondarySkill: 'invalid',
  heroAbilityBindings: {
    phantom: { ability1: 'invalid', ability2: 'phantom_blink' },
  },
}));
const invalidLoadout = loadStoredLoadout();
assert.equal(invalidLoadout.blazePrimarySkill, 'fireball_rockets');
assert.equal(invalidLoadout.blazeSecondarySkill, 'meteor_strike');
assert.deepEqual(invalidLoadout.heroAbilityBindings, {});

useLoadoutStore.getState().setBlazePrimarySkill('scrapshot');
assert.equal(useLoadoutStore.getState().blazePrimarySkill, 'scrapshot');
assert.deepEqual(JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}'), {
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'meteor_strike',
  heroAbilityBindings: {},
});

useLoadoutStore.getState().setBlazeSecondarySkill('phosphor_flare');
assert.equal(useLoadoutStore.getState().blazeSecondarySkill, 'phosphor_flare');
assert.deepEqual(JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}'), {
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'phosphor_flare',
  heroAbilityBindings: {},
});

useLoadoutStore.getState().assignHeroAbility('phantom', 'ability1', 'phantom_personal_shield');
const phantomBindings = resolveHeroAbilityBindings(
  'phantom',
  useLoadoutStore.getState().heroAbilityBindings,
);
assert.deepEqual(phantomBindings, {
  ability1: 'phantom_personal_shield',
  ability2: 'phantom_blink',
});

const physicalEInput = {
  moveForward: false,
  moveBackward: false,
  moveLeft: false,
  moveRight: false,
  jump: false,
  crouch: false,
  sprint: false,
  primaryFire: false,
  secondaryFire: false,
  reload: false,
  ability1: true,
  ability2: false,
  ultimate: false,
  interact: false,
};
const mappedEInput = applyHeroAbilityBindings(
  physicalEInput,
  'phantom',
  useLoadoutStore.getState().heroAbilityBindings,
);
assert.equal(mappedEInput.ability1, false);
assert.equal(mappedEInput.ability2, true);
assert.equal(
  applyHeroAbilityBindings(physicalEInput, 'blaze', useLoadoutStore.getState().heroAbilityBindings),
  physicalEInput,
);

const {
  BLAZE_PHOSPHOR_FLARE_OPTION_ID,
  BLAZE_SCRAPSHOT_OPTION_ID,
  HERO_LOADOUT_POOL,
} = await import('../components/ui/loadoutPool');
const scrapshotOption = HERO_LOADOUT_POOL.blaze.primaryFire.find((option) => (
  option.id === BLAZE_SCRAPSHOT_OPTION_ID
));
assert.equal(scrapshotOption?.ownership, 'owned');
const phosphorFlareOption = HERO_LOADOUT_POOL.blaze.secondaryFire.find((option) => (
  option.id === BLAZE_PHOSPHOR_FLARE_OPTION_ID
));
assert.equal(phosphorFlareOption?.ownership, 'owned');

const { getHeroSkillItems } = await import('../components/ui/HeroSkillKit');
assert.equal(getHeroSkillItems('blaze', 'scrapshot')[0]?.name, 'Scrapshot');
assert.equal(getHeroSkillItems('blaze', 'fireball_rockets')[0]?.name, 'Fireball Rockets');
assert.equal(
  getHeroSkillItems('blaze', 'fireball_rockets', undefined, 'phosphor_flare')[1]?.name,
  'Phosphor Flare',
);
const phantomSkills = getHeroSkillItems('phantom', 'fireball_rockets', phantomBindings);
assert.equal(phantomSkills.find((skill) => skill.input === 'E')?.abilityId, 'phantom_personal_shield');
assert.equal(phantomSkills.find((skill) => skill.input === 'Q')?.abilityId, 'phantom_blink');

console.log('loadout store tests passed');
