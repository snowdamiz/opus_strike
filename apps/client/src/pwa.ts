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

let isInstallTrackingInitialized = false;
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;
let hasInstalledPwa = isRunningAsInstalledPwa();
const installPromptSubscribers = new Set<() => void>();

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
}

export function usePwaInstallPrompt() {
  const [{ installPrompt, isInstalled }, setInstallState] = useState(getPwaInstallState);

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
      hasInstalledPwa = true;
      notifyInstallPromptSubscribers();
    }
  }, [installPrompt]);

  return {
    canInstall: Boolean(installPrompt) && !isInstalled,
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
      pendingInstallPrompt = null;
    }

    notifyInstallPromptSubscribers();
  };

  const handleBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();

    if (!isRunningAsInstalledPwa()) {
      pendingInstallPrompt = event as BeforeInstallPromptEvent;
      notifyInstallPromptSubscribers();
    }
  };

  const handleAppInstalled = () => {
    hasInstalledPwa = true;
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

  return {
    installPrompt: isInstalled ? null : pendingInstallPrompt,
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
