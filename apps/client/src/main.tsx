import './polyfills';
import React, { Suspense, lazy, useState, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { WalletProvider } from './contexts/WalletContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { GlobalNotificationBanner } from './components/ui/GlobalNotificationBanner';
import { registerServiceWorker } from './pwa';
import { config } from './config/environment';
import './styles/index.css';

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));
const LegalPage = lazy(() => import('./components/ui/LegalPage').then((module) => ({ default: module.LegalPage })));
const AdminConsole = lazy(() =>
  import('./components/admin/AdminConsole').then((module) => ({ default: module.AdminConsole }))
);
const ModelLab = lazy(() =>
  import('./components/ui/ModelLab').then((module) => ({ default: module.ModelLab }))
);
const legalPageKind = getLegalPageKind(window.location.pathname);
const isAdminRoute = getIsAdminRoute(window.location.pathname);
const isModelLabRoute = getIsModelLabRoute(window.location.pathname);
const mobileWalletCallbackBridgeUrl = getMobileWalletCallbackBridgeUrl(window.location);
const DYNAMIC_IMPORT_RELOAD_STORAGE_KEY = 'slop:dynamicImportReloadAt';
const DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS = 60_000;

type MobileWalletCallbackBridgeResponse =
  | { action: 'redirect'; url: string }
  | { action: 'complete'; returnTo: string }
  | { action: 'error'; returnTo: string };

function getLegalPageKind(pathname: string) {
  if (pathname === '/terms-of-service') return 'terms';
  if (pathname === '/privacy-policy') return 'privacy';
  return null;
}

function getIsAdminRoute(pathname: string) {
  return pathname === '/admin' || pathname === '/admin/';
}

function getIsModelLabRoute(pathname: string) {
  return pathname === '/model-lab' || pathname === '/model-lab/';
}

function getMobileWalletCallbackBridgeUrl(location: Location): string | null {
  if (!/^\/auth\/mobile-wallet\/(?:phantom|solflare)\/(?:connect|sign)$/.test(location.pathname)) {
    return null;
  }

  const apiUrl = new URL(location.pathname, config.serverHttpUrl);
  apiUrl.search = location.search;
  return apiUrl.toString();
}

async function handleMobileWalletCallbackBridge(apiUrl: string): Promise<void> {
  try {
    const url = new URL(apiUrl);
    url.searchParams.set('response', 'json');

    const response = await fetch(url.toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Wallet callback failed (${response.status})`);
    }

    const result = await response.json() as Partial<MobileWalletCallbackBridgeResponse>;
    if (result.action === 'redirect' && typeof result.url === 'string') {
      window.location.replace(result.url);
      return;
    }
    if ((result.action === 'complete' || result.action === 'error') && typeof result.returnTo === 'string') {
      window.location.replace(result.returnTo);
      return;
    }

    throw new Error('Wallet callback returned an invalid response');
  } catch {
    window.location.replace('/?auth=error&provider=wallet&error=wallet_failed');
  }
}

function isDynamicImportLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|CSS_CHUNK_LOAD_FAILED/i.test(message);
}

function canReloadAfterDynamicImportError(): boolean {
  try {
    const now = Date.now();
    const lastReloadAt = Number(window.sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_STORAGE_KEY) || 0);
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_STORAGE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

class ChunkLoadErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; isChunkLoadError: boolean }
> {
  state = { hasError: false, isChunkLoadError: false };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      isChunkLoadError: isDynamicImportLoadError(error),
    };
  }

  componentDidCatch(error: unknown) {
    if (!isDynamicImportLoadError(error) || !canReloadAfterDynamicImportError()) return;

    window.setTimeout(() => {
      window.location.reload();
    }, 50);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-[#09090b] px-6 text-center font-display text-white">
        <div>
          <div className="text-sm uppercase tracking-[0.28em] text-white/55">
            {this.state.isChunkLoadError ? 'Refreshing client' : 'Client error'}
          </div>
          <div className="mt-3 text-2xl text-white">
            {this.state.isChunkLoadError ? 'Reloading...' : 'Refresh required'}
          </div>
        </div>
      </div>
    );
  }
}

function ClientAppShell() {
  const [isGlobalNotificationVisible, setIsGlobalNotificationVisible] = useState(false);

  return (
    <WalletProvider>
      <NetworkProvider>
        <VoiceProvider>
          <div className={`relative h-full min-h-0 ${isGlobalNotificationVisible ? 'global-notification-visible' : ''}`}>
            <GlobalNotificationBanner onVisibilityChange={setIsGlobalNotificationVisible} />
            <div className="h-full min-h-0">
              <App />
            </div>
          </div>
        </VoiceProvider>
      </NetworkProvider>
    </WalletProvider>
  );
}

if (mobileWalletCallbackBridgeUrl) {
  void handleMobileWalletCallbackBridge(mobileWalletCallbackBridgeUrl);
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ChunkLoadErrorBoundary>
        <Suspense fallback={null}>
          {isModelLabRoute ? (
            <ModelLab />
          ) : isAdminRoute ? (
            <AdminConsole />
          ) : legalPageKind ? (
            <LegalPage kind={legalPageKind} />
          ) : (
            <ClientAppShell />
          )}
        </Suspense>
      </ChunkLoadErrorBoundary>
    </React.StrictMode>
  );

  registerServiceWorker();
}
