// Installed PWAs (home screen apps) run in their own window and, on iOS, in a
// storage partition the wallet's redirect chain can't reach. These helpers gate
// the install prompt and the wallet session-handoff flow.

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  if (window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) {
    return true;
  }
  return (navigator as { standalone?: boolean }).standalone === true;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ reports itself as Macintosh; the touch check tells them apart.
  return /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
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
