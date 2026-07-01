import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { normalizeObserverFlightSpeed, useGameStore } from '../../store/gameStore';
import { setGameConsoleOpen } from '../../store/gameConsoleState';
import { useChatStore, type ChatMessage } from '../../store/chatStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { config } from '../../config/environment';
import {
  ABILITY_DEFINITIONS,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  ALL_HERO_IDS,
  DEV_TESTING_MAP_PROFILE_ID,
  getDefaultHeroSkinId,
  getHeroSkinsForHero,
  HERO_DEFINITIONS,
} from '@voxel-strike/shared';
import type { AbilityState, HeroId, Team } from '@voxel-strike/shared';
import {
  formatConsoleSkinLine,
  resolveConsoleSkinQuery,
} from './gameConsoleSkinCommands';

interface ConsoleMessage {
  id: number;
  text: string;
  type: 'input' | 'output' | 'error' | 'info';
  timestamp: number;
}

interface DisplayMessage {
  id: string;
  text: string;
  type: ConsoleMessage['type'] | 'chat' | 'team';
  timestamp: number;
  source: 'console' | 'chat';
}

let messageId = 0;

const CHAT_PREVIEW_IDLE_TIMEOUT_MS = 30_000;
const CHAT_PREVIEW_FADE_MS = 500;
const PUBLIC_COMMAND_LIST = '/seed copy, /observer <low|med|hight>';
const DEV_COMMAND_LIST = '/seed copy, /observer <low|med|hight>, /devtarget, /immune, /hero <hero>, /hero down <hero>, /skins <hero>, /skins apply <skin>, /end, /bot add <hero> <red|blue>, /bot skill <hero> <red|blue> <e|q|f|lmb|rmb>, /bot look <hero> <red|blue> <up|down>, /bot nobrain, /bot brain, /bots root, /bots release, /f, /time freeze';
type BotLookDirection = 'up' | 'down';
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

