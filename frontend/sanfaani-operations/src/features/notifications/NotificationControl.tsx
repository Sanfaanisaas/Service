import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { createPushSubscription, deletePushSubscription, getPushPublicKey } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { registerPwa, urlBase64ToUint8Array } from '@/lib/pwa';

type State = 'not-requested' | 'enabled' | 'denied' | 'unsupported';

export default function NotificationControl() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [state, setState] = useState<State>(() => !supported ? 'unsupported' : Notification.permission === 'denied' ? 'denied' : 'not-requested');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => {
      if (subscription) setState('enabled');
    });
  }, [supported]);

  const enable = async () => {
    if (!supported || Notification.permission === 'denied') { setState(supported ? 'denied' : 'unsupported'); return; }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'not-requested'); return; }
      const registration = await registerPwa();
      if (!registration) throw new Error('Service worker unavailable');
      const { publicKey } = await getPushPublicKey();
      if (!publicKey) throw new Error('Browser push is not configured on the server');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const value = subscription.toJSON();
      if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error('Incomplete browser subscription');
      await createPushSubscription({ endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } });
      setState('enabled'); toast.success('Browser notifications enabled.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Browser notifications could not be enabled.'); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) { await deletePushSubscription({ endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
      setState('not-requested'); toast.success('Browser notifications disabled on this device.');
    } catch { toast.error('Browser notifications could not be disabled.'); }
    finally { setBusy(false); }
  };

  const message = {
    'not-requested': 'Off — enable when you are ready.', enabled: 'Enabled on this device.',
    denied: 'Blocked in browser settings. SANFAANI will not prompt again.', unsupported: 'Unsupported by this browser.',
  }[state];
  return <div className="rounded-lg border border-border bg-card p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
    <div><p className="text-sm font-semibold">Browser push</p><p className="mt-1 text-xs text-muted-foreground">{message}</p></div>
    {state === 'enabled'
      ? <button disabled={busy} onClick={() => void disable()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-bold uppercase tracking-wider sm:mt-0"><BellOff size={15} /> Disable</button>
      : <button disabled={busy || state === 'denied' || state === 'unsupported'} onClick={() => void enable()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50 sm:mt-0"><Bell size={15} /> {busy ? 'Enabling…' : 'Enable notifications'}</button>}
  </div>;
}
