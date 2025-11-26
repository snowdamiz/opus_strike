import { useGameStore } from '../../store/gameStore';
import { useNetwork } from '../../contexts/NetworkContext';

interface InGameMenuProps {
  onClose: () => void;
}

export function InGameMenu({ onClose }: InGameMenuProps) {
  const { playerName, currentLobbyName } = useGameStore();
  const { leaveGame } = useNetwork();

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

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleResume}
      />
      
      {/* Menu panel */}
      <div className="relative z-10 w-full max-w-sm animate-scale-in">
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="p-6 text-center border-b border-strike-border bg-strike-elevated/50">
            <h2 className="font-display text-3xl text-orange-500">PAUSED</h2>
            {currentLobbyName && (
              <p className="font-body text-white/40 text-sm mt-1">{currentLobbyName}</p>
            )}
          </div>

          {/* Menu options */}
          <div className="p-4 space-y-2">
            <MenuButton onClick={handleResume} primary>
              RESUME
            </MenuButton>
            
            <MenuButton onClick={() => {}}>
              SETTINGS
            </MenuButton>
            
            <MenuButton onClick={() => {}}>
              CONTROLS
            </MenuButton>
            
            <div className="pt-2 border-t border-strike-border">
              <MenuButton onClick={handleLeaveGame} danger>
                LEAVE GAME
              </MenuButton>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="text-center mt-4">
          <p className="font-body text-xs text-white/30">
            Press <span className="text-white/50">ESC</span> to resume
          </p>
        </div>
      </div>

      {/* Player info */}
      <div className="absolute bottom-4 left-4">
        <div className="px-4 py-2 bg-strike-surface/90 border border-strike-border rounded-lg backdrop-blur-sm">
          <span className="font-body text-white/40 text-sm">Playing as </span>
          <span className="font-display text-orange-400">{playerName}</span>
        </div>
      </div>
    </div>
  );
}

interface MenuButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}

function MenuButton({ children, onClick, primary, danger }: MenuButtonProps) {
  let className = `
    w-full py-3 font-display text-lg rounded-lg transition-all duration-150
    active:scale-[0.98]
  `;

  if (primary) {
    className += ` bg-orange-500 text-white hover:bg-orange-400`;
  } else if (danger) {
    className += ` bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20`;
  } else {
    className += ` bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white`;
  }

  return (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  );
}
