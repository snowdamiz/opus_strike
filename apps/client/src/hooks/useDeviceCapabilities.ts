import { useEffect, useState } from 'react';

export const TOUCH_CONTROLS_QUERY = '(pointer: coarse), (hover: none)';

const MOBILE_VIEWPORT_QUERY = '(max-width: 820px)';
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
const TOUCH_CAPABILITY_QUERIES = [TOUCH_CONTROLS_QUERY];
const MOBILE_DEVICE_QUERIES = [MOBILE_VIEWPORT_QUERY];

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

export function isTouchControlsAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  return window.matchMedia(TOUCH_CONTROLS_QUERY).matches || navigator.maxTouchPoints > 0;
}

export function useTouchControlsAvailable(): boolean {
  return useDeviceCapability(isTouchControlsAvailable, TOUCH_CAPABILITY_QUERIES);
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const isMobileUserAgent = MOBILE_USER_AGENT_PATTERN.test(userAgent);
  const isIPadOsDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  const isTouchNarrowViewport = navigator.maxTouchPoints > 0 && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;

  return isMobileUserAgent || isIPadOsDesktopMode || isTouchNarrowViewport;
}

export function useMobileDevice(): boolean {
  return useDeviceCapability(isMobileDevice, MOBILE_DEVICE_QUERIES);
}

function useDeviceCapability(readCapability: () => boolean, mediaQueries: string[]): boolean {
  const [available, setAvailable] = useState(readCapability);

  useEffect(() => {
    const updateAvailability = () => setAvailable(readCapability());
    const mediaQueryLists = mediaQueries.map((query) => window.matchMedia(query));
    const cleanups = mediaQueryLists.map((mediaQuery) => addMediaQueryListener(mediaQuery, updateAvailability));

    updateAvailability();

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [mediaQueries, readCapability]);

  return available;
}

function addMediaQueryListener(mediaQuery: MediaQueryList, listener: (event: MediaQueryListEvent) => void): () => void {
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }

  const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
  legacyMediaQuery.addListener?.(listener);
  return () => legacyMediaQuery.removeListener?.(listener);
}
