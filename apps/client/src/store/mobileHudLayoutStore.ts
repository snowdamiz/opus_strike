import { create } from 'zustand';
import { loggers } from '../utils/logger';

export interface MobileHudLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MobileHudLayoutElementId =
  | 'mobile-menu'
  | 'mobile-scoreboard'
  | 'mobile-joystick'
  | 'mobile-target-cancel'
  | 'mobile-reload'
  | 'mobile-interact'
  | 'mobile-ability1'
  | 'mobile-ability2'
  | 'mobile-ultimate'
  | 'mobile-jump'
  | 'mobile-crouch'
  | 'mobile-secondary-fire'
  | 'mobile-primary-fire'
  | 'hud-score'
  | 'hud-minimap'
  | 'hud-kill-feed'
  | 'hud-safe-zone'
  | 'hud-interaction-prompt'
  | 'hud-targeting-instruction'
  | 'hud-flag'
  | 'hud-health'
  | 'hud-skill-bar'
  | 'hud-primary-ammo'
  | 'hud-movement-indicators'
  | 'hud-hero-meter'
  | 'hud-voice'
  | 'hud-drop-prompt'
  | 'hud-downed'
  | 'hud-revive-channel'
  | 'hud-soul-channel'
  | 'hud-battle-royal-prompt';

export interface MobileHudLayoutDefinition {
  label: string;
  defaultRect: MobileHudLayoutRect;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  lockAspectRatio?: boolean;
}

type MobileHudLayoutItems = Record<MobileHudLayoutElementId, MobileHudLayoutRect>;

interface MobileHudLayoutState {
  items: MobileHudLayoutItems;
  updateItem: (id: MobileHudLayoutElementId, rect: MobileHudLayoutRect) => void;
  resetLayout: () => void;
}

export const MOBILE_HUD_LAYOUT_STORAGE_KEY = 'voxel-strike-mobile-hud-layout';

const squareButton = {
  minWidth: 4.5,
  minHeight: 9,
  maxWidth: 18,
  maxHeight: 34,
  lockAspectRatio: true,
} satisfies Omit<MobileHudLayoutDefinition, 'label' | 'defaultRect'>;

