import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { DataProvider } from './state';
import { UIProvider } from './ui/ui';
import { VaultGate } from './security/Vault';
import { ProfileGate } from './security/Profiles';

declare const __SINGLE__: boolean;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProfileGate>
      <VaultGate>
        <DataProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </DataProvider>
      </VaultGate>
    </ProfileGate>
  </React.StrictMode>,
);

if (!__SINGLE__ && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
