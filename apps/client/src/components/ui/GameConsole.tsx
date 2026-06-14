import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { config } from '../../config/environment';
import {
  ABILITY_DEFINITIONS,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  HERO_DEFINITIONS,
  ALL_HERO_IDS,
} from '@voxel-strike/shared';
import type { AbilityState, HeroId, Team } from '@voxel-strike/shared';

interface ConsoleMessage {
  id: number;
  text: string;
  type: 'input' | 'output' | 'error' | 'info';
}

let messageId = 0;

const PUBLIC_COMMAND_HELP = '/seed copy';
const DEV_COMMAND_HELP = '/seed copy | /observe | /immune | /hero <hero> | /end | /bot add <hero> <red|blue> | /bot skill <hero> <red|blue> <e|q|f|lmb|rmb> | /bot nobrain | /bot brain | /bots root | /bots release | /f | /time freeze';
const PUBLIC_COMMAND_LIST = '/seed copy';
const DEV_COMMAND_LIST = '/seed copy, /observe, /immune, /hero <hero>, /end, /bot add <hero> <red|blue>, /bot skill <hero> <red|blue> <e|q|f|lmb|rmb>, /bot nobrain, /bot brain, /bots root, /bots release, /f, /time freeze';
const BOT_SKILL_KEYS: Record<string, string> = {
  e: 'e',
  q: 'q',
  f: 'f',
  ult: 'f',
  ultimate: 'f',
  lmb: 'lmb',
  m1: 'lmb',
  mouse1: 'lmb',
  primary: 'lmb',
  fire: 'lmb',
  rmb: 'rmb',
  m2: 'rmb',
  mouse2: 'rmb',
  secondary: 'rmb',
  shield: 'rmb',
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy path below.
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

// Helper to check if a player ID is an NPC (server-spawned NPCs have npc_ prefix)
export function isNpcId(playerId: string): boolean {
  return playerId.startsWith('npc_');
}

// Get all NPC IDs from the current players in store
export function getSpawnedNpcIds(): string[] {
  const { players } = useGameStore.getState();
  const npcs: string[] = [];
  players.forEach((_, id) => {
    if (isNpcId(id)) {
      npcs.push(id);
    }
  });
  return npcs;
}

// For backward compatibility with DireBall/VoidZone - create a Map view
export function getSpawnedNpcs(): Map<string, { heroId: HeroId; team: Team }> {
  const { players } = useGameStore.getState();
  const npcs = new Map<string, { heroId: HeroId; team: Team }>();
  players.forEach((player, id) => {
    if (isNpcId(id) && player.heroId) {
      npcs.set(id, { heroId: player.heroId as HeroId, team: player.team });
    }
  });
  return npcs;
}

// Store network functions reference for use by projectiles (set by GameConsole component)
let networkDamageNpc: ((npcId: string, damage: number) => void) | null = null;
let networkKillNpc: ((npcId: string) => void) | null = null;

export function setNetworkDamageNpc(fn: (npcId: string, damage: number) => void) {
  networkDamageNpc = fn;
}

export function setNetworkKillNpc(fn: (npcId: string) => void) {
  networkKillNpc = fn;
}

// Damage NPC - sends to server OR falls back to client-side handling
export function damageNpc(npcId: string, damage: number): { killed: boolean; npcName: string } | null {
  const { players, updatePlayer, removePlayer } = useGameStore.getState();
  const npc = players.get(npcId);
  if (!npc || !isNpcId(npcId)) return null;

  // Try to send damage to server first
  if (networkDamageNpc) {
    networkDamageNpc(npcId, damage);
    // Return predicted result (server will confirm)
    const predictedKill = npc.health - damage <= 0;
    return { killed: predictedKill, npcName: npc.name };
  }

  // Fallback: Apply damage client-side if network not available
  // This ensures damage works even before network context is fully initialized
  const newHealth = Math.max(0, npc.health - damage);

  if (newHealth <= 0) {
    removePlayer(npcId);
    return { killed: true, npcName: npc.name };
  } else {
    updatePlayer(npcId, { ...npc, health: newHealth });
    return { killed: false, npcName: npc.name };
  }
}

// Find NPCs within a radius (for ability targeting)
export function findNpcsInRadius(position: { x: number; y: number; z: number }, radius: number): string[] {
  const { players } = useGameStore.getState();
  const result: string[] = [];

  players.forEach((player, playerId) => {
    if (!isNpcId(playerId)) return;
    if (player.state !== 'alive') return;

    const dx = player.position.x - position.x;
    const dy = player.position.y - position.y;
    const dz = player.position.z - position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance <= radius) {
      result.push(playerId);
    }
  });

  return result;
}

