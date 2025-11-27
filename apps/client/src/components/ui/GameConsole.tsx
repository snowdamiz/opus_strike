import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';

interface ConsoleMessage {
  id: number;
  text: string;
  type: 'input' | 'output' | 'error' | 'info';
}

let messageId = 0;

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

  // Toggle console with backtick key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(prev => !prev);
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
      case '/help':
        addMessage('Available commands:', 'info');
        addMessage('  /pos - Toggle real-time position display', 'info');
        addMessage('  /tp <x> <y> <z> - Teleport to position', 'info');
        addMessage('  /clear - Clear console', 'info');
        addMessage('  /help - Show this help', 'info');
        break;

      case '/pos':
        setShowPosition(prev => !prev);
        addMessage(showPosition ? 'Position display OFF' : 'Position display ON', 'info');
        // Close console after toggling
        setTimeout(() => setIsOpen(false), 100);
        break;

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
      
      {/* Console panel */}
      <div 
        className="fixed top-0 left-0 w-full h-[40%] bg-black/90 text-green-400 font-mono text-sm z-[9999] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
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
        Press ` to toggle console | ESC to close | ↑↓ for history
      </div>
    </div>
    </>
  );
}

