import { useRef, useCallback, useEffect } from 'react';
import { loadSettings, type ClientSettings } from '../store/settingsStore';
import { recordSpawnMarker, recordSystemTime } from '../utils/perfMarks';

interface AudioConfig {
  masterVolume: number;  // 0-100
  sfxVolume: number;     // 0-100
  musicVolume: number;   // 0-100
  muted: boolean;
}

interface SoundEffect {
  buffer: AudioBuffer | null;
  volume: number;
}

interface PlaySoundOptions {
  volume?: number;
  pitch?: number;
  position?: { x: number; y: number; z: number };
  durationMs?: number;
  signal?: AbortSignal;
}

interface SoundPlayback {
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
  isMusic: boolean;
  baseVolume: number;
  stopping?: boolean;
  stopTimeout?: number;
}>();
const sharedPendingLoops = new Map<string, { cancelled: boolean }>();

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
  slide: { path: '/sounds/slide.mp3', volume: 0.18 },
  wallRun: { path: '/sounds/wall_run.mp3', volume: 0.4 },
  
  // Abilities - Generic
  blink: { path: '/sounds/blink.mp3', volume: 0.6 },
  grapple: { path: '/sounds/grapple.mp3', volume: 0.5 },
  jetpack: { path: '/sounds/jetpack.mp3', volume: 0.4 },
  
  // Phantom Abilities (using shortened clips)
  phantomBlink: { path: '/sounds/blink_short.mp3', volume: 0.4 },
  phantomShadowStep: { path: '/sounds/shadow_step_short.mp3', volume: 0.4 },
  phantomVeil: { path: '/sounds/phantom_veil.mp3', volume: 0.2 },
  phantomBasic: { path: '/sounds/phantom_basic.mp3', volume: 0.1872 },
  phantomVoidRay: { path: '/sounds/phantom_strong.mp3', volume: 0.6 },
  phantomVoidRayCharge: { path: '/sounds/phantom_right_click_charge.mp3', volume: 0.45 },
  
  // Blaze Abilities (using existing sounds as fallbacks)
  blazeRocket: { path: '/sounds/rocket_fire.mp3', volume: 0.4 },
  blazeBombTarget: { path: '/sounds/button.mp3', volume: 0.5 },
  blazeBombFall: { path: '/sounds/bomb_fall.mp3', volume: 0.5 },
  blazeBombExplode: { path: '/sounds/bomb_explode.mp3', volume: 0.7 },
  blazeFlamethrower: { path: '/sounds/jetpack.mp3', volume: 0.3 },
  blazeRocketJump: { path: '/sounds/rocket_jump.mp3', volume: 0.6 },
  blazeAirstrike: { path: '/sounds/airstrike.mp3', volume: 0.6 },
  
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
  buttonClick: { path: '/sounds/button_press.mp3', volume: 0.3 },
  countdown: { path: '/sounds/countdown.mp3', volume: 0.6 },
  matchStart: { path: '/sounds/match_start.mp3', volume: 0.8 },
  roundEnd: { path: '/sounds/round_end.mp3', volume: 0.8 },
  victory: { path: '/sounds/victory.mp3', volume: 0.9 },
  defeat: { path: '/sounds/defeat.mp3', volume: 0.7 },
  
  // Music (equal base volume, controlled by settings)
  lobbyMusic: { path: '/sounds/lobby.mp3', volume: 0.3 },
  gameMusic: { path: '/sounds/game.mp3', volume: 0.3 },
} as const;

export type SoundName = keyof typeof SOUND_EFFECTS;
export type SoundGroup = 'menu' | 'lobby' | 'commonCombat' | 'phantom' | 'blaze';

const SOUND_GROUPS: Record<SoundGroup, SoundName[]> = {
  menu: ['buttonHover', 'buttonClick'],
  lobby: ['lobbyMusic', 'buttonHover', 'buttonClick'],
  commonCombat: ['gameMusic', 'walk', 'slide', 'jetpack'],
  phantom: ['phantomBlink', 'phantomShadowStep', 'phantomVeil', 'phantomBasic', 'phantomVoidRay', 'phantomVoidRayCharge'],
  blaze: ['blazeRocket', 'blazeBombTarget', 'blazeBombFall', 'blazeBombExplode', 'blazeFlamethrower', 'blazeRocketJump', 'blazeAirstrike'],
};

