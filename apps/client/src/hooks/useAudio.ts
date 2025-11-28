import { useRef, useCallback, useEffect } from 'react';

interface AudioConfig {
  volume: number;
  muted: boolean;
}

interface SoundEffect {
  buffer: AudioBuffer | null;
  volume: number;
}

const DEFAULT_CONFIG: AudioConfig = {
  volume: 0.7,
  muted: false,
};

// SINGLETON: Shared audio state across all hook instances
let sharedAudioContext: AudioContext | null = null;
const sharedConfig: AudioConfig = { ...DEFAULT_CONFIG };
const sharedSounds = new Map<string, SoundEffect>();
const sharedLoops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();

// Sound effect definitions
const SOUND_EFFECTS = {
  // Movement
  footstep: { path: '/sounds/footstep.mp3', volume: 0.3 },
  jump: { path: '/sounds/jump.mp3', volume: 0.5 },
  land: { path: '/sounds/land.mp3', volume: 0.4 },
  slide: { path: '/sounds/slide.mp3', volume: 0.5 },
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
  buttonClick: { path: '/sounds/button_click.mp3', volume: 0.4 },
  countdown: { path: '/sounds/countdown.mp3', volume: 0.6 },
  matchStart: { path: '/sounds/match_start.mp3', volume: 0.8 },
  roundEnd: { path: '/sounds/round_end.mp3', volume: 0.8 },
  victory: { path: '/sounds/victory.mp3', volume: 0.9 },
  defeat: { path: '/sounds/defeat.mp3', volume: 0.7 },
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

    // Create gain node
    const gainNode = ctx.createGain();
    gainNode.gain.value = (options?.volume ?? 1) * sound.volume * sharedConfig.volume;

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
    options?: { volume?: number; fadeIn?: number }
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

    const gainNode = ctx.createGain();
    
    if (options?.fadeIn) {
      gainNode.gain.value = 0;
      gainNode.gain.linearRampToValueAtTime(
        (options.volume ?? 1) * sound.volume * sharedConfig.volume,
        ctx.currentTime + options.fadeIn
      );
    } else {
      gainNode.gain.value = (options?.volume ?? 1) * sound.volume * sharedConfig.volume;
    }

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();

    sharedLoops.set(id, { source, gain: gainNode });
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

  // Set master volume
  const setVolume = useCallback((volume: number) => {
    sharedConfig.volume = Math.max(0, Math.min(1, volume));
    
    // Update all looping sounds
    for (const loop of sharedLoops.values()) {
      loop.gain.gain.value *= sharedConfig.volume;
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
    setVolume,
    toggleMute,
    preloadSounds,
    isMuted: () => sharedConfig.muted,
    getVolume: () => sharedConfig.volume,
  };
}

// Sound effect helper hooks
export function useMovementSounds() {
  const { playSound, playLoop, stopLoop } = useAudio();

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

  return {
    onFootstep,
    onJump,
    onLand,
    startSlide,
    stopSlide,
    startWallRun,
    stopWallRun,
  };
}

// Ability sound effects hook
export function useAbilitySounds() {
  const { playSound } = useAudio();

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

  return {
    // Phantom
    playPhantomBlink,
    playPhantomShadowStep,
    playPhantomVeil,
    playPhantomBasic,
  };
}

