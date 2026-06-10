import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { WalletProvider } from './contexts/WalletContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { registerServiceWorker } from './pwa';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <NetworkProvider>
        <VoiceProvider>
          <App />
        </VoiceProvider>
      </NetworkProvider>
    </WalletProvider>
  </React.StrictMode>
);

registerServiceWorker();
