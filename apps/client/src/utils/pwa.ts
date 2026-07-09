import { isIosDevice } from './platform';

// Installed PWAs (home screen apps) run in their own window and, on iOS, in a
// storage partition the wallet's redirect chain can't reach. These helpers gate
// the install prompt and the wallet session-handoff flow.

export { isIosDevice };

export const PWA_INSTALL_SNOOZE_STORAGE_KEY = 'slop-heroes:pwa-install-prompt-snoozed-at';
export const PWA_INSTALL_SNOOZE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

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

export function isPwaInstallPromptSnoozed(nowMs = Date.now()): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const snoozedAt = Number(window.localStorage.getItem(PWA_INSTALL_SNOOZE_STORAGE_KEY) ?? 0);
    return Boolean(snoozedAt && nowMs - snoozedAt < PWA_INSTALL_SNOOZE_DURATION_MS);
  } catch {
    return false;
  }
}

// iOS only: Android installs are offered natively by Chrome, and the wallet
// sign-in flow needs no help there. Wallet in-app browsers have no share sheet,
// so prompting to install from inside them would dead-end.
export function canOfferPwaInstallInstructions(options: { respectSnooze?: boolean } = {}): boolean {
  if (!isIosDevice()) return false;
  if (isStandaloneDisplayMode()) return false;
  if (isWalletInAppBrowser()) return false;
  if (options.respectSnooze && isPwaInstallPromptSnoozed()) return false;

  return true;
}

export function snoozePwaInstallPrompt(nowMs = Date.now()): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(PWA_INSTALL_SNOOZE_STORAGE_KEY, String(nowMs));
  } catch {
    // Ignore storage failures; the prompt can safely reappear on the next visit.
  }
}
