'use client';

import { useEffect } from 'react';
import { PWAInstallBanner } from '../components/ui/pwa-install-banner';

export function PWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[SYNCRO] Service Worker registered:', registration);
        })
        .catch((error) => {
          console.error('[SYNCRO] Service Worker registration failed:', error);
        });
    }
  }, []);

  return (
    <>
      {children}
      <PWAInstallBanner />
    </>
  );
}