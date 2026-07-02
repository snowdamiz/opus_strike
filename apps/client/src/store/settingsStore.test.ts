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
  streamerModeEnabled: true,
}));

const loadedSettings = loadSettings();
assert.equal(loadedSettings.masterVolume, 37);
assert.equal(loadedSettings.streamerModeEnabled, false);

useSettingsStore.getState().applySettings({
  ...defaultSettings,
  masterVolume: 42,
  streamerModeEnabled: true,
});

assert.equal(useSettingsStore.getState().settings.masterVolume, 42);
assert.equal(useSettingsStore.getState().settings.streamerModeEnabled, true);

const persistedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
assert.equal(persistedSettings.masterVolume, 42);
assert.equal(persistedSettings.streamerModeEnabled, false);

console.log('settings store tests passed');
