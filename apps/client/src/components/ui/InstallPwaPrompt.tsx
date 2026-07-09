import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { canOfferPwaInstallInstructions } from '../../utils/pwa';
import { useAppAuth } from '../../contexts/WalletContext';

const SHOW_DELAY_MS = 2500;

// Dismissal is deliberately not persisted: on iOS we want the App prompt on
// every fresh web load. This module-level flag only suppresses re-showing the
// toast within the current page session (e.g. bouncing menu → match → menu),
// and resets on reload/reopen.
let dismissedThisPageSession = false;

export function ShareGlyph() {
  return (
    <svg className="pwa-install-share-glyph" viewBox="0 0 16 20" aria-hidden="true">
      <path d="M8 1.5v10M8 1.5L4.5 5M8 1.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8H3a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 3 18h10a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13 8h-1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function InstallPwaPrompt() {
  const { user } = useAppAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (dismissedThisPageSession) return;
    if (!canOfferPwaInstallInstructions()) return;

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    dismissedThisPageSession = true;
    setVisible(false);
  };

  // We only reach here on iOS Safari (never inside the installed App — that's
  // gated out by canOfferPwaInstallInstructions). If the signed-in account has
  // opened the installed App before, nudge them to switch back to it instead of
  // re-pitching the install. iOS can't launch the home-screen App from Safari,
  // so this is intentionally instructional rather than a one-tap switch.
  const hasOpenedApp = Boolean(user?.appOpenedAt);

  if (hasOpenedApp) {
    return (
      <div className="pwa-install-toast" role="status" aria-live="polite">
        <img className="pwa-install-icon" src="/icons/icon-192.png" alt="" />
        <div className="pwa-install-copy">
          <div className="pwa-install-title">Open the App</div>
          <div className="pwa-install-text">
            You have Slop Heroes installed. Open it from your <strong>Home Screen</strong> for
            fullscreen play and faster sign-in.
          </div>
        </div>
        <button type="button" className="pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss App reminder">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="pwa-install-toast" role="status" aria-live="polite">
      <img className="pwa-install-icon" src="/icons/icon-192.png" alt="" />
      <div className="pwa-install-copy">
        <div className="pwa-install-title">Install Slop Heroes</div>
        <div className="pwa-install-text">
          Get fullscreen play and faster wallet sign-in: tap <ShareGlyph /> then{' '}
          <strong>Add to Home Screen</strong>.
        </div>
      </div>
      <button type="button" className="pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss install prompt">
        <X size={16} />
      </button>
    </div>
  );
}
