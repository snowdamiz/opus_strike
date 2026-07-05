import bs58 from 'bs58';
import nacl from 'tweetnacl';

const MOBILE_WALLET_DEEP_LINK_REQUEST_TTL_MS = 20 * 60 * 1000;
const MOBILE_WALLET_DEEP_LINK_SESSION_KEY_PREFIX = 'opusStrike.mobileWalletDeepLink.session';
const MOBILE_WALLET_DEEP_LINK_REQUEST_KEY = 'opusStrike.mobileWalletDeepLink.request';

const CALLBACK_PROVIDER_PARAM = 'wallet_provider';
const CALLBACK_ACTION_PARAM = 'wallet_action';
const CALLBACK_REQUEST_PARAM = 'wallet_request';
const MOBILE_WALLET_CALLBACK_PARAMS = [
  CALLBACK_PROVIDER_PARAM,
  CALLBACK_ACTION_PARAM,
  CALLBACK_REQUEST_PARAM,
  'phantom_encryption_public_key',
  'solflare_encryption_public_key',
  'wallet_encryption_public_key',
  'nonce',
  'data',
  'errorCode',
  'errorMessage',
];

export type MobileWalletDeepLinkProviderId = 'phantom' | 'solflare' | 'backpack';
export type MobileWalletDeepLinkAction = 'connect' | 'signMessage';
export type MobileWalletDeepLinkPurpose = 'connect' | 'linkWallet' | 'walletAuth';

interface MobileWalletDeepLinkProviderConfig {
  id: MobileWalletDeepLinkProviderId;
  name: string;
  universalBaseUrl: string;
  customSchemeBaseUrl?: string;
  connectResponseEncryptionPublicKeyParam: string;
}

export const MOBILE_WALLET_DEEP_LINK_PROVIDERS: MobileWalletDeepLinkProviderConfig[] = [
  {
    id: 'phantom',
    name: 'Phantom',
    universalBaseUrl: 'https://phantom.app/ul/v1',
    customSchemeBaseUrl: 'phantom://v1',
    connectResponseEncryptionPublicKeyParam: 'phantom_encryption_public_key',
  },
  {
    id: 'solflare',
    name: 'Solflare',
    universalBaseUrl: 'https://solflare.com/ul/v1',
    connectResponseEncryptionPublicKeyParam: 'solflare_encryption_public_key',
  },
  {
    id: 'backpack',
    name: 'Backpack',
    universalBaseUrl: 'https://backpack.app/ul/v1',
    connectResponseEncryptionPublicKeyParam: 'wallet_encryption_public_key',
  },
];