export function useAudio() {
  // Initialize audio context on first interaction
  const initAudio = useCallback(() => {
    if (sharedAudioContext) {
      // Resume if suspended (browser autoplay policy)
      if (sharedAudioContext.state === 'suspended') {
        sharedAudioContext.resume();
      }
      return;
    }

    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }, []);

  // Load a sound effect
  const loadSound = useCallback(async (name: SoundName): Promise<SoundEffect | null> => {
    if (!sharedAudioContext) {
      initAudio();
    }

    const ctx = sharedAudioContext;
    if (!ctx) {
      console.warn('[Audio] No AudioContext available');
      return null;
    }

    const existing = sharedSounds.get(name);
    if (existing?.buffer) return existing;

    const pending = sharedSoundLoads.get(name);
    if (pending) return pending;

    const soundDef = SOUND_EFFECTS[name];

    const loadPromise = (async () => {
      try {
        const response = await fetch(soundDef.path);
        if (!response.ok) {
          console.warn(`[Audio] Sound file not found: ${soundDef.path}`);
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);

        const effect: SoundEffect = {
          buffer,
          volume: soundDef.volume,
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
  }, [initAudio]);

  // Play a sound effect
  const playSound = useCallback(async (
    name: SoundName, 
    options?: PlaySoundOptions
  ): Promise<SoundPlayback | undefined> => {
    if (sharedConfig.muted) return;
    if (options?.signal?.aborted) return;

    // Ensure audio context exists and is running
    if (!sharedAudioContext) {
      initAudio();
    }
    
    const ctx = sharedAudioContext;
    if (!ctx) {
      console.warn('[Audio] Cannot play sound - no AudioContext');
      return;
    }

    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (options?.signal?.aborted) return;

    const hadLoadedBuffer = Boolean(sharedSounds.get(name)?.buffer);
    if (name === 'phantomBasic') {
      recordSpawnMarker('audio:phantomBasic');
    }

    const loadStart = hadLoadedBuffer ? 0 : performance.now();
    const sound = await loadSound(name);
    if (!hadLoadedBuffer) {
      recordSystemTime('audioLoads', performance.now() - loadStart);
      recordSpawnMarker(`audioLoad:${name}`);
    }
    if (options?.signal?.aborted) return;

    if (!sound?.buffer) {
      console.warn(`[Audio] Cannot play ${name} - no buffer`);
      return;
    }

    // Create source
    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    
    // Apply pitch
    if (options?.pitch) {
      source.playbackRate.value = options.pitch;
    }

    // Create gain node (SFX volume)
    const gainNode = ctx.createGain();
    gainNode.gain.value = (options?.volume ?? 1) * sound.volume * getSfxVolume();

    // Connect nodes
    source.connect(gainNode);
    
    // Optional: 3D positioning with panner
    if (options?.position) {
      const panner = ctx.createPanner();
      panner.setPosition(options.position.x, options.position.y, options.position.z);
      gainNode.connect(panner);
      panner.connect(ctx.destination);
    } else {
      gainNode.connect(ctx.destination);
    }

    let stopped = false;
    let durationTimeout: number | null = null;

    function cleanup() {
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

    options?.signal?.addEventListener('abort', stop, { once: true });
    source.onended = () => {
      stopped = true;
      cleanup();
    };

    source.start();
    if (options?.durationMs !== undefined) {
      durationTimeout = window.setTimeout(stop, Math.max(0, options.durationMs));
    }

    return { stop };
  }, [loadSound, initAudio]);

  // Play looping sound
  const playLoop = useCallback(async (
    id: string, 
    name: SoundName, 
    options?: { volume?: number; fadeIn?: number; isMusic?: boolean }
  ) => {
    if (sharedConfig.muted) return;
    if (sharedLoops.has(id) || sharedPendingLoops.has(id)) return; // Already playing or loading

    const pendingLoop = { cancelled: false };
    sharedPendingLoops.set(id, pendingLoop);

    if (!sharedAudioContext) {
      initAudio();
    }

    const ctx = sharedAudioContext;
    if (!ctx) {
      sharedPendingLoops.delete(id);
      return;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (pendingLoop.cancelled || sharedPendingLoops.get(id) !== pendingLoop) return;

    const sound = await loadSound(name);
    if (pendingLoop.cancelled || sharedPendingLoops.get(id) !== pendingLoop) return;
    if (!sound?.buffer) {
      sharedPendingLoops.delete(id);
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.loop = true;

    // Use music volume for music tracks, SFX volume for other loops
    const volumeMultiplier = options?.isMusic ? getMusicVolume() : getSfxVolume();
    const baseVolume = (options?.volume ?? 1) * sound.volume;
    const gainNode = ctx.createGain();
    
    if (options?.fadeIn) {
      gainNode.gain.value = 0;
      gainNode.gain.linearRampToValueAtTime(
        baseVolume * volumeMultiplier,
        ctx.currentTime + options.fadeIn
      );
    } else {
      gainNode.gain.value = baseVolume * volumeMultiplier;
    }

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    sharedLoops.set(id, {
      source,
      gain: gainNode,
      isMusic: options?.isMusic ?? false,
      baseVolume,
    });
    sharedPendingLoops.delete(id);
    source.start();
  }, [loadSound, initAudio]);

  // Stop looping sound
  const stopLoop = useCallback((id: string, fadeOut?: number) => {
    const pendingLoop = sharedPendingLoops.get(id);
    if (pendingLoop) {
      pendingLoop.cancelled = true;
      sharedPendingLoops.delete(id);
    }

    const loop = sharedLoops.get(id);
    if (!loop || !sharedAudioContext) return;
    if (loop.stopping) return;

    if (fadeOut) {
      loop.stopping = true;
      const ctx = sharedAudioContext;
      loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
      loop.stopTimeout = window.setTimeout(() => {
        try {
          loop.source.stop();
        } catch {
          // Source may already have ended if the browser stopped it first.
        }
        sharedLoops.delete(id);
      }, fadeOut * 1000);
    } else {
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
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    sharedConfig.muted = !sharedConfig.muted;
    
    // Stop all loops when muted
    if (sharedConfig.muted) {
      for (const [id] of sharedLoops) {
        stopLoop(id);
      }
    }
  }, [stopLoop]);

  // Preload multiple sounds (for abilities that need instant playback)
  const preloadSounds = useCallback(async (names: SoundName[]) => {
    if (!sharedAudioContext) {
      initAudio();
    }
    
    await Promise.all(names.map(name => loadSound(name)));
  }, [initAudio, loadSound]);

  const preloadSoundGroup = useCallback(async (group: SoundGroup) => {
    await preloadSounds(SOUND_GROUPS[group]);
  }, [preloadSounds]);

  const preloadHeroSounds = useCallback(async (heroId: string | null | undefined) => {
    if (heroId === 'phantom') {
      await preloadSoundGroup('phantom');
    } else if (heroId === 'blaze') {
      await preloadSoundGroup('blaze');
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
  const playFootstep = useCallback(() => {
    if (!sharedAudioContext) {
      initAudio();
    }
    const ctx = sharedAudioContext;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
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
    gainNode.gain.value = 0.4 * getSfxVolume();

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

    // Play footstep immediately on landing (bunny hop support)
    // Only if already moving for a while (not a fresh tap)
    if (justLanded && isMoving && !isSliding && hasMovedEnough) {
      playFootstep();
      walkingSoundState.isWalking = true;
      return; // Already played a step this frame
    }

    if (!shouldPlaySteps || !hasMovedEnough) {
      walkingSoundState.isWalking = false;
      return;
    }

    // Calculate interval between footsteps based on speed
    const speedRatio = horizontalSpeed / baseSpeed;
    const baseInterval = 300; // ms at normal speed
    const minInterval = 150; // ms at max speed
    const maxInterval = 500; // ms at slow walk
    
    const stepInterval = Math.max(minInterval, Math.min(maxInterval, baseInterval / speedRatio));
    const timeSinceLastStep = now - walkingSoundState.lastStepTime;

    // Play footstep if enough time has passed
    if (timeSinceLastStep >= stepInterval) {
      playFootstep();
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
    playSound('phantomBlink');
  }, [playSound]);

  const playPhantomShadowStep = useCallback(() => {
    playSound('phantomShadowStep');
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
  
  const playBlazeBombFall = useCallback(() => {
    playSound('blazeBombFall');
  }, [playSound]);
  
  const playBlazeBombExplode = useCallback(() => {
    playSound('blazeBombExplode');
  }, [playSound]);
  
  const playBlazeRocketJump = useCallback(() => {
    playSound('blazeRocketJump');
  }, [playSound]);
  
  const playBlazeAirstrike = useCallback(() => {
    playSound('blazeAirstrike');
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
    playPhantomShadowStep,
    playPhantomVeil,
    playPhantomBasic,
    playPhantomVoidRay,
    startPhantomVoidRayCharge,
    stopPhantomVoidRayCharge,
    // Blaze
    playBlazeRocket,
    playBlazeBombTarget,
    playBlazeBombFall,
    playBlazeBombExplode,
    playBlazeRocketJump,
    playBlazeAirstrike,
    startFlamethrowerSound,
    stopFlamethrowerSound,
  } as const;
}

// UI sound effects hook
export function useUISounds() {
  const { playSound, preloadSounds } = useAudio();

  useEffect(() => {
    void preloadSounds(['buttonClick']);
  }, [preloadSounds]);

  const playButtonHover = useCallback(() => {}, []);

  const playButtonClick = useCallback(() => {
    playSound('buttonClick');
  }, [playSound]);

  return {
    playButtonHover,
    playButtonClick,
  };
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
    musicState.userHasInteracted = true;
    callback();
    // Remove listeners after first interaction
    document.removeEventListener('click', handleInteraction);
    document.removeEventListener('keydown', handleInteraction);
  };
  
  document.addEventListener('click', handleInteraction);
  document.addEventListener('keydown', handleInteraction);
}

// Background music hook
export function useMusic() {
  const { playLoop, stopLoop, initAudio } = useAudio();

  // Actually start playing the music
  const startMusic = useCallback((track: 'lobby' | 'game') => {    
    // Force stop any current music immediately (no fade to prevent overlap)
    const lobbyLoop = sharedLoops.get('lobbyMusic');
    if (lobbyLoop) {
      try { lobbyLoop.source.stop(); } catch {}
      sharedLoops.delete('lobbyMusic');
    }
    const gameLoop = sharedLoops.get('gameMusic');
    if (gameLoop) {
      try { gameLoop.source.stop(); } catch {}
      sharedLoops.delete('gameMusic');
    }
    
    initAudio();
    
    // Resume context if needed
    if (sharedAudioContext?.state === 'suspended') {
      sharedAudioContext.resume();
    }
    
    const soundName = track === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    playLoop(soundName, soundName, { fadeIn: 1.5, isMusic: true });
    musicState.currentTrack = track;
    musicState.isPlaying = true;
    musicState.isPaused = false;
    musicState.pendingTrack = null;
  }, [playLoop, initAudio]);

  // Pause music (fade out but don't stop)
  const pauseMusic = useCallback(() => {
    if (!musicState.isPlaying || musicState.isPaused) return;
    
    const loopId = musicState.currentTrack === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    const loop = sharedLoops.get(loopId);
    
    if (loop && sharedAudioContext) {
      musicState.pausedGainValue = loop.gain.gain.value;
      loop.gain.gain.linearRampToValueAtTime(0, sharedAudioContext.currentTime + 0.5);
      musicState.isPaused = true;
    }
  }, []);

  // Resume music (fade back in)
  const resumeMusic = useCallback(() => {
    if (!musicState.isPlaying || !musicState.isPaused) return;
    
    const loopId = musicState.currentTrack === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    const loop = sharedLoops.get(loopId);
    
    if (loop && sharedAudioContext) {
      const targetVolume = musicState.pausedGainValue || getMusicVolume();
      loop.gain.gain.linearRampToValueAtTime(
        targetVolume,
        sharedAudioContext.currentTime + 0.5
      );
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
    if (sharedLoops.has('lobbyMusic')) {
      stopLoop('lobbyMusic', 1.5);
    }
    if (sharedLoops.has('gameMusic')) {
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
