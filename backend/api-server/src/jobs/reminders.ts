import webpush from 'web-push';
import { ChargingSession, Customer, Notification, PushSubscription } from '../models/index.js';

export async function sendDueChargingReminders(now = new Date()) {
  const due = await ChargingSession.find({ status: { $in: ['checked-in', 'charging'] }, estimatedReadyAt: { $lte: now }, readyAt: null });
  for (const charging of due) {
    const customer = await Customer.findById(charging.customerId);
    if (!customer?.notificationPreferences?.inApp) continue;
    const exists = await Notification.exists({ customerId: customer._id, type: 'charging_reminder', message: { $regex: charging.publicSessionId } });
    if (exists) continue;
    await Notification.create({
      customerId: customer._id, title: 'Collection reminder',
      message: `Your device should now be ready for collection. Claim ID: ${charging.publicSessionId}`, type: 'charging_reminder',
    });
    if (customer.notificationPreferences?.push) {
      const subscriptions = await PushSubscription.find({ customerId: customer._id });
      await Promise.allSettled(subscriptions.filter((subscription) => subscription.keys).map((subscription) => webpush.sendNotification({
        endpoint: subscription.endpoint, keys: subscription.keys!,
      }, JSON.stringify({ title: 'SANFAANI', body: `Your device should now be ready. Claim ID: ${charging.publicSessionId}` }))));
    }
  }
  return due.length;
}
