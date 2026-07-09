import { isIosDevice } from './platform';

// Installed PWAs (home screen apps) run in their own window and, on iOS, in a
// storage partition the wallet's redirect chain can't reach. These helpers gate
// the install prompt and the wallet session-handoff flow.

export { isIosDevice };

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  if (window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) {
    return true;
  }
  return (navigator as { standalone?: boolean }).standalone === true;
}

// Wallet in-app browsers (Phantom, Solflare, Backpack) have no share sheet with
// "Add to Home Screen", so the install prompt is pointless there.
export function isWalletInAppBrowser(): boolean {
  if (typeof window === 'undefined') return false;

  const win = window as {
    phantom?: { solana?: unknown };
    solflare?: unknown;
    backpack?: unknown;
  };
  return Boolean(win.phantom?.solana || win.solflare || win.backpack);
}

// iOS only: Android installs are offered natively by Chrome, and the wallet
// sign-in flow needs no help there. Wallet in-app browsers have no share sheet,
// so prompting to install from inside them would dead-end.
//
// No persistent snooze: on iOS we want the App prompt on every web visit, so
// dismissal is intentionally session-scoped (handled by the toast component)
// rather than remembered across page loads.
export function canOfferPwaInstallInstructions(): boolean {
  if (!isIosDevice()) return false;
  if (isStandaloneDisplayMode()) return false;
  if (isWalletInAppBrowser()) return false;

  return true;
}
