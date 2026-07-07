import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { Transaction } from '@solana/web3.js';
import type { RankSummary } from '@voxel-strike/shared';
import { config } from '../config/environment';
import { loggers } from '../utils/logger';

type AuthProviderName = 'discord' | 'wallet';
type MobileWalletDeepLinkProviderId = 'phantom' | 'solflare';
type MobileWalletAuthBridgeResponse =
  | { action: 'redirect'; url: string }
  | { action: 'complete'; returnTo: string }
  | { action: 'error'; returnTo: string };
const EMPTY_LINKED_ACCOUNTS: LinkedAccountSummary[] = [];
const NO_WALLET_DETECTED_MESSAGE = 'No Solana wallet was detected. Open this app in Phantom, Solflare, Brave Wallet, Backpack, or another compatible wallet browser.';
const MOBILE_DEEP_LINK_WALLET_PROVIDERS: Array<{
  id: string;
  name: string;
  deepLinkProviderId: MobileWalletDeepLinkProviderId;
}> = [
  { id: 'phantom-mobile', name: 'Phantom', deepLinkProviderId: 'phantom' },
  { id: 'solflare-mobile', name: 'Solflare', deepLinkProviderId: 'solflare' },
];

interface WalletPublicKey {
  toBase58: () => string;
}

interface SolanaWalletProvider {
  publicKey: WalletPublicKey | null;
  isConnected?: boolean;
  connected?: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBraveWallet?: boolean;
  name?: string;
  walletName?: string;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: WalletPublicKey } | void>;
  disconnect?: () => Promise<void>;
  signMessage: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  off?: (event: string, handler: (...args: any[]) => void) => void;
}

export interface WalletProviderSummary {
  id: string;
  name: string;
  installed: boolean;
  deepLinkProviderId?: MobileWalletDeepLinkProviderId;
}

interface DiscoveredWalletProvider extends WalletProviderSummary {
  provider: SolanaWalletProvider | null;
}

declare global {
  interface Window {
    phantom?: {
      solana?: SolanaWalletProvider;
    };
    solana?: SolanaWalletProvider & {
      providers?: SolanaWalletProvider[];
    };
    solflare?: SolanaWalletProvider;
    braveSolana?: SolanaWalletProvider;
    solanaProviders?: SolanaWalletProvider[];
  }
}

export interface LinkedAccountSummary {
  provider: AuthProviderName;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingRegistrationData {
  provider: AuthProviderName;
  displayName?: string | null;
  avatarUrl?: string | null;
  walletAddress?: string | null;
}

export interface UserData {
  id: string;
  walletAddress: string | null;
  isGameAdmin: boolean;
  name: string;
  lastLoginAt: string | null;
  tutorialCompletedAt: string | null;
  stats: {
    totalGames: number;
    totalWins: number;
    totalLosses: number;
    totalDraws: number;
    totalKills: number;
    totalDeaths: number;
    totalAssists: number;
    totalCaptures: number;
    totalFlagReturns: number;
    totalScore: number;
    totalExperience: number;
    totalWagerGames: number;
    totalWagerWins: number;
    totalWagerLosses: number;
    totalWagerDraws: number;
    totalWageredLamports: string;
    totalWagerWonLamports: string;
    totalWagerLostLamports: string;
    competitiveRating: number;
    rankedGames: number;
    rankedWins: number;
    rankedLosses: number;
    rankedDraws: number;
    rankedPlacementsRemaining: number;
    rankedPeakRating: number;
    rankedLastMatchAt: string | null;
  };
  rank: {
    competitiveRating: number;
    rankedGames: number;
    rankedWins: number;
    rankedLosses: number;
    rankedDraws: number;
    rankedPlacementsRemaining: number;
    rankedLastMatchAt: string | null;
    current: RankSummary;
    peak: RankSummary;
    progress: RankSummary['progress'];
  };
  linkedAccounts: LinkedAccountSummary[];
}

interface WalletContextType {
  isWalletInstalled: boolean;
  walletProviders: WalletProviderSummary[];
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;

  isAuthenticated: boolean;
  isNewUser: boolean;
  authProvider: AuthProviderName | null;
  user: UserData | null;
  linkedAccounts: LinkedAccountSummary[];
  hasDiscordAccount: boolean;
  hasWalletAccount: boolean;
  pendingRegistration: PendingRegistrationData | null;
  suggestedPlayerName: string;
  isSessionLoading: boolean;

