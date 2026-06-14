import { useRef, useCallback, useEffect } from 'react';
import { loadSettings, type ClientSettings } from '../store/settingsStore';

interface AudioConfig {
  masterVolume: number;  // 0-100
  sfxVolume: number;     // 0-100
  musicVolume: number;   // 0-100
  muted: boolean;
}

interface SoundEffect {
  buffer: AudioBuffer | null;
  volume: number;
  playbackDurationRatio?: number;
}

interface SoundDefinition {
  path: string;
  volume: number;
  playbackDurationRatio?: number;
}

export interface PlaySoundOptions {
  volume?: number;
  pitch?: number;
  position?: { x: number; y: number; z: number };
  startOffsetMs?: number;
  durationMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  signal?: AbortSignal;
}

export interface SoundPlayback {
  stop: () => void;
}

const DEFAULT_CONFIG: AudioConfig = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  muted: false,
};

// Load settings from localStorage
function loadAudioSettings(settings: Partial<ClientSettings> = loadSettings()): AudioConfig {
  try {
    return {
      masterVolume: settings.masterVolume ?? DEFAULT_CONFIG.masterVolume,
      sfxVolume: settings.sfxVolume ?? DEFAULT_CONFIG.sfxVolume,
      musicVolume: settings.musicVolume ?? DEFAULT_CONFIG.musicVolume,
      muted: false,
    };
  } catch (e) {
    console.warn('[Audio] Failed to load settings:', e);
  }
  return { ...DEFAULT_CONFIG };
}

// SINGLETON: Shared audio state across all hook instances
let sharedAudioContext: AudioContext | null = null;
const sharedConfig: AudioConfig = loadAudioSettings();
const sharedSounds = new Map<string, SoundEffect>();
const sharedSoundLoads = new Map<string, Promise<SoundEffect | null>>();
const sharedLoops = new Map<string, {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  isMusic: boolean;
  baseVolume: number;
  stopping?: boolean;
  stopTimeout?: number;
}>();
const sharedPendingLoops = new Map<string, { cancelled: boolean }>();

const DEFAULT_AUDIO_UP = { x: 0, y: 1, z: 0 };
const AUDIO_LISTENER_POSITION_EPSILON_SQ = 0.000001;
const AUDIO_LISTENER_DIRECTION_EPSILON_SQ = 0.00000001;
let lastAudioListenerContext: AudioContext | null = null;
let hasLastAudioListenerPosition = false;
let hasLastAudioListenerOrientation = false;
let lastAudioListenerPositionX = 0;
let lastAudioListenerPositionY = 0;
let lastAudioListenerPositionZ = 0;
let lastAudioListenerForwardX = 0;
let lastAudioListenerForwardY = 0;
let lastAudioListenerForwardZ = -1;
let lastAudioListenerUpX = 0;
let lastAudioListenerUpY = 1;
let lastAudioListenerUpZ = 0;

let hasAudioUserActivation =
  typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;
let audioUnlockListenersInstalled = false;

function hasUserActivatedAudio(): boolean {
  if (hasAudioUserActivation) return true;

  const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
  if (activation?.isActive || activation?.hasBeenActive) {
    hasAudioUserActivation = true;
    return true;
  }

  return false;
}

function markAudioUserActivation(): void {
  hasAudioUserActivation = true;

  if (sharedAudioContext?.state === 'suspended') {
    void sharedAudioContext.resume().catch(() => undefined);
  }
  void flushPendingAudioPreloads();
}

