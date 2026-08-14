import webpush from 'web-push';
import { env } from '../config/env.js';
import { PushSubscription } from '../models/index.js';

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export async function sendCustomerPush(customerId: unknown, payload: { title: string; body: string; url: string; tag: string }) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0, removed: 0 };
  const subscriptions = await PushSubscription.find({ customerId });
  let sent = 0;
  let removed = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys! }, JSON.stringify(payload), { TTL: 3_600 });
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: subscription._id });
        removed += 1;
        return;
      }
      console.error('Push delivery failed', { status: status ?? 'unknown' });
    }
  }));
  return { sent, removed };
}
