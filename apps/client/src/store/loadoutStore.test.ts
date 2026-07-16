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
  resolveRuntimeHeroAbilityBindings,
  useLoadoutStore,
} = await import('./loadoutStore');
const {
  PHANTOM_DIRE_BALL_SPEED,
  PHANTOM_SOULREND_MAGAZINE_SIZE,
  PHANTOM_SOULREND_SPEED,
  getPhantomPrimaryMagazineSize,
  getPhantomPrimaryProjectileSpeed,
} = await import('@voxel-strike/shared');

assert.equal(PHANTOM_SOULREND_MAGAZINE_SIZE, 10);
assert.equal(getPhantomPrimaryMagazineSize('soulrend_daggers'), 10);
assert.equal(getPhantomPrimaryProjectileSpeed('soulrend_daggers'), PHANTOM_SOULREND_SPEED);
assert.ok(PHANTOM_SOULREND_SPEED > PHANTOM_DIRE_BALL_SPEED);

assert.equal(loadStoredLoadout().phantomPrimarySkill, 'dire_ball');
assert.equal(loadStoredLoadout().phantomSecondarySkill, 'void_ray');
assert.equal(loadStoredLoadout().phantomUltimateSkill, 'phantom_veil');
assert.equal(loadStoredLoadout().blazePrimarySkill, 'fireball_rockets');
assert.equal(loadStoredLoadout().blazeSecondarySkill, 'meteor_strike');
assert.equal(loadStoredLoadout().blazeUltimateSkill, 'infernal_gearstorm');
assert.deepEqual(loadStoredLoadout().heroAbilityBindings, {});

localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({
  phantomPrimarySkill: 'soulrend_daggers',
  phantomSecondarySkill: 'rift_bolt',
  phantomUltimateSkill: 'nightreign',
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'phosphor_flare',
  blazeUltimateSkill: 'phoenix_dive',
  heroAbilityBindings: {
    phantom: {
      ability1: 'phantom_personal_shield',
      ability2: 'phantom_blink',
    },
  },
}));
const storedLoadout = loadStoredLoadout();
assert.equal(storedLoadout.phantomPrimarySkill, 'soulrend_daggers');
assert.equal(storedLoadout.phantomSecondarySkill, 'rift_bolt');
assert.equal(storedLoadout.phantomUltimateSkill, 'nightreign');
assert.equal(storedLoadout.blazePrimarySkill, 'scrapshot');
assert.equal(storedLoadout.blazeSecondarySkill, 'phosphor_flare');
assert.equal(storedLoadout.blazeUltimateSkill, 'phoenix_dive');
assert.deepEqual(storedLoadout.heroAbilityBindings.phantom, {
  ability1: 'phantom_personal_shield',
  ability2: 'phantom_blink',
});

localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({
  phantomPrimarySkill: 'invalid',
  phantomSecondarySkill: 'invalid',
  phantomUltimateSkill: 'invalid',
  blazePrimarySkill: 'invalid',
  blazeSecondarySkill: 'invalid',
  blazeUltimateSkill: 'invalid',
  heroAbilityBindings: {
    phantom: { ability1: 'invalid', ability2: 'phantom_blink' },
  },
}));
const invalidLoadout = loadStoredLoadout();
assert.equal(invalidLoadout.phantomPrimarySkill, 'dire_ball');
assert.equal(invalidLoadout.phantomSecondarySkill, 'void_ray');
assert.equal(invalidLoadout.phantomUltimateSkill, 'phantom_veil');
assert.equal(invalidLoadout.blazePrimarySkill, 'fireball_rockets');
assert.equal(invalidLoadout.blazeSecondarySkill, 'meteor_strike');
assert.equal(invalidLoadout.blazeUltimateSkill, 'infernal_gearstorm');
assert.deepEqual(invalidLoadout.heroAbilityBindings, {});

useLoadoutStore.getState().setPhantomPrimarySkill('soulrend_daggers');
assert.equal(useLoadoutStore.getState().phantomPrimarySkill, 'soulrend_daggers');

useLoadoutStore.getState().setPhantomSecondarySkill('rift_bolt');
assert.equal(useLoadoutStore.getState().phantomSecondarySkill, 'rift_bolt');

useLoadoutStore.getState().setPhantomUltimateSkill('nightreign');
assert.equal(useLoadoutStore.getState().phantomUltimateSkill, 'nightreign');

