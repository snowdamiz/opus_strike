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
      // Request pointer lock immediately during the click event (user gesture required)
      const lockPromise = canvas.requestPointerLock();
      
      // Close menu after pointer lock is acquired (or immediately if promise resolves)
      if (lockPromise && typeof lockPromise.then === 'function') {
        lockPromise.then(() => {
          onClose();
        }).catch(() => {
          // If pointer lock fails, still close the menu
          onClose();
        });
      } else {
        // Fallback for browsers where requestPointerLock doesn't return a promise
        // Wait for pointerlockchange event
        const handleLockChange = () => {
          document.removeEventListener('pointerlockchange', handleLockChange);
          onClose();
        };
        document.addEventListener('pointerlockchange', handleLockChange);
        // Fallback timeout in case event doesn't fire
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
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleResume}
      />
      
      {/* Menu panel */}
      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="bg-voxel-surface border border-voxel-border rounded-t-lg p-6 text-center">
          <h2 
            className="font-display text-3xl text-voxel-primary mb-1"
            style={{ textShadow: '0 0 20px rgba(0, 255, 136, 0.4)' }}
          >
            GAME PAUSED
          </h2>
          {currentLobbyName && (
            <p className="font-body text-gray-400 text-sm">{currentLobbyName}</p>
          )}
        </div>

        {/* Menu options */}
        <div className="bg-voxel-dark border-x border-voxel-border p-4 space-y-3">
          <MenuButton onClick={handleResume} primary>
            RESUME GAME
          </MenuButton>
          
          <MenuButton onClick={() => {}}>
            SETTINGS
          </MenuButton>
          
          <MenuButton onClick={() => {}}>
            CONTROLS
          </MenuButton>
        </div>

        {/* Leave section */}
        <div className="bg-voxel-surface border border-voxel-border rounded-b-lg p-4">
          <MenuButton onClick={handleLeaveGame} danger>
            LEAVE GAME
          </MenuButton>
        </div>

        {/* Footer hint */}
        <div className="text-center mt-4">
          <p className="font-mono text-xs text-gray-600">
            Press <span className="text-gray-400">ESC</span> to resume
          </p>
        </div>
      </div>

      {/* Player info */}
      <div className="absolute bottom-4 left-4">
        <div className="px-4 py-2 bg-voxel-surface/60 backdrop-blur border border-voxel-border rounded">
          <span className="font-body text-gray-400 text-sm">Playing as </span>
          <span className="font-display text-voxel-primary">{playerName}</span>
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
    w-full py-3 font-display text-lg rounded transition-all duration-200
    active:scale-[0.98]
  `;

  if (primary) {
    className += `
      bg-voxel-primary text-voxel-dark font-bold
      hover:bg-voxel-primary/90 hover:shadow-lg hover:shadow-voxel-primary/30
    `;
  } else if (danger) {
    className += `
      bg-red-500/20 border border-red-500/50 text-red-400
      hover:bg-red-500/30 hover:border-red-500
    `;
  } else {
    className += `
      bg-voxel-dark border border-voxel-border text-gray-300
      hover:border-voxel-primary hover:text-voxel-primary
    `;
  }

  return (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  );
}

