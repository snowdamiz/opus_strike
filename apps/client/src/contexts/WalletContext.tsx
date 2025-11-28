import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/environment';

// Types for Phantom wallet provider
interface PhantomProvider {
  publicKey: PublicKey | null;
  isConnected: boolean;
  isPhantom: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
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

export interface UserData {
  id: string;
  walletAddress: string;
  name: string;
  stats: {
    totalGames: number;
    totalWins: number;
    totalKills: number;
    totalDeaths: number;
    totalCaptures: number;
  };
}

interface WalletContextType {
  // Connection state
  isPhantomInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;
  
  // Auth state
  isAuthenticated: boolean;
  isNewUser: boolean;
  user: UserData | null;
  isSessionLoading: boolean; // Loading session from cookies
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: () => Promise<{ isNewUser: boolean }>;
  registerUser: (name: string) => Promise<UserData>;
  logout: () => Promise<void>;
  
  // Errors
  error: string | null;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

// Get Phantom provider
function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  
  const provider = window.phantom?.solana || window.solana;
  
  if (provider?.isPhantom) {
    return provider;
  }
  
  return null;
}

// API helper with credentials support for session cookies
async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const httpUrl = config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  const response = await fetch(`${httpUrl}${endpoint}`, {
    ...options,
    credentials: 'include', // Include cookies in requests
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
  const [user, setUser] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  
  // Restore session from cookies on page load
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const result = await apiRequest<{
          authenticated: boolean;
          user?: UserData;
          error?: string;
        }>('/auth/session');
        
        if (result.authenticated && result.user) {
          setIsAuthenticated(true);
          setUser(result.user);
          setWalletAddress(result.user.walletAddress);
          setIsConnected(true);
          setIsNewUser(false);
        }
      } catch (err) {
        // No valid session - this is expected for first-time visitors
        console.log('No existing session found');
      } finally {
        setIsSessionLoading(false);
      }
    };
    
    restoreSession();
  }, []);
  
  // Check for Phantom installation
  useEffect(() => {
    const checkForPhantom = () => {
      const provider = getPhantomProvider();
      setIsPhantomInstalled(!!provider);
      
      // Check if already connected (only update if not already authenticated via session)
      if (provider?.isConnected && provider.publicKey && !isAuthenticated) {
        setIsConnected(true);
        setWalletAddress(provider.publicKey.toBase58());
      }
    };
    
    // Check immediately
    checkForPhantom();
    
    // Also check after a short delay (Phantom might inject after page load)
    const timeout = setTimeout(checkForPhantom, 500);
    
    return () => clearTimeout(timeout);
  }, [isAuthenticated]);
  
  // Set up wallet event listeners
  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider) return;
    
    const handleConnect = (publicKey: PublicKey) => {
      console.log('Wallet connected:', publicKey.toBase58());
      setIsConnected(true);
      setWalletAddress(publicKey.toBase58());
    };
    
    const handleDisconnect = () => {
      console.log('Wallet disconnected');
      setIsConnected(false);
      setWalletAddress(null);
      setIsAuthenticated(false);
      setUser(null);
      setIsNewUser(false);
    };
    
    const handleAccountChanged = (publicKey: PublicKey | null) => {
      if (publicKey) {
        console.log('Account changed:', publicKey.toBase58());
        setWalletAddress(publicKey.toBase58());
        // Reset auth state when account changes
        setIsAuthenticated(false);
        setUser(null);
        setIsNewUser(false);
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
  
  // Connect to Phantom
  const connect = useCallback(async () => {
    const provider = getPhantomProvider();
    
    if (!provider) {
      // Open Phantom download page
      window.open('https://phantom.app/', '_blank');
      setError('Phantom wallet is not installed. Please install it to continue.');
      return;
    }
    
    setIsConnecting(true);
    setError(null);
    
    try {
      const { publicKey } = await provider.connect();
      setWalletAddress(publicKey.toBase58());
      setIsConnected(true);
    } catch (err: any) {
      console.error('Failed to connect wallet:', err);
      if (err.code === 4001) {
        setError('Connection rejected. Please approve the connection request.');
      } else {
        setError(err.message || 'Failed to connect wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);
  
  // Disconnect from Phantom
  const disconnect = useCallback(() => {
    const provider = getPhantomProvider();
    
    if (provider) {
      provider.disconnect();
    }
    
    setIsConnected(false);
    setWalletAddress(null);
    setIsAuthenticated(false);
    setUser(null);
    setIsNewUser(false);
    setError(null);
  }, []);
  
  // Authenticate with the server
  const authenticate = useCallback(async (): Promise<{ isNewUser: boolean }> => {
    const provider = getPhantomProvider();
    
    if (!provider || !walletAddress) {
      throw new Error('Wallet not connected');
    }
    
    setError(null);
    
    try {
      // Get nonce from server
      const { nonce, message } = await apiRequest<{ nonce: string; message: string }>(
        `/auth/nonce?walletAddress=${walletAddress}`
      );
      
      // Sign the message
      const encodedMessage = new TextEncoder().encode(message);
      const { signature } = await provider.signMessage(encodedMessage, 'utf8');
      const signatureBase58 = bs58.encode(signature);
      
      // Verify with server
      const result = await apiRequest<{
        authenticated: boolean;
        isNewUser: boolean;
        user?: UserData;
        walletAddress?: string;
      }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          signature: signatureBase58,
          nonce,
        }),
      });
      
      if (result.authenticated) {
        setIsAuthenticated(true);
        
        if (result.isNewUser) {
          setIsNewUser(true);
          return { isNewUser: true };
        } else if (result.user) {
          setUser(result.user);
          setIsNewUser(false);
          return { isNewUser: false };
        }
      }
      
      throw new Error('Authentication failed');
    } catch (err: any) {
      console.error('Authentication error:', err);
      if (err.code === 4001) {
        setError('Signature rejected. Please sign the message to authenticate.');
      } else {
        setError(err.message || 'Authentication failed');
      }
      throw err;
    }
  }, [walletAddress]);
  
  // Register new user with name
  const registerUser = useCallback(async (name: string): Promise<UserData> => {
    if (!walletAddress) {
      throw new Error('Wallet not connected');
    }
    
    setError(null);
    
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
        setUser(result.user);
        setIsNewUser(false);
        return result.user;
      }
      
      throw new Error('Registration failed');
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Registration failed');
      throw err;
    }
  }, [walletAddress]);
  
  // Logout - clear server session and local state
  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    
    // Disconnect wallet if connected
    const provider = getPhantomProvider();
    if (provider) {
      try {
        await provider.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
    }
    
    // Clear all local state
    setIsConnected(false);
    setWalletAddress(null);
    setIsAuthenticated(false);
    setUser(null);
    setIsNewUser(false);
    setError(null);
  }, []);
  
  const clearError = useCallback(() => setError(null), []);
  
  return (
    <WalletContext.Provider
      value={{
        isPhantomInstalled,
        isConnected,
        isConnecting,
        walletAddress,
        isAuthenticated,
        isNewUser,
        user,
        isSessionLoading,
        connect,
        disconnect,
        authenticate,
        registerUser,
        logout,
        error,
        clearError,
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