interface StoredMobileWalletDeepLinkSession {
  version: 1;
  providerId: MobileWalletDeepLinkProviderId;
  publicKey: string;
  session: string;
  dappEncryptionPublicKey: string;
  dappEncryptionSecretKey: string;
  walletEncryptionPublicKey: string;
  sharedSecret: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredMobileWalletDeepLinkRequest {
  version: 1;
  providerId: MobileWalletDeepLinkProviderId;
  action: MobileWalletDeepLinkAction;
  requestId: string;
  createdAt: number;
  purpose?: MobileWalletDeepLinkPurpose;
  dappEncryptionPublicKey?: string;
  dappEncryptionSecretKey?: string;
  authNonce?: string;
}

interface MobileWalletConnectData {
  public_key: string;
  session: string;
}

interface MobileWalletSignMessageData {
  signature: string;
}

export type MobileWalletDeepLinkCallbackResult =
  | { handled: false }
  | {
    handled: true;
    ok: false;
    providerId: MobileWalletDeepLinkProviderId | null;
    action: MobileWalletDeepLinkAction | null;
    error: string;
    errorCode: string | null;
  }
  | {
    handled: true;
    ok: true;
    providerId: MobileWalletDeepLinkProviderId;
    action: 'connect';
    publicKey: string;
    purpose: MobileWalletDeepLinkPurpose;
  }
  | {
    handled: true;
    ok: true;
    providerId: MobileWalletDeepLinkProviderId;
    action: 'signMessage';
    publicKey: string;
    signature: string;
    authNonce: string;
  };

export function canUseMobileWalletDeepLink(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isIPadOsDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

  return isMobileUserAgent || isIPadOsDesktopMode;
}

export function getMobileWalletDeepLinkSession(
  providerId?: MobileWalletDeepLinkProviderId | null
): { providerId: MobileWalletDeepLinkProviderId; publicKey: string } | null {
  if (providerId) {
    const session = readStoredSession(providerId);
    return session ? { providerId: session.providerId, publicKey: session.publicKey } : null;
  }

  for (const provider of MOBILE_WALLET_DEEP_LINK_PROVIDERS) {
    const session = readStoredSession(provider.id);
    if (session) return { providerId: session.providerId, publicKey: session.publicKey };
  }

  return null;
}

export function clearMobileWalletDeepLinkSession(providerId?: MobileWalletDeepLinkProviderId): void {
  if (providerId) {
    removeStorageItem(getSessionStorageKey(providerId));
  } else {
    for (const provider of MOBILE_WALLET_DEEP_LINK_PROVIDERS) {
      removeStorageItem(getSessionStorageKey(provider.id));
    }
  }
  removeStorageItem(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
}

export function hasMobileWalletDeepLinkCallback(): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (
    params.has(CALLBACK_PROVIDER_PARAM) ||
    params.has(CALLBACK_ACTION_PARAM) ||
    params.has(CALLBACK_REQUEST_PARAM) ||
    params.has('phantom_encryption_public_key') ||
    params.has('solflare_encryption_public_key') ||
    params.has('wallet_encryption_public_key')
  ) {
    return true;
  }

  return Boolean(readStoredRequest()) && (
    params.has('data') ||
    params.has('errorCode') ||
    params.has('errorMessage')
  );
}

export function startMobileWalletConnect(
  providerId: MobileWalletDeepLinkProviderId,
  purpose: MobileWalletDeepLinkPurpose = 'connect'
): void {
  const provider = getProviderConfig(providerId);
  const keyPair = nacl.box.keyPair();
  const requestId = createRequestId();
  const dappEncryptionPublicKey = bs58.encode(keyPair.publicKey);
  const dappEncryptionSecretKey = bs58.encode(keyPair.secretKey);

  writeStoredRequest({
    version: 1,
    providerId,
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
    redirect_link: createRedirectLink(providerId, 'connect', requestId),
  });

  openMobileWalletDeepLink(provider, 'connect', params);
}

export function startMobileWalletSignMessage(options: {
  providerId: MobileWalletDeepLinkProviderId;
  publicKey: string;
  message: string;
  authNonce: string;
}): void {
  const provider = getProviderConfig(options.providerId);
  const session = readStoredSession(options.providerId);
  if (!session || session.publicKey !== options.publicKey) {
    throw new Error(`${provider.name} mobile session is not available. Please reconnect ${provider.name}.`);
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
    providerId: options.providerId,
    action: 'signMessage',
    requestId,
    createdAt: Date.now(),
    authNonce: options.authNonce,
  });

  const params = new URLSearchParams({
    dapp_encryption_public_key: session.dappEncryptionPublicKey,
    nonce: bs58.encode(encryptionNonce),
    redirect_link: createRedirectLink(options.providerId, 'signMessage', requestId),
    payload: bs58.encode(encryptedPayload),
  });

  openMobileWalletDeepLink(provider, 'signMessage', params);
}

export function waitForMobileWalletRedirect<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

export function createMobileWalletDeepLinkUrl(
  providerId: MobileWalletDeepLinkProviderId,
  action: MobileWalletDeepLinkAction,
  params: URLSearchParams,
  options: { preferCustomScheme?: boolean } = {}
): string {
  const provider = getProviderConfig(providerId);
  const preferCustomScheme = options.preferCustomScheme ?? canUseMobileWalletDeepLink();
  const baseUrl = preferCustomScheme && provider.customSchemeBaseUrl
    ? provider.customSchemeBaseUrl
    : provider.universalBaseUrl;
  return `${baseUrl}/${action}?${params.toString()}`;
}

export function handleMobileWalletDeepLinkCallback(): MobileWalletDeepLinkCallbackResult {
  if (typeof window === 'undefined') return { handled: false };

  const url = new URL(window.location.href);
  const params = url.searchParams;
  const request = readStoredRequest();
  const providerId = parseProviderId(params.get(CALLBACK_PROVIDER_PARAM)) ?? request?.providerId ?? null;
  const action = parseAction(params.get(CALLBACK_ACTION_PARAM)) ?? request?.action ?? null;

  if (!hasMobileWalletDeepLinkCallback()) return { handled: false };

  const errorCode = params.get('errorCode');
  if (errorCode) {
    removeStorageItem(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
    cleanMobileWalletCallbackParams(url);
    return {
      handled: true,
      ok: false,
      providerId,
      action,
      error: getMobileWalletDeepLinkErrorMessage(providerId, action, errorCode, params.get('errorMessage')),
      errorCode,
    };
  }

  try {
    if (!request || !providerId) {
      throw new Error('Wallet connection expired. Please try again.');
    }

    const provider = getProviderConfig(providerId);

    if (Date.now() - request.createdAt > MOBILE_WALLET_DEEP_LINK_REQUEST_TTL_MS) {
      removeStorageItem(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
      throw new Error(`${provider.name} connection expired. Please try again.`);
    }

    const callbackRequestId = params.get(CALLBACK_REQUEST_PARAM);
    if (!callbackRequestId || callbackRequestId !== request.requestId) {
      throw new Error(`${provider.name} returned an unexpected connection response. Please try again.`);
    }

    if (request.action === 'connect') {
      return handleConnectCallback(params, request, provider, url);
    }

    return handleSignMessageCallback(params, request, provider, url);
  } catch (error) {
    cleanMobileWalletCallbackParams(url);
    return {
      handled: true,
      ok: false,
      providerId,
      action,
      error: error instanceof Error ? error.message : 'Wallet connection failed. Please try again.',
      errorCode: null,
    };
  }
}

function openMobileWalletDeepLink(
  provider: MobileWalletDeepLinkProviderConfig,
  action: MobileWalletDeepLinkAction,
  params: URLSearchParams
): void {
  window.location.assign(createMobileWalletDeepLinkUrl(provider.id, action, params));
}

function handleConnectCallback(
  params: URLSearchParams,
  request: StoredMobileWalletDeepLinkRequest,
  provider: MobileWalletDeepLinkProviderConfig,
  url: URL
): MobileWalletDeepLinkCallbackResult {
  if (!request.dappEncryptionPublicKey || !request.dappEncryptionSecretKey) {
    throw new Error(`${provider.name} connection state is incomplete. Please try again.`);
  }

  const walletEncryptionPublicKey = getRequiredParam(params, provider.connectResponseEncryptionPublicKeyParam, provider);
  const sharedSecret = nacl.box.before(
    bs58.decode(walletEncryptionPublicKey),
    bs58.decode(request.dappEncryptionSecretKey)
  );
  const connectData = decryptPayload<MobileWalletConnectData>(
    getRequiredParam(params, 'data', provider),
    getRequiredParam(params, 'nonce', provider),
    sharedSecret,
    provider
  );

  if (!connectData.public_key || !connectData.session) {
    throw new Error(`${provider.name} returned an incomplete connection response.`);
  }

  const now = Date.now();
  writeStoredSession({
    version: 1,
    providerId: provider.id,
    publicKey: connectData.public_key,
    session: connectData.session,
    dappEncryptionPublicKey: request.dappEncryptionPublicKey,
    dappEncryptionSecretKey: request.dappEncryptionSecretKey,
    walletEncryptionPublicKey,
    sharedSecret: bs58.encode(sharedSecret),
    createdAt: now,
    updatedAt: now,
  });
  removeStorageItem(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
  cleanMobileWalletCallbackParams(url);

  return {
    handled: true,
    ok: true,
    providerId: provider.id,
    action: 'connect',
    publicKey: connectData.public_key,
    purpose: request.purpose ?? 'connect',
  };
}

function handleSignMessageCallback(
  params: URLSearchParams,
  request: StoredMobileWalletDeepLinkRequest,
  provider: MobileWalletDeepLinkProviderConfig,
  url: URL
): MobileWalletDeepLinkCallbackResult {
  const session = readStoredSession(provider.id);
  if (!session || !request.authNonce) {
    throw new Error(`${provider.name} signature state is incomplete. Please try again.`);
  }

  const signMessageData = decryptPayload<MobileWalletSignMessageData>(
    getRequiredParam(params, 'data', provider),
    getRequiredParam(params, 'nonce', provider),
    bs58.decode(session.sharedSecret),
    provider
  );

  if (!signMessageData.signature) {
    throw new Error(`${provider.name} did not return a message signature.`);
  }

  removeStorageItem(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
  cleanMobileWalletCallbackParams(url);

  return {
    handled: true,
    ok: true,
    providerId: provider.id,
    action: 'signMessage',
    publicKey: session.publicKey,
    signature: signMessageData.signature,
    authNonce: request.authNonce,
  };
}

function decryptPayload<T>(
  data: string,
  nonce: string,
  sharedSecret: Uint8Array,
  provider: MobileWalletDeepLinkProviderConfig
): T {
  const decryptedPayload = nacl.box.open.after(
    bs58.decode(data),
    bs58.decode(nonce),
    sharedSecret
  );

  if (!decryptedPayload) {
    throw new Error(`Unable to decrypt ${provider.name} response. Please reconnect ${provider.name}.`);
  }

  return JSON.parse(new TextDecoder().decode(decryptedPayload)) as T;
}

function createRedirectLink(
  providerId: MobileWalletDeepLinkProviderId,
  action: MobileWalletDeepLinkAction,
  requestId: string
): string {
  const url = new URL(window.location.href);
  cleanMobileWalletParams(url);
  url.searchParams.set(CALLBACK_PROVIDER_PARAM, providerId);
  url.searchParams.set(CALLBACK_ACTION_PARAM, action);
  url.searchParams.set(CALLBACK_REQUEST_PARAM, requestId);
  return url.toString();
}

function cleanMobileWalletCallbackParams(url: URL): void {
  cleanMobileWalletParams(url);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function cleanMobileWalletParams(url: URL): void {
  for (const param of MOBILE_WALLET_CALLBACK_PARAMS) {
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

function getRequiredParam(
  params: URLSearchParams,
  name: string,
  provider: MobileWalletDeepLinkProviderConfig
): string {
  const value = params.get(name);
  if (!value) {
    throw new Error(`${provider.name} returned an incomplete response. Please try again.`);
  }
  return value;
}

function parseAction(value: string | null): MobileWalletDeepLinkAction | null {
  return value === 'connect' || value === 'signMessage' ? value : null;
}

function parseProviderId(value: string | null): MobileWalletDeepLinkProviderId | null {
  return MOBILE_WALLET_DEEP_LINK_PROVIDERS.some((provider) => provider.id === value)
    ? value as MobileWalletDeepLinkProviderId
    : null;
}

function getMobileWalletDeepLinkErrorMessage(
  providerId: MobileWalletDeepLinkProviderId | null,
  action: MobileWalletDeepLinkAction | null,
  errorCode: string,
  errorMessage: string | null
): string {
  const providerName = providerId ? getProviderConfig(providerId).name : 'Wallet';
  if (errorCode === '4001') {
    return action === 'signMessage'
      ? `Signature rejected. Please sign the message to connect ${providerName}.`
      : `Connection rejected. Please approve the connection request in ${providerName}.`;
  }

  return errorMessage || `${providerName} connection failed. Please try again.`;
}

function getProviderConfig(providerId: MobileWalletDeepLinkProviderId): MobileWalletDeepLinkProviderConfig {
  const provider = MOBILE_WALLET_DEEP_LINK_PROVIDERS.find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Unsupported mobile wallet provider: ${providerId}`);
  }
  return provider;
}

function readStoredSession(providerId: MobileWalletDeepLinkProviderId): StoredMobileWalletDeepLinkSession | null {
  const session = readStorageJson<StoredMobileWalletDeepLinkSession>(getSessionStorageKey(providerId));
  if (
    !session ||
    session.version !== 1 ||
    session.providerId !== providerId ||
    !session.publicKey ||
    !session.session ||
    !session.sharedSecret
  ) {
    return null;
  }

  return session;
}

function writeStoredSession(session: StoredMobileWalletDeepLinkSession): void {
  writeStorageJson(getSessionStorageKey(session.providerId), session);
}

function readStoredRequest(): StoredMobileWalletDeepLinkRequest | null {
  const request = readStorageJson<StoredMobileWalletDeepLinkRequest>(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY);
  if (!request || request.version !== 1 || !request.requestId || !parseProviderId(request.providerId)) return null;
  return request;
}

function writeStoredRequest(request: StoredMobileWalletDeepLinkRequest): void {
  writeStorageJson(MOBILE_WALLET_DEEP_LINK_REQUEST_KEY, request);
}

function getSessionStorageKey(providerId: MobileWalletDeepLinkProviderId): string {
  return `${MOBILE_WALLET_DEEP_LINK_SESSION_KEY_PREFIX}.${providerId}`;
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
