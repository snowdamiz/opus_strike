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

// Sound effect definitions
const SOUND_EFFECTS = {
  // Movement
  footstep: { path: '/sounds/footstep.mp3', volume: 0.3 },
  jump: { path: '/sounds/jump.mp3', volume: 0.5 },
  land: { path: '/sounds/land.mp3', volume: 0.4 },
  slide: { path: '/sounds/slide.mp3', volume: 0.5 },
  wallRun: { path: '/sounds/wall_run.mp3', volume: 0.4 },
  
  // Abilities
  dash: { path: '/sounds/dash.mp3', volume: 0.6 },
  blink: { path: '/sounds/blink.mp3', volume: 0.6 },
  grapple: { path: '/sounds/grapple.mp3', volume: 0.5 },
  jetpack: { path: '/sounds/jetpack.mp3', volume: 0.4 },
  
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const configRef = useRef<AudioConfig>(DEFAULT_CONFIG);
  const soundsRef = useRef<Map<SoundName, SoundEffect>>(new Map());
  const loopingRef = useRef<Map<string, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());

  // Initialize audio context on first interaction
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;

    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Preload sounds (in production, load only essential sounds initially)
    // For now, we'll load on demand
  }, []);

  // Load a sound effect
  const loadSound = useCallback(async (name: SoundName): Promise<SoundEffect | null> => {
    if (!audioContextRef.current) {
      initAudio();
    }

    const ctx = audioContextRef.current;
    if (!ctx) return null;

    const existing = soundsRef.current.get(name);
    if (existing?.buffer) return existing;

    const soundDef = SOUND_EFFECTS[name];
    
    try {
      // In production, fetch from actual sound files
      // For now, create placeholder silent buffer
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      
      const effect: SoundEffect = {
        buffer,
        volume: soundDef.volume,
      };
      
      soundsRef.current.set(name, effect);
      return effect;
    } catch (error) {
      console.warn(`Failed to load sound: ${name}`, error);
      return null;
    }
  }, [initAudio]);

  // Play a sound effect
  const playSound = useCallback(async (
    name: SoundName, 
    options?: { volume?: number; pitch?: number; position?: { x: number; y: number; z: number } }
  ) => {
    if (configRef.current.muted) return;

    const sound = await loadSound(name);
    if (!sound?.buffer || !audioContextRef.current) return;

    const ctx = audioContextRef.current;
    
    // Create source
    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    
    // Apply pitch
    if (options?.pitch) {
      source.playbackRate.value = options.pitch;
    }

    // Create gain node
    const gainNode = ctx.createGain();
    gainNode.gain.value = (options?.volume ?? 1) * sound.volume * configRef.current.volume;

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
  }, [loadSound]);

  // Play looping sound
  const playLoop = useCallback(async (
    id: string, 
    name: SoundName, 
    options?: { volume?: number; fadeIn?: number }
  ) => {
    if (configRef.current.muted) return;
    if (loopingRef.current.has(id)) return; // Already playing

    const sound = await loadSound(name);
    if (!sound?.buffer || !audioContextRef.current) return;

    const ctx = audioContextRef.current;
    
    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.loop = true;

    const gainNode = ctx.createGain();
    
    if (options?.fadeIn) {
      gainNode.gain.value = 0;
      gainNode.gain.linearRampToValueAtTime(
        (options.volume ?? 1) * sound.volume * configRef.current.volume,
        ctx.currentTime + options.fadeIn
      );
    } else {
      gainNode.gain.value = (options?.volume ?? 1) * sound.volume * configRef.current.volume;
    }

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();

    loopingRef.current.set(id, { source, gain: gainNode });
  }, [loadSound]);

  // Stop looping sound
  const stopLoop = useCallback((id: string, fadeOut?: number) => {
    const loop = loopingRef.current.get(id);
    if (!loop || !audioContextRef.current) return;

    if (fadeOut) {
      const ctx = audioContextRef.current;
      loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
      setTimeout(() => {
        loop.source.stop();
        loopingRef.current.delete(id);
      }, fadeOut * 1000);
    } else {
      loop.source.stop();
      loopingRef.current.delete(id);
    }
  }, []);

  // Set master volume
  const setVolume = useCallback((volume: number) => {
    configRef.current.volume = Math.max(0, Math.min(1, volume));
    
    // Update all looping sounds
    for (const loop of loopingRef.current.values()) {
      loop.gain.gain.value *= configRef.current.volume;
    }
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    configRef.current.muted = !configRef.current.muted;
    
    // Stop all loops when muted
    if (configRef.current.muted) {
      for (const [id] of loopingRef.current) {
        stopLoop(id);
      }
    }
  }, [stopLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const loop of loopingRef.current.values()) {
        loop.source.stop();
      }
      loopingRef.current.clear();
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    initAudio,
    playSound,
    playLoop,
    stopLoop,
    setVolume,
    toggleMute,
    isMuted: () => configRef.current.muted,
    getVolume: () => configRef.current.volume,
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

