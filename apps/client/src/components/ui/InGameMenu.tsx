import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';
import { SettingsModal } from './SettingsModal';
import { GameDialog } from './GameDialog';

interface InGameMenuProps {
  onClose: () => void;
}

export function InGameMenu({ onClose }: InGameMenuProps) {
  const playerName = useGameStore((state) => state.playerName);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const localPlayerState = useGameStore((state) => state.localPlayer?.state ?? null);
  const unstuckCooldownUntil = useGameStore((state) => state.unstuckCooldownUntil);
  const requestUnstuck = useGameStore((state) => state.requestUnstuck);
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { leaveGame } = useNetwork();
  const unstuckRemainingMs = Math.max(0, unstuckCooldownUntil - now);
  const isUnstuckCoolingDown = unstuckRemainingMs > 0;
  const canUseUnstuck =
    !isUnstuckCoolingDown &&
    localPlayerState === 'alive' &&
    (gamePhase === 'playing' || gamePhase === 'countdown');
  const unstuckLabel = isUnstuckCoolingDown
    ? `UNSTUCK (${Math.ceil(unstuckRemainingMs / 1000)}s)`
    : 'UNSTUCK';

  useEffect(() => {
    if (!isUnstuckCoolingDown) return;

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, [isUnstuckCoolingDown, unstuckCooldownUntil]);

  const handleResume = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const lockPromise = canvas.requestPointerLock();

      if (lockPromise && typeof lockPromise.then === 'function') {
        lockPromise.then(() => {
          onClose();
        }).catch(() => {
          onClose();
        });
      } else {
        const handleLockChange = () => {
          document.removeEventListener('pointerlockchange', handleLockChange);
          onClose();
        };
        document.addEventListener('pointerlockchange', handleLockChange);
        setTimeout(() => {
          document.removeEventListener('pointerlockchange', handleLockChange);
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
    if (requestUnstuck()) {
      handleResume();
    }
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
        bodyClassName="p-4 space-y-2"
        footerClassName="px-6 py-4 border-t border-white/5 bg-strike-elevated/50 text-center"
        footer={(
          <p className="font-body text-xs text-white/30">
            Press <span className="text-white/50">ESC</span> to resume
          </p>
        )}
      >
        <MenuButton onClick={handleResume} primary>
          RESUME
        </MenuButton>

        <MenuButton onClick={() => setShowSettings(true)}>
          SETTINGS
        </MenuButton>

        <MenuButton onClick={handleUnstuck} disabled={!canUseUnstuck}>
          {unstuckLabel}
        </MenuButton>

        <MenuButton onClick={() => {}}>
          CONTROLS
        </MenuButton>

        <div className="pt-2 border-t border-strike-border">
          <MenuButton onClick={handleLeaveGame} danger>
            LEAVE GAME
          </MenuButton>
        </div>
      </GameDialog>

      {/* Player info */}
      <div className="fixed bottom-4 left-4 z-modal">
        <div className="px-4 py-2 bg-strike-surface/90 border border-strike-border rounded-lg backdrop-blur-sm">
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
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

function MenuButton({ children, onClick, primary, danger, disabled }: MenuButtonProps) {
  let className = `
    w-full py-3 font-display text-lg rounded-lg transition-colors
  `;

  if (disabled) {
    className += ` bg-white/5 border border-white/10 text-white/40 cursor-not-allowed`;
  } else if (primary) {
    className += ` bg-orange-500 text-white hover:bg-orange-400`;
  } else if (danger) {
    className += ` bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20`;
  } else {
    className += ` bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white`;
  }

  return (
    <button type="button" onClick={onClick} className={className} disabled={disabled}>
      {children}
    </button>
  );
}
