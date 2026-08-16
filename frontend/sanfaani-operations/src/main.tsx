import { createRoot } from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { Providers } from '@/app/providers';

import './index.css';
import { registerPwa } from '@/lib/pwa';

if (import.meta.env.PROD) void registerPwa().catch((error) => console.error('Service worker registration failed', error));

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <Providers><App /><SpeedInsights /></Providers>
  </ErrorBoundary>,
);