function installAudioUnlockListeners(): void {
  if (audioUnlockListenersInstalled || typeof document === 'undefined') return;
  audioUnlockListenersInstalled = true;

  const handleInteraction = () => {
    markAudioUserActivation();
    document.removeEventListener('pointerdown', handleInteraction, true);
    document.removeEventListener('touchstart', handleInteraction, true);
    document.removeEventListener('keydown', handleInteraction, true);
  };

  document.addEventListener('pointerdown', handleInteraction, true);
  document.addEventListener('touchstart', handleInteraction, true);
  document.addEventListener('keydown', handleInteraction, true);
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;

  return window.AudioContext || (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
}

// Calculate effective volume for SFX
function getSfxVolume(): number {
  return (sharedConfig.masterVolume / 100) * (sharedConfig.sfxVolume / 100);
}

// Calculate effective volume for music
function getMusicVolume(): number {
  return (sharedConfig.masterVolume / 100) * (sharedConfig.musicVolume / 100);
}

// Sound effect definitions
const SOUND_EFFECTS = {
  // Movement
  footstep: { path: '/sounds/footstep.mp3', volume: 0.3 },
  walk: { path: '/sounds/walk.mp3', volume: 1.04 },
  jump: { path: '/sounds/jump.mp3', volume: 0.5 },
  land: { path: '/sounds/land.mp3', volume: 0.4 },
  slide: { path: '/sounds/slide.mp3', volume: 0.32 },
  wallRun: { path: '/sounds/wall_run.mp3', volume: 0.4 },
  
  // Abilities - Generic
  blink: { path: '/sounds/blink.mp3', volume: 0.6 },
  grapple: { path: '/sounds/grapple.mp3', volume: 0.5 },
  jetpack: { path: '/sounds/jetpack.mp3', volume: 0.4 },
  
  // Phantom Abilities (using shortened clips)
  phantomBlink: { path: '/sounds/blink_short.mp3', volume: 0.39 },
  phantomVeil: { path: '/sounds/phantom_veil.mp3', volume: 0.2 },
  phantomBasic: { path: '/sounds/phantom_basic.mp3', volume: 0.1872 },
  phantomReload: { path: '/sounds/phantom_reload.mp3', volume: 0.27 },
  phantomShield: { path: '/sounds/phantom_shield.mp3', volume: 0.336 },
  phantomShieldCast: { path: '/sounds/phantom_shield_cast.mp3', volume: 0.464 },
  phantomVoidRay: { path: '/sounds/phantom_strong.mp3', volume: 0.6 },
  phantomVoidRayCharge: { path: '/sounds/phantom_right_click_charge.mp3', volume: 0.45 },
  
  // Blaze Abilities (using existing sounds as fallbacks)
  blazeRocket: { path: '/sounds/rocket_fire.mp3', volume: 0.4 },
  blazeBombTarget: { path: '/sounds/button.mp3', volume: 0.75 },
  blazeBombRelease: { path: '/sounds/blaze_RMB_release.mp3', volume: 0.7 },
  blazeBombFall: { path: '/sounds/bomb_fall.mp3', volume: 0.8 },
  blazeBombExplode: { path: '/sounds/bomb_explode.mp3', volume: 1.862 },
  blazeFlamethrower: { path: '/sounds/jetpack.mp3', volume: 0.3 },
  blazeRocketJump: { path: '/sounds/rocket_jump.mp3', volume: 0.6 },
  blazeAirstrikeFire: { path: '/sounds/blaze_F_fire.mp3', volume: 0.5 },
  blazeAirstrikeGears: { path: '/sounds/blaze_F_gears.mp3', volume: 0.46 },

  // Hookshot Abilities
  hookshotShot: { path: '/sounds/hookshot_shot.mp3', volume: 0.58 },
  hookshotPrimary: { path: '/sounds/hookshot_lmb.mp3', volume: 0.48 },
  hookshotSecondary: { path: '/sounds/hookshot_rmb.mp3', volume: 0.58 },
  hookshotGrapple: { path: '/sounds/hookshot_lmb.mp3', volume: 0.5 },
  hookshotAnchorWall: { path: '/sounds/hookshot_q.mp3', volume: 0.6 },
  hookshotTrap: { path: '/sounds/hookshot_hero_strike.mp3', volume: 0.58 },
  hookshotRetract: { path: '/sounds/hookshot_retract.mp3', volume: 0.42 },

  // Chronos Abilities
  chronosPulse: { path: '/sounds/chronos_charge.mp3', volume: 0 },
  chronosAegis: { path: '/sounds/chronos_shield.mp3', volume: 0.696 },
  chronosLifeline: { path: '/sounds/choronos_heal.mp3', volume: 0.5 },
  chronosTimebreakCharge: { path: '/sounds/chronos_charge.mp3', volume: 0.72 },
  chronosPush: { path: '/sounds/chronos_push.mp3', volume: 0.72 },
  chronosTimebreak: { path: '/sounds/chronos_charge.mp3', volume: 0 },
  chronosSuperchargedImpact: { path: '/sounds/magic_impact.mp3', volume: 0.72 },
  
  // Combat
  hit: { path: '/sounds/hit.mp3', volume: 0.6 },
  damage: { path: '/sounds/damage.mp3', volume: 0.5 },
  death: { path: '/sounds/death.mp3', volume: 0.6 },
  kill: { path: '/sounds/kill.mp3', volume: 0.7 },
  
  // CTF
  flagPickup: { path: '/sounds/flag_pickup.mp3', volume: 0.8 },
  flagDrop: { path: '/sounds/flag_drop.mp3', volume: 0.6 },
  flagCapture: { path: '/sounds/flag_capture.mp3', volume: 1.0 },
  flagReturn: { path: '/sounds/flag_return.mp3', volume: 0.7 },
  
  // UI
  buttonHover: { path: '/sounds/button.mp3', volume: 0.4 },
  buttonClick: { path: '/sounds/button.mp3', volume: 0.1, playbackDurationRatio: 0.15 },
  countdownTick: { path: '/sounds/tick.mp3', volume: 0.65 },
  countdown: { path: '/sounds/countdown.mp3', volume: 0.6 },
  matchStart: { path: '/sounds/match_start.mp3', volume: 0.8 },
  roundEnd: { path: '/sounds/round_end.mp3', volume: 0.8 },
  victory: { path: '/sounds/victory.mp3', volume: 0.9 },
  defeat: { path: '/sounds/defeat.mp3', volume: 0.7 },
  
  // Music (equal base volume, controlled by settings)
  lobbyMusic: { path: '/sounds/lobby.mp3', volume: 0.3 },
  gameMusic: { path: '/sounds/game.mp3', volume: 0.3 },
} as const satisfies Record<string, SoundDefinition>;

export type SoundName = keyof typeof SOUND_EFFECTS;
export type SoundGroup = 'menu' | 'lobby' | 'commonCombat' | 'phantom' | 'blaze' | 'hookshot' | 'chronos';

export const CHRONOS_VERDANT_PULSE_SHOT_PITCH = 1.28;
export const CHRONOS_VERDANT_PULSE_SHOT_VOLUME = 0.72;
export const BLAZE_BOMB_RELEASE_SOUND_START_OFFSET_MS = 260;
export const BLAZE_BOMB_RELEASE_SOUND_DURATION_MS = 1100;
export const BLAZE_BOMB_RELEASE_SOUND_FADE_OUT_MS = 80;
export const BLAZE_AIRSTRIKE_SOUND_DURATION_MS = 5200;
export const BLAZE_AIRSTRIKE_SOUND_FADE_IN_MS = 120;
export const BLAZE_AIRSTRIKE_SOUND_FADE_OUT_MS = 360;

const SOUND_GROUPS: Record<SoundGroup, SoundName[]> = {
  menu: ['buttonHover', 'buttonClick'],
  lobby: ['buttonHover', 'buttonClick'],
  commonCombat: ['walk', 'slide', 'jetpack', 'countdownTick'],
  phantom: ['phantomBlink', 'phantomVeil', 'phantomBasic', 'phantomReload', 'phantomShield', 'phantomShieldCast', 'phantomVoidRay', 'phantomVoidRayCharge'],
  blaze: ['blazeRocket', 'blazeBombTarget', 'blazeBombRelease', 'blazeBombFall', 'blazeBombExplode', 'blazeFlamethrower', 'blazeRocketJump', 'blazeAirstrikeFire', 'blazeAirstrikeGears'],
  hookshot: ['hookshotShot', 'hookshotPrimary', 'hookshotSecondary', 'hookshotGrapple', 'hookshotAnchorWall', 'hookshotTrap', 'hookshotRetract'],
  chronos: ['phantomBasic', 'chronosAegis', 'chronosLifeline', 'chronosTimebreakCharge', 'chronosPush', 'chronosSuperchargedImpact'],
};

const pendingAudioPreloadNames = new Set<SoundName>();
let pendingAudioPreloadFlush: Promise<void> | null = null;
const BLAZE_AIRSTRIKE_SOUND_LAYERS = ['blazeAirstrikeFire', 'blazeAirstrikeGears'] as const satisfies readonly SoundName[];
const MUSIC_SOUND_NAMES = new Set<SoundName>(['lobbyMusic', 'gameMusic']);
const MAX_CONCURRENT_AUDIO_DECODES = 2;
const SHARED_SOUND_LAYER_START_DELAY_MS = 20;
const GLOBAL_BUTTON_SOUND_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="reset"]',
  'input[type="submit"]',
].join(',');

let activeAudioDecodes = 0;
const queuedAudioDecodeJobs: Array<() => void> = [];

const sharedStreamedLoops = new Map<string, {
  audio: HTMLAudioElement;
  name: SoundName;
  baseVolume: number;
  isMusic: true;
  stopping?: boolean;
  fadeRaf?: number;
  stopTimeout?: number;
}>();

function pumpAudioDecodeQueue(): void {
  while (activeAudioDecodes < MAX_CONCURRENT_AUDIO_DECODES) {
    const next = queuedAudioDecodeJobs.shift();
    if (!next) return;
    activeAudioDecodes++;
    next();
  }
}

function decodeAudioDataLimited(ctx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    queuedAudioDecodeJobs.push(() => {
      ctx.decodeAudioData(arrayBuffer)
        .then(resolve, reject)
        .finally(() => {
          activeAudioDecodes = Math.max(0, activeAudioDecodes - 1);
          pumpAudioDecodeQueue();
        });
    });
    pumpAudioDecodeQueue();
  });
}

function clampAudioVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPlaybackDurationMs(sound: SoundEffect, options?: PlaySoundOptions): number | undefined {
  const explicitDurationMs = options?.durationMs === undefined
    ? undefined
    : Math.max(0, options.durationMs);
  const ratio = sound.playbackDurationRatio;

  if (ratio === undefined || !sound.buffer) {
    return explicitDurationMs;
  }

  const ratioDurationMs = sound.buffer.duration * 1000 * Math.max(0, Math.min(1, ratio));
  return explicitDurationMs === undefined
    ? ratioDurationMs
    : Math.min(explicitDurationMs, ratioDurationMs);
}

type LoadedSoundEffect = SoundEffect & { buffer: AudioBuffer };

function hasLoadedSoundBuffer(sound: SoundEffect | null): sound is LoadedSoundEffect {
  return Boolean(sound?.buffer);
}

function getButtonSoundTarget(target: EventTarget | null): Element | null {
  if (typeof Element === 'undefined') return null;
  if (!(target instanceof Element)) return null;

  const button = target.closest(GLOBAL_BUTTON_SOUND_SELECTOR);
  if (!button) return null;

  if (button.hasAttribute('disabled')) return null;
  if (button.getAttribute('aria-disabled') === 'true') return null;

  return button;
}

function ensureSharedAudioContext(): AudioContext | null {
  installAudioUnlockListeners();

  if (!sharedAudioContext) {
    if (!hasUserActivatedAudio()) return null;

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return null;

    sharedAudioContext = new AudioContextConstructor();
  }

  if (sharedAudioContext.state === 'suspended' && hasUserActivatedAudio()) {
    void sharedAudioContext.resume().catch(() => undefined);
  }

  return sharedAudioContext;
}

async function ensureRunningAudioContext(): Promise<AudioContext | null> {
  const audioContext = ensureSharedAudioContext();
  if (!audioContext) return null;

  if (audioContext.state === 'suspended') {
    if (!hasUserActivatedAudio()) return null;

    try {
      await audioContext.resume();
    } catch {
      return null;
    }
  }

  return audioContext.state === 'closed' ? null : audioContext;
}

function setAudioParam(
  param: AudioParam | undefined,
  value: number,
  currentTime: number
): void {
  if (!param) return;
  param.setValueAtTime(value, currentTime);
}

function vectorDistanceSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

function cancelStreamedLoopFade(loop: { fadeRaf?: number; stopTimeout?: number }): void {
  if (loop.fadeRaf !== undefined) {
    window.cancelAnimationFrame(loop.fadeRaf);
    loop.fadeRaf = undefined;
  }
  if (loop.stopTimeout !== undefined) {
    window.clearTimeout(loop.stopTimeout);
    loop.stopTimeout = undefined;
  }
}

function getStreamedLoopTargetVolume(loop: { baseVolume: number; isMusic: boolean }): number {
  return clampAudioVolume(loop.baseVolume * (loop.isMusic ? getMusicVolume() : getSfxVolume()));
}

function finalizeStreamedLoop(id: string, loop: { audio: HTMLAudioElement; fadeRaf?: number; stopTimeout?: number }): void {
  cancelStreamedLoopFade(loop);
  loop.audio.pause();
  try {
    loop.audio.currentTime = 0;
  } catch {
    // Some browsers disallow seeking until media metadata is ready.
  }
  loop.audio.removeAttribute('src');
  loop.audio.load();
  sharedStreamedLoops.delete(id);
}

function fadeStreamedLoop(
  loop: { audio: HTMLAudioElement; fadeRaf?: number },
  targetVolume: number,
  durationMs: number,
  onComplete?: () => void
): void {
  if (durationMs <= 0) {
    loop.audio.volume = clampAudioVolume(targetVolume);
    onComplete?.();
    return;
  }

  if (loop.fadeRaf !== undefined) {
    window.cancelAnimationFrame(loop.fadeRaf);
  }

  const startTime = performance.now();
  const startVolume = loop.audio.volume;
  const safeTarget = clampAudioVolume(targetVolume);

  const tick = () => {
    const progress = Math.min(1, (performance.now() - startTime) / durationMs);
    loop.audio.volume = startVolume + (safeTarget - startVolume) * progress;

    if (progress >= 1) {
      loop.fadeRaf = undefined;
      onComplete?.();
      return;
    }

    loop.fadeRaf = window.requestAnimationFrame(tick);
  };

  loop.fadeRaf = window.requestAnimationFrame(tick);
}

function updateStreamedLoopVolumes(): void {
  for (const [, loop] of sharedStreamedLoops) {
    if (loop.stopping) continue;
    loop.audio.volume = getStreamedLoopTargetVolume(loop);
  }
}

async function playStreamedMusicLoop(
  id: string,
  name: SoundName,
  options: {
    volume?: number;
    fadeInMs?: number;
  },
  pendingLoop: { cancelled: boolean }
): Promise<void> {
  const soundDef = SOUND_EFFECTS[name];
  const audio = new Audio(soundDef.path);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;

  const loop = {
    audio,
    name,
    baseVolume: (options.volume ?? 1) * soundDef.volume,
    isMusic: true as const,
  };
  sharedStreamedLoops.set(id, loop);

  try {
    await audio.play();
  } catch (error) {
    sharedStreamedLoops.delete(id);
    sharedPendingLoops.delete(id);
    console.warn(`[Audio] Failed to stream music: ${name}`, error);
    return;
  }

  if (pendingLoop.cancelled || sharedPendingLoops.get(id) !== pendingLoop) {
    finalizeStreamedLoop(id, loop);
    return;
  }

  sharedPendingLoops.delete(id);
  const targetVolume = getStreamedLoopTargetVolume(loop);
  fadeStreamedLoop(loop, targetVolume, Math.max(0, options.fadeInMs ?? 0));
}

function stopStreamedLoop(id: string, fadeOutMs = 0): void {
  const loop = sharedStreamedLoops.get(id);
  if (!loop) return;
  if (loop.stopping) return;

  if (fadeOutMs > 0) {
    loop.stopping = true;
    fadeStreamedLoop(loop, 0, fadeOutMs, () => finalizeStreamedLoop(id, loop));
    return;
  }

  finalizeStreamedLoop(id, loop);
}