  connectWallet: (providerId?: string) => Promise<string | null>;
  disconnect: () => void;
  signInWithDiscord: () => void;
  signInWithWallet: (providerId?: string) => Promise<UserData | null>;
  linkDiscord: () => void;
  linkWallet: (providerId?: string) => Promise<UserData>;
  signTransaction: (transaction: Transaction) => Promise<string>;
  registerUser: (name: string) => Promise<UserData>;
  updatePlayerName: (name: string) => Promise<UserData>;
  completeTutorial: () => Promise<UserData>;
  logout: () => Promise<void>;

  error: string | null;
  notice: string | null;
  clearError: () => void;
  clearNotice: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

function isSolanaWalletProvider(value: unknown): value is SolanaWalletProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Partial<SolanaWalletProvider>;
  return typeof provider.connect === 'function' && typeof provider.signMessage === 'function';
}

function getWalletProviderName(provider: SolanaWalletProvider): string {
  if (provider.isBraveWallet) return 'Brave Wallet';
  if (provider.isSolflare) return 'Solflare';
  if (provider.isPhantom) return 'Phantom';
  return provider.name || provider.walletName || 'Solana Wallet';
}

function getWalletProviderId(provider: SolanaWalletProvider, fallback: string): string {
  const name = getWalletProviderName(provider).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return name || fallback;
}

function claimWalletProviderId(baseId: string, usedIds: Set<string>): string {
  let id = baseId;
  let duplicateIndex = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${duplicateIndex}`;
    duplicateIndex += 1;
  }
  usedIds.add(id);
  return id;
}

function collectInjectedWalletCandidates(): Array<{ provider: unknown; fallbackId: string }> {
  if (typeof window === 'undefined') return [];

  const candidates: Array<{ provider: unknown; fallbackId: string }> = [
    { provider: window.braveSolana, fallbackId: 'brave-wallet' },
    { provider: window.phantom?.solana, fallbackId: 'phantom' },
    { provider: window.solflare, fallbackId: 'solflare' },
    { provider: window.solana, fallbackId: 'solana' },
  ];

  for (const [index, provider] of (window.solanaProviders ?? []).entries()) {
    candidates.push({ provider, fallbackId: `solana-provider-${index}` });
  }

  for (const [index, provider] of (window.solana?.providers ?? []).entries()) {
    candidates.push({ provider, fallbackId: `solana-provider-list-${index}` });
  }

  return candidates;
}

function discoverWalletProviders(): DiscoveredWalletProvider[] {
  const providers: DiscoveredWalletProvider[] = [];
  const seen = new Set<SolanaWalletProvider>();
  const usedIds = new Set<string>();

  for (const candidate of collectInjectedWalletCandidates()) {
    if (!isSolanaWalletProvider(candidate.provider) || seen.has(candidate.provider)) continue;
    seen.add(candidate.provider);

    const id = claimWalletProviderId(getWalletProviderId(candidate.provider, candidate.fallbackId), usedIds);

    providers.push({
      id,
      name: getWalletProviderName(candidate.provider),
      installed: true,
      provider: candidate.provider,
    });
  }

  if (canUseMobileWalletDeepLinks()) {
    for (const mobileWallet of MOBILE_DEEP_LINK_WALLET_PROVIDERS) {
      providers.push({
        ...mobileWallet,
        id: claimWalletProviderId(mobileWallet.id, usedIds),
        installed: false,
        provider: null,
      });
    }
  }

  return providers;
}

function getConnectedWallet(
  providers: DiscoveredWalletProvider[],
  preferredProviderId: string | null = null
): { providerId: string; provider: SolanaWalletProvider | null; address: string } | null {
  const orderedProviders = preferredProviderId
    ? [
        ...providers.filter((provider) => provider.id === preferredProviderId),
        ...providers.filter((provider) => provider.id !== preferredProviderId),
      ]
    : providers;

  for (const wallet of orderedProviders) {
    const provider = wallet.provider;
    if (!provider) continue;
    const connected = provider.isConnected ?? provider.connected ?? false;
    if (connected && provider.publicKey) {
      return {
        providerId: wallet.id,
        provider,
        address: provider.publicKey.toBase58(),
      };
    }
  }

  return null;
}

function toWalletProviderSummaries(providers: DiscoveredWalletProvider[]): WalletProviderSummary[] {
  return providers.map(({ id, name, installed, deepLinkProviderId }) => ({
    id,
    name,
    installed,
    deepLinkProviderId,
  }));
}

async function connectInjectedWalletProvider(provider: SolanaWalletProvider): Promise<string> {
  const result = await provider.connect();
  const publicKey = result?.publicKey ?? provider.publicKey;
  if (!publicKey) {
    throw new Error('Wallet did not return a public key.');
  }
  return publicKey.toBase58();
}

async function signWalletAuthMessage(
  provider: SolanaWalletProvider,
  message: string
): Promise<string> {
  const encodedMessage = new TextEncoder().encode(message);
  const result = await provider.signMessage(encodedMessage, 'utf8');
  const signature = result instanceof Uint8Array ? result : result.signature;
  const { default: bs58 } = await import('bs58');
  return bs58.encode(signature);
}

function getWalletActionError(err: any, fallback: string): string {
  if (err?.code === 4001) {
    return 'Request rejected. Please approve the wallet prompt to continue.';
  }
  return err?.message || fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

function getCleanReturnTo(): string {
  if (typeof window === 'undefined') return '/';

  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  url.searchParams.delete('error');
  url.searchParams.delete('provider');
  return `${url.pathname}${url.search}${url.hash}`;
}

function canUseMobileWalletDeepLinks(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  return (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(userAgent)) ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

async function requestMobileWalletAuthStep(url: URL): Promise<MobileWalletAuthBridgeResponse> {
  url.searchParams.set('response', 'json');

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Wallet authentication could not start.');
  }

  const data = await response.json() as Partial<MobileWalletAuthBridgeResponse>;
  if (data.action === 'redirect' && typeof data.url === 'string') return data as MobileWalletAuthBridgeResponse;
  if ((data.action === 'complete' || data.action === 'error') && typeof data.returnTo === 'string') {
    return data as MobileWalletAuthBridgeResponse;
  }

  throw new Error('Wallet authentication returned an invalid response.');
}

async function startMobileWalletAuth(providerId: MobileWalletDeepLinkProviderId): Promise<void> {
  if (typeof window === 'undefined') return;

  const url = new URL(`${getHttpUrl()}/auth/mobile-wallet/${providerId}/start`);
  url.searchParams.set('returnTo', getCleanReturnTo());
  url.searchParams.set('callbackOrigin', window.location.origin);
  const result = await requestMobileWalletAuthStep(url);

  if (result.action === 'redirect') {
    window.location.assign(result.url);
    return;
  }

  window.location.assign(result.returnTo);
}

function cleanOAuthReturnParams(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const hadOAuthParams = url.searchParams.has('auth') || url.searchParams.has('error') || url.searchParams.has('provider');
  if (!hadOAuthParams) return;

  url.searchParams.delete('auth');
  url.searchParams.delete('error');
  url.searchParams.delete('provider');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getOAuthReturnStatus(): {
  status: string | null;
  provider: AuthProviderName | null;
  errorCode: string | null;
} {
  if (typeof window === 'undefined') {
    return { status: null, provider: null, errorCode: null };
  }

  const params = new URLSearchParams(window.location.search);
  const provider = params.get('provider');
  return {
    status: params.get('auth'),
    provider: provider === 'discord' || provider === 'wallet' ? provider : null,
    errorCode: params.get('error'),
  };
}

function getOAuthErrorMessage(provider: AuthProviderName | null, errorCode: string | null): string {
  if (provider === 'wallet') {
    switch (errorCode) {
      case 'wallet_denied':
        return 'Wallet connection was canceled.';
      case 'wallet_conflict':
        return 'That wallet is already linked to another profile.';
      case 'wallet_expired':
        return 'Wallet connection expired. Please try again.';
      case 'wallet_invalid_signature':
        return 'Wallet signature could not be verified.';
      case 'wallet_unavailable':
        return 'Wallet authentication is temporarily unavailable.';
      case 'wallet_unsupported':
        return 'That mobile wallet is not supported yet.';
      default:
        return 'Wallet sign-in failed. Please try again.';
    }
  }

  switch (errorCode) {
    case 'not_configured':
      return 'Discord sign-in is not configured yet.';
    case 'oauth_denied':
      return 'Discord sign-in was canceled.';
    case 'provider_conflict':
      return 'That Discord account is already linked to another profile.';
    case 'login_required':
      return 'Sign in before linking Discord.';
    case 'rate_limited':
      return 'Too many auth attempts. Please try again shortly.';
    case 'invalid_state_missing':
    case 'invalid_state_expired':
    case 'invalid_state_used':
    case 'invalid_state_provider':
      return 'Discord sign-in expired. Please try again.';
    default:
      return 'Discord sign-in failed. Please try again.';
  }
}

function getOAuthSuccessMessage(status: string | null, provider: AuthProviderName | null): string | null {
  if (status === 'linked') {
    return provider === 'wallet' ? 'Wallet connected.' : 'Discord connected.';
  }

  if (status === 'success') {
    return provider === 'wallet' ? 'Signed in with wallet.' : 'Signed in with Discord.';
  }

  return null;
}

function getSuggestedPlayerName(pending: PendingRegistrationData | null): string {
  const displayName = pending?.displayName?.trim().replace(/\s+/g, ' ') ?? '';
  if (displayName.length < 2) return '';
  return displayName.slice(0, 16);
}

function inferAuthProvider(user: UserData | null): AuthProviderName | null {
  if (!user) return null;
  if (user.linkedAccounts.some((account) => account.provider === 'discord')) return 'discord';
  if (user.linkedAccounts.some((account) => account.provider === 'wallet') || user.walletAddress) return 'wallet';
  return null;
}

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getHttpUrl()}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(errorData.error || 'Request failed');
  }

  return response.json();
}

type WalletVerificationResult = {
  authenticated: boolean;
  isNewUser: boolean;
  provider?: AuthProviderName;
  linked?: boolean;
  user?: UserData;
  walletAddress?: string;
  pendingRegistration?: PendingRegistrationData;
};

async function requestWalletAuthNonce(address: string): Promise<{ nonce: string; message: string }> {
  return apiRequest<{ nonce: string; message: string }>(
    `/auth/nonce?walletAddress=${encodeURIComponent(address)}`
  );
}

async function verifyWalletSignatureWithServer(
  address: string,
  signature: string,
  nonce: string
): Promise<WalletVerificationResult> {
  return apiRequest<WalletVerificationResult>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: address,
      signature,
      nonce,
    }),
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [discoveredWalletProviders, setDiscoveredWalletProviders] = useState<DiscoveredWalletProvider[]>([]);
  const [isWalletInstalled, setIsWalletInstalled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [authProvider, setAuthProvider] = useState<AuthProviderName | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistrationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const activeWalletProviderIdRef = useRef<string | null>(null);

  const setActiveWalletProvider = useCallback((providerId: string | null) => {
    activeWalletProviderIdRef.current = providerId;
  }, []);

  const applyUserSession = useCallback((nextUser: UserData, provider?: AuthProviderName | null) => {
    const connectedWallet = getConnectedWallet(discoveredWalletProviders, activeWalletProviderIdRef.current);
    setIsAuthenticated(true);
    setIsNewUser(false);
    setUser(nextUser);
    setPendingRegistration(null);
    setWalletAddress(connectedWallet?.address ?? nextUser.walletAddress);
    setIsConnected(Boolean(connectedWallet));
    if (connectedWallet) {
      setActiveWalletProvider(connectedWallet.providerId);
    }
    setAuthProvider(provider ?? inferAuthProvider(nextUser));
  }, [discoveredWalletProviders, setActiveWalletProvider]);

  const applyPendingRegistration = useCallback((pending: PendingRegistrationData) => {
    const pendingWalletAddress = pending.provider === 'wallet' ? pending.walletAddress ?? null : null;
    setIsAuthenticated(true);
    setIsNewUser(true);
    setUser(null);
    setPendingRegistration(pending);
    setWalletAddress(pendingWalletAddress);
    setIsConnected(Boolean(pendingWalletAddress));
    setAuthProvider(pending.provider);
  }, []);

  const applyWalletVerificationResult = useCallback((
    result: WalletVerificationResult,
    address: string,
    noticeText: string
  ): UserData | null => {
    if (result.authenticated && result.user) {
      applyUserSession(result.user, result.provider ?? 'wallet');
      setWalletAddress(result.user.walletAddress ?? address);
      setIsConnected(true);
      setAuthProvider(result.provider ?? 'wallet');
      setNotice(noticeText);
      return result.user;
    }

    if (result.authenticated && result.isNewUser && result.pendingRegistration) {
      applyPendingRegistration(result.pendingRegistration);
      setWalletAddress(result.pendingRegistration.walletAddress ?? address);
      setIsConnected(true);
      setNotice(null);
      return null;
    }

    throw new Error('Wallet authentication failed. Please try again.');
  }, [applyPendingRegistration, applyUserSession]);

  useEffect(() => {
    const restoreSession = async () => {
      const oauthReturn = getOAuthReturnStatus();

      try {
        try {
          const result = await apiRequest<{
            authenticated: boolean;
            isNewUser?: boolean;
            provider?: AuthProviderName | null;
            user?: UserData;
            pendingRegistration?: PendingRegistrationData;
            error?: string;
          }>('/auth/session?quiet=1');

          if (result.authenticated && result.user) {
            applyUserSession(result.user, result.provider ?? oauthReturn.provider);
          } else if (
            result.authenticated &&
            result.isNewUser &&
            result.pendingRegistration
          ) {
            applyPendingRegistration(result.pendingRegistration);
          }
        } catch {
          loggers.auth.debug('no existing session found');
        }
      } catch (err: any) {
        loggers.auth.error('wallet session restore error:', err);
        setError(err.message || 'Wallet connection failed. Please try again.');
      } finally {
        if (oauthReturn.status === 'error') {
          setError(getOAuthErrorMessage(oauthReturn.provider, oauthReturn.errorCode));
        } else {
          const successMessage = getOAuthSuccessMessage(oauthReturn.status, oauthReturn.provider);
          if (successMessage) {
            setNotice(successMessage);
          }
        }

        cleanOAuthReturnParams();
        setIsConnecting(false);
        setIsSessionLoading(false);
      }
    };

    restoreSession();
  }, [applyPendingRegistration, applyUserSession, applyWalletVerificationResult, setActiveWalletProvider]);

  useEffect(() => {
    const refreshWalletProviders = () => {
      const providers = discoverWalletProviders();
      const connectedWallet = getConnectedWallet(providers, activeWalletProviderIdRef.current);

      setDiscoveredWalletProviders(providers);
      setIsWalletInstalled(providers.some((provider) => provider.installed));

      if (connectedWallet) {
        setActiveWalletProvider(connectedWallet.providerId);
        setIsConnected(true);
        setWalletAddress(connectedWallet.address);
      } else if (isAuthenticated) {
        setIsConnected(false);
        setWalletAddress(user?.walletAddress ?? null);
      } else {
        setIsConnected(false);
        setWalletAddress(null);
      }
    };

    refreshWalletProviders();
    const timeout = setTimeout(refreshWalletProviders, 500);
    return () => clearTimeout(timeout);
  }, [isAuthenticated, setActiveWalletProvider, user?.walletAddress]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    for (const wallet of discoveredWalletProviders) {
      const provider = wallet.provider;
      if (!provider?.on || !provider.off) continue;

      const handleConnect = (publicKey?: WalletPublicKey) => {
        const nextPublicKey = publicKey ?? provider.publicKey;
        if (!nextPublicKey) return;
        loggers.auth.debug('wallet connected', wallet.name, nextPublicKey.toBase58());
        setActiveWalletProvider(wallet.id);
        setIsConnected(true);
        setWalletAddress(nextPublicKey.toBase58());
      };

      const handleDisconnect = () => {
        loggers.auth.debug('wallet disconnected', wallet.name);
        if (activeWalletProviderIdRef.current === wallet.id) {
          setActiveWalletProvider(null);
          setIsConnected(false);
          setWalletAddress(user?.walletAddress ?? null);
        }
      };

      const handleAccountChanged = (publicKey: WalletPublicKey | null) => {
        if (publicKey) {
          loggers.auth.debug('account changed', wallet.name, publicKey.toBase58());
          setActiveWalletProvider(wallet.id);
          setWalletAddress(publicKey.toBase58());
        } else {
          handleDisconnect();
        }
      };

      provider.on('connect', handleConnect);
      provider.on('disconnect', handleDisconnect);
      provider.on('accountChanged', handleAccountChanged);

      cleanups.push(() => {
        provider.off?.('connect', handleConnect);
        provider.off?.('disconnect', handleDisconnect);
        provider.off?.('accountChanged', handleAccountChanged);
      });
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [discoveredWalletProviders, setActiveWalletProvider, user?.walletAddress]);

  const signInWithDiscord = useCallback(() => {
    setError(null);
    setNotice(null);
    const returnTo = encodeURIComponent(getCleanReturnTo());
    window.location.assign(`${getHttpUrl()}/auth/discord/start?returnTo=${returnTo}`);
  }, []);

  const linkDiscord = useCallback(() => {
    setError(null);
    setNotice(null);
    const returnTo = encodeURIComponent(getCleanReturnTo());
    window.location.assign(`${getHttpUrl()}/auth/discord/link/start?returnTo=${returnTo}`);
  }, []);

  const getWalletById = useCallback((providerId?: string) => {
    if (providerId) {
      return discoveredWalletProviders.find((wallet) => wallet.id === providerId) ?? null;
    }
    return discoveredWalletProviders[0] ?? null;
  }, [discoveredWalletProviders]);

  const verifyWalletWithServer = useCallback(async (provider: SolanaWalletProvider, address: string) => {
    const { nonce, message } = await requestWalletAuthNonce(address);
    const signatureBase58 = await signWalletAuthMessage(provider, message);
    return verifyWalletSignatureWithServer(address, signatureBase58, nonce);
  }, []);

  const connectWallet = useCallback(async (providerId?: string): Promise<string | null> => {
    const wallet = getWalletById(providerId);

    if (!wallet?.provider) {
      setError(NO_WALLET_DETECTED_MESSAGE);
      return null;
    }

    setIsConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const address = await connectInjectedWalletProvider(wallet.provider);
      setActiveWalletProvider(wallet.id);
      setWalletAddress(address);
      setIsConnected(true);
      return address;
    } catch (err: any) {
      loggers.auth.error('failed to connect wallet:', err);
      setError(getWalletActionError(err, 'Failed to connect wallet'));
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [getWalletById, setActiveWalletProvider]);

  const disconnect = useCallback(() => {
    const connectedWallet = getConnectedWallet(discoveredWalletProviders, activeWalletProviderIdRef.current);
    if (connectedWallet?.provider?.disconnect) {
      connectedWallet.provider.disconnect();
    }

    setActiveWalletProvider(null);
    setIsConnected(false);
    setWalletAddress(null);
    setError(null);
    setNotice(null);
  }, [discoveredWalletProviders, setActiveWalletProvider]);

  const signInWithWallet = useCallback(async (providerId?: string): Promise<UserData | null> => {
    const wallet = getWalletById(providerId);

    if (wallet?.deepLinkProviderId && !wallet.provider) {
      setIsConnecting(true);
      setError(null);
      setNotice(null);
      try {
        await startMobileWalletAuth(wallet.deepLinkProviderId);
      } catch (err: any) {
        loggers.auth.error('mobile wallet sign-in start error:', err);
        setError(err?.message || 'Wallet sign-in failed');
      } finally {
        setIsConnecting(false);
      }
      return null;
    }

    if (!wallet?.provider) {
      setError(NO_WALLET_DETECTED_MESSAGE);
      throw new Error(NO_WALLET_DETECTED_MESSAGE);
    }

    setIsConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const address = (wallet.provider.isConnected || wallet.provider.connected) && wallet.provider.publicKey
        ? wallet.provider.publicKey.toBase58()
        : await connectInjectedWalletProvider(wallet.provider);
      setActiveWalletProvider(wallet.id);
      setWalletAddress(address);
      setIsConnected(true);

      const result = await verifyWalletWithServer(wallet.provider, address);
      return applyWalletVerificationResult(result, address, 'Signed in with wallet.');
    } catch (err: any) {
      loggers.auth.error('wallet sign-in error:', err);
      setError(getWalletActionError(err, 'Wallet sign-in failed'));
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [applyWalletVerificationResult, getWalletById, setActiveWalletProvider, verifyWalletWithServer]);

  const linkWallet = useCallback(async (providerId?: string): Promise<UserData> => {
    if (!isAuthenticated || !user) {
      setError('Sign in before linking a wallet.');
      throw new Error('Sign in before linking a wallet.');
    }

    const result = await signInWithWallet(providerId);
    if (!result) {
      throw new Error('Wallet linked profile is not ready yet.');
    }
    return result;
  }, [isAuthenticated, signInWithWallet, user]);

  const signTransaction = useCallback(async (transaction: Transaction): Promise<string> => {
    const connectedWallet = getConnectedWallet(discoveredWalletProviders, activeWalletProviderIdRef.current);
    const provider = connectedWallet?.provider ?? null;
    if (!provider || !provider.publicKey) {
      throw new Error('Connect a wallet before paying');
    }

    if (typeof provider.signTransaction !== 'function') {
      throw new Error('This wallet connection cannot sign transactions for server relay');
    }

    const signed = await provider.signTransaction(transaction);
    return bytesToBase64(signed.serialize());
  }, [discoveredWalletProviders]);

  const registerUser = useCallback(async (name: string): Promise<UserData> => {
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ success: boolean; user: UserData }>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
          }),
        }
      );

      if (result.success && result.user) {
        applyUserSession(result.user, authProvider);
        return result.user;
      }

      throw new Error('Registration failed');
    } catch (err: any) {
      loggers.auth.error('registration error:', err);
      setError(err.message || 'Registration failed');
      throw err;
    }
  }, [applyUserSession, authProvider]);

  const updatePlayerName = useCallback(async (name: string): Promise<UserData> => {
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ success: boolean; user: UserData }>(
        '/auth/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
          }),
        }
      );

      if (result.success && result.user) {
        applyUserSession(result.user, authProvider);
        return result.user;
      }

      throw new Error('Name update failed');
    } catch (err: any) {
      loggers.auth.error('profile update error:', err);
      setError(err.message || 'Name update failed');
      throw err;
    }
  }, [applyUserSession, authProvider]);

  const completeTutorial = useCallback(async (): Promise<UserData> => {
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ success: boolean; user: UserData }>(
        '/auth/tutorial/complete',
        { method: 'POST', body: JSON.stringify({}) }
      );

      if (result.success && result.user) {
        applyUserSession(result.user, authProvider);
        return result.user;
      }

      throw new Error('Tutorial completion was not saved');
    } catch (err: any) {
      loggers.auth.error('tutorial completion error:', err);
      setError(err.message || 'Failed to save tutorial completion');
      throw err;
    }
  }, [applyUserSession, authProvider]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (err) {
      loggers.auth.error('logout error:', err);
    }

    const connectedWallet = getConnectedWallet(discoveredWalletProviders, activeWalletProviderIdRef.current);
    if (connectedWallet?.provider?.disconnect) {
      try {
        await connectedWallet.provider.disconnect();
      } catch {
        // Ignore disconnect errors; the server session is already cleared.
      }
    }
    setActiveWalletProvider(null);
    setIsConnected(false);
    setWalletAddress(null);
    setIsAuthenticated(false);
    setUser(null);
    setIsNewUser(false);
    setAuthProvider(null);
    setPendingRegistration(null);
    setError(null);
    setNotice(null);
  }, [discoveredWalletProviders, setActiveWalletProvider]);

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const linkedAccounts = user?.linkedAccounts ?? EMPTY_LINKED_ACCOUNTS;
  const hasDiscordAccount = linkedAccounts.some((account) => account.provider === 'discord');
  const hasWalletAccount = Boolean(user?.walletAddress) || linkedAccounts.some((account) => account.provider === 'wallet');
  const suggestedPlayerName = useMemo(() => getSuggestedPlayerName(pendingRegistration), [pendingRegistration]);
  const walletProviders = useMemo(
    () => toWalletProviderSummaries(discoveredWalletProviders),
    [discoveredWalletProviders]
  );

  const contextValue = useMemo<WalletContextType>(() => ({
    isWalletInstalled,
    walletProviders,
    isConnected,
    isConnecting,
    walletAddress,
    isAuthenticated,
    isNewUser,
    authProvider,
    user,
    linkedAccounts,
    hasDiscordAccount,
    hasWalletAccount,
    pendingRegistration,
    suggestedPlayerName,
    isSessionLoading,
    connectWallet,
    disconnect,
    signInWithDiscord,
    signInWithWallet,
    linkDiscord,
    linkWallet,
    signTransaction,
    registerUser,
    updatePlayerName,
    completeTutorial,
    logout,
    error,
    notice,
    clearError,
    clearNotice,
  }), [
    authProvider,
    clearError,
    clearNotice,
    completeTutorial,
    connectWallet,
    disconnect,
    error,
    hasDiscordAccount,
    hasWalletAccount,
    isAuthenticated,
    isConnected,
    isConnecting,
    isNewUser,
    isWalletInstalled,
    isSessionLoading,
    linkDiscord,
    linkWallet,
    linkedAccounts,
    logout,
    notice,
    pendingRegistration,
    registerUser,
    signInWithDiscord,
    signInWithWallet,
    signTransaction,
    suggestedPlayerName,
    updatePlayerName,
    user,
    walletProviders,
    walletAddress,
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export const useAppAuth = useWallet;
