import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Transaction } from '@solana/web3.js';
import type { RankSummary } from '@voxel-strike/shared';
import { config } from '../config/environment';
import { loggers } from '../utils/logger';
import {
  canUsePhantomMobileDeepLink,
  clearPhantomMobileDeepLinkSession,
  getPhantomMobileDeepLinkSession,
  handlePhantomMobileDeepLinkCallback,
  hasPhantomMobileDeepLinkCallback,
  startPhantomMobileConnect,
  startPhantomMobileSignMessage,
  waitForPhantomMobileRedirect,
} from '../utils/phantomDeepLink';

type AuthProviderName = 'discord' | 'phantom';
const EMPTY_LINKED_ACCOUNTS: LinkedAccountSummary[] = [];

interface WalletPublicKey {
  toBase58: () => string;
}

interface PhantomProvider {
  publicKey: WalletPublicKey | null;
  isConnected: boolean;
  isPhantom: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: WalletPublicKey }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    phantom?: {
      solana?: PhantomProvider;
    };
    solana?: PhantomProvider;
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
  isPhantomInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;

  isAuthenticated: boolean;
  isNewUser: boolean;
  authProvider: AuthProviderName | null;
  user: UserData | null;
  linkedAccounts: LinkedAccountSummary[];
  hasDiscordAccount: boolean;
  hasPhantomAccount: boolean;
  pendingRegistration: PendingRegistrationData | null;
  suggestedPlayerName: string;
  isSessionLoading: boolean;

  connect: () => Promise<string | null>;
  disconnect: () => void;
  signInWithDiscord: () => void;
  linkDiscord: () => void;
  linkPhantom: () => Promise<UserData>;
  signTransaction: (transaction: Transaction) => Promise<string>;
  registerUser: (name: string) => Promise<UserData>;
  completeTutorial: () => Promise<UserData>;
  logout: () => Promise<void>;

  error: string | null;
  notice: string | null;
  clearError: () => void;
  clearNotice: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;

  const provider = window.phantom?.solana || window.solana;
  return provider?.isPhantom ? provider : null;
}

function getConnectedPhantomAddress(): string | null {
  const provider = getPhantomProvider();
  if (provider?.isConnected && provider.publicKey) {
    return provider.publicKey.toBase58();
  }

  return getPhantomMobileDeepLinkSession()?.publicKey ?? null;
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
    provider: provider === 'discord' ? provider : null,
    errorCode: params.get('error'),
  };
}