// Global state for console open status - used by useInput to ignore game controls
let isConsoleOpenGlobal = false;
export function isGameConsoleOpen(): boolean {
  return isConsoleOpenGlobal;
}

let devImmuneModeGlobal = false;

function isDevImmuneMode(): boolean {
  return config.isDev && devImmuneModeGlobal;
}

function setDevImmuneMode(enabled: boolean) {
  devImmuneModeGlobal = config.isDev && enabled;
}

function normalizeHeroName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

function resolveHeroId(value: string): HeroId | null {
  const normalized = normalizeHeroName(value);
  return ALL_HERO_IDS.find((heroId) => {
    const hero = HERO_DEFINITIONS[heroId];
    return normalizeHeroName(heroId) === normalized || normalizeHeroName(hero.name) === normalized;
  }) ?? null;
}

function validHeroNames(): string {
  return ALL_HERO_IDS.map((heroId) => HERO_DEFINITIONS[heroId].name).join(', ');
}

function resolveTeam(value: string | undefined): Team | null {
  const normalized = value?.toLowerCase();
  return normalized === 'red' || normalized === 'blue' ? normalized : null;
}

function resolveBotSkillKey(value: string | undefined): string | null {
  const normalized = value?.toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  const keyWithoutDomPrefix = normalized.startsWith('key') ? normalized.slice(3) : normalized;
  return BOT_SKILL_KEYS[keyWithoutDomPrefix] ?? null;
}

function parseCommandParts(input: string): string[] {
  const parts = input.split(/\s+/);
  if (parts[0] === '/' && parts[1]) {
    return [`/${parts[1]}`, ...parts.slice(2)];
  }
  return parts;
}

function disableActiveSkillState() {
  const store = useGameStore.getState();
  store.setBombTargeting(false, false);
  store.setAirStrikeTargeting(false, false);
  store.setGrappleTrapTargeting(false, false);
  store.setFlamethrowerActive(false);
}

function createHeroAbilities(heroId: HeroId): Record<string, AbilityState> {
  const hero = HERO_DEFINITIONS[heroId];
  const abilityIds = [
    hero.ability1.abilityId,
    hero.ability2.abilityId,
    hero.ultimate.abilityId,
  ];

  return abilityIds.reduce<Record<string, AbilityState>>((abilities, abilityId) => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    abilities[abilityId] = {
      abilityId,
      cooldownRemaining: 0,
      charges: abilityDef?.charges || 1,
      isActive: false,
      activatedAt: 0,
    };
    return abilities;
  }, {});
}

