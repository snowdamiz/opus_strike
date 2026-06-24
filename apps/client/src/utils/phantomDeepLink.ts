import bs58 from 'bs58';
import nacl from 'tweetnacl';

const PHANTOM_DEEP_LINK_BASE_URL = 'https://phantom.app/ul/v1';
const PHANTOM_DEEP_LINK_SESSION_KEY = 'opusStrike.phantomDeepLink.session';
const PHANTOM_DEEP_LINK_REQUEST_KEY = 'opusStrike.phantomDeepLink.request';
const PHANTOM_DEEP_LINK_REQUEST_TTL_MS = 20 * 60 * 1000;

const CALLBACK_ACTION_PARAM = 'phantom_action';
const CALLBACK_REQUEST_PARAM = 'phantom_request';
const PHANTOM_CALLBACK_PARAMS = [
  CALLBACK_ACTION_PARAM,
  CALLBACK_REQUEST_PARAM,
  'phantom_encryption_public_key',
  'nonce',
  'data',
  'errorCode',
  'errorMessage',
];

type PhantomDeepLinkAction = 'connect' | 'signMessage';
type PhantomDeepLinkPurpose = 'connect' | 'linkWallet' | 'walletAuth';

interface StoredPhantomDeepLinkSession {
  version: 1;
  publicKey: string;
  session: string;
  dappEncryptionPublicKey: string;
  dappEncryptionSecretKey: string;
  phantomEncryptionPublicKey: string;
  sharedSecret: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredPhantomDeepLinkRequest {
  version: 1;
  action: PhantomDeepLinkAction;
  requestId: string;
  createdAt: number;
  purpose?: PhantomDeepLinkPurpose;
  dappEncryptionPublicKey?: string;
  dappEncryptionSecretKey?: string;
  authNonce?: string;
}

interface PhantomConnectData {
  public_key: string;
  session: string;
}

interface PhantomSignMessageData {
  signature: string;
}

export type PhantomMobileDeepLinkCallbackResult =
  | { handled: false }
  | {
    handled: true;
    ok: false;
    action: PhantomDeepLinkAction | null;
    error: string;
    errorCode: string | null;
  }
  | {
    handled: true;
    ok: true;
    action: 'connect';
    publicKey: string;
    purpose: PhantomDeepLinkPurpose;
  }
  | {
    handled: true;
    ok: true;
    action: 'signMessage';
    publicKey: string;
    signature: string;
    authNonce: string;
  };

export function canUsePhantomMobileDeepLink(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isIPadOsDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

  return isMobileUserAgent || isIPadOsDesktopMode;
}

export function getPhantomMobileDeepLinkSession(): { publicKey: string } | null {
  const session = readStoredSession();
  return session ? { publicKey: session.publicKey } : null;
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

  return Boolean(readStoredRequest()) && (
    params.has('data') ||
    params.has('errorCode') ||
    params.has('errorMessage')
  );
}

export function startPhantomMobileConnect(purpose: PhantomDeepLinkPurpose = 'connect'): void {
  const keyPair = nacl.box.keyPair();
  const requestId = createRequestId();
  const dappEncryptionPublicKey = bs58.encode(keyPair.publicKey);
  const dappEncryptionSecretKey = bs58.encode(keyPair.secretKey);

  writeStoredRequest({
    version: 1,
    action: 'connect',
    requestId,
    createdAt: Date.now(),
    purpose,
    dappEncryptionPublicKey,
    dappEncryptionSecretKey,
  });

  const params = new URLSearchParams({
    app_url: getAppUrl(),
    dapp_encryption_public_key: dappEncryptionPublicKey,
    redirect_link: createRedirectLink('connect', requestId),
  });

  window.location.assign(`${PHANTOM_DEEP_LINK_BASE_URL}/connect?${params.toString()}`);
}

export function startPhantomMobileSignMessage(options: {
  publicKey: string;
  message: string;
  authNonce: string;
}): void {
  const session = readStoredSession();
  if (!session || session.publicKey !== options.publicKey) {
    throw new Error('Phantom mobile session is not available. Please reconnect Phantom.');
  }

  const requestId = createRequestId();
  const encryptionNonce = nacl.randomBytes(24);
  const payload = JSON.stringify({
    message: bs58.encode(new TextEncoder().encode(options.message)),
    session: session.session,
    display: 'utf8',
  });
  const encryptedPayload = nacl.box.after(
    new TextEncoder().encode(payload),
    encryptionNonce,
    bs58.decode(session.sharedSecret)
  );

  writeStoredRequest({
    version: 1,
    action: 'signMessage',
    requestId,
    createdAt: Date.now(),
    authNonce: options.authNonce,
  });

  const params = new URLSearchParams({
    dapp_encryption_public_key: session.dappEncryptionPublicKey,
    nonce: bs58.encode(encryptionNonce),
    redirect_link: createRedirectLink('signMessage', requestId),
    payload: bs58.encode(encryptedPayload),
  });

  window.location.assign(`${PHANTOM_DEEP_LINK_BASE_URL}/signMessage?${params.toString()}`);
}

export function waitForPhantomMobileRedirect<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

export function handlePhantomMobileDeepLinkCallback(): PhantomMobileDeepLinkCallbackResult {
  if (typeof window === 'undefined') return { handled: false };

  const url = new URL(window.location.href);
  const params = url.searchParams;
  const request = readStoredRequest();
  const action = parseAction(params.get(CALLBACK_ACTION_PARAM)) ?? request?.action ?? null;

  if (!hasPhantomMobileDeepLinkCallback()) return { handled: false };

  const errorCode = params.get('errorCode');
  if (errorCode) {
    removeStorageItem(PHANTOM_DEEP_LINK_REQUEST_KEY);
    cleanPhantomCallbackParams(url);
    return {
      handled: true,
      ok: false,
      action,
      error: getPhantomDeepLinkErrorMessage(action, errorCode, params.get('errorMessage')),
      errorCode,
    };
  }

  try {
    if (!request) {
      throw new Error('Phantom connection expired. Please try again.');
    }

    if (Date.now() - request.createdAt > PHANTOM_DEEP_LINK_REQUEST_TTL_MS) {
      removeStorageItem(PHANTOM_DEEP_LINK_REQUEST_KEY);
      throw new Error('Phantom connection expired. Please try again.');
    }

    const callbackRequestId = params.get(CALLBACK_REQUEST_PARAM);
    if (!callbackRequestId || callbackRequestId !== request.requestId) {
      throw new Error('Phantom returned an unexpected connection response. Please try again.');
    }

    if (request.action === 'connect') {
      return handleConnectCallback(params, request, url);
    }

    return handleSignMessageCallback(params, request, url);
  } catch (error) {
    cleanPhantomCallbackParams(url);
    return {
      handled: true,
      ok: false,
      action,
      error: error instanceof Error ? error.message : 'Phantom connection failed. Please try again.',
      errorCode: null,
    };
  }
}

function handleConnectCallback(
  params: URLSearchParams,
  request: StoredPhantomDeepLinkRequest,
  url: URL
): PhantomMobileDeepLinkCallbackResult {
  if (!request.dappEncryptionPublicKey || !request.dappEncryptionSecretKey) {
    throw new Error('Phantom connection state is incomplete. Please try again.');
  }

  const phantomEncryptionPublicKey = getRequiredParam(params, 'phantom_encryption_public_key');
  const sharedSecret = nacl.box.before(
    bs58.decode(phantomEncryptionPublicKey),
    bs58.decode(request.dappEncryptionSecretKey)
  );
  const connectData = decryptPayload<PhantomConnectData>(
    getRequiredParam(params, 'data'),
    getRequiredParam(params, 'nonce'),
    sharedSecret
  );

  if (!connectData.public_key || !connectData.session) {
    throw new Error('Phantom returned an incomplete connection response.');
  }

  const now = Date.now();
  writeStoredSession({
    version: 1,
    publicKey: connectData.public_key,
    session: connectData.session,
    dappEncryptionPublicKey: request.dappEncryptionPublicKey,
    dappEncryptionSecretKey: request.dappEncryptionSecretKey,
    phantomEncryptionPublicKey,
    sharedSecret: bs58.encode(sharedSecret),
    createdAt: now,
    updatedAt: now,
  });
  removeStorageItem(PHANTOM_DEEP_LINK_REQUEST_KEY);
  cleanPhantomCallbackParams(url);

  return {
    handled: true,
    ok: true,
    action: 'connect',
    publicKey: connectData.public_key,
    purpose: request.purpose ?? 'connect',
  };
}

function handleSignMessageCallback(
  params: URLSearchParams,
  request: StoredPhantomDeepLinkRequest,
  url: URL
): PhantomMobileDeepLinkCallbackResult {
  const session = readStoredSession();
  if (!session || !request.authNonce) {
    throw new Error('Phantom signature state is incomplete. Please try again.');
  }

  const signMessageData = decryptPayload<PhantomSignMessageData>(
    getRequiredParam(params, 'data'),
    getRequiredParam(params, 'nonce'),
    bs58.decode(session.sharedSecret)
  );

  if (!signMessageData.signature) {
    throw new Error('Phantom did not return a message signature.');
  }

  removeStorageItem(PHANTOM_DEEP_LINK_REQUEST_KEY);
  cleanPhantomCallbackParams(url);

  return {
    handled: true,
    ok: true,
    action: 'signMessage',
    publicKey: session.publicKey,
    signature: signMessageData.signature,
    authNonce: request.authNonce,
  };
}

function decryptPayload<T>(data: string, nonce: string, sharedSecret: Uint8Array): T {
  const decryptedPayload = nacl.box.open.after(
    bs58.decode(data),
    bs58.decode(nonce),
    sharedSecret
  );

  if (!decryptedPayload) {
    throw new Error('Unable to decrypt Phantom response. Please reconnect Phantom.');
  }

  return JSON.parse(new TextDecoder().decode(decryptedPayload)) as T;
}

function createRedirectLink(action: PhantomDeepLinkAction, requestId: string): string {
  const url = new URL(window.location.href);
  cleanPhantomParams(url);
  url.searchParams.set(CALLBACK_ACTION_PARAM, action);
  url.searchParams.set(CALLBACK_REQUEST_PARAM, requestId);
  return url.toString();
}

function cleanPhantomCallbackParams(url: URL): void {
  cleanPhantomParams(url);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function cleanPhantomParams(url: URL): void {
  for (const param of PHANTOM_CALLBACK_PARAMS) {
    url.searchParams.delete(param);
  }
}

function getAppUrl(): string {
  const url = new URL(window.location.href);
  return url.origin;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return bs58.encode(nacl.randomBytes(16));
}

function getRequiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) {
    throw new Error('Phantom returned an incomplete response. Please try again.');
  }
  return value;
}

