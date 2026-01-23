import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { HERO_DEFINITIONS, ALL_HERO_IDS } from '@voxel-strike/shared';
import type { HeroId, Team } from '@voxel-strike/shared';

interface ConsoleMessage {
  id: number;
  text: string;
  type: 'input' | 'output' | 'error' | 'info';
}

let messageId = 0;

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

// Position display component - shows real-time position in top-right
function PositionDisplay() {
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Update position by reading directly from store every frame
    const interval = setInterval(() => {
      const { localPlayer } = useGameStore.getState();
      if (localPlayer?.position) {
        setPosition({
          x: localPlayer.position.x,
          y: localPlayer.position.y,
          z: localPlayer.position.z,
        });
      }
    }, 50); // 20 updates per second

    return () => clearInterval(interval);
  }, []);

  // Listen for 'p' key to copy position
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't copy if console is open or typing in an input
      if (isConsoleOpenGlobal) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'p' || e.key === 'P') {
        const posString = `{ x: ${position.x.toFixed(1)}, z: ${position.z.toFixed(1)} }`;
        navigator.clipboard.writeText(posString).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [position]);

  return (
    <div className="fixed top-4 right-4 bg-black/80 text-green-400 font-mono text-sm px-4 py-2 rounded z-[9998] border border-green-800">
      <div className="text-xs text-gray-400 mb-1">Press P to copy | /pos to hide</div>
      <div>X: <span className="text-white">{position.x.toFixed(2)}</span></div>
      <div>Y: <span className="text-white">{position.y.toFixed(2)}</span></div>
      <div>Z: <span className="text-white">{position.z.toFixed(2)}</span></div>
      {copied && (
        <div className="text-xs text-yellow-400 mt-1 animate-pulse">
          Copied to clipboard!
        </div>
      )}
    </div>
  );
}