function applyLocalHero(heroId: HeroId): boolean {
  const store = useGameStore.getState();
  const { localPlayer } = store;
  const hero = HERO_DEFINITIONS[heroId];

  if (!localPlayer || !hero) return false;

  store.clearClientCooldowns();
  store.setFlamethrowerActive(false);
  store.setFlamethrowerFuel(BLAZE_FLAMETHROWER_MAX_FUEL);

  store.updateLocalPlayer({
    heroId,
    health: hero.stats.maxHealth,
    maxHealth: hero.stats.maxHealth,
    ultimateCharge: 0,
    abilities: createHeroAbilities(heroId),
    movement: {
      ...localPlayer.movement,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: heroId === 'blaze'
        ? BLAZE_FLAMETHROWER_MAX_FUEL
        : localPlayer.movement.jetpackFuel,
      isGliding: false,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  });

  return true;
}

export function GameConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ConsoleMessage[]>(() => [
    {
      id: messageId++,
      text: config.isDev
        ? `Developer Console - ${DEV_COMMAND_HELP}`
        : `Game Chat - ${PUBLIC_COMMAND_HELP}`,
      type: 'info',
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    damageNpc: networkDamageNpcFn,
    killNpc: networkKillNpcFn,
    devSetHero,
    devFillUltimate,
    devEndGame,
    setDevImmune,
    setDevTimeFrozen,
    setDevBotsRooted,
    setDevBotBrainEnabled,
    addGameBot,
    devBotSkill,
    devSetLobbyObserver,
    devSetGameObserver,
  } = useNetwork();

  // Set the network functions for projectiles to use
  useEffect(() => {
    setNetworkDamageNpc(networkDamageNpcFn);
    setNetworkKillNpc(networkKillNpcFn);
  }, [networkDamageNpcFn, networkKillNpcFn]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Update global state when console opens/closes
  useEffect(() => {
    isConsoleOpenGlobal = isOpen;
    return () => {
      isConsoleOpenGlobal = false;
    };
  }, [isOpen]);

  // Toggle console with Enter key (not when already in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only open chat with Enter when not already open and not in an input
      if (e.key === 'Enter' && !isOpen) {
        // Don't intercept if already in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(true);
      }

      // Close with Escape
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  const addMessage = useCallback((text: string, type: ConsoleMessage['type'] = 'output') => {
    setMessages(prev => [...prev, { id: messageId++, text, type }]);
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Add to history
    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    // Echo input
    addMessage(`> ${trimmed}`, 'input');

    const parts = parseCommandParts(trimmed);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/seed': {
        const action = parts[1]?.toLowerCase();
        const seed = useGameStore.getState().mapSeed >>> 0;

        if (!action) {
          addMessage(`Current seed: ${seed}`, 'info');
          break;
        }

        if (parts.length !== 2 || action !== 'copy') {
          addMessage('Usage: /seed copy', 'error');
          break;
        }

        const copied = await copyTextToClipboard(String(seed));
        if (copied) {
          addMessage(`Copied seed ${seed} to clipboard.`, 'info');
        } else {
          addMessage(`Clipboard unavailable. Current seed: ${seed}`, 'error');
        }
        break;
      }

      case '/observe': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        if (parts.length !== 1) {
          addMessage('Usage: /observe', 'error');
          break;
        }

        const store = useGameStore.getState();
        if (store.isObserverMode) {
          addMessage('Already observing.', 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        if (store.appPhase === 'in_lobby') {
          const currentPlayer = store.playerId ? store.lobbyPlayers.get(store.playerId) : null;
          if (!currentPlayer) {
            addMessage('No lobby player to switch.', 'error');
            break;
          }

          if (currentPlayer.isObserver) {
            addMessage('Already observing.', 'info');
            setTimeout(() => setIsOpen(false), 100);
            break;
          }

          const observerCount = Array.from(store.lobbyPlayers.values()).filter((player) => player.isObserver).length;
          const observerCapacity = store.lobbyObserversEnabled ? Math.max(0, store.maxLobbyObservers) : 1;
          if (observerCount >= observerCapacity) {
            addMessage('Observer slot is full.', 'error');
            break;
          }

          devSetLobbyObserver(true);
          addMessage('Switching to observer...', 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        if (store.appPhase === 'in_game' && !store.isPracticeMode) {
          if (!store.localPlayer) {
            addMessage('No active player to switch.', 'error');
            break;
          }

          devSetGameObserver();
          addMessage('Switching to observer...', 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        addMessage('Use /observe from a custom lobby or custom game.', 'error');
        break;
      }

      case '/immune': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const nextImmuneMode = !isDevImmuneMode();
        setDevImmuneMode(nextImmuneMode);
        setDevImmune(nextImmuneMode);
        addMessage(`Immune mode ${nextImmuneMode ? 'ON - damage ignored' : 'OFF'}`, 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      case '/hero': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const heroName = parts.slice(1).join(' ');
        const heroId = resolveHeroId(heroName);

        if (!heroName || !heroId) {
          addMessage('Usage: /hero <hero name>', 'error');
          addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
          break;
        }

        disableActiveSkillState();
        if (!applyLocalHero(heroId)) {
          addMessage('No active player to switch.', 'error');
          break;
        }

        devSetHero(heroId);
        addMessage(`Switching to ${HERO_DEFINITIONS[heroId].name}...`, 'info');
        break;
      }

      case '/f': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const store = useGameStore.getState();
        if (!store.localPlayer?.heroId) {
          addMessage('No active hero to charge.', 'error');
          break;
        }

        store.updateLocalPlayer({ ultimateCharge: 100 });
        devFillUltimate();
        addMessage('Ultimate ability ready.', 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      case '/end': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        devEndGame();
        addMessage('Ending match...', 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      case '/time': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const action = parts[1]?.toLowerCase();
        if (action !== 'freeze' && action !== 'unfreeze') {
          addMessage('Usage: /time freeze | /time unfreeze', 'error');
          break;
        }

        const shouldFreeze = action === 'freeze';
        setDevTimeFrozen(shouldFreeze);
        addMessage(`Game clock ${shouldFreeze ? 'frozen' : 'unfrozen'}.`, 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      case '/bot': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const action = parts[1]?.toLowerCase();

        if (parts.length === 2 && (action === 'nobrain' || action === 'brain')) {
          const enabled = action === 'brain';
          setDevBotBrainEnabled(enabled);
          addMessage(`Bot AI ${enabled ? 'enabled' : 'disabled'}.`, 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        if (action === 'skill') {
          const heroId = parts[2] ? resolveHeroId(parts[2]) : null;
          const team = resolveTeam(parts[3]);
          const skillKey = resolveBotSkillKey(parts[4]);

          if (parts.length !== 5 || !heroId || !team || !skillKey) {
            addMessage('Usage: /bot skill <hero> <red|blue> <e|q|f|lmb|rmb>', 'error');
            addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
            break;
          }

          devBotSkill(heroId, team, skillKey);
          addMessage(`Holding ${skillKey.toUpperCase()} on a ${team} ${HERO_DEFINITIONS[heroId].name} bot for 10s...`, 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        const heroName = parts[2];
        const heroId = heroName ? resolveHeroId(heroName) : null;
        const team = resolveTeam(parts[3]);

        if (parts.length !== 4 || action !== 'add' || !heroId || !team) {
          addMessage('Usage: /bot add <hero> <red|blue> | /bot skill <hero> <red|blue> <e|q|f|lmb|rmb> | /bot nobrain | /bot brain', 'error');
          addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
          break;
        }

        addGameBot(heroId, team);
        addMessage(`Adding ${HERO_DEFINITIONS[heroId].name} bot to ${team}...`, 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      case '/bots': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const action = parts[1]?.toLowerCase();
        if (parts.length !== 2 || (action !== 'root' && action !== 'release')) {
          addMessage('Usage: /bots root | /bots release', 'error');
          break;
        }

        const shouldRoot = action === 'root';
        setDevBotsRooted(shouldRoot);
        addMessage(`Bots ${shouldRoot ? 'rooted' : 'released'}.`, 'info');
        setTimeout(() => setIsOpen(false), 100);
        break;
      }

      default:
        addMessage(`Unknown command: ${command}. Available commands: ${config.isDev ? DEV_COMMAND_LIST : PUBLIC_COMMAND_LIST}`, 'error');
    }
  }, [addGameBot, addMessage, devBotSkill, devEndGame, devFillUltimate, devSetHero, devSetGameObserver, devSetLobbyObserver, setDevBotBrainEnabled, setDevBotsRooted, setDevImmune, setDevTimeFrozen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeCommand(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Command history navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Chat box panel - positioned bottom-mid left */}
      <div
        className="fixed bottom-4 left-4 w-[500px] max-w-[calc(100vw-2rem)] bg-black/80 backdrop-blur-sm text-green-400 font-mono text-sm z-[9999] flex flex-col rounded-lg border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Messages - compact height with scroll */}
        <div className="max-h-[200px] overflow-y-auto p-3 space-y-1">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`
              ${msg.type === 'input' ? 'text-white' : ''}
              ${msg.type === 'output' ? 'text-green-400' : ''}
              ${msg.type === 'error' ? 'text-red-400' : ''}
              ${msg.type === 'info' ? 'text-cyan-400' : ''}
            `}
            >
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-green-800 p-2 flex">
          <span className="text-green-400 mr-2">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-white caret-green-400"
            placeholder={config.isDev ? `Type ${DEV_COMMAND_LIST}...` : `Type ${PUBLIC_COMMAND_LIST}...`}
            autoComplete="off"
            spellCheck={false}
          />
        </form>

        {/* Help hint */}
        <div className="text-xs text-gray-500 px-3 pb-2">
          Press Enter to open | ESC to close | /seed copy works in any match
        </div>
      </div>
    </>
  );
}
