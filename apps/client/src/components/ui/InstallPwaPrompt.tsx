import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { canOfferPwaInstallInstructions, snoozePwaInstallPrompt } from '../../utils/pwa';

const SHOW_DELAY_MS = 2500;

export function ShareGlyph() {
  return (
    <svg className="pwa-install-share-glyph" viewBox="0 0 16 20" aria-hidden="true">
      <path d="M8 1.5v10M8 1.5L4.5 5M8 1.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8H3a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 3 18h10a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13 8h-1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function InstallPwaPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!canOfferPwaInstallInstructions({ respectSnooze: true })) return;

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    snoozePwaInstallPrompt();
  };

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
