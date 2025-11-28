import { useRef, useCallback, useEffect } from 'react';

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

const DEFAULT_CONFIG: AudioConfig = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  muted: false,
};

// Load settings from localStorage
function loadAudioSettings(): AudioConfig {
  try {
    const saved = localStorage.getItem('voxel-strike-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      return {
        masterVolume: settings.masterVolume ?? DEFAULT_CONFIG.masterVolume,
        sfxVolume: settings.sfxVolume ?? DEFAULT_CONFIG.sfxVolume,
        musicVolume: settings.musicVolume ?? DEFAULT_CONFIG.musicVolume,
        muted: false,
      };
    }
  } catch (e) {
    console.warn('[Audio] Failed to load settings:', e);
  }
  return { ...DEFAULT_CONFIG };
}

// SINGLETON: Shared audio state across all hook instances
let sharedAudioContext: AudioContext | null = null;
const sharedConfig: AudioConfig = loadAudioSettings();
const sharedSounds = new Map<string, SoundEffect>();
const sharedLoops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; isMusic: boolean }>();

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
  walk: { path: '/sounds/walk.mp3', volume: 0.8 },
  jump: { path: '/sounds/jump.mp3', volume: 0.5 },
  land: { path: '/sounds/land.mp3', volume: 0.4 },
  slide: { path: '/sounds/slide.mp3', volume: 0.15 },
  wallRun: { path: '/sounds/wall_run.mp3', volume: 0.4 },
  
  // Abilities - Generic
  dash: { path: '/sounds/dash.mp3', volume: 0.6 },
  blink: { path: '/sounds/blink.mp3', volume: 0.6 },
  grapple: { path: '/sounds/grapple.mp3', volume: 0.5 },
  jetpack: { path: '/sounds/jetpack.mp3', volume: 0.4 },
  
  // Phantom Abilities (using shortened clips)
  phantomBlink: { path: '/sounds/blink_short.mp3', volume: 0.4 },
  phantomShadowStep: { path: '/sounds/shadow_step_short.mp3', volume: 0.4 },
  phantomVeil: { path: '/sounds/phantom_veil.mp3', volume: 0.2 },
  phantomBasic: { path: '/sounds/phantom_basic.mp3', volume: 0.1 },
  phantomVoidRay: { path: '/sounds/phantom_strong.mp3', volume: 0.6 },
  
  // Blaze Abilities (using existing sounds as fallbacks)
  blazeRocket: { path: '/sounds/rocket_fire.mp3', volume: 0.4 },
  blazeBombTarget: { path: '/sounds/button.mp3', volume: 0.5 },
  blazeBombFall: { path: '/sounds/bomb_fall.mp3', volume: 0.5 },
  blazeBombExplode: { path: '/sounds/bomb_explode.mp3', volume: 0.7 },
  blazeJetpack: { path: '/sounds/jetpack.mp3', volume: 0.3 },
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

