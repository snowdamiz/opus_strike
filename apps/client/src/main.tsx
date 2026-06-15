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
const AdminDashboard = lazy(() => import('./components/ui/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const isAdminRoute = window.location.pathname === '/admin';

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
      {isAdminRoute ? (
        <AdminDashboard />
      ) : (
        <ClientAppShell />
      )}
    </Suspense>
  </React.StrictMode>
);

registerServiceWorker();
