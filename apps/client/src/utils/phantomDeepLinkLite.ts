const PHANTOM_DEEP_LINK_SESSION_KEY = 'opusStrike.phantomDeepLink.session';
const PHANTOM_DEEP_LINK_REQUEST_KEY = 'opusStrike.phantomDeepLink.request';

const CALLBACK_ACTION_PARAM = 'phantom_action';
const CALLBACK_REQUEST_PARAM = 'phantom_request';

interface StoredPhantomDeepLinkSession {
  version: 1;
  publicKey: string;
  session: string;
  sharedSecret: string;
}

interface StoredPhantomDeepLinkRequest {
  version: 1;
  requestId: string;
}

export function canUsePhantomMobileDeepLink(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isIPadOsDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

  return isMobileUserAgent || isIPadOsDesktopMode;
}

export function getPhantomMobileDeepLinkSession(): { publicKey: string } | null {
  const session = readStorageJson<StoredPhantomDeepLinkSession>(PHANTOM_DEEP_LINK_SESSION_KEY);
  if (!session || session.version !== 1 || !session.publicKey || !session.session || !session.sharedSecret) {
    return null;
  }

  return { publicKey: session.publicKey };
}

export function clearPhantomMobileDeepLinkSession(): void {
  removeStorageItem(PHANTOM_DEEP_LINK_SESSION_KEY);
  removeStorageItem(PHANTOM_DEEP_LINK_REQUEST_KEY);
}

export function hasPhantomMobileDeepLinkCallback(): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (
    params.has(CALLBACK_ACTION_PARAM) ||
    params.has(CALLBACK_REQUEST_PARAM) ||
    params.has('phantom_encryption_public_key')
  ) {
    return true;
  }

  const request = readStorageJson<StoredPhantomDeepLinkRequest>(PHANTOM_DEEP_LINK_REQUEST_KEY);
  return Boolean(request?.version === 1 && request.requestId) && (
    params.has('data') ||
    params.has('errorCode') ||
    params.has('errorMessage')
  );
}

function readStorageJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}
