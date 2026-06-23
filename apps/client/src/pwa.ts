import { useCallback, useEffect, useState } from 'react';

type PwaInstallChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<PwaInstallChoice>;
};

const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'] as const;
const PWA_DOWNLOADED_STORAGE_KEY = 'voxel:pwaDownloaded';

let isInstallTrackingInitialized = false;
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;
let hasInstalledPwa = isRunningAsInstalledPwa();
let hasDownloadedPwa = hasRecordedPwaDownload() || hasInstalledPwa;
let hasDismissedPwaInstallToast = false;
const installPromptSubscribers = new Set<() => void>();

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => undefined);
    return;
  }

  const register = () => {
    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'imports',
    }).catch(() => undefined);
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

export function usePwaInstallPrompt() {
  const [
    { hasDownloaded, installPrompt, isInstalled, isInstallToastDismissed },
    setInstallState,
  ] = useState(getPwaInstallState);

  useEffect(() => {
    initializeInstallPromptTracking();

    const updateInstallState = () => setInstallState(getPwaInstallState());
    installPromptSubscribers.add(updateInstallState);
    updateInstallState();

    return () => {
      installPromptSubscribers.delete(updateInstallState);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) {
      return;
    }

    pendingInstallPrompt = null;
    notifyInstallPromptSubscribers();

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice.outcome === 'accepted') {
      rememberPwaDownload();
      notifyInstallPromptSubscribers();
    }
  }, [installPrompt]);

  const dismissInstallToast = useCallback(() => {
    hasDismissedPwaInstallToast = true;
    notifyInstallPromptSubscribers();
  }, []);

  const canPromptInstall = Boolean(installPrompt) && !hasDownloaded;

  return {
    canInstall: canPromptInstall && !isInstallToastDismissed,
    canPromptInstall,
    dismissInstallToast,
    hasDownloaded,
    install,
    isInstalled,
  };
}

initializeInstallPromptTracking();

function initializeInstallPromptTracking(): void {
  if (isInstallTrackingInitialized || typeof window === 'undefined') {
    return;
  }

  isInstallTrackingInitialized = true;

  const updateInstalledState = () => {
    hasInstalledPwa = isRunningAsInstalledPwa();

    if (hasInstalledPwa) {
      rememberPwaDownload();
      pendingInstallPrompt = null;
    }

    notifyInstallPromptSubscribers();
  };

  const handleBeforeInstallPrompt = (event: Event) => {
    if (!getPwaInstallState().hasDownloaded) {
      event.preventDefault();
      pendingInstallPrompt = event as BeforeInstallPromptEvent;
      notifyInstallPromptSubscribers();
    }
  };

  const handleAppInstalled = () => {
    hasInstalledPwa = true;
    rememberPwaDownload();
    pendingInstallPrompt = null;
    notifyInstallPromptSubscribers();
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);
  INSTALLED_DISPLAY_MODES.forEach((displayMode) => {
    window.matchMedia(`(display-mode: ${displayMode})`).addEventListener('change', updateInstalledState);
  });
  updateInstalledState();
}

function getPwaInstallState() {
  const isInstalled = hasInstalledPwa || isRunningAsInstalledPwa();
  const hasDownloaded = hasDownloadedPwa || hasRecordedPwaDownload() || isInstalled;

  return {
    hasDownloaded,
    installPrompt: hasDownloaded ? null : pendingInstallPrompt,
    isInstallToastDismissed: hasDismissedPwaInstallToast,
    isInstalled,
  };
}

function notifyInstallPromptSubscribers(): void {
  installPromptSubscribers.forEach((subscriber) => subscriber());
}

function isRunningAsInstalledPwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };

  return (
    navigatorWithStandalone.standalone === true ||
    INSTALLED_DISPLAY_MODES.some((displayMode) => window.matchMedia(`(display-mode: ${displayMode})`).matches)
  );
}

function rememberPwaDownload(): void {
  hasDownloadedPwa = true;

  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PWA_DOWNLOADED_STORAGE_KEY, '1');
  } catch {
    // Storage can be unavailable in private browsing or locked-down webviews.
  }
}

function hasRecordedPwaDownload(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(PWA_DOWNLOADED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