function resolveBotLookDirection(value: string | undefined): BotLookDirection | null {
  const normalized = value?.toLowerCase();
  return normalized === 'up' || normalized === 'down' ? normalized : null;
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
    skinId: getDefaultHeroSkinId(heroId),
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

function formatChatMessage(message: ChatMessage): string {
  const prefix = message.teamOnly ? '[Team] ' : '';
  return `${prefix}${message.playerName}: ${message.message}`;
}

function toDisplayMessages(consoleMessages: ConsoleMessage[], chatMessages: ChatMessage[]): DisplayMessage[] {
  return [
    ...consoleMessages.map((message) => ({
      id: `console:${message.id}`,
      text: message.text,
      type: message.type,
      timestamp: message.timestamp,
      source: 'console' as const,
    })),
    ...chatMessages.map((message) => ({
      id: `chat:${message.id}`,
      text: formatChatMessage(message),
      type: message.teamOnly ? 'team' as const : 'chat' as const,
      timestamp: message.timestamp,
      source: 'chat' as const,
    })),
  ].sort((left, right) => left.timestamp - right.timestamp);
}

export function GameConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const chatMessages = useChatStore((state) => state.messages);
  const [isChatPreviewMounted, setIsChatPreviewMounted] = useState(false);
  const [isChatPreviewVisible, setIsChatPreviewVisible] = useState(false);
  const [messages, setMessages] = useState<ConsoleMessage[]>(() => [
    {
      id: messageId++,
      text: config.isDev ? 'Developer Console' : 'Game Chat',
      type: 'info',
      timestamp: Date.now(),
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    devSetHero,
    devSetSkin,
    devDownHero,
    devFillUltimate,
    devEndGame,
    setDevImmune,
    setDevTimeFrozen,
    setDevBotsRooted,
    setDevBotBrainEnabled,
    addGameBot,
    devBotSkill,
    devBotLook,
    sendChatMessage,
  } = useNetwork();

  const displayMessages = useMemo(() => toDisplayMessages(messages, chatMessages), [messages, chatMessages]);
  const visibleMessages = useMemo(
    () => (isOpen ? displayMessages.slice(-80) : displayMessages.filter((message) => message.source === 'chat').slice(-5)),
    [displayMessages, isOpen]
  );
  const latestChatMessageId = chatMessages[chatMessages.length - 1]?.id ?? null;
  const lastVisibleMessageId = visibleMessages[visibleMessages.length - 1]?.id ?? null;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastVisibleMessageId]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Update global state when console opens/closes
  useEffect(() => {
    setGameConsoleOpen(isOpen);
    return () => {
      setGameConsoleOpen(false);
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

  useEffect(() => {
    if (!latestChatMessageId) {
      setIsChatPreviewVisible(false);
      return;
    }

    setIsChatPreviewMounted(true);
    setIsChatPreviewVisible(true);

    const timeoutId = window.setTimeout(() => {
      setIsChatPreviewVisible(false);
    }, CHAT_PREVIEW_IDLE_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [latestChatMessageId]);

  useEffect(() => {
    if (isChatPreviewVisible) return;

    const timeoutId = window.setTimeout(() => {
      setIsChatPreviewMounted(false);
    }, CHAT_PREVIEW_FADE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isChatPreviewVisible]);

  const addMessage = useCallback((text: string, type: ConsoleMessage['type'] = 'output') => {
    setMessages(prev => [...prev, { id: messageId++, text, type, timestamp: Date.now() }]);
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    if (!trimmed.startsWith('/')) {
      if (!sendChatMessage(trimmed)) {
        addMessage('Chat is unavailable while disconnected.', 'error');
        return;
      }

      setIsOpen(false);
      return;
    }

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

      case '/observer': {
        const speed = normalizeObserverFlightSpeed(parts[1]?.toLowerCase() ?? '');
        if (parts.length !== 2 || !speed) {
          addMessage('Usage: /observer low|med|hight', 'error');
          break;
        }

        useGameStore.getState().setObserverFlightSpeed(speed);
        addMessage(`Observer flight speed set to ${speed}.`, 'info');
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

        const action = parts[1]?.toLowerCase();
        if (action === 'down') {
          const heroName = parts.slice(2).join(' ');
          const heroId = resolveHeroId(heroName);

          if (!heroName || !heroId) {
            addMessage('Usage: /hero down <hero name>', 'error');
            addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
            break;
          }

          devDownHero(heroId);
          addMessage(`Downing teammate ${HERO_DEFINITIONS[heroId].name} for revive testing...`, 'info');
          setTimeout(() => setIsOpen(false), 100);
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

      case '/skins': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        const action = parts[1]?.toLowerCase();
        if (action === 'apply') {
          const skinName = parts.slice(2).join(' ');
          const store = useGameStore.getState();
          const localHeroId = store.localPlayer?.heroId ?? null;

          if (!skinName) {
            addMessage('Usage: /skins apply <skin name>', 'error');
            break;
          }
          if (!store.localPlayer || !localHeroId) {
            addMessage('No active hero to apply a skin to.', 'error');
            break;
          }

          const resolution = resolveConsoleSkinQuery(skinName, { heroId: localHeroId });
          if (resolution.status === 'empty' || resolution.status === 'not_found') {
            addMessage(`Unknown skin: ${skinName}`, 'error');
            break;
          }
          if (resolution.status === 'ambiguous') {
            addMessage(`Ambiguous skin: ${skinName}`, 'error');
            addMessage(`Matches: ${resolution.matches.map((skin) => skin.displayName).join(', ')}`, 'info');
            break;
          }

          const skin = resolution.skin;
          if (skin.heroId !== localHeroId) {
            addMessage(`${skin.displayName} belongs to ${HERO_DEFINITIONS[skin.heroId].name}. Switch hero first.`, 'error');
            break;
          }

          store.updateLocalPlayer({ skinId: skin.id });
          devSetSkin(skin.id);
          addMessage(`Applying ${skin.displayName} (${skin.id})...`, 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        const heroName = parts.slice(1).join(' ');
        const heroId = resolveHeroId(heroName);

        if (!heroName || !heroId) {
          addMessage('Usage: /skins <hero name> | /skins apply <skin name>', 'error');
          addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
          break;
        }

        addMessage(`Skins for ${HERO_DEFINITIONS[heroId].name}:`, 'info');
        for (const skin of getHeroSkinsForHero(heroId)) {
          addMessage(formatConsoleSkinLine(skin), 'output');
        }
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

      case '/devtarget': {
        if (!config.isDev) {
          addMessage('Developer commands are disabled outside development builds.', 'error');
          break;
        }

        if (parts.length !== 1) {
          addMessage('Usage: /devtarget', 'error');
          break;
        }

        const store = useGameStore.getState();
        const isDevTestingMap = (
          store.isPracticeMode &&
          store.gamePhase === 'playing' &&
          store.mapProfileId === DEV_TESTING_MAP_PROFILE_ID
        );

        if (!isDevTestingMap) {
          addMessage('Start Practice before using /devtarget.', 'error');
          break;
        }

        store.requestDevTestingTargetBotHold();
        addMessage('Dev target bot reset to center and frozen.', 'info');
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

        if (action === 'look') {
          const heroId = parts[2] ? resolveHeroId(parts[2]) : null;
          const team = resolveTeam(parts[3]);
          const direction = resolveBotLookDirection(parts[4]);

          if (parts.length !== 5 || !heroId || !team || !direction) {
            addMessage('Usage: /bot look <hero> <red|blue> <up|down>', 'error');
            addMessage(`Valid heroes: ${validHeroNames()}`, 'info');
            break;
          }

          devBotLook(heroId, team, direction);
          addMessage(`Forcing a ${team} ${HERO_DEFINITIONS[heroId].name} bot to look ${direction} for 10s...`, 'info');
          setTimeout(() => setIsOpen(false), 100);
          break;
        }

        const heroName = parts[2];
        const heroId = heroName ? resolveHeroId(heroName) : null;
        const team = resolveTeam(parts[3]);

        if (parts.length !== 4 || action !== 'add' || !heroId || !team) {
          addMessage('Usage: /bot add <hero> <red|blue> | /bot skill <hero> <red|blue> <e|q|f|lmb|rmb> | /bot look <hero> <red|blue> <up|down> | /bot nobrain | /bot brain', 'error');
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
  }, [addGameBot, addMessage, devBotLook, devBotSkill, devDownHero, devEndGame, devFillUltimate, devSetHero, devSetSkin, sendChatMessage, setDevBotBrainEnabled, setDevBotsRooted, setDevImmune, setDevTimeFrozen]);

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

  const shouldShowClosedPreview = isChatPreviewMounted && visibleMessages.length > 0;

  if (!isOpen && !shouldShowClosedPreview) {
    return null;
  }

  return (
    <>
      <div
        className={`fixed left-4 z-[9999] flex max-w-[calc(100vw-2rem)] flex-col rounded-lg border font-mono text-sm transition-[opacity,transform] duration-500 ease-out ${
          isOpen
            ? 'bottom-[clamp(2.05rem,3.1vw,2.65rem)] w-[500px] border-white/[0.07] bg-black/[0.10] opacity-100 shadow-[0_0.7rem_1.8rem_rgb(0_0_0_/_0.1)] backdrop-blur-[2px]'
            : `bottom-[clamp(2.05rem,3.1vw,2.65rem)] pointer-events-none w-[420px] border-white/[0.07] bg-black/[0.10] shadow-[0_0.7rem_1.8rem_rgb(0_0_0_/_0.1)] backdrop-blur-[2px] ${isChatPreviewVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${isOpen ? 'max-h-[220px]' : 'max-h-[150px]'} space-y-1 overflow-y-auto p-3`}>
          {visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={`break-words leading-relaxed ${
                msg.type === 'input' ? 'text-white/80' : ''
              } ${
                msg.type === 'output' ? 'text-emerald-300' : ''
              } ${
                msg.type === 'error' ? 'text-red-300' : ''
              } ${
                msg.type === 'info' ? 'text-cyan-300' : ''
              } ${
                msg.type === 'chat' ? 'text-white' : ''
              } ${
                msg.type === 'team' ? 'text-sky-200' : ''
              }`}
            >
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {isOpen && (
          <form onSubmit={handleSubmit} className="flex border-t border-white/[0.07] p-2">
            <span className="mr-2 text-cyan-300">{'>'}</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-w-0 flex-1 bg-transparent text-white outline-none caret-cyan-300"
              placeholder={config.isDev ? 'Message or /seed copy' : 'Message'}
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        )}
      </div>
    </>
  );
}
