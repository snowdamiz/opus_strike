import assert from 'node:assert/strict';

const storage = new Map<string, string>();
const localStorage = {
  get length() {
    return storage.size;
  },
  clear: () => {
    storage.clear();
  },
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

(globalThis as any).window = { localStorage };

const {
  SETTINGS_STORAGE_KEY,
  defaultSettings,
  loadSettings,
  useSettingsStore,
} = await import('./settingsStore');

localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
  ...defaultSettings,
  masterVolume: 37,
  mobileHudLayoutEditing: true,
  streamerModeEnabled: true,
  streamerFeedMode: 'bot_deathmatch',
}));

const loadedSettings = loadSettings();
assert.equal(loadedSettings.masterVolume, 37);
assert.equal(loadedSettings.mobileHudLayoutEditing, false);
assert.equal(loadedSettings.streamerModeEnabled, false);
assert.equal(loadedSettings.streamerFeedMode, 'bot_deathmatch');

localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
  ...defaultSettings,
  keybindings: {
    moveForward: 'KeyW',
    moveBackward: 'KeyS',
    moveLeft: 'KeyA',
    moveRight: 'KeyD',
    jump: 'Space',
    crouch: 'KeyC',
    sprint: 'ShiftLeft',
    primaryFire: 'Mouse0',
    secondaryFire: 'Mouse1',
    reload: 'KeyR',
    ability1: 'KeyE',
    ability2: 'KeyQ',
    ultimate: 'KeyF',
    interact: 'KeyX',
    scoreboard: 'Tab',
    pushToTalk: 'KeyZ',
    ping: 'Mouse2',
  },
}));

const migratedVoiceKeySettings = loadSettings();
assert.equal(migratedVoiceKeySettings.keybindings.teamPushToTalk, 'KeyZ');
assert.equal(migratedVoiceKeySettings.keybindings.proximityPushToTalk, 'KeyB');
assert.equal('pushToTalk' in migratedVoiceKeySettings.keybindings, false);

useSettingsStore.getState().applySettings({
  ...defaultSettings,
  masterVolume: 42,
  mobileHudLayoutEditing: true,
  streamerModeEnabled: true,
  streamerFeedMode: 'bot_deathmatch',
});

assert.equal(useSettingsStore.getState().settings.masterVolume, 42);
assert.equal(useSettingsStore.getState().settings.mobileHudLayoutEditing, true);
assert.equal(useSettingsStore.getState().settings.streamerModeEnabled, true);
assert.equal(useSettingsStore.getState().settings.streamerFeedMode, 'bot_deathmatch');

const persistedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
assert.equal(persistedSettings.masterVolume, 42);
assert.equal(persistedSettings.mobileHudLayoutEditing, false);
assert.equal(persistedSettings.streamerModeEnabled, false);
assert.equal(persistedSettings.streamerFeedMode, 'bot_deathmatch');

console.log('settings store tests passed');
