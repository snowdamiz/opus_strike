import './polyfills';
import React, { Suspense, lazy, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { WalletProvider } from './contexts/WalletContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { GlobalNotificationBanner } from './components/ui/GlobalNotificationBanner';
import { registerServiceWorker } from './pwa';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>
);

registerServiceWorker();
