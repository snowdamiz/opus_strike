import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isIosDevice, isStandaloneDisplayMode, isWalletInAppBrowser } from '../../utils/pwa';

const SNOOZE_STORAGE_KEY = 'slop-heroes:pwa-install-prompt-snoozed-at';
const SNOOZE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2500;

// iOS only: Android installs are offered natively by Chrome, and the wallet
// sign-in flow needs no help there. Wallet in-app browsers have no share sheet,
// so prompting to install from inside them would dead-end.
function shouldOfferInstallPrompt(): boolean {
  if (!isIosDevice()) return false;
  if (isStandaloneDisplayMode()) return false;
  if (isWalletInAppBrowser()) return false;

  try {
    const snoozedAt = Number(window.localStorage.getItem(SNOOZE_STORAGE_KEY) ?? 0);
    if (snoozedAt && Date.now() - snoozedAt < SNOOZE_DURATION_MS) return false;
  } catch {
    // Without storage the prompt can't snooze; showing it each visit is acceptable.
  }

  return true;
}

function ShareGlyph() {
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
    if (!shouldOfferInstallPrompt()) return;

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(SNOOZE_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <div className="pwa-install-toast" role="status">
      <img className="pwa-install-icon" src="/icons/icon-192.png" alt="" />
      <div className="pwa-install-copy">
        <div className="pwa-install-title">Install Slop Heroes</div>
        <div className="pwa-install-text">
          Get fullscreen play and faster wallet sign-in: tap <ShareGlyph /> then{' '}
          <strong>Add&nbsp;to&nbsp;Home&nbsp;Screen</strong>.
        </div>
      </div>
      <button type="button" className="pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss install prompt">
        <X size={16} />
      </button>
    </div>
  );
}
