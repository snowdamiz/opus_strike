import './polyfills';
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { WalletProvider } from './contexts/WalletContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { registerServiceWorker } from './pwa';
import './styles/index.css';

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));
const AdminDashboard = lazy(() => import('./components/ui/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const isAdminRoute = window.location.pathname === '/admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {isAdminRoute ? (
        <AdminDashboard />
      ) : (
        <WalletProvider>
          <NetworkProvider>
            <VoiceProvider>
              <App />
            </VoiceProvider>
          </NetworkProvider>
        </WalletProvider>
      )}
    </Suspense>
  </React.StrictMode>
);

registerServiceWorker();
