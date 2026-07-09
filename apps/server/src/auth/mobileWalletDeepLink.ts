import crypto from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { Request } from 'express';
import { sanitizeReturnTo } from './returnTo';
import type {
  MobileWalletDeepLinkState,
  MobileWalletProviderId,
} from './mobileWalletDeepLinkStore';

interface MobileWalletProviderConfig {
  id: MobileWalletProviderId;
  connectUrl: string;
  signMessageUrl: string;
  encryptionPublicKeyParam: string;
}

export interface MobileWalletConnectResponse {
  public_key: string;
  session: string;
}

export interface MobileWalletSignMessageResponse {
  signature: string;
}

const MOBILE_WALLET_PROVIDERS = {
  phantom: {
    id: 'phantom',
    connectUrl: 'https://phantom.app/ul/v1/connect',
    signMessageUrl: 'https://phantom.app/ul/v1/signMessage',
    encryptionPublicKeyParam: 'phantom_encryption_public_key',
  },
  solflare: {
    id: 'solflare',
    connectUrl: 'https://solflare.com/ul/v1/connect',
    signMessageUrl: 'https://solflare.com/ul/v1/signMessage',
    encryptionPublicKeyParam: 'solflare_encryption_public_key',
  },
} as const satisfies Record<MobileWalletProviderId, MobileWalletProviderConfig>;

const SIGN_MESSAGE_DISPLAY = 'utf8';

export function parseMobileWalletProviderId(value: unknown): MobileWalletProviderId | null {
  return value === 'phantom' || value === 'solflare' ? value : null;
}

export function createMobileWalletDeepLinkState(input: {
  providerId: MobileWalletProviderId;
  returnTo: unknown;
  authToken: string | null;
  callbackOrigin?: string;
  handoff?: boolean;
  now?: number;
}): MobileWalletDeepLinkState {
  const keyPair = nacl.box.keyPair();

  return {
    id: crypto.randomBytes(24).toString('base64url'),
    providerId: input.providerId,
    phase: 'connect',
    returnTo: sanitizeReturnTo(input.returnTo),
    dappPublicKey: bs58.encode(keyPair.publicKey),
    dappSecretKey: bs58.encode(keyPair.secretKey),
    createdAt: input.now ?? Date.now(),
    authToken: input.authToken,
    callbackOrigin: input.callbackOrigin,
    handoff: input.handoff ? true : undefined,
  };
}

export function buildMobileWalletConnectUrl(input: {
  state: MobileWalletDeepLinkState;
  appUrl: string;
  redirectLink: string;
  cluster?: string;
}): string {
  const provider = MOBILE_WALLET_PROVIDERS[input.state.providerId];
  const url = new URL(provider.connectUrl);

  url.searchParams.set('app_url', input.appUrl);
  url.searchParams.set('dapp_encryption_public_key', input.state.dappPublicKey);
  url.searchParams.set('redirect_link', input.redirectLink);
  if (input.cluster) {
    url.searchParams.set('cluster', input.cluster);
  }

  return url.toString();
}

export function buildMobileWalletSignMessageUrl(input: {
  state: MobileWalletDeepLinkState;
  message: string;
  redirectLink: string;
}): string {
  if (!input.state.walletSession || !input.state.walletEncryptionPublicKey) {
    throw new Error('Mobile wallet session is not ready for message signing');
  }

  const provider = MOBILE_WALLET_PROVIDERS[input.state.providerId];
  const encrypted = encryptMobileWalletPayload(input.state, {
    message: bs58.encode(new TextEncoder().encode(input.message)),
    session: input.state.walletSession,
    display: SIGN_MESSAGE_DISPLAY,
  });
  const url = new URL(provider.signMessageUrl);

  url.searchParams.set('dapp_encryption_public_key', input.state.dappPublicKey);
  url.searchParams.set('nonce', encrypted.nonce);
  url.searchParams.set('redirect_link', input.redirectLink);
  url.searchParams.set('payload', encrypted.payload);

  return url.toString();
}

export function readMobileWalletError(params: URLSearchParams): string | null {
  const code = params.get('errorCode');
  const message = params.get('errorMessage');
  if (!code && !message) return null;
  return message || code || 'Wallet request was rejected.';
}

export function decryptMobileWalletConnectResponse(
  state: MobileWalletDeepLinkState,
  params: URLSearchParams
): { walletEncryptionPublicKey: string; data: MobileWalletConnectResponse } {
  const provider = MOBILE_WALLET_PROVIDERS[state.providerId];
  const walletEncryptionPublicKey = params.get(provider.encryptionPublicKeyParam);
  const nonce = params.get('nonce');
  const data = params.get('data');

  if (!walletEncryptionPublicKey || !nonce || !data) {
    throw new Error('Wallet connection callback was missing encrypted response data');
  }

  return {
    walletEncryptionPublicKey,
    data: decryptMobileWalletPayload<MobileWalletConnectResponse>({
      ...state,
      walletEncryptionPublicKey,
    }, nonce, data),
  };
}

export function decryptMobileWalletSignMessageResponse(
  state: MobileWalletDeepLinkState,
  params: URLSearchParams
): MobileWalletSignMessageResponse {
  const nonce = params.get('nonce');
  const data = params.get('data');

  if (!nonce || !data) {
    throw new Error('Wallet signature callback was missing encrypted response data');
  }

  return decryptMobileWalletPayload<MobileWalletSignMessageResponse>(state, nonce, data);
}

export function buildMobileWalletCallbackUrl(
  req: Request,
  providerId: MobileWalletProviderId,
  path: 'connect' | 'sign',
  stateId: string,
  callbackOrigin?: string
): string {
  const url = new URL(`/auth/mobile-wallet/${providerId}/${path}`, callbackOrigin || getServerOrigin(req));
  url.searchParams.set('state', stateId);
  return url.toString();
}

export function getMobileWalletAppUrl(req: Request, clientOrigin: string): string {
  return clientOrigin || getServerOrigin(req);
}

function encryptMobileWalletPayload(
  state: MobileWalletDeepLinkState,
  payload: Record<string, unknown>
): { nonce: string; payload: string } {
  const sharedSecret = getMobileWalletSharedSecret(state);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = nacl.box.after(plaintext, nonce, sharedSecret);

  return {
    nonce: bs58.encode(nonce),
    payload: bs58.encode(encrypted),
  };
}

function decryptMobileWalletPayload<T>(
  state: MobileWalletDeepLinkState,
  nonce: string,
  data: string
): T {
  const sharedSecret = getMobileWalletSharedSecret(state);
  const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), sharedSecret);

  if (!decrypted) {
    throw new Error('Wallet callback could not be decrypted');
  }

  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

function getMobileWalletSharedSecret(state: MobileWalletDeepLinkState): Uint8Array {
  if (!state.walletEncryptionPublicKey) {
    throw new Error('Wallet encryption public key is missing');
  }

  return nacl.box.before(
    bs58.decode(state.walletEncryptionPublicKey),
    bs58.decode(state.dappSecretKey)
  );
}

function getForwardedProtocol(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0]?.trim() || req.protocol;
  }

  return req.protocol;
}

function getServerOrigin(req: Request): string {
  return `${getForwardedProtocol(req)}://${req.get('host')}`;
}