type SoundName = keyof typeof SOUND_EFFECTS;

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
    console.log('[Audio] AudioContext created, state:', sharedAudioContext.state);
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

    // Resume if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const existing = sharedSounds.get(name);
    if (existing?.buffer) return existing;

    const soundDef = SOUND_EFFECTS[name];
    
    try {
      // Fetch and decode the actual audio file
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
      console.log(`[Audio] Loaded sound: ${name}`);
      return effect;
    } catch (error) {
      console.warn(`[Audio] Failed to load sound: ${name}`, error);
      return null;
    }
  }, [initAudio]);

  // Play a sound effect
  const playSound = useCallback(async (
    name: SoundName, 
    options?: { volume?: number; pitch?: number; position?: { x: number; y: number; z: number } }
  ) => {
    if (sharedConfig.muted) return;

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

    const sound = await loadSound(name);
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

    source.start();
    console.log(`[Audio] Playing: ${name}`);
  }, [loadSound, initAudio]);

  // Play looping sound
  const playLoop = useCallback(async (
    id: string, 
    name: SoundName, 
    options?: { volume?: number; fadeIn?: number; isMusic?: boolean }
  ) => {
    if (sharedConfig.muted) return;
    if (sharedLoops.has(id)) return; // Already playing

    if (!sharedAudioContext) {
      initAudio();
    }

    const ctx = sharedAudioContext;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const sound = await loadSound(name);
    if (!sound?.buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.loop = true;

    // Use music volume for music tracks, SFX volume for other loops
    const volumeMultiplier = options?.isMusic ? getMusicVolume() : getSfxVolume();
    const gainNode = ctx.createGain();
    
    if (options?.fadeIn) {
      gainNode.gain.value = 0;
      gainNode.gain.linearRampToValueAtTime(
        (options.volume ?? 1) * sound.volume * volumeMultiplier,
        ctx.currentTime + options.fadeIn
      );
    } else {
      gainNode.gain.value = (options?.volume ?? 1) * sound.volume * volumeMultiplier;
    }

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();

    sharedLoops.set(id, { source, gain: gainNode, isMusic: options?.isMusic ?? false });
  }, [loadSound, initAudio]);

  // Stop looping sound
  const stopLoop = useCallback((id: string, fadeOut?: number) => {
    const loop = sharedLoops.get(id);
    if (!loop || !sharedAudioContext) return;

    if (fadeOut) {
      const ctx = sharedAudioContext;
      loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
      setTimeout(() => {
        loop.source.stop();
        sharedLoops.delete(id);
      }, fadeOut * 1000);
    } else {
      loop.source.stop();
      sharedLoops.delete(id);
    }
  }, []);

  // Update audio settings from localStorage
  const updateSettings = useCallback(() => {
    const newSettings = loadAudioSettings();
    sharedConfig.masterVolume = newSettings.masterVolume;
    sharedConfig.sfxVolume = newSettings.sfxVolume;
    sharedConfig.musicVolume = newSettings.musicVolume;
    
    // Update all currently playing loops with new volume
    for (const [, loop] of sharedLoops) {
      const volumeMultiplier = loop.isMusic ? getMusicVolume() : getSfxVolume();
      loop.gain.gain.value = volumeMultiplier;
    }
    
    console.log('[Audio] Settings updated:', sharedConfig);
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
    
    console.log(`[Audio] Preloading ${names.length} sounds...`);
    await Promise.all(names.map(name => loadSound(name)));
    console.log(`[Audio] Preload complete`);
  }, [initAudio, loadSound]);

  // No cleanup on unmount - audio context is shared/singleton

  return {
    initAudio,
    playSound,
    playLoop,
    stopLoop,
    updateSettings,
    toggleMute,
    preloadSounds,
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
      console.log('[Audio] Walking sound preloaded, duration:', sound.buffer.duration);
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

// Ability sound effects hook
export function useAbilitySounds() {
  const { playSound, playLoop, stopLoop } = useAudio();

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
  
  // Blaze abilities
  const playBlazeRocket = useCallback(() => {
    playSound('blazeRocket');
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
  
  // Jetpack loop controls
  const startJetpackSound = useCallback(() => {
    playLoop('jetpack', 'blazeJetpack', { fadeIn: 0.1 });
  }, [playLoop]);
  
  const stopJetpackSound = useCallback(() => {
    stopLoop('jetpack', 0.15);
  }, [stopLoop]);

  return {
    // Phantom
    playPhantomBlink,
    playPhantomShadowStep,
    playPhantomVeil,
    playPhantomBasic,
    playPhantomVoidRay,
    // Blaze
    playBlazeRocket,
    playBlazeBombTarget,
    playBlazeBombFall,
    playBlazeBombExplode,
    playBlazeRocketJump,
    playBlazeAirstrike,
    startJetpackSound,
    stopJetpackSound,
  } as const;
}

// UI sound effects hook
export function useUISounds() {
  const { playSound } = useAudio();

  const playButtonHover = useCallback(() => {
    playSound('buttonHover', { volume: 0.5 });
  }, [playSound]);

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
    console.log(`[Music] startMusic called for ${track}, current: ${musicState.currentTrack}`);
    
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
    console.log(`[Music] Started ${track} music`);
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
      console.log('[Music] Paused');
    }
  }, []);

  // Resume music (fade back in)
  const resumeMusic = useCallback(() => {
    console.log('[Music] Resume called, isPlaying:', musicState.isPlaying, 'isPaused:', musicState.isPaused, 'track:', musicState.currentTrack);
    if (!musicState.isPlaying || !musicState.isPaused) return;
    
    const loopId = musicState.currentTrack === 'lobby' ? 'lobbyMusic' : 'gameMusic';
    const loop = sharedLoops.get(loopId);
    
    if (loop && sharedAudioContext) {
      const targetVolume = musicState.pausedGainValue || getMusicVolume();
      console.log('[Music] Resuming with volume:', targetVolume);
      loop.gain.gain.linearRampToValueAtTime(
        targetVolume,
        sharedAudioContext.currentTime + 0.5
      );
      musicState.isPaused = false;
      console.log('[Music] Resumed');
    }
  }, []);

  // Play lobby music
  const playLobbyMusic = useCallback(() => {
    // Skip only if lobby is already playing and not paused
    if (musicState.currentTrack === 'lobby' && musicState.isPlaying && !musicState.isPaused) {
      console.log('[Music] Lobby music already playing, skipping');
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
      console.log('[Music] Lobby music queued (waiting for user interaction)');
      return;
    }
    
    console.log('[Music] Switching to lobby music');
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
      console.log('[Music] Game music queued (waiting for user interaction)');
      return;
    }
    
    console.log('[Music] Starting game music, current track:', musicState.currentTrack, 'isPaused:', musicState.isPaused);
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
    console.log('[Music] Stopped music');
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