export function setAudioListenerTransform(
  position: { x: number; y: number; z: number },
  forward?: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number } = DEFAULT_AUDIO_UP
): void {
  const ctx = sharedAudioContext;
  if (!ctx) return;

  if (lastAudioListenerContext !== ctx) {
    lastAudioListenerContext = ctx;
    hasLastAudioListenerPosition = false;
    hasLastAudioListenerOrientation = false;
  }

  const listener = ctx.listener as AudioListener & {
    positionX?: AudioParam;
    positionY?: AudioParam;
    positionZ?: AudioParam;
    forwardX?: AudioParam;
    forwardY?: AudioParam;
    forwardZ?: AudioParam;
    upX?: AudioParam;
    upY?: AudioParam;
    upZ?: AudioParam;
    setPosition?: (x: number, y: number, z: number) => void;
    setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
  };

  const positionChanged = !hasLastAudioListenerPosition || vectorDistanceSq(
    position.x,
    position.y,
    position.z,
    lastAudioListenerPositionX,
    lastAudioListenerPositionY,
    lastAudioListenerPositionZ
  ) > AUDIO_LISTENER_POSITION_EPSILON_SQ;

  if (positionChanged) {
    if (listener.positionX && listener.positionY && listener.positionZ) {
      setAudioParam(listener.positionX, position.x, ctx.currentTime);
      setAudioParam(listener.positionY, position.y, ctx.currentTime);
      setAudioParam(listener.positionZ, position.z, ctx.currentTime);
    } else {
      listener.setPosition?.(position.x, position.y, position.z);
    }

    hasLastAudioListenerPosition = true;
    lastAudioListenerPositionX = position.x;
    lastAudioListenerPositionY = position.y;
    lastAudioListenerPositionZ = position.z;
  }

  if (!forward) return;

  const orientationChanged = !hasLastAudioListenerOrientation || (
    vectorDistanceSq(
      forward.x,
      forward.y,
      forward.z,
      lastAudioListenerForwardX,
      lastAudioListenerForwardY,
      lastAudioListenerForwardZ
    ) > AUDIO_LISTENER_DIRECTION_EPSILON_SQ ||
    vectorDistanceSq(
      up.x,
      up.y,
      up.z,
      lastAudioListenerUpX,
      lastAudioListenerUpY,
      lastAudioListenerUpZ
    ) > AUDIO_LISTENER_DIRECTION_EPSILON_SQ
  );

  if (!orientationChanged) return;

  if (
    listener.forwardX &&
    listener.forwardY &&
    listener.forwardZ &&
    listener.upX &&
    listener.upY &&
    listener.upZ
  ) {
    setAudioParam(listener.forwardX, forward.x, ctx.currentTime);
    setAudioParam(listener.forwardY, forward.y, ctx.currentTime);
    setAudioParam(listener.forwardZ, forward.z, ctx.currentTime);
    setAudioParam(listener.upX, up.x, ctx.currentTime);
    setAudioParam(listener.upY, up.y, ctx.currentTime);
    setAudioParam(listener.upZ, up.z, ctx.currentTime);
  } else {
    listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }

  hasLastAudioListenerOrientation = true;
  lastAudioListenerForwardX = forward.x;
  lastAudioListenerForwardY = forward.y;
  lastAudioListenerForwardZ = forward.z;
  lastAudioListenerUpX = up.x;
  lastAudioListenerUpY = up.y;
  lastAudioListenerUpZ = up.z;
}

