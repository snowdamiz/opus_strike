import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { config } from '../config/environment';
import { loggers } from '../utils/logger';

type AuthProviderName = 'discord' | 'phantom';

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
  };
  linkedAccounts: LinkedAccountSummary[];
}

interface WalletContextType {
  isPhantomInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;

  isAuthenticated: boolean;
  isDiscordAuthEnabled: boolean;
  isNewUser: boolean;
  authProvider: AuthProviderName | null;
  user: UserData | null;
  linkedAccounts: LinkedAccountSummary[];
  hasDiscordAccount: boolean;
  hasPhantomAccount: boolean;
  hasFullFunctionality: boolean;
  pendingRegistration: PendingRegistrationData | null;
  suggestedPlayerName: string;
  isSessionLoading: boolean;

  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: () => Promise<{ isNewUser: boolean }>;
  signInWithDiscord: () => void;
  linkDiscord: () => void;
  linkPhantom: () => Promise<UserData>;
  registerUser: (name: string) => Promise<UserData>;
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
    provider: provider === 'discord' || provider === 'phantom' ? provider : null,
    errorCode: params.get('error'),
  };
}

function getOAuthErrorMessage(errorCode: string | null): string {
  switch (errorCode) {
    case 'disabled':
      return 'Discord sign-in is currently disabled.';
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
  if (user.linkedAccounts.some((account) => account.provider === 'phantom') || user.walletAddress) return 'phantom';
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
  const authProviderRef = useRef<AuthProviderName | null>(null);

  useEffect(() => {
    authProviderRef.current = authProvider;
  }, [authProvider]);

  const applyUserSession = useCallback((nextUser: UserData, provider?: AuthProviderName | null) => {
    setIsAuthenticated(true);
    setIsNewUser(false);
    setUser(nextUser);
    setPendingRegistration(null);
    setWalletAddress(nextUser.walletAddress);
    setIsConnected(Boolean(nextUser.walletAddress));
    setAuthProvider(provider ?? inferAuthProvider(nextUser));
  }, []);

  const applyPendingRegistration = useCallback((pending: PendingRegistrationData) => {
    setIsAuthenticated(true);
    setIsNewUser(true);
    setUser(null);
    setPendingRegistration(pending);
    setWalletAddress(pending.walletAddress ?? null);
    setIsConnected(pending.provider === 'phantom' && Boolean(pending.walletAddress));
    setAuthProvider(pending.provider);
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      const oauthReturn = getOAuthReturnStatus();

      try {
        const result = await apiRequest<{
          authenticated: boolean;
          isNewUser?: boolean;
          provider?: AuthProviderName | null;
          user?: UserData;
          pendingRegistration?: PendingRegistrationData;
          error?: string;
        }>('/auth/session');

        if (result.authenticated && result.user) {
          applyUserSession(result.user, result.provider ?? oauthReturn.provider);
        } else if (result.authenticated && result.isNewUser && result.pendingRegistration) {
          applyPendingRegistration(result.pendingRegistration);
        }
      } catch {
        loggers.auth.debug('no existing session found');
      } finally {
        if (oauthReturn.status === 'error') {
          setError(getOAuthErrorMessage(oauthReturn.errorCode));
        } else if (oauthReturn.status === 'linked') {
          setNotice('Discord connected.');
        } else if (oauthReturn.status === 'success') {
          setNotice('Signed in with Discord.');
        }

        cleanOAuthReturnParams();
        setIsSessionLoading(false);
      }
    };

    restoreSession();
  }, [applyPendingRegistration, applyUserSession]);

  useEffect(() => {
    const checkForPhantom = () => {
      const provider = getPhantomProvider();
      setIsPhantomInstalled(Boolean(provider));

      if (provider?.isConnected && provider.publicKey && !isAuthenticated) {
        setIsConnected(true);
        setWalletAddress(provider.publicKey.toBase58());
      }
    };

    checkForPhantom();
    const timeout = setTimeout(checkForPhantom, 500);
    return () => clearTimeout(timeout);
  }, [isAuthenticated]);

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
      if (authProviderRef.current === 'phantom') {
        setWalletAddress(null);
        setIsAuthenticated(false);
        setUser(null);
        setIsNewUser(false);
        setPendingRegistration(null);
        setAuthProvider(null);
      }
    };

    const handleAccountChanged = (publicKey: WalletPublicKey | null) => {
      if (publicKey) {
        loggers.auth.debug('account changed', publicKey.toBase58());
        setWalletAddress(publicKey.toBase58());
        if (authProviderRef.current === 'phantom') {
          setIsAuthenticated(false);
          setUser(null);
          setIsNewUser(false);
          setPendingRegistration(null);
          setAuthProvider(null);
        }
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
    if (!config.discordAuthEnabled) {
      setError('Discord sign-in is currently disabled.');
      return;
    }

    setError(null);
    setNotice(null);
    const returnTo = encodeURIComponent(getCleanReturnTo());
    window.location.assign(`${getHttpUrl()}/auth/discord/start?returnTo=${returnTo}`);
  }, []);

  const linkDiscord = useCallback(() => {
    if (!config.discordAuthEnabled) {
      setError('Discord linking is currently disabled.');
      return;
    }

    setError(null);
    setNotice(null);
    const returnTo = encodeURIComponent(getCleanReturnTo());
    window.location.assign(`${getHttpUrl()}/auth/discord/link/start?returnTo=${returnTo}`);
  }, []);

  const verifyPhantomWithServer = useCallback(async (provider: PhantomProvider, address: string) => {
    const { nonce, message } = await apiRequest<{ nonce: string; message: string }>(
      `/auth/nonce?walletAddress=${encodeURIComponent(address)}`
    );

    const encodedMessage = new TextEncoder().encode(message);
    const { signature } = await provider.signMessage(encodedMessage, 'utf8');
    const { default: bs58 } = await import('bs58');
    const signatureBase58 = bs58.encode(signature);

    return apiRequest<{
      authenticated: boolean;
      isNewUser: boolean;
      provider?: AuthProviderName;
      linked?: boolean;
      user?: UserData;
      walletAddress?: string;
      pendingRegistration?: PendingRegistrationData;
    }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        walletAddress: address,
        signature: signatureBase58,
        nonce,
      }),
    });
  }, []);

  const connect = useCallback(async () => {
    const provider = getPhantomProvider();

    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      setError('Phantom wallet is not installed. Please install it to continue.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const { publicKey } = await provider.connect();
      setWalletAddress(publicKey.toBase58());
      setIsConnected(true);
    } catch (err: any) {
      loggers.auth.error('failed to connect wallet:', err);
      if (err.code === 4001) {
        setError('Connection rejected. Please approve the connection request.');
      } else {
        setError(err.message || 'Failed to connect wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const provider = getPhantomProvider();

    if (provider) {
      provider.disconnect();
    }

    setIsConnected(false);
    setWalletAddress(null);
    if (authProviderRef.current === 'phantom') {
      setIsAuthenticated(false);
      setUser(null);
      setIsNewUser(false);
      setPendingRegistration(null);
      setAuthProvider(null);
    }
    setError(null);
    setNotice(null);
  }, []);

  const authenticate = useCallback(async (): Promise<{ isNewUser: boolean }> => {
    const provider = getPhantomProvider();

    if (!provider || !walletAddress) {
      throw new Error('Wallet not connected');
    }

    setError(null);
    setNotice(null);

    try {
      const result = await verifyPhantomWithServer(provider, walletAddress);

      if (result.authenticated) {
        if (result.isNewUser) {
          applyPendingRegistration(result.pendingRegistration ?? {
            provider: 'phantom',
            walletAddress,
            displayName: walletAddress,
          });
          return { isNewUser: true };
        }

        if (result.user) {
          applyUserSession(result.user, 'phantom');
          if (result.linked) {
            setNotice('Phantom wallet connected.');
          }
          return { isNewUser: false };
        }
      }

      throw new Error('Authentication failed');
    } catch (err: any) {
      loggers.auth.error('authentication error:', err);
      if (err.code === 4001) {
        setError('Signature rejected. Please sign the message to authenticate.');
      } else {
        setError(err.message || 'Authentication failed');
      }
      throw err;
    }
  }, [applyPendingRegistration, applyUserSession, verifyPhantomWithServer, walletAddress]);

  const linkPhantom = useCallback(async (): Promise<UserData> => {
    const provider = getPhantomProvider();

    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      setError('Phantom wallet is not installed. Please install it to continue.');
      throw new Error('Phantom wallet not installed');
    }

    if (!isAuthenticated || !user) {
      setError('Sign in before linking Phantom.');
      throw new Error('Sign in before linking Phantom.');
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
      if (result.authenticated && result.user && !result.isNewUser) {
        applyUserSession(result.user, 'phantom');
        setNotice('Phantom wallet connected.');
        return result.user;
      }

      throw new Error('Phantom linking failed');
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
  }, [applyUserSession, isAuthenticated, user, verifyPhantomWithServer]);

  const registerUser = useCallback(async (name: string): Promise<UserData> => {
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ success: boolean; user: UserData }>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
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
  }, [applyUserSession, authProvider, walletAddress]);

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
  const linkedAccounts = user?.linkedAccounts ?? [];
  const hasDiscordAccount = linkedAccounts.some((account) => account.provider === 'discord');
  const hasPhantomAccount = Boolean(user?.walletAddress) || linkedAccounts.some((account) => account.provider === 'phantom');
  const hasFullFunctionality = isAuthenticated && Boolean(user) && hasPhantomAccount;

  return (
    <WalletContext.Provider
      value={{
        isPhantomInstalled,
        isConnected,
        isConnecting,
        walletAddress,
        isAuthenticated,
        isDiscordAuthEnabled: config.discordAuthEnabled,
        isNewUser,
        authProvider,
        user,
        linkedAccounts,
        hasDiscordAccount,
        hasPhantomAccount,
        hasFullFunctionality,
        pendingRegistration,
        suggestedPlayerName: getSuggestedPlayerName(pendingRegistration),
        isSessionLoading,
        connect,
        disconnect,
        authenticate,
        signInWithDiscord,
        linkDiscord,
        linkPhantom,
        registerUser,
        logout,
        error,
        notice,
        clearError,
        clearNotice,
      }}
    >
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