export function GameConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ConsoleMessage[]>([
    { id: messageId++, text: 'Game Console - Type /help for commands', type: 'info' }
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showPosition, setShowPosition] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get network functions for NPC operations
  const network = useNetwork();

  // Set the network functions for projectiles to use
  useEffect(() => {
    setNetworkDamageNpc(network.damageNpc);
    setNetworkKillNpc(network.killNpc);
  }, [network.damageNpc, network.killNpc]);

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

  const executeCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Add to history
    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    // Echo input
    addMessage(`> ${trimmed}`, 'input');

    // Parse command
    const parts = trimmed.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/help': {
        const topic = parts[1]?.toLowerCase();

        if (!topic) {
          // Main help overview
          addMessage('╔════════════════════════════════════════╗', 'info');
          addMessage('║       OPUS STRIKE DEVELOPER CONSOLE     ║', 'info');
          addMessage('╚════════════════════════════════════════╝', 'info');
          addMessage('', 'info');
          addMessage('Type /help <topic> for detailed help. Topics:', 'info');
          addMessage('  /help spawn    - How to spawn NPC heroes', 'info');
          addMessage('  /help combat   - How to damage and eliminate NPCs', 'info');
          addMessage('  /help movement - Teleportation and position tools', 'info');
          addMessage('  /help all      - Show all commands with examples', 'info');
          addMessage('', 'info');
          addMessage('Quick Start:', 'output');
          addMessage('  1. Type /heroes to see available hero types', 'output');
          addMessage('  2. Type /spawn phantom red to spawn a Phantom on red team', 'output');
          addMessage('  3. Use abilities (E, Q, F keys) to eliminate NPCs!', 'output');
          addMessage('  4. Type /npcs to see all spawned NPCs', 'output');
        } else if (topic === 'spawn') {
          addMessage('═══ SPAWNING HEROES ═══', 'info');
          addMessage('', 'info');
          addMessage('/heroes', 'output');
          addMessage('  Lists all available hero types with their stats.', 'info');
          addMessage('', 'info');
          addMessage('/spawn <heroId> [team]', 'output');
          addMessage('  Spawns an NPC hero near your current position.', 'info');
          addMessage('  • heroId: phantom, hookshot, blaze, glacier, pulse, sentinel', 'info');
          addMessage('  • team: red or blue (random if not specified)', 'info');
          addMessage('  Examples:', 'info');
          addMessage('    /spawn phantom        - Spawn Phantom on random team', 'output');
          addMessage('    /spawn blaze red      - Spawn Blaze on red team', 'output');
          addMessage('    /spawn glacier blue   - Spawn Glacier on blue team', 'output');
          addMessage('', 'info');
          addMessage('/spawnat <heroId> <x> <y> <z> [team]', 'output');
          addMessage('  Spawns an NPC at exact coordinates.', 'info');
          addMessage('  Examples:', 'info');
          addMessage('    /spawnat phantom 0 5 10        - Spawn at position', 'output');
          addMessage('    /spawnat sentinel 10 2 -5 red  - Spawn at position on red team', 'output');
          addMessage('', 'info');
          addMessage('/npcs', 'output');
          addMessage('  Lists all spawned NPCs with their IDs, health, and positions.', 'info');
        } else if (topic === 'combat') {
          addMessage('═══ COMBAT & ELIMINATION ═══', 'info');
          addMessage('', 'info');
          addMessage('Use your hero abilities to eliminate NPCs!', 'info');
          addMessage('  E key - Primary ability', 'output');
          addMessage('  Q key - Secondary ability', 'output');
          addMessage('  F key - Ultimate ability', 'output');
          addMessage('', 'info');
          addMessage('/damage <npcId> <amount>', 'output');
          addMessage('  Deals damage to an NPC. Kills if HP reaches 0.', 'info');
          addMessage('  • npcId: Full ID or partial match (e.g., "0" matches "npc_0")', 'info');
          addMessage('  Examples:', 'info');
          addMessage('    /damage npc_0 50      - Deal 50 damage to npc_0', 'output');
          addMessage('    /damage 1 100         - Deal 100 damage to first matching NPC', 'output');
          addMessage('', 'info');
          addMessage('/kill <npcId>', 'output');
          addMessage('  Instantly eliminates an NPC.', 'info');
          addMessage('  Examples:', 'info');
          addMessage('    /kill npc_0           - Kill npc_0', 'output');
          addMessage('    /kill 2               - Kill NPC with "2" in its ID', 'output');
          addMessage('', 'info');
          addMessage('/killall', 'output');
          addMessage('  Removes ALL spawned NPCs at once.', 'info');
          addMessage('', 'info');
          addMessage('/godmode', 'output');
          addMessage('  Toggle invincibility for your player.', 'info');
        } else if (topic === 'movement') {
          addMessage('═══ MOVEMENT & POSITION ═══', 'info');
          addMessage('', 'info');
          addMessage('/pos', 'output');
          addMessage('  Toggle real-time position display in top-right corner.', 'info');
          addMessage('  Press P while display is on to copy position to clipboard.', 'info');
          addMessage('', 'info');
          addMessage('/tp <x> <y> <z>', 'output');
          addMessage('  Teleport your player to exact coordinates.', 'info');
          addMessage('  • Y is the vertical axis (height)', 'info');
          addMessage('  Examples:', 'info');
          addMessage('    /tp 0 10 0             - Teleport to center, 10 units high', 'output');
          addMessage('    /tp -20 5 30           - Teleport to specific position', 'output');
        } else if (topic === 'all') {
          addMessage('═══ ALL COMMANDS ═══', 'info');
          addMessage('', 'info');
          addMessage('─── Navigation ───', 'info');
          addMessage('  /pos                     - Toggle position display', 'output');
          addMessage('  /tp <x> <y> <z>          - Teleport to coordinates', 'output');
          addMessage('', 'info');
          addMessage('─── NPC Spawning ───', 'info');
          addMessage('  /heroes                  - List hero types', 'output');
          addMessage('  /spawn <hero> [team]     - Spawn NPC near you', 'output');
          addMessage('  /spawnat <hero> <x> <y> <z> [team]  - Spawn at position', 'output');
          addMessage('  /npcs                    - List all NPCs', 'output');
          addMessage('', 'info');
          addMessage('─── Combat ───', 'info');
          addMessage('  /damage <npc> <amount>   - Damage an NPC', 'output');
          addMessage('  /kill <npc>              - Instantly kill an NPC', 'output');
          addMessage('  /killall                 - Kill all NPCs', 'output');
          addMessage('  /godmode                 - Toggle invincibility', 'output');
          addMessage('', 'info');
          addMessage('─── Utility ───', 'info');
          addMessage('  /clear                   - Clear console', 'output');
          addMessage('  /help [topic]            - Show help', 'output');
        } else {
          addMessage(`Unknown help topic: "${topic}"`, 'error');
          addMessage('Available topics: spawn, combat, movement, all', 'info');
        }
        break;
      }

      case '/heroes':
        addMessage('Available heroes:', 'info');
        ALL_HERO_IDS.forEach((heroId) => {
          const def = HERO_DEFINITIONS[heroId];
          addMessage(`  ${heroId} - ${def.name} (${def.role}) - HP: ${def.stats.maxHealth}`, 'output');
        });
        break;

      case '/spawn': {
        const heroId = parts[1]?.toLowerCase() as HeroId;
        const teamArg = parts[2]?.toLowerCase();

        if (!heroId || !ALL_HERO_IDS.includes(heroId)) {
          addMessage(`Usage: /spawn <heroId> [team]`, 'error');
          addMessage(`Valid heroes: ${ALL_HERO_IDS.join(', ')}`, 'error');
          break;
        }

        // If team specified, validate it
        if (teamArg && teamArg !== 'red' && teamArg !== 'blue') {
          addMessage('Error: Team must be "red" or "blue"', 'error');
          break;
        }

        // Send spawn request to server
        // If no team specified, server will spawn on OPPOSITE team (so you can damage them)
        const team = teamArg as Team | undefined;
        network.spawnNpc(heroId, team as Team);

        if (team) {
          addMessage(`Requesting spawn of ${HERO_DEFINITIONS[heroId].name} on ${team} team...`, 'info');
        } else {
          addMessage(`Requesting spawn of ${HERO_DEFINITIONS[heroId].name} on enemy team...`, 'info');
        }
        break;
      }

      case '/spawnat': {
        const heroId = parts[1]?.toLowerCase() as HeroId;
        const x = parseFloat(parts[2]);
        const y = parseFloat(parts[3]);
        const z = parseFloat(parts[4]);
        const teamArg = parts[5]?.toLowerCase();

        if (!heroId || !ALL_HERO_IDS.includes(heroId)) {
          addMessage(`Usage: /spawnat <heroId> <x> <y> <z> [team]`, 'error');
          addMessage(`Valid heroes: ${ALL_HERO_IDS.join(', ')}`, 'error');
          break;
        }

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          addMessage('Error: Invalid coordinates', 'error');
          break;
        }

        if (teamArg && teamArg !== 'red' && teamArg !== 'blue') {
          addMessage('Error: Team must be "red" or "blue"', 'error');
          break;
        }

        // Send spawn request to server with specific position
        const team = teamArg as Team | undefined;
        network.spawnNpc(heroId, team, { x, y, z });

        if (team) {
          addMessage(`Requesting spawn of ${HERO_DEFINITIONS[heroId].name} on ${team} team at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})...`, 'info');
        } else {
          addMessage(`Requesting spawn of ${HERO_DEFINITIONS[heroId].name} on enemy team at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})...`, 'info');
        }
        break;
      }

      case '/npcs': {
        const { players } = useGameStore.getState();
        const npcIds = getSpawnedNpcIds();

        if (npcIds.length === 0) {
          addMessage('No NPCs spawned. Use /spawn <heroId> to create one.', 'info');
          break;
        }

        addMessage(`Spawned NPCs (${npcIds.length}):`, 'info');
        npcIds.forEach((npcId) => {
          const npc = players.get(npcId);
          if (npc) {
            const pos = npc.position;
            addMessage(`  ${npcId}: ${npc.name} (${npc.heroId}, ${npc.team}) - HP: ${npc.health}/${npc.maxHealth} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`, 'output');
          }
        });
        break;
      }

      case '/kill': {
        const npcId = parts[1];

        if (!npcId) {
          addMessage('Usage: /kill <npcId>', 'error');
          addMessage('Use /npcs to see spawned NPC IDs', 'info');
          break;
        }

        // Support partial matching
        const npcIds = getSpawnedNpcIds();
        let targetId = npcId;
        if (!npcIds.includes(npcId)) {
          // Try to find a partial match
          for (const id of npcIds) {
            if (id.includes(npcId)) {
              targetId = id;
              break;
            }
          }
        }

        if (!npcIds.includes(targetId) && !targetId.startsWith('npc_')) {
          addMessage(`NPC "${npcId}" not found. Use /npcs to see spawned NPCs.`, 'error');
          break;
        }

        // Send kill request to server
        network.killNpc(targetId);
        addMessage(`Eliminating ${targetId}...`, 'info');
        break;
      }

      case '/damage': {
        const npcId = parts[1];
        const damage = parseFloat(parts[2]);

        if (!npcId || isNaN(damage)) {
          addMessage('Usage: /damage <npcId> <amount>', 'error');
          break;
        }

        // Support partial matching
        const npcIds = getSpawnedNpcIds();
        let targetId = npcId;
        if (!npcIds.includes(npcId)) {
          for (const id of npcIds) {
            if (id.includes(npcId)) {
              targetId = id;
              break;
            }
          }
        }

        if (!npcIds.includes(targetId) && !targetId.startsWith('npc_')) {
          addMessage(`NPC "${npcId}" not found. Use /npcs to see spawned NPCs.`, 'error');
          break;
        }

        // Send damage request to server
        network.damageNpc(targetId, damage);
        addMessage(`Dealing ${damage} damage to ${targetId}...`, 'info');
        break;
      }

      case '/killall': {
        const npcIds = getSpawnedNpcIds();

        if (npcIds.length === 0) {
          addMessage('No NPCs to remove.', 'info');
          break;
        }

        // Send kill all request to server
        network.killAllNpcs();
        addMessage(`Eliminating all ${npcIds.length} NPCs...`, 'info');
        break;
      }

      case '/godmode': {
        const { localPlayer, updateLocalPlayer } = useGameStore.getState();
        if (!localPlayer) {
          addMessage('Error: No local player', 'error');
          break;
        }

        // Toggle between max health (999999) and normal
        const isGodMode = localPlayer.maxHealth > 10000;
        if (isGodMode) {
          const heroStats = localPlayer.heroId ? HERO_DEFINITIONS[localPlayer.heroId].stats : { maxHealth: 200 };
          updateLocalPlayer({ health: heroStats.maxHealth, maxHealth: heroStats.maxHealth });
          addMessage('God mode OFF', 'info');
        } else {
          updateLocalPlayer({ health: 999999, maxHealth: 999999 });
          addMessage('God mode ON - You are invincible!', 'info');
        }
        break;
      }

      case '/pos':
        setShowPosition(prev => !prev);
        addMessage(showPosition ? 'Position display OFF' : 'Position display ON', 'info');
        // Close console after toggling
        setTimeout(() => setIsOpen(false), 100);
        break;

      case '/debug': {
        const { debugMode, toggleDebugMode } = useGameStore.getState();
        toggleDebugMode();
        addMessage(`Debug mode ${!debugMode ? 'ON' : 'OFF'} - Performance monitor ${!debugMode ? 'visible' : 'hidden'}`, 'info');
        break;
      }

      case '/tp':
        if (parts.length >= 4) {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            // Teleport will be handled by updating store
            const { updateLocalPlayer } = useGameStore.getState();
            updateLocalPlayer({ position: { x, y, z } });
            addMessage(`Teleported to: X=${x}, Y=${y}, Z=${z}`, 'output');
          } else {
            addMessage('Error: Invalid coordinates', 'error');
          }
        } else {
          addMessage('Usage: /tp <x> <y> <z>', 'error');
        }
        break;

      case '/clear':
        setMessages([{ id: messageId++, text: 'Console cleared', type: 'info' }]);
        break;

      default:
        addMessage(`Unknown command: ${command}. Type /help for available commands.`, 'error');
    }
  }, [addMessage, showPosition]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(input);
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

  // Always render position display if enabled, even when console is closed
  if (!isOpen) {
    return showPosition ? <PositionDisplay /> : null;
  }

  return (
    <>
      {/* Position display (always visible when enabled) */}
      {showPosition && <PositionDisplay />}

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
            placeholder="Type a command..."
            autoComplete="off"
            spellCheck={false}
          />
        </form>

        {/* Help hint */}
        <div className="text-xs text-gray-500 px-3 pb-2">
          Press Enter to open | ESC to close | Type /debug to toggle performance monitor
        </div>
      </div>
    </>
  );
}

