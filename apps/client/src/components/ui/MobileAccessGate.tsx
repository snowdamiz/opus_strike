import { Fullscreen, RotateCw, Smartphone } from 'lucide-react';
import type { MobileGameAccessState } from '../../hooks/useMobileGameAccess';

interface MobileAccessGateProps {
  access: MobileGameAccessState;
}

export function MobileAccessGate({ access }: MobileAccessGateProps) {
  if (!access.isBlocked) return null;

  const isPortrait = access.blockReason === 'portrait';
  const title = isPortrait ? 'Flip To Landscape' : 'Go Fullscreen';
  const message = isPortrait
    ? 'Turn your device sideways to continue.'
    : 'Landscape is ready. Fullscreen is required before lobby or match controls unlock.';
  const Icon = isPortrait ? RotateCw : Fullscreen;

  return (
    <div className="mobile-access-gate" role="dialog" aria-modal="true" aria-labelledby="mobile-access-gate-title">
      <div className="mobile-access-gate-panel">
        <div className="mobile-access-gate-device" aria-hidden="true">
          <Smartphone className="mobile-access-gate-phone" />
          <Icon className="mobile-access-gate-action-icon" />
        </div>

        <div className="mobile-access-gate-copy">
          <p className="mobile-access-gate-kicker">Mobile Setup</p>
          <h2 id="mobile-access-gate-title" className="mobile-access-gate-title">{title}</h2>
          <p className="mobile-access-gate-message">{message}</p>
        </div>

        {!isPortrait && (
          <div className="mobile-access-gate-actions">
            <button
              type="button"
              className="mobile-access-gate-button"
              onClick={() => void access.requestFullscreen()}
              disabled={access.isRequestingFullscreen}
            >
              <Fullscreen aria-hidden="true" />
              <span>{access.isRequestingFullscreen ? 'Opening...' : 'Go Fullscreen'}</span>
            </button>
            {!access.isRequestFullscreenSupported && (
              <p className="mobile-access-gate-help">
                This browser cannot start fullscreen from the page. Use a browser with fullscreen support to continue.
              </p>
            )}
          </div>
        )}

        {access.fullscreenRequestError && (
          <p className="mobile-access-gate-error" role="alert">{access.fullscreenRequestError}</p>
        )}
      </div>
    </div>
  );
}
