import { useState } from 'react';
import { usePwaInstallPrompt } from '../../pwa';
import { useUISounds } from '../../hooks/useAudio';

export function PwaInstallToast() {
  const { canInstall, hasDownloaded, install } = usePwaInstallPrompt();
  const { playButtonClick } = useUISounds();
  const [isInstalling, setIsInstalling] = useState(false);

  if (hasDownloaded || !canInstall) {
    return null;
  }

  const handleInstall = async () => {
    if (isInstalling) {
      return;
    }

    playButtonClick();

    setIsInstalling(true);

    try {
      await install();
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="pwa-install-toast" role="status" aria-live="polite">
      <div className="pwa-install-toast-icon" aria-hidden="true">
        <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 3v10m0 0l4-4m-4 4L8 9" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M5 14v3.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V14" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-body text-xs font-semibold leading-tight text-white/90 sm:text-sm">
          Download for a better experience
        </p>
      </div>

      <button
        type="button"
        className="pwa-install-toast-action"
        onClick={() => void handleInstall()}
        disabled={isInstalling}
        aria-label="Download Slop Heroes app"
      >
        {isInstalling ? 'Opening' : 'Download'}
      </button>
    </div>
  );
}
