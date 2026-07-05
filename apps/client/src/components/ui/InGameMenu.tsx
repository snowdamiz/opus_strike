import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { isTouchControlsAvailable } from '../../hooks/useDeviceCapabilities';
import { SettingsModal } from './SettingsModal';
import { GameDialog } from './GameDialog';

const UNSTUCK_REQUEST_COOLDOWN_MS = 15000;

interface InGameMenuProps {
  onClose: () => void;
}

export function InGameMenu({ onClose }: InGameMenuProps) {
  const playerName = useGameStore((state) => state.playerName);
  const [showSettings, setShowSettings] = useState(false);
  const [unstuckRequested, setUnstuckRequested] = useState(false);
  const unstuckCooldownTimer = useRef<number | null>(null);
  const { leaveGame, requestUnstuck } = useNetwork();

  useEffect(() => () => {
    if (unstuckCooldownTimer.current !== null) {
      window.clearTimeout(unstuckCooldownTimer.current);
    }
  }, []);

  const handleResume = () => {
    if (isTouchControlsAvailable()) {
      onClose();
      return;
    }

    const canvas = document.querySelector('canvas');
    if (canvas) {
      let lockPromise: Promise<void> | void;

      try {
        lockPromise = canvas.requestPointerLock();
      } catch {
        onClose();
        return;
      }

      if (lockPromise && typeof lockPromise.then === 'function') {
        lockPromise.then(() => {
          onClose();
        }).catch(() => {
          onClose();
        });
      } else {
        let fallbackTimer: number | null = null;
        const handleLockChange = () => {
          document.removeEventListener('pointerlockchange', handleLockChange);
          if (fallbackTimer !== null) {
            window.clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          onClose();
        };
        document.addEventListener('pointerlockchange', handleLockChange);
        fallbackTimer = window.setTimeout(() => {
          document.removeEventListener('pointerlockchange', handleLockChange);
          fallbackTimer = null;
          onClose();
        }, 200);
      }
    } else {
      onClose();
    }
  };

  const handleLeaveGame = () => {
    leaveGame();
  };

  const handleUnstuck = () => {
    if (unstuckRequested) return;
    requestUnstuck();
    setUnstuckRequested(true);
    if (unstuckCooldownTimer.current !== null) {
      window.clearTimeout(unstuckCooldownTimer.current);
    }
    unstuckCooldownTimer.current = window.setTimeout(() => {
      setUnstuckRequested(false);
      unstuckCooldownTimer.current = null;
    }, UNSTUCK_REQUEST_COOLDOWN_MS);
  };

  return (
    <>
      <GameDialog
        title="PAUSED"
        icon={(
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5h3v14H8V5zm5 0h3v14h-3V5z" />
          </svg>
        )}
        size="sm"
        onClose={handleResume}
        showCloseButton={false}
        panelClassName="pause-menu-dialog"
        bodyClassName="pause-menu-body p-4 space-y-2"
      >
        <MenuButton onClick={handleResume} primary>
          RESUME
        </MenuButton>

        <MenuButton onClick={() => setShowSettings(true)}>
          SETTINGS
        </MenuButton>

        <MenuButton onClick={handleUnstuck} disabled={unstuckRequested}>
          {unstuckRequested ? 'UNSTUCK REQUESTED' : 'UNSTUCK'}
        </MenuButton>

        <div className="pause-menu-separator pt-2 border-t border-strike-border">
          <MenuButton onClick={handleLeaveGame} danger>
            LEAVE GAME
          </MenuButton>
        </div>
      </GameDialog>

      {/* Player info */}
      <div className="pause-player-info fixed bottom-4 left-4 z-modal">
        <div className="pause-player-card px-4 py-2 bg-strike-surface/90 border border-strike-border rounded-lg backdrop-blur-sm">
          <span className="font-body text-white/40 text-sm">Playing as </span>
          <span className="font-display text-orange-400">{playerName}</span>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}

interface MenuButtonProps {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

function MenuButton({ children, onClick, primary, danger, disabled = false }: MenuButtonProps) {
  let className = `
    pause-menu-button w-full py-3 font-display text-lg rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45
  `;

  if (primary) {
    className += disabled ? ` bg-orange-500 text-white` : ` bg-orange-500 text-white hover:bg-orange-400`;
  } else if (danger) {
    className += disabled
      ? ` bg-red-500/10 border border-red-500/30 text-red-400`
      : ` bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20`;
  } else {
    className += disabled
      ? ` bg-white/5 border border-white/10 text-white/70`
      : ` bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white`;
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}