export const MOBILE_HUD_LAYOUT_DEFINITIONS: Record<MobileHudLayoutElementId, MobileHudLayoutDefinition> = {
  'mobile-menu': {
    label: 'Menu',
    defaultRect: { x: 1.4, y: 2.4, width: 7.1, height: 9.5 },
    minWidth: 6,
    minHeight: 8,
    maxWidth: 20,
    maxHeight: 18,
  },
  'mobile-scoreboard': {
    label: 'Board',
    defaultRect: { x: 9.2, y: 2.4, width: 8.4, height: 9.5 },
    minWidth: 6,
    minHeight: 8,
    maxWidth: 22,
    maxHeight: 18,
  },
  'mobile-joystick': {
    label: 'Move stick',
    defaultRect: { x: 1.4, y: 70.5, width: 12.2, height: 26.3 },
    minWidth: 5.2,
    minHeight: 11.2,
    maxWidth: 28,
    maxHeight: 48,
    lockAspectRatio: true,
  },
  'mobile-target-cancel': {
    label: 'Cancel target',
    defaultRect: { x: 44, y: 62, width: 12.5, height: 9.5 },
    minWidth: 8,
    minHeight: 8,
    maxWidth: 28,
    maxHeight: 18,
  },
  'mobile-reload': {
    label: 'Reload',
    defaultRect: { x: 16.2, y: 80.6, width: 5.8, height: 12.5 },
    ...squareButton,
  },
  'mobile-interact': {
    label: 'Interact',
    defaultRect: { x: 22.8, y: 80.6, width: 5.8, height: 12.5 },
    ...squareButton,
  },
  'mobile-ability1': {
    label: 'Ability 1',
    defaultRect: { x: 74.4, y: 49.6, width: 5.8, height: 12.5 },
    ...squareButton,
  },
  'mobile-ability2': {
    label: 'Ability 2',
    defaultRect: { x: 81.2, y: 49.6, width: 5.8, height: 12.5 },
    ...squareButton,
  },
  'mobile-ultimate': {
    label: 'Ultimate',
    defaultRect: { x: 88, y: 49.6, width: 5.8, height: 12.5 },
    ...squareButton,
  },
  'mobile-jump': {
    label: 'Jump',
    defaultRect: { x: 74.2, y: 70.8, width: 6.4, height: 13.8 },
    ...squareButton,
  },
  'mobile-crouch': {
    label: 'Slide',
    defaultRect: { x: 74.2, y: 85.2, width: 6.4, height: 13.8 },
    ...squareButton,
  },
  'mobile-secondary-fire': {
    label: 'Alt fire',
    defaultRect: { x: 81.4, y: 69.6, width: 7, height: 15.1 },
    ...squareButton,
  },
  'mobile-primary-fire': {
    label: 'Fire',
    defaultRect: { x: 89.3, y: 76.4, width: 8.7, height: 18.8 },
    minWidth: 5.5,
    minHeight: 11,
    maxWidth: 22,
    maxHeight: 40,
    lockAspectRatio: true,
  },
  'hud-score': {
    label: 'Score',
    defaultRect: { x: 36, y: 1.2, width: 28, height: 13 },
    minWidth: 20,
    minHeight: 9,
    maxWidth: 58,
    maxHeight: 24,
  },
  'hud-minimap': {
    label: 'Minimap',
    defaultRect: { x: 1.6, y: 14, width: 11.6, height: 25 },
    minWidth: 8,
    minHeight: 16,
    maxWidth: 30,
    maxHeight: 56,
    lockAspectRatio: true,
  },
  'hud-kill-feed': {
    label: 'Kill feed',
    defaultRect: { x: 75, y: 13.6, width: 23, height: 25 },
    minWidth: 14,
    minHeight: 10,
    maxWidth: 40,
    maxHeight: 54,
  },
  'hud-safe-zone': {
    label: 'Safe zone',
    defaultRect: { x: 42, y: 14, width: 16, height: 10 },
    minWidth: 12,
    minHeight: 8,
    maxWidth: 30,
    maxHeight: 18,
  },
  'hud-interaction-prompt': {
    label: 'Interaction prompt',
    defaultRect: { x: 39, y: 52, width: 22, height: 12 },
    minWidth: 14,
    minHeight: 8,
    maxWidth: 44,
    maxHeight: 22,
  },
  'hud-targeting-instruction': {
    label: 'Targeting prompt',
    defaultRect: { x: 36, y: 26, width: 28, height: 15 },
    minWidth: 18,
    minHeight: 10,
    maxWidth: 52,
    maxHeight: 26,
  },
  'hud-flag': {
    label: 'Flag',
    defaultRect: { x: 46, y: 16, width: 8, height: 16 },
    minWidth: 5,
    minHeight: 10,
    maxWidth: 18,
    maxHeight: 34,
    lockAspectRatio: true,
  },
  'hud-health': {
    label: 'Health',
    defaultRect: { x: 1.4, y: 45, width: 18, height: 8 },
    minWidth: 12,
    minHeight: 6,
    maxWidth: 36,
    maxHeight: 16,
  },
  'hud-skill-bar': {
    label: 'Skill bar',
    defaultRect: { x: 34, y: 82.5, width: 32, height: 15 },
    minWidth: 22,
    minHeight: 10,
    maxWidth: 58,
    maxHeight: 28,
  },
  'hud-primary-ammo': {
    label: 'Ammo',
    defaultRect: { x: 80, y: 18, width: 18, height: 17 },
    minWidth: 12,
    minHeight: 10,
    maxWidth: 38,
    maxHeight: 32,
  },
  'hud-movement-indicators': {
    label: 'Movement',
    defaultRect: { x: 80, y: 37, width: 18, height: 22 },
    minWidth: 12,
    minHeight: 10,
    maxWidth: 38,
    maxHeight: 40,
  },
  'hud-hero-meter': {
    label: 'Hero meter',
    defaultRect: { x: 79, y: 61, width: 19, height: 12 },
    minWidth: 12,
    minHeight: 8,
    maxWidth: 38,
    maxHeight: 24,
  },
  'hud-voice': {
    label: 'Voice',
    defaultRect: { x: 1.4, y: 38, width: 22, height: 22 },
    minWidth: 14,
    minHeight: 10,
    maxWidth: 40,
    maxHeight: 42,
  },
  'hud-drop-prompt': {
    label: 'Drop prompt',
    defaultRect: { x: 27, y: 55, width: 46, height: 20 },
    minWidth: 28,
    minHeight: 12,
    maxWidth: 74,
    maxHeight: 34,
  },
  'hud-downed': {
    label: 'Downed',
    defaultRect: { x: 30, y: 54, width: 40, height: 20 },
    minWidth: 24,
    minHeight: 12,
    maxWidth: 66,
    maxHeight: 34,
  },
  'hud-revive-channel': {
    label: 'Revive channel',
    defaultRect: { x: 34, y: 55, width: 32, height: 18 },
    minWidth: 22,
    minHeight: 12,
    maxWidth: 54,
    maxHeight: 30,
  },
  'hud-soul-channel': {
    label: 'Soul channel',
    defaultRect: { x: 34, y: 55, width: 32, height: 18 },
    minWidth: 22,
    minHeight: 12,
    maxWidth: 54,
    maxHeight: 30,
  },
  'hud-battle-royal-prompt': {
    label: 'BR prompt',
    defaultRect: { x: 35, y: 55, width: 30, height: 13 },
    minWidth: 20,
    minHeight: 9,
    maxWidth: 50,
    maxHeight: 24,
  },
};