function parseAction(value: string | null): PhantomDeepLinkAction | null {
  return value === 'connect' || value === 'signMessage' ? value : null;
}

function getPhantomDeepLinkErrorMessage(
  action: PhantomDeepLinkAction | null,
  errorCode: string,
  errorMessage: string | null
): string {
  if (errorCode === '4001') {
    return action === 'signMessage'
      ? 'Signature rejected. Please sign the message to connect Phantom.'
      : 'Connection rejected. Please approve the connection request.';
  }

  return errorMessage || 'Phantom connection failed. Please try again.';
}

function readStoredSession(): StoredPhantomDeepLinkSession | null {
  const session = readStorageJson<StoredPhantomDeepLinkSession>(PHANTOM_DEEP_LINK_SESSION_KEY);
  if (!session || session.version !== 1 || !session.publicKey || !session.session || !session.sharedSecret) {
    return null;
  }

  return session;
}

function writeStoredSession(session: StoredPhantomDeepLinkSession): void {
  writeStorageJson(PHANTOM_DEEP_LINK_SESSION_KEY, session);
}

function readStoredRequest(): StoredPhantomDeepLinkRequest | null {
  const request = readStorageJson<StoredPhantomDeepLinkRequest>(PHANTOM_DEEP_LINK_REQUEST_KEY);
  if (!request || request.version !== 1 || !request.requestId) return null;
  return request;
}

function writeStoredRequest(request: StoredPhantomDeepLinkRequest): void {
  writeStorageJson(PHANTOM_DEEP_LINK_REQUEST_KEY, request);
}

function readStorageJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}
