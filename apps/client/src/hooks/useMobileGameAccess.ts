import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMediaQueryListener, useMobileDevice } from './useDeviceCapabilities';
import { isStandaloneDisplayMode } from '../utils/pwa';

export type MobileGameAccessBlockReason = 'portrait' | 'fullscreen';

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

export type MobileGameAccessSnapshot = {
  isFullscreen: boolean;
  isLandscape: boolean;
  isMobile: boolean;
  isRequestFullscreenSupported: boolean;
};

export type MobileGameAccessState = MobileGameAccessSnapshot & {
  blockReason: MobileGameAccessBlockReason | null;
  fullscreenRequestError: string | null;
  isBlocked: boolean;
  isRequestingFullscreen: boolean;
  requestFullscreen: () => Promise<void>;
};

const MOBILE_ACCESS_MEDIA_QUERIES = [
  '(orientation: landscape)',
] as const;

export function useMobileGameAccess(): MobileGameAccessState {
  const isMobile = useMobileDevice();
  const [snapshot, setSnapshot] = useState<MobileGameAccessSnapshot>(() => readMobileGameAccessSnapshot(isMobile));
  const [fullscreenRequestError, setFullscreenRequestError] = useState<string | null>(null);
  const [isRequestingFullscreen, setIsRequestingFullscreen] = useState(false);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(readMobileGameAccessSnapshot(isMobile));
  }, [isMobile]);

  useEffect(() => {
    refreshSnapshot();

    const mediaQueryCleanups = MOBILE_ACCESS_MEDIA_QUERIES.map((query) => (
      addMediaQueryListener(window.matchMedia(query), refreshSnapshot)
    ));

    window.addEventListener('resize', refreshSnapshot);
    window.addEventListener('orientationchange', refreshSnapshot);
    document.addEventListener('fullscreenchange', refreshSnapshot);
    document.addEventListener('webkitfullscreenchange', refreshSnapshot);
    document.addEventListener('visibilitychange', refreshSnapshot);
    window.visualViewport?.addEventListener('resize', refreshSnapshot);

    return () => {
      mediaQueryCleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('resize', refreshSnapshot);
      window.removeEventListener('orientationchange', refreshSnapshot);
      document.removeEventListener('fullscreenchange', refreshSnapshot);
      document.removeEventListener('webkitfullscreenchange', refreshSnapshot);
      document.removeEventListener('visibilitychange', refreshSnapshot);
      window.visualViewport?.removeEventListener('resize', refreshSnapshot);
    };
  }, [refreshSnapshot]);

  const blockReason = getMobileAccessBlockReason(snapshot);

  useEffect(() => {
    if (blockReason !== 'fullscreen') {
      setFullscreenRequestError(null);
    }
  }, [blockReason]);

  const requestFullscreen = useCallback(async () => {
    setFullscreenRequestError(null);

    const target = document.documentElement as WebkitFullscreenElement;
    const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
    if (!request) {
      setFullscreenRequestError('Fullscreen is not available in this browser. Use a browser with fullscreen support to continue.');
      refreshSnapshot();
      return;
    }

    setIsRequestingFullscreen(true);
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' });
      } else {
        await target.webkitRequestFullscreen?.();
      }

      await lockLandscapeOrientation();
    } catch (error) {
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? 'Fullscreen was blocked. Tap the button again from this screen.'
        : 'Fullscreen could not start. Check browser permissions and try again.';
      setFullscreenRequestError(message);
    } finally {
      setIsRequestingFullscreen(false);
      refreshSnapshot();
    }
  }, [refreshSnapshot]);

  return useMemo(() => ({
    ...snapshot,
    blockReason,
    fullscreenRequestError,
    isBlocked: blockReason !== null,
    isRequestingFullscreen,
    requestFullscreen,
  }), [
    blockReason,
    fullscreenRequestError,
    isRequestingFullscreen,
    requestFullscreen,
    snapshot,
  ]);
}

function readMobileGameAccessSnapshot(isMobile: boolean): MobileGameAccessSnapshot {
  return {
    isFullscreen: isFullscreenActive(),
    isLandscape: isLandscapeViewport(),
    isMobile,
    isRequestFullscreenSupported: isFullscreenRequestSupported(),
  };
}

export function getMobileAccessBlockReason(snapshot: MobileGameAccessSnapshot): MobileGameAccessBlockReason | null {
  if (!snapshot.isMobile) return null;
  if (!snapshot.isLandscape) return 'portrait';
  if (!snapshot.isFullscreen && snapshot.isRequestFullscreenSupported) return 'fullscreen';
  return null;
}

function isLandscapeViewport(): boolean {
  if (typeof window === 'undefined') return true;

  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;

  return window.matchMedia('(orientation: landscape)').matches || width > height;
}

function isFullscreenActive(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  const webkitDocument = document as WebkitDocument;

  // Installed PWAs already run without browser chrome; asking for the
  // Fullscreen API on top of that is redundant friction.
  return Boolean(
    document.fullscreenElement ||
    webkitDocument.webkitFullscreenElement ||
    isStandaloneDisplayMode()
  );
}

function isFullscreenRequestSupported(): boolean {
  if (typeof document === 'undefined') return false;

  const target = document.documentElement as WebkitFullscreenElement;
  return Boolean(target.requestFullscreen || target.webkitRequestFullscreen);
}

async function lockLandscapeOrientation(): Promise<void> {
  if (typeof screen === 'undefined') return;

  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  if (typeof orientation?.lock !== 'function') return;

  try {
    await orientation.lock('landscape');
  } catch {
    // Orientation lock is best-effort and often denied unless already fullscreen.
  }
}
