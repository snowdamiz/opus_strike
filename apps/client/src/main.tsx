import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { WalletProvider } from './contexts/WalletContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { AdminDashboard } from './components/ui/AdminDashboard';
import { registerServiceWorker } from './pwa';
import './styles/index.css';

const isAdminRoute = window.location.pathname === '/admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>
);

registerServiceWorker();
