import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  if (online) return null;
  return <div className="fixed inset-x-0 top-0 z-[100] bg-destructive px-4 py-3 text-center text-sm font-semibold text-destructive-foreground" role="status" data-testid="offline-banner">You're offline. Operational changes are temporarily unavailable.</div>;
}