async function loadSharedSound(name: SoundName): Promise<SoundEffect | null> {
  if (MUSIC_SOUND_NAMES.has(name)) {
    const musicSoundDef: SoundDefinition = SOUND_EFFECTS[name];
    const musicEffect = sharedSounds.get(name) ?? {
      buffer: null,
      volume: musicSoundDef.volume,
      playbackDurationRatio: musicSoundDef.playbackDurationRatio,
    };
    sharedSounds.set(name, musicEffect);
    return musicEffect;
  }

  const ctx = ensureSharedAudioContext();
  if (!ctx) {
    return null;
  }

  const existing = sharedSounds.get(name);
  if (existing?.buffer) return existing;

  const pending = sharedSoundLoads.get(name);
  if (pending) return pending;

  const soundDef: SoundDefinition = SOUND_EFFECTS[name];
  const loadPromise = (async () => {
    try {
      const response = await fetch(soundDef.path);
      if (!response.ok) {
        console.warn(`[Audio] Sound file not found: ${soundDef.path}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = await decodeAudioDataLimited(ctx, arrayBuffer);
      const effect: SoundEffect = {
        buffer,
        volume: soundDef.volume,
        playbackDurationRatio: soundDef.playbackDurationRatio,
      };

      sharedSounds.set(name, effect);
      return effect;
    } catch (error) {
      console.warn(`[Audio] Failed to load sound: ${name}`, error);
      return null;
    } finally {
      sharedSoundLoads.delete(name);
    }
  })();

  sharedSoundLoads.set(name, loadPromise);
  return loadPromise;
}

async function flushPendingAudioPreloads(): Promise<void> {
  if (!hasUserActivatedAudio()) return;
  if (pendingAudioPreloadFlush) return pendingAudioPreloadFlush;

  pendingAudioPreloadFlush = (async () => {
    try {
      while (pendingAudioPreloadNames.size > 0) {
        const names = Array.from(pendingAudioPreloadNames);
        pendingAudioPreloadNames.clear();
        await Promise.all(names.map((name) => loadSharedSound(name)));
      }
    } finally {
      pendingAudioPreloadFlush = null;
    }
  })();

  return pendingAudioPreloadFlush;
}

function startSharedSoundBuffer(
  ctx: AudioContext,
  sound: LoadedSoundEffect,
  options?: PlaySoundOptions,
  startAt = ctx.currentTime
): SoundPlayback {
  const audioCtx = ctx;
  const source = ctx.createBufferSource();
  source.buffer = sound.buffer;

  if (options?.pitch) {
    source.playbackRate.value = options.pitch;
  }

  const gainNode = ctx.createGain();
  const targetGain = (options?.volume ?? 1) * sound.volume * getSfxVolume();
  const fadeInMs = Math.max(0, options?.fadeInMs ?? 0);
  const startTime = Math.max(ctx.currentTime, startAt);
  gainNode.gain.setValueAtTime(fadeInMs > 0 ? 0 : targetGain, startTime);
  if (fadeInMs > 0) {
    gainNode.gain.linearRampToValueAtTime(targetGain, startTime + fadeInMs / 1000);
  }
  source.connect(gainNode);

  if (options?.position) {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 70;
    panner.rolloffFactor = 0.65;
    panner.setPosition(options.position.x, options.position.y, options.position.z);
    gainNode.connect(panner);
    panner.connect(ctx.destination);
  } else {
    gainNode.connect(ctx.destination);
  }

  let stopped = false;
  let durationTimeout: number | null = null;
  let fadeTimeout: number | null = null;

  function cleanup() {
    if (fadeTimeout !== null) {
      window.clearTimeout(fadeTimeout);
      fadeTimeout = null;
    }
    if (durationTimeout !== null) {
      window.clearTimeout(durationTimeout);
      durationTimeout = null;
    }
    options?.signal?.removeEventListener('abort', stop);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cleanup();
    try {
      source.stop();
    } catch {
      // Source may already have ended or been stopped by the scheduled duration.
    }
  }

  function fadeOutAndStop(fadeOutMs: number) {
    if (stopped) return;
    fadeTimeout = null;
    const fadeSeconds = fadeOutMs / 1000;
    const currentTime = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
    gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeSeconds);
    durationTimeout = window.setTimeout(stop, fadeOutMs);
  }

  options?.signal?.addEventListener('abort', stop, { once: true });
  source.onended = () => {
    stopped = true;
    cleanup();
  };

  const startOffsetSeconds = Math.min(
    Math.max(0, (options?.startOffsetMs ?? 0) / 1000),
    Math.max(0, sound.buffer.duration - 0.001)
  );
  source.start(startTime, startOffsetSeconds);
  const playbackDurationMs = getPlaybackDurationMs(sound, options);
  if (playbackDurationMs !== undefined) {
    const durationMs = Math.max(0, playbackDurationMs);
    const fadeOutMs = Math.min(durationMs, Math.max(0, options?.fadeOutMs ?? 0));
    const startDelayMs = Math.max(0, (startTime - audioCtx.currentTime) * 1000);
    if (fadeOutMs > 0) {
      fadeTimeout = window.setTimeout(() => fadeOutAndStop(fadeOutMs), startDelayMs + durationMs - fadeOutMs);
    } else {
      durationTimeout = window.setTimeout(stop, startDelayMs + durationMs);
    }
  }

  return { stop };
}

export async function playSharedSound(
  name: SoundName,
  options?: PlaySoundOptions
): Promise<SoundPlayback | undefined> {
  if (sharedConfig.muted) return;
  if (options?.signal?.aborted) return;

  const ctx = await ensureRunningAudioContext();
  if (!ctx) return;
  if (options?.signal?.aborted) return;

  const sound = await loadSharedSound(name);
  if (options?.signal?.aborted) return;

  if (!hasLoadedSoundBuffer(sound)) {
    console.warn(`[Audio] Cannot play ${name} - no buffer`);
    return;
  }

  return startSharedSoundBuffer(ctx, sound, options);
}

export async function playSharedBlazeAirstrikeSound(
  options?: PlaySoundOptions
): Promise<SoundPlayback | undefined> {
  if (sharedConfig.muted) return;
  if (options?.signal?.aborted) return;

  const ctx = await ensureRunningAudioContext();
  if (!ctx) return;
  if (options?.signal?.aborted) return;

  const layerOptions: PlaySoundOptions = {
    ...options,
    durationMs: options?.durationMs ?? BLAZE_AIRSTRIKE_SOUND_DURATION_MS,
    fadeInMs: options?.fadeInMs ?? BLAZE_AIRSTRIKE_SOUND_FADE_IN_MS,
    fadeOutMs: options?.fadeOutMs ?? BLAZE_AIRSTRIKE_SOUND_FADE_OUT_MS,
  };
  const layers = await Promise.all(BLAZE_AIRSTRIKE_SOUND_LAYERS.map(async (name) => ({
    name,
    sound: await loadSharedSound(name),
  })));
  if (options?.signal?.aborted) return;

  const startAt = ctx.currentTime + SHARED_SOUND_LAYER_START_DELAY_MS / 1000;
  const playbacks: SoundPlayback[] = [];
  for (const { name, sound } of layers) {
    if (!hasLoadedSoundBuffer(sound)) {
      console.warn(`[Audio] Cannot play ${name} - no buffer`);
      continue;
    }
    playbacks.push(startSharedSoundBuffer(ctx, sound, layerOptions, startAt));
  }

  if (playbacks.length === 0) return;

  return {
    stop: () => {
      for (const playback of playbacks) {
        playback.stop();
      }
    },
  };
}

export async function playSharedLoop(
  id: string,
  name: SoundName,
  options: {
    volume?: number;
    position?: { x: number; y: number; z: number };
    fadeInMs?: number;
    isMusic?: boolean;
  } = {}
): Promise<void> {
  if (sharedConfig.muted) return;
  if (sharedLoops.has(id) || sharedStreamedLoops.has(id) || sharedPendingLoops.has(id)) return;

  const pendingLoop = { cancelled: false };
  sharedPendingLoops.set(id, pendingLoop);

  if (options.isMusic || MUSIC_SOUND_NAMES.has(name)) {
    await playStreamedMusicLoop(id, name, {
      volume: options.volume,
      fadeInMs: options.fadeInMs,
    }, pendingLoop);
    return;
  }

  const ctx = await ensureRunningAudioContext();
  if (!ctx) {
    sharedPendingLoops.delete(id);
    return;
  }
  if (pendingLoop.cancelled || sharedPendingLoops.get(id) !== pendingLoop) return;

  const sound = await loadSharedSound(name);
  if (pendingLoop.cancelled || sharedPendingLoops.get(id) !== pendingLoop) return;
  if (!sound?.buffer) {
    sharedPendingLoops.delete(id);
    return;
  }

  const source = ctx.createBufferSource();
  source.buffer = sound.buffer;
  source.loop = true;

  const volumeMultiplier = options.isMusic ? getMusicVolume() : getSfxVolume();
  const baseVolume = (options.volume ?? 1) * sound.volume;
  const gainNode = ctx.createGain();
  const fadeInMs = Math.max(0, options.fadeInMs ?? 0);
  gainNode.gain.value = fadeInMs > 0 ? 0 : baseVolume * volumeMultiplier;
  if (fadeInMs > 0) {
    gainNode.gain.linearRampToValueAtTime(baseVolume * volumeMultiplier, ctx.currentTime + fadeInMs / 1000);
  }

  source.connect(gainNode);

  let panner: PannerNode | undefined;
  if (options.position) {
    panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 70;
    panner.rolloffFactor = 0.65;
    panner.setPosition(options.position.x, options.position.y, options.position.z);
    gainNode.connect(panner);
    panner.connect(ctx.destination);
  } else {
    gainNode.connect(ctx.destination);
  }

  sharedLoops.set(id, {
    source,
    gain: gainNode,
    panner,
    isMusic: options.isMusic ?? false,
    baseVolume,
  });
  sharedPendingLoops.delete(id);
  source.start();
}

export function setSharedLoopPosition(
  id: string,
  position: { x: number; y: number; z: number }
): void {
  const loop = sharedLoops.get(id);
  loop?.panner?.setPosition(position.x, position.y, position.z);
}

export function stopSharedLoop(id: string, fadeOutMs = 0): void {
  const pendingLoop = sharedPendingLoops.get(id);
  if (pendingLoop) {
    pendingLoop.cancelled = true;
    sharedPendingLoops.delete(id);
  }

  const streamedLoop = sharedStreamedLoops.get(id);
  if (streamedLoop) {
    stopStreamedLoop(id, fadeOutMs);
    return;
  }

  const loop = sharedLoops.get(id);
  if (!loop || !sharedAudioContext) return;
  if (loop.stopping) return;

  if (fadeOutMs > 0) {
    loop.stopping = true;
    const ctx = sharedAudioContext;
    const fadeSeconds = fadeOutMs / 1000;
    loop.gain.gain.cancelScheduledValues(ctx.currentTime);
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, ctx.currentTime);
    loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSeconds);
    loop.stopTimeout = window.setTimeout(() => {
      try {
        loop.source.stop();
      } catch {
        // Source may already have ended.
      }
      sharedLoops.delete(id);
    }, fadeOutMs);
    return;
  }

  if (loop.stopTimeout !== undefined) {
    window.clearTimeout(loop.stopTimeout);
  }
  try {
    loop.source.stop();
  } catch {
    // Source may already have ended.
  }
  sharedLoops.delete(id);
}

export function useAudio() {
  useEffect(() => {
    installAudioUnlockListeners();
  }, []);

  // Initialize audio context on first interaction
  const initAudio = useCallback(() => {
    return ensureSharedAudioContext();
  }, []);

  // Load a sound effect
  const loadSound = useCallback(async (name: SoundName): Promise<SoundEffect | null> => {
    if (!sharedAudioContext && !hasUserActivatedAudio()) {
      return null;
    }

    if (!sharedAudioContext) {
      initAudio();
    }
    return loadSharedSound(name);
  }, [initAudio]);

  // Play a sound effect
  const playSound = useCallback(async (
    name: SoundName, 
    options?: PlaySoundOptions
  ): Promise<SoundPlayback | undefined> => {
    return playSharedSound(name, options);
  }, []);

  // Play looping sound
  const playLoop = useCallback(async (
    id: string, 
    name: SoundName, 
    options?: { volume?: number; fadeIn?: number; isMusic?: boolean }
  ) => {
    await playSharedLoop(id, name, {
      volume: options?.volume,
      fadeInMs: Math.max(0, options?.fadeIn ?? 0) * 1000,
      isMusic: options?.isMusic,
    });
  }, []);

  // Stop looping sound
  const stopLoop = useCallback((id: string, fadeOut?: number) => {
    stopSharedLoop(id, Math.max(0, fadeOut ?? 0) * 1000);
  }, []);

  // Update audio settings from localStorage
  const updateSettings = useCallback((settings?: Partial<ClientSettings>) => {
    const newSettings = loadAudioSettings(settings);
    sharedConfig.masterVolume = newSettings.masterVolume;
    sharedConfig.sfxVolume = newSettings.sfxVolume;
    sharedConfig.musicVolume = newSettings.musicVolume;
    
    // Update all currently playing loops with new volume
    for (const [, loop] of sharedLoops) {
      const volumeMultiplier = loop.isMusic ? getMusicVolume() : getSfxVolume();
      loop.gain.gain.value = loop.baseVolume * volumeMultiplier;
    }
    updateStreamedLoopVolumes();
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    sharedConfig.muted = !sharedConfig.muted;
    
    // Stop all loops when muted
    if (sharedConfig.muted) {
      for (const [id] of sharedLoops) {
        stopLoop(id);
      }
      for (const [id] of sharedStreamedLoops) {
        stopStreamedLoop(id);
      }
    }
  }, [stopLoop]);

  // Preload multiple sounds (for abilities that need instant playback)
  const preloadSounds = useCallback(async (names: SoundName[]) => {
    const preloadNames = names.filter(name => !MUSIC_SOUND_NAMES.has(name));
    if (!hasUserActivatedAudio()) {
      preloadNames.forEach((name) => pendingAudioPreloadNames.add(name));
      return;
    }

    await Promise.all(preloadNames.map(name => loadSound(name)));
    await flushPendingAudioPreloads();
  }, [loadSound]);

  const preloadSoundGroup = useCallback(async (group: SoundGroup) => {
    await preloadSounds(SOUND_GROUPS[group]);
  }, [preloadSounds]);

  const preloadHeroSounds = useCallback(async (heroId: string | null | undefined) => {
    if (heroId === 'phantom') {
      await preloadSoundGroup('phantom');
    } else if (heroId === 'blaze') {
      await preloadSoundGroup('blaze');
    } else if (heroId === 'hookshot') {
      await preloadSoundGroup('hookshot');
    } else if (heroId === 'chronos') {
      await preloadSoundGroup('chronos');
    } else {
      await preloadSoundGroup('commonCombat');
    }
  }, [preloadSoundGroup]);

  // No cleanup on unmount - audio context is shared/singleton

  return {
    initAudio,
    playSound,
    playLoop,
    stopLoop,
    updateSettings,
    toggleMute,
    preloadSounds,
    preloadSoundGroup,
    preloadHeroSounds,
    loadSound,
    isMuted: () => sharedConfig.muted,
    getMasterVolume: () => sharedConfig.masterVolume,
    getSfxVolume: () => sharedConfig.sfxVolume,
    getMusicVolume: () => sharedConfig.musicVolume,
  };
}

// Walking sound state (shared across hook instances)
let walkingSoundState = {
  cachedBuffer: null as AudioBuffer | null,
  lastStepTime: 0, // Time of last footstep
  isWalking: false,
  movementStartTime: 0, // When continuous movement started
};

const WALKING_STEP_BASE_GAIN = 0.52;
const WALKING_STEP_VOLUME_MULTIPLIER = 1.3;
const RUNNING_STEP_VOLUME_MULTIPLIER = 1.4;
const RUNNING_STEP_SPEED_RATIO = 1.1;

// Sound effect helper hooks
export function useMovementSounds() {
  const { playSound, playLoop, stopLoop, loadSound, initAudio } = useAudio();

  const onFootstep = useCallback(() => {
    playSound('footstep', { pitch: 0.9 + Math.random() * 0.2 });
  }, [playSound]);

  const onJump = useCallback(() => {
    playSound('jump');
  }, [playSound]);

  const onLand = useCallback((velocity: number) => {
    const volume = Math.min(1, velocity / 20);
    playSound('land', { volume });
  }, [playSound]);

  const startSlide = useCallback(() => {
    playLoop('slide', 'slide', { fadeIn: 0.1 });
  }, [playLoop]);

  const stopSlide = useCallback(() => {
    stopLoop('slide', 0.2);
  }, [stopLoop]);

  const startWallRun = useCallback(() => {
    playLoop('wallrun', 'wallRun', { fadeIn: 0.1 });
  }, [playLoop]);

  const stopWallRun = useCallback(() => {
    stopLoop('wallrun', 0.2);
  }, [stopLoop]);

  // Preload walking sound buffer (call once at startup)
  const preloadWalkingSound = useCallback(async () => {
    if (walkingSoundState.cachedBuffer) return;
    
    const sound = await loadSound('walk');
    if (sound?.buffer) {
      walkingSoundState.cachedBuffer = sound.buffer;
    }
  }, [loadSound]);

  // Helper to play a single footstep sound
  const playFootstep = useCallback((volumeMultiplier = WALKING_STEP_VOLUME_MULTIPLIER) => {
    const ctx = initAudio();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      if (!hasUserActivatedAudio()) return;
      void ctx.resume().catch(() => undefined);
      if (ctx.state === 'suspended') return;
    }

    const buffer = walkingSoundState.cachedBuffer;
    if (!buffer) {
      preloadWalkingSound();
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    // Pitch variation for naturalness (0.85 to 1.15)
    source.playbackRate.value = 0.85 + Math.random() * 0.3;

    const gainNode = ctx.createGain();
    gainNode.gain.value = WALKING_STEP_BASE_GAIN * volumeMultiplier * getSfxVolume();

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();

    walkingSoundState.lastStepTime = performance.now();
  }, [initAudio, preloadWalkingSound]);

  // Update walking sound based on movement state
  // Plays discrete footstep sounds at intervals based on speed
  // justLanded: passed from PlayerController, detected BEFORE jump check
  const updateWalkingSound = useCallback((
    horizontalSpeed: number,
    isGrounded: boolean,
    isSliding: boolean,
    baseSpeed: number,
    justLanded: boolean = false
  ) => {
    const MIN_WALKING_SPEED = 2.0; // Higher threshold to filter out tiny movements
    const MIN_MOVEMENT_TIME = 150; // ms - must be moving this long before first footstep
    const isMoving = horizontalSpeed > MIN_WALKING_SPEED;
    const shouldPlaySteps = isMoving && isGrounded && !isSliding;
    const now = performance.now();

    // Track when continuous movement started (regardless of grounded state for bunny hop)
    if (isMoving) {
      if (walkingSoundState.movementStartTime === 0) {
        walkingSoundState.movementStartTime = now;
      }
    } else {
      walkingSoundState.movementStartTime = 0;
    }

    // Check if player has been moving long enough (prevents sounds on brief taps)
    const movementDuration = walkingSoundState.movementStartTime > 0 
      ? now - walkingSoundState.movementStartTime 
      : 0;
    const hasMovedEnough = movementDuration >= MIN_MOVEMENT_TIME;
    const safeBaseSpeed = Math.max(baseSpeed, MIN_WALKING_SPEED);
    const speedRatio = horizontalSpeed / safeBaseSpeed;
    const footstepVolumeMultiplier = speedRatio >= RUNNING_STEP_SPEED_RATIO
      ? RUNNING_STEP_VOLUME_MULTIPLIER
      : WALKING_STEP_VOLUME_MULTIPLIER;

    // Play footstep immediately on landing (bunny hop support)
    // Only if already moving for a while (not a fresh tap)
    if (justLanded && isMoving && !isSliding && hasMovedEnough) {
      playFootstep(footstepVolumeMultiplier);
      walkingSoundState.isWalking = true;
      return; // Already played a step this frame
    }

    if (!shouldPlaySteps || !hasMovedEnough) {
      walkingSoundState.isWalking = false;
      return;
    }

    // Calculate interval between footsteps based on speed
    const baseInterval = 300; // ms at normal speed
    const minInterval = 150; // ms at max speed
    const maxInterval = 500; // ms at slow walk
    
    const stepInterval = Math.max(minInterval, Math.min(maxInterval, baseInterval / speedRatio));
    const timeSinceLastStep = now - walkingSoundState.lastStepTime;

    // Play footstep if enough time has passed
    if (timeSinceLastStep >= stepInterval) {
      playFootstep(footstepVolumeMultiplier);
      walkingSoundState.isWalking = true;
    }
  }, [playFootstep]);

  // Explicitly stop walking sound (useful for cleanup)
  const stopWalkingSound = useCallback(() => {
    walkingSoundState.isWalking = false;
  }, []);

  return {
    onFootstep,
    onJump,
    onLand,
    startSlide,
    stopSlide,
    startWallRun,
    stopWallRun,
    updateWalkingSound,
    stopWalkingSound,
    preloadWalkingSound,
  };
}

const PHANTOM_VOID_RAY_CHARGE_MIN_DURATION_MS = 1;

// Ability sound effects hook
export function useAbilitySounds() {
  const { playSound, playLoop, stopLoop } = useAudio();
  const phantomVoidRayChargeAbortRef = useRef<AbortController | null>(null);
  const phantomVoidRayChargeTimeoutRef = useRef<number | null>(null);

  const stopPhantomVoidRayCharge = useCallback(() => {
    if (phantomVoidRayChargeTimeoutRef.current !== null) {
      window.clearTimeout(phantomVoidRayChargeTimeoutRef.current);
      phantomVoidRayChargeTimeoutRef.current = null;
    }

    phantomVoidRayChargeAbortRef.current?.abort();
    phantomVoidRayChargeAbortRef.current = null;
  }, []);

  // Phantom abilities - sounds are loaded on first play, then cached
  const playPhantomBlink = useCallback(() => {
    playSound('phantomBlink', { durationMs: 900 });
  }, [playSound]);

  const playPhantomVeil = useCallback(() => {
    playSound('phantomVeil');
  }, [playSound]);

  const playPhantomBasic = useCallback(() => {
    playSound('phantomBasic');
  }, [playSound]);

  const playPhantomVoidRay = useCallback(() => {
    playSound('phantomVoidRay');
  }, [playSound]);

  const startPhantomVoidRayCharge = useCallback((durationMs: number) => {
    stopPhantomVoidRayCharge();

    const clippedDurationMs = Math.max(PHANTOM_VOID_RAY_CHARGE_MIN_DURATION_MS, durationMs);
    const controller = new AbortController();
    phantomVoidRayChargeAbortRef.current = controller;

    void playSound('phantomVoidRayCharge', {
      durationMs: clippedDurationMs,
      signal: controller.signal,
    });

    phantomVoidRayChargeTimeoutRef.current = window.setTimeout(() => {
      if (phantomVoidRayChargeAbortRef.current !== controller) return;
      controller.abort();
      phantomVoidRayChargeAbortRef.current = null;
      phantomVoidRayChargeTimeoutRef.current = null;
    }, clippedDurationMs);
  }, [playSound, stopPhantomVoidRayCharge]);

  useEffect(() => stopPhantomVoidRayCharge, [stopPhantomVoidRayCharge]);
  
  // Blaze abilities
  const playBlazeRocket = useCallback(() => {
    // Add pitch variation for more natural feel (0.85 - 1.15 range)
    playSound('blazeRocket', { pitch: 0.85 + Math.random() * 0.3 });
  }, [playSound]);
  
  const playBlazeBombTarget = useCallback(() => {
    playSound('blazeBombTarget');
  }, [playSound]);

  const playBlazeBombRelease = useCallback(() => {
    playSound('blazeBombRelease', {
      startOffsetMs: BLAZE_BOMB_RELEASE_SOUND_START_OFFSET_MS,
      durationMs: BLAZE_BOMB_RELEASE_SOUND_DURATION_MS,
      fadeOutMs: BLAZE_BOMB_RELEASE_SOUND_FADE_OUT_MS,
    });
  }, [playSound]);
  
  const playBlazeBombFall = useCallback(() => {
    playSound('blazeBombFall');
  }, [playSound]);
  
  const playBlazeBombExplode = useCallback(() => {
    playSound('blazeBombExplode');
  }, [playSound]);
  
  const playBlazeRocketJump = useCallback(() => {
    playSound('blazeRocketJump');
  }, [playSound]);
  
  // Flamethrower loop controls
  const startFlamethrowerSound = useCallback(() => {
    playLoop('flamethrower', 'blazeFlamethrower', { fadeIn: 0.1 });
  }, [playLoop]);
  
  const stopFlamethrowerSound = useCallback(() => {
    stopLoop('flamethrower', 0.15);
  }, [stopLoop]);

  return {
    // Phantom
    playPhantomBlink,
    playPhantomVeil,
    playPhantomBasic,
    playPhantomVoidRay,
    startPhantomVoidRayCharge,
    stopPhantomVoidRayCharge,
    // Blaze
    playBlazeRocket,
    playBlazeBombTarget,
    playBlazeBombRelease,
    playBlazeBombFall,
    playBlazeBombExplode,
    playBlazeRocketJump,
    startFlamethrowerSound,
    stopFlamethrowerSound,
  } as const;
}

// UI sound effects hook
export function useUISounds() {
  const playButtonHover = useCallback(() => {}, []);
  const playButtonClick = useCallback(() => {}, []);

  return {
    playButtonHover,
    playButtonClick,
  };
}

export function useGlobalButtonSounds() {
  const { preloadSounds } = useAudio();

  useEffect(() => {
    void preloadSounds(['buttonClick']);
  }, [preloadSounds]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleButtonClick = (event: MouseEvent) => {
      if (!getButtonSoundTarget(event.target)) return;
      void playSharedSound('buttonClick');
    };

    document.addEventListener('click', handleButtonClick, true);
    return () => {
      document.removeEventListener('click', handleButtonClick, true);
    };
  }, []);
}

// Music state (shared singleton)
let musicState = {
  currentTrack: null as 'lobby' | 'game' | null,
  pendingTrack: null as 'lobby' | 'game' | null, // Track to play once user interacts
  isPlaying: false,
  isPaused: false,
  userHasInteracted: false,
  pausedGainValue: 0,
};

// Set up one-time click listener to start audio on user interaction
let interactionListenerSet = false;
function setupInteractionListener(callback: () => void) {
  if (interactionListenerSet) return;
  interactionListenerSet = true;
  
  const handleInteraction = () => {
    markAudioUserActivation();
    musicState.userHasInteracted = true;
    callback();
    // Remove listeners after first interaction
    document.removeEventListener('click', handleInteraction);
    document.removeEventListener('pointerdown', handleInteraction);
    document.removeEventListener('touchstart', handleInteraction);
    document.removeEventListener('keydown', handleInteraction);
  };
  
  document.addEventListener('click', handleInteraction);
  document.addEventListener('pointerdown', handleInteraction);
  document.addEventListener('touchstart', handleInteraction);
  document.addEventListener('keydown', handleInteraction);
}

// Background music hook
export function useMusic() {
  const { playLoop, stopLoop, initAudio } = useAudio();

  // Actually start playing the music
  const startMusic = useCallback((track: 'lobby' | 'game') => {    
    // Force stop any current music immediately (no fade to prevent overlap)
    stopLoop('lobbyMusic');
    stopLoop('gameMusic');
    
    initAudio();
    
    // Resume context if needed
    if (sharedAudioContext?.state === 'suspended') {
      void sharedAudioContext.resume().catch(() => undefined);
    }
    
    const soundName = track === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    playLoop(soundName, soundName, { fadeIn: 1.5, isMusic: true });
    musicState.currentTrack = track;
    musicState.isPlaying = true;
    musicState.isPaused = false;
    musicState.pendingTrack = null;
  }, [playLoop, stopLoop, initAudio]);

  // Pause music (fade out but don't stop)
  const pauseMusic = useCallback(() => {
    if (!musicState.isPlaying || musicState.isPaused) return;
    
    const loopId = musicState.currentTrack === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    const loop = sharedLoops.get(loopId);
    const streamedLoop = sharedStreamedLoops.get(loopId);
    
    if (loop && sharedAudioContext) {
      musicState.pausedGainValue = loop.gain.gain.value;
      loop.gain.gain.linearRampToValueAtTime(0, sharedAudioContext.currentTime + 0.5);
      musicState.isPaused = true;
    } else if (streamedLoop) {
      musicState.pausedGainValue = streamedLoop.audio.volume;
      fadeStreamedLoop(streamedLoop, 0, 500);
      musicState.isPaused = true;
    }
  }, []);

  // Resume music (fade back in)
  const resumeMusic = useCallback(() => {
    if (!musicState.isPlaying || !musicState.isPaused) return;
    
    const loopId = musicState.currentTrack === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    const loop = sharedLoops.get(loopId);
    const streamedLoop = sharedStreamedLoops.get(loopId);
    
    if (loop && sharedAudioContext) {
      const targetVolume = musicState.pausedGainValue || getMusicVolume();
      loop.gain.gain.linearRampToValueAtTime(
        targetVolume,
        sharedAudioContext.currentTime + 0.5
      );
      musicState.isPaused = false;
    } else if (streamedLoop) {
      const targetVolume = musicState.pausedGainValue || getStreamedLoopTargetVolume(streamedLoop);
      fadeStreamedLoop(streamedLoop, targetVolume, 500);
      musicState.isPaused = false;
    }
  }, []);

  // Play lobby music
  const playLobbyMusic = useCallback(() => {
    // Skip only if lobby is already playing and not paused
    if (musicState.currentTrack === 'lobby' && musicState.isPlaying && !musicState.isPaused) {
      return;
    }
    
    if (!musicState.userHasInteracted) {
      // Queue for when user interacts
      musicState.pendingTrack = 'lobby';
      setupInteractionListener(() => {
        if (musicState.pendingTrack) {
          startMusic(musicState.pendingTrack);
        }
      });
      return;
    }
    
    startMusic('lobby');
  }, [startMusic]);

  // Play game music
  const playGameMusic = useCallback(() => {
    // Skip if already playing game music (and not paused)
    if (musicState.currentTrack === 'game' && musicState.isPlaying && !musicState.isPaused) return;
    
    if (!musicState.userHasInteracted) {
      // Queue for when user interacts
      musicState.pendingTrack = 'game';
      setupInteractionListener(() => {
        if (musicState.pendingTrack) {
          startMusic(musicState.pendingTrack);
        }
      });
      return;
    }
    
    startMusic('game');
  }, [startMusic]);

  // Stop all music
  const stopMusic = useCallback(() => {
    if (sharedLoops.has('lobbyMusic') || sharedStreamedLoops.has('lobbyMusic')) {
      stopLoop('lobbyMusic', 1.5);
    }
    if (sharedLoops.has('gameMusic') || sharedStreamedLoops.has('gameMusic')) {
      stopLoop('gameMusic', 1.5);
    }
    musicState.currentTrack = null;
    musicState.pendingTrack = null;
    musicState.isPlaying = false;
  }, [stopLoop]);

  // Update music based on game phase
  const updateMusicForPhase = useCallback((phase: string) => {
    if (phase === 'playing' || phase === 'countdown') {
      playGameMusic();
    } else {
      playLobbyMusic();
    }
  }, [playGameMusic, playLobbyMusic]);

  return {
    playLobbyMusic,
    playGameMusic,
    stopMusic,
    pauseMusic,
    resumeMusic,
    updateMusicForPhase,
    currentTrack: () => musicState.currentTrack,
    isPaused: () => musicState.isPaused,
  };
}