useLoadoutStore.getState().setBlazePrimarySkill('scrapshot');
assert.equal(useLoadoutStore.getState().blazePrimarySkill, 'scrapshot');
assert.deepEqual(JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}'), {
  phantomPrimarySkill: 'soulrend_daggers',
  phantomSecondarySkill: 'rift_bolt',
  phantomUltimateSkill: 'nightreign',
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'meteor_strike',
  blazeUltimateSkill: 'infernal_gearstorm',
  heroAbilityBindings: {},
});

useLoadoutStore.getState().setBlazeSecondarySkill('phosphor_flare');
assert.equal(useLoadoutStore.getState().blazeSecondarySkill, 'phosphor_flare');
assert.deepEqual(JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}'), {
  phantomPrimarySkill: 'soulrend_daggers',
  phantomSecondarySkill: 'rift_bolt',
  phantomUltimateSkill: 'nightreign',
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'phosphor_flare',
  blazeUltimateSkill: 'infernal_gearstorm',
  heroAbilityBindings: {},
});

useLoadoutStore.getState().setBlazeUltimateSkill('phoenix_dive');
assert.equal(useLoadoutStore.getState().blazeUltimateSkill, 'phoenix_dive');
assert.deepEqual(JSON.parse(localStorage.getItem(LOADOUT_STORAGE_KEY) ?? '{}'), {
  phantomPrimarySkill: 'soulrend_daggers',
  phantomSecondarySkill: 'rift_bolt',
  phantomUltimateSkill: 'nightreign',
  blazePrimarySkill: 'scrapshot',
  blazeSecondarySkill: 'phosphor_flare',
  blazeUltimateSkill: 'phoenix_dive',
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

useLoadoutStore.getState().assignHeroAbility('blaze', 'ability1', 'blaze_afterburner');
const blazeBindings = resolveHeroAbilityBindings(
  'blaze',
  useLoadoutStore.getState().heroAbilityBindings,
);
assert.deepEqual(blazeBindings, {
  ability1: 'blaze_afterburner',
  ability2: 'blaze_rocketjump',
});
assert.equal(
  applyHeroAbilityBindings(physicalEInput, 'blaze', useLoadoutStore.getState().heroAbilityBindings),
  physicalEInput,
  'Afterburner loadouts keep physical E/Q slots for server-side ability resolution',
);

const {
  BLAZE_AFTERBURNER_OPTION_ID,
  BLAZE_PHOSPHOR_FLARE_OPTION_ID,
  BLAZE_SCRAPSHOT_OPTION_ID,
  BLAZE_PHOENIX_DIVE_OPTION_ID,
  PHANTOM_RIFT_BOLT_OPTION_ID,
  PHANTOM_SOULREND_OPTION_ID,
  PHANTOM_UMBRAL_DECOY_OPTION_ID,
  PHANTOM_NIGHTREIGN_OPTION_ID,
  HERO_LOADOUT_POOL,
} = await import('../components/ui/loadoutPool');
for (const heroId of ['phantom', 'blaze'] as const) {
  const loadoutOptions = Object.values(HERO_LOADOUT_POOL[heroId]).flat();
  const previewVideos = loadoutOptions.flatMap((option) => (
    option.previewVideo ? [option.previewVideo] : []
  ));
  assert.equal(loadoutOptions.length, 9);
  assert.equal(previewVideos.length, 9);
  assert.equal(new Set(previewVideos.map((preview) => preview.videoSrc)).size, 9);
  assert.ok(previewVideos.every((preview) => preview.videoSrc.startsWith(`/videos/${heroId}/`)));
  assert.ok(previewVideos.every((preview) => preview.posterSrc.startsWith(`/videos/${heroId}/posters/`)));
}
const scrapshotOption = HERO_LOADOUT_POOL.blaze.primaryFire.find((option) => (
  option.id === BLAZE_SCRAPSHOT_OPTION_ID
));
assert.equal(scrapshotOption?.ownership, 'owned');
const soulrendOption = HERO_LOADOUT_POOL.phantom.primaryFire.find((option) => (
  option.id === PHANTOM_SOULREND_OPTION_ID
));
assert.equal(soulrendOption?.ownership, 'owned');
assert.ok(soulrendOption?.meta?.includes('10 ammo'));
const riftBoltOption = HERO_LOADOUT_POOL.phantom.secondaryFire.find((option) => (
  option.id === PHANTOM_RIFT_BOLT_OPTION_ID
));
assert.equal(riftBoltOption?.abilityId, 'phantom_rift_bolt');
assert.equal(riftBoltOption?.ownership, 'owned');
assert.ok(riftBoltOption?.meta?.includes('22 dmg'));
const umbralDecoyOption = HERO_LOADOUT_POOL.phantom.ability1.find((option) => (
  option.id === PHANTOM_UMBRAL_DECOY_OPTION_ID
));
assert.equal(umbralDecoyOption?.abilityId, 'phantom_umbral_decoy');
assert.equal(umbralDecoyOption?.ownership, 'owned');
const nightreignOption = HERO_LOADOUT_POOL.phantom.ultimate.find((option) => (
  option.id === PHANTOM_NIGHTREIGN_OPTION_ID
));
assert.equal(nightreignOption?.abilityId, 'phantom_nightreign');
assert.equal(nightreignOption?.ownership, 'owned');
const phosphorFlareOption = HERO_LOADOUT_POOL.blaze.secondaryFire.find((option) => (
  option.id === BLAZE_PHOSPHOR_FLARE_OPTION_ID
));
assert.equal(phosphorFlareOption?.ownership, 'owned');
const afterburnerOption = HERO_LOADOUT_POOL.blaze.ability1.find((option) => (
  option.id === BLAZE_AFTERBURNER_OPTION_ID
));
assert.equal(afterburnerOption?.abilityId, 'blaze_afterburner');
assert.equal(afterburnerOption?.ownership, 'owned');
const phoenixDiveOption = HERO_LOADOUT_POOL.blaze.ultimate.find((option) => (
  option.id === BLAZE_PHOENIX_DIVE_OPTION_ID
));
assert.equal(phoenixDiveOption?.abilityId, 'blaze_phoenix_dive');
assert.equal(phoenixDiveOption?.ownership, 'owned');

const { getHeroSkillItems } = await import('../components/ui/HeroSkillKit');
assert.equal(getHeroSkillItems('blaze', 'scrapshot')[0]?.name, 'Scrapshot');
assert.equal(getHeroSkillItems('blaze', 'fireball_rockets')[0]?.name, 'Fireball Rockets');
assert.equal(
  getHeroSkillItems('blaze', 'fireball_rockets', undefined, 'phosphor_flare')[1]?.name,
  'Phosphor Flare',
);
assert.equal(
  getHeroSkillItems('blaze', 'fireball_rockets', blazeBindings)[2]?.name,
  'Afterburner Dash',
);
assert.equal(
  getHeroSkillItems('blaze', 'fireball_rockets', blazeBindings, 'meteor_strike', 'phoenix_dive')[4]?.name,
  'Phoenix Dive',
);
const phantomSkills = getHeroSkillItems('phantom', 'fireball_rockets', phantomBindings);
assert.equal(phantomSkills.find((skill) => skill.input === 'E')?.abilityId, 'phantom_personal_shield');
assert.equal(phantomSkills.find((skill) => skill.input === 'Q')?.abilityId, 'phantom_blink');
assert.equal(
  getHeroSkillItems(
    'phantom',
    'fireball_rockets',
    phantomBindings,
    'meteor_strike',
    'infernal_gearstorm',
    'dire_ball',
    'void_ray',
    'nightreign',
  ).find((skill) => skill.input === 'F')?.abilityId,
  'phantom_nightreign',
);
useLoadoutStore.getState().assignHeroAbility('phantom', 'ability1', 'phantom_umbral_decoy');
const umbralBindings = resolveRuntimeHeroAbilityBindings(
  'phantom',
  useLoadoutStore.getState().heroAbilityBindings,
);
assert.deepEqual(umbralBindings, {
  ability1: 'phantom_umbral_decoy',
  ability2: 'phantom_blink',
});
assert.equal(
  applyHeroAbilityBindings(physicalEInput, 'phantom', useLoadoutStore.getState().heroAbilityBindings),
  physicalEInput,
  'Umbral Decoy loadouts keep physical E/Q slots for server-side ability resolution',
);
assert.equal(
  getHeroSkillItems('phantom', 'fireball_rockets', umbralBindings)
    .find((skill) => skill.input === 'E')?.name,
  'Umbral Decoy',
);
assert.equal(
  getHeroSkillItems(
    'phantom',
    'fireball_rockets',
    phantomBindings,
    'meteor_strike',
    'infernal_gearstorm',
    'soulrend_daggers',
    'rift_bolt',
  )[0]?.name,
  'Soulrend Daggers',
);
assert.equal(
  getHeroSkillItems(
    'phantom',
    'fireball_rockets',
    phantomBindings,
    'meteor_strike',
    'infernal_gearstorm',
    'soulrend_daggers',
    'rift_bolt',
  )[1]?.name,
  'Rift Bolt',
);

console.log('loadout store tests passed');