const mobileHudLayoutElementIds = Object.keys(MOBILE_HUD_LAYOUT_DEFINITIONS) as MobileHudLayoutElementId[];

function cloneDefaultLayout(): MobileHudLayoutItems {
  return mobileHudLayoutElementIds.reduce((items, id) => {
    items[id] = { ...MOBILE_HUD_LAYOUT_DEFINITIONS[id].defaultRect };
    return items;
  }, {} as MobileHudLayoutItems);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampMobileHudLayoutRect(
  id: MobileHudLayoutElementId,
  rect: MobileHudLayoutRect
): MobileHudLayoutRect {
  const definition = MOBILE_HUD_LAYOUT_DEFINITIONS[id];
  let width = Math.min(definition.maxWidth, Math.max(definition.minWidth, readNumber(rect.width, definition.defaultRect.width)));
  let height = Math.min(definition.maxHeight, Math.max(definition.minHeight, readNumber(rect.height, definition.defaultRect.height)));

  if (definition.lockAspectRatio) {
    const defaultWidth = Math.max(1, definition.defaultRect.width);
    const defaultHeight = Math.max(1, definition.defaultRect.height);
    const requestedScale = Math.min(width / defaultWidth, height / defaultHeight);
    const minScale = Math.max(definition.minWidth / defaultWidth, definition.minHeight / defaultHeight);
    const maxScale = Math.min(definition.maxWidth / defaultWidth, definition.maxHeight / defaultHeight);
    const scale = Math.min(maxScale, Math.max(minScale, requestedScale));

    width = defaultWidth * scale;
    height = defaultHeight * scale;
  }

  const maxX = Math.max(0, 100 - width);
  const maxY = Math.max(0, 100 - height);

  return {
    x: Math.min(maxX, Math.max(0, readNumber(rect.x, definition.defaultRect.x))),
    y: Math.min(maxY, Math.max(0, readNumber(rect.y, definition.defaultRect.y))),
    width,
    height,
  };
}

function sanitizeLayout(value: unknown): MobileHudLayoutItems {
  const raw = typeof value === 'object' && value !== null
    ? value as Partial<Record<MobileHudLayoutElementId, Partial<MobileHudLayoutRect>>>
    : {};
  const defaults = cloneDefaultLayout();

  for (const id of mobileHudLayoutElementIds) {
    const rawRect = raw[id];
    defaults[id] = clampMobileHudLayoutRect(id, {
      x: readNumber(rawRect?.x, defaults[id].x),
      y: readNumber(rawRect?.y, defaults[id].y),
      width: readNumber(rawRect?.width, defaults[id].width),
      height: readNumber(rawRect?.height, defaults[id].height),
    });
  }

  return defaults;
}

function loadLayout(): MobileHudLayoutItems {
  if (typeof window === 'undefined') return cloneDefaultLayout();

  try {
    const saved = window.localStorage.getItem(MOBILE_HUD_LAYOUT_STORAGE_KEY);
    return saved ? sanitizeLayout(JSON.parse(saved)) : cloneDefaultLayout();
  } catch (error) {
    loggers.room.warn('failed to load mobile HUD layout', error);
    return cloneDefaultLayout();
  }
}

function persistLayout(items: MobileHudLayoutItems): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MOBILE_HUD_LAYOUT_STORAGE_KEY, JSON.stringify(items));
}

export const useMobileHudLayoutStore = create<MobileHudLayoutState>((set) => ({
  items: loadLayout(),
  updateItem: (id, rect) => set((state) => {
    const nextItems = {
      ...state.items,
      [id]: clampMobileHudLayoutRect(id, rect),
    };
    persistLayout(nextItems);
    return { items: nextItems };
  }),
  resetLayout: () => {
    const nextItems = cloneDefaultLayout();
    persistLayout(nextItems);
    set({ items: nextItems });
  },
}));

export function resetMobileHudLayout(): void {
  useMobileHudLayoutStore.getState().resetLayout();
}