function getOAuthErrorMessage(errorCode: string | null): string {
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

function getSuggestedPlayerName(pending: PendingRegistrationData | null): string {
  const displayName = pending?.displayName?.trim().replace(/\s+/g, ' ') ?? '';
  if (displayName.length < 2) return '';
  return displayName.slice(0, 16);
}

function inferAuthProvider(user: UserData | null): AuthProviderName | null {
  if (!user) return null;
  if (user.linkedAccounts.some((account) => account.provider === 'discord')) return 'discord';
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

type PhantomVerificationResult = {
  authenticated: boolean;
  isNewUser: boolean;
  provider?: AuthProviderName;
  linked?: boolean;
  user?: UserData;
  walletAddress?: string;
  pendingRegistration?: PendingRegistrationData;
};

async function requestPhantomAuthNonce(address: string): Promise<{ nonce: string; message: string }> {
  return apiRequest<{ nonce: string; message: string }>(
    `/auth/nonce?walletAddress=${encodeURIComponent(address)}`
  );
}

async function verifyPhantomSignatureWithServer(
  address: string,
  signature: string,
  nonce: string
): Promise<PhantomVerificationResult> {
  return apiRequest<PhantomVerificationResult>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: address,
      signature,
      nonce,
    }),
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isPhantomInstalled, setIsPhantomInstalled] = useState(false);
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

  const applyUserSession = useCallback((nextUser: UserData, provider?: AuthProviderName | null) => {
    const connectedAddress = getConnectedPhantomAddress();
    setIsAuthenticated(true);
    setIsNewUser(false);
    setUser(nextUser);
    setPendingRegistration(null);
    setWalletAddress(connectedAddress ?? nextUser.walletAddress);
    setIsConnected(Boolean(connectedAddress));
    setAuthProvider(provider ?? inferAuthProvider(nextUser));
  }, []);

  const applyPendingRegistration = useCallback((pending: PendingRegistrationData) => {
    setIsAuthenticated(true);
    setIsNewUser(true);
    setUser(null);
    setPendingRegistration(pending);
    setWalletAddress(null);
    setIsConnected(false);
    setAuthProvider(pending.provider);
  }, []);

  const applyPhantomLinkResult = useCallback((
    result: PhantomVerificationResult,
    address: string
  ): UserData => {
    if (result.authenticated && result.user && result.linked) {
      applyUserSession(result.user, 'discord');
      setWalletAddress(result.user.walletAddress ?? address);
      setIsConnected(true);
      setNotice('Phantom wallet connected.');
      return result.user;
    }

    throw new Error('Sign in with Discord before connecting Phantom.');
  }, [applyUserSession]);

  useEffect(() => {
    const restoreSession = async () => {
      const oauthReturn = getOAuthReturnStatus();

      try {
        if (hasPhantomMobileDeepLinkCallback()) {
          const callback = handlePhantomMobileDeepLinkCallback();
          if (callback.handled) {
            if (!callback.ok) {
              setError(callback.error);
              return;
            }

            if (callback.action === 'connect') {
              setWalletAddress(callback.publicKey);
              setIsConnected(true);
              if (callback.purpose === 'linkPhantom') {
                setIsConnecting(true);
                const { nonce, message } = await requestPhantomAuthNonce(callback.publicKey);
                startPhantomMobileSignMessage({
                  publicKey: callback.publicKey,
                  message,
                  authNonce: nonce,
                });
                await waitForPhantomMobileRedirect<void>();
              }
              return;
            }

            const result = await verifyPhantomSignatureWithServer(
              callback.publicKey,
              callback.signature,
              callback.authNonce
            );
            applyPhantomLinkResult(result, callback.publicKey);
            return;
          }
        }

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
            result.pendingRegistration?.provider === 'discord'
          ) {
            applyPendingRegistration(result.pendingRegistration);
          }
        } catch {
          loggers.auth.debug('no existing session found');
        }
      } catch (err: any) {
        loggers.auth.error('phantom mobile callback error:', err);
        setError(err.message || 'Phantom connection failed. Please try again.');
      } finally {
        if (oauthReturn.status === 'error') {
          setError(getOAuthErrorMessage(oauthReturn.errorCode));
        } else if (oauthReturn.status === 'linked') {
          setNotice('Discord connected.');
        } else if (oauthReturn.status === 'success') {
          setNotice('Signed in with Discord.');
        }

        cleanOAuthReturnParams();
        setIsConnecting(false);
        setIsSessionLoading(false);
      }
    };

    restoreSession();
  }, [applyPendingRegistration, applyPhantomLinkResult, applyUserSession]);

  useEffect(() => {
    const checkForPhantom = () => {
      const provider = getPhantomProvider();
      const connectedAddress = getConnectedPhantomAddress();
      setIsPhantomInstalled(Boolean(provider) || canUsePhantomMobileDeepLink());

      if (connectedAddress) {
        setIsConnected(true);
        setWalletAddress(connectedAddress);
      } else if (isAuthenticated) {
        setIsConnected(false);
        setWalletAddress(user?.walletAddress ?? null);
      } else {
        setIsConnected(false);
        setWalletAddress(null);
      }
    };

    checkForPhantom();
    const timeout = setTimeout(checkForPhantom, 500);
    return () => clearTimeout(timeout);
  }, [isAuthenticated, user?.walletAddress]);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider) return;

    const handleConnect = (publicKey: WalletPublicKey) => {
      loggers.auth.debug('wallet connected', publicKey.toBase58());
      setIsConnected(true);
      setWalletAddress(publicKey.toBase58());
    };

    const handleDisconnect = () => {
      loggers.auth.debug('wallet disconnected');
      setIsConnected(false);
      setWalletAddress(null);
    };

    const handleAccountChanged = (publicKey: WalletPublicKey | null) => {
      if (publicKey) {
        loggers.auth.debug('account changed', publicKey.toBase58());
        setWalletAddress(publicKey.toBase58());
      } else {
        handleDisconnect();
      }
    };

    provider.on('connect', handleConnect);
    provider.on('disconnect', handleDisconnect);
    provider.on('accountChanged', handleAccountChanged);

    return () => {
      provider.off('connect', handleConnect);
      provider.off('disconnect', handleDisconnect);
      provider.off('accountChanged', handleAccountChanged);
    };
  }, []);

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

  const verifyPhantomWithServer = useCallback(async (provider: PhantomProvider, address: string) => {
    const { nonce, message } = await requestPhantomAuthNonce(address);
    const encodedMessage = new TextEncoder().encode(message);
    const { signature } = await provider.signMessage(encodedMessage, 'utf8');
    const { default: bs58 } = await import('bs58');
    const signatureBase58 = bs58.encode(signature);

    return verifyPhantomSignatureWithServer(address, signatureBase58, nonce);
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    const provider = getPhantomProvider();

    if (!provider && canUsePhantomMobileDeepLink()) {
      setIsConnecting(true);
      setError(null);
      setNotice(null);

      try {
        const mobileSession = getPhantomMobileDeepLinkSession();
        if (mobileSession) {
          setWalletAddress(mobileSession.publicKey);
          setIsConnected(true);
          return mobileSession.publicKey;
        }

        startPhantomMobileConnect();
        await waitForPhantomMobileRedirect<void>();
        return null;
      } catch (err: any) {
        loggers.auth.error('failed to connect mobile wallet:', err);
        setError(err.message || 'Failed to connect wallet');
        return null;
      } finally {
        setIsConnecting(false);
      }
    }

    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      setError('Phantom wallet is not installed. Please install it to continue.');
      return null;
    }

    setIsConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toBase58();
      setWalletAddress(address);
      setIsConnected(true);
      return address;
    } catch (err: any) {
      loggers.auth.error('failed to connect wallet:', err);
      if (err.code === 4001) {
        setError('Connection rejected. Please approve the connection request.');
      } else {
        setError(err.message || 'Failed to connect wallet');
      }
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const provider = getPhantomProvider();

    if (provider) {
      provider.disconnect();
    }
    clearPhantomMobileDeepLinkSession();

    setIsConnected(false);
    setWalletAddress(null);
    setError(null);
    setNotice(null);
  }, []);

  const linkPhantom = useCallback(async (): Promise<UserData> => {
    const provider = getPhantomProvider();

    if (!isAuthenticated || !user) {
      setError('Sign in before linking Phantom.');
      throw new Error('Sign in before linking Phantom.');
    }

    if (!provider && canUsePhantomMobileDeepLink()) {
      setIsConnecting(true);
      setError(null);
      setNotice(null);

      try {
        const mobileSession = getPhantomMobileDeepLinkSession();
        if (mobileSession) {
          setWalletAddress(mobileSession.publicKey);
          setIsConnected(true);
          const { nonce, message } = await requestPhantomAuthNonce(mobileSession.publicKey);
          startPhantomMobileSignMessage({
            publicKey: mobileSession.publicKey,
            message,
            authNonce: nonce,
          });
        } else {
          startPhantomMobileConnect('linkPhantom');
        }

        return await waitForPhantomMobileRedirect<UserData>();
      } catch (err: any) {
        loggers.auth.error('mobile phantom linking error:', err);
        setError(err.message || 'Phantom linking failed');
        throw err;
      } finally {
        setIsConnecting(false);
      }
    }

    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      setError('Phantom wallet is not installed. Please install it to continue.');
      throw new Error('Phantom wallet not installed');
    }

    setIsConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const { publicKey } = provider.isConnected && provider.publicKey
        ? { publicKey: provider.publicKey }
        : await provider.connect();
      const address = publicKey.toBase58();

      setWalletAddress(address);
      setIsConnected(true);

      const result = await verifyPhantomWithServer(provider, address);
      return applyPhantomLinkResult(result, address);
    } catch (err: any) {
      loggers.auth.error('phantom linking error:', err);
      if (err.code === 4001) {
        setError('Signature rejected. Please sign the message to link Phantom.');
      } else {
        setError(err.message || 'Phantom linking failed');
      }
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [applyPhantomLinkResult, isAuthenticated, user, verifyPhantomWithServer]);

  const signTransaction = useCallback(async (transaction: Transaction): Promise<string> => {
    const provider = getPhantomProvider();
    if (!provider || !provider.publicKey) {
      throw new Error('Connect Phantom before paying');
    }

    if (typeof provider.signTransaction !== 'function') {
      throw new Error('This Phantom connection cannot sign transactions for server relay');
    }

    const signed = await provider.signTransaction(transaction);
    return bytesToBase64(signed.serialize());
  }, []);

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

    const provider = getPhantomProvider();
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // Ignore disconnect errors; the server session is already cleared.
      }
    }
    clearPhantomMobileDeepLinkSession();

    setIsConnected(false);
    setWalletAddress(null);
    setIsAuthenticated(false);
    setUser(null);
    setIsNewUser(false);
    setAuthProvider(null);
    setPendingRegistration(null);
    setError(null);
    setNotice(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const linkedAccounts = user?.linkedAccounts ?? EMPTY_LINKED_ACCOUNTS;
  const hasDiscordAccount = linkedAccounts.some((account) => account.provider === 'discord');
  const hasPhantomAccount = Boolean(user?.walletAddress) || linkedAccounts.some((account) => account.provider === 'phantom');
  const suggestedPlayerName = useMemo(() => getSuggestedPlayerName(pendingRegistration), [pendingRegistration]);

  const contextValue = useMemo<WalletContextType>(() => ({
    isPhantomInstalled,
    isConnected,
    isConnecting,
    walletAddress,
    isAuthenticated,
    isNewUser,
    authProvider,
    user,
    linkedAccounts,
    hasDiscordAccount,
    hasPhantomAccount,
    pendingRegistration,
    suggestedPlayerName,
    isSessionLoading,
    connect,
    disconnect,
    signInWithDiscord,
    linkDiscord,
    linkPhantom,
    signTransaction,
    registerUser,
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
    connect,
    disconnect,
    error,
    hasDiscordAccount,
    hasPhantomAccount,
    isAuthenticated,
    isConnected,
    isConnecting,
    isNewUser,
    isPhantomInstalled,
    isSessionLoading,
    linkDiscord,
    linkPhantom,
    linkedAccounts,
    logout,
    notice,
    pendingRegistration,
    registerUser,
    signInWithDiscord,
    signTransaction,
    suggestedPlayerName,
    user,
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
