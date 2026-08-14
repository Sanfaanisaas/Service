import { ChargingSession, Customer, Notification } from '../models/index.js';
import { sendCustomerPush } from '../services/push.js';

export async function sendDueChargingReminders(now = new Date()) {
  const due = await ChargingSession.find({ status: { $in: ['checked-in', 'charging'] }, estimatedReadyAt: { $lte: now }, readyAt: null, reminderSentAt: null });
  for (const charging of due) {
    const customer = await Customer.findById(charging.customerId);
    if (!customer?.notificationPreferences?.chargingReminders) continue;
    if (customer.notificationPreferences?.inApp) await Notification.create({
      customerId: customer._id, title: 'Collection reminder',
      message: `Your device should now be ready for collection. Claim ID: ${charging.publicSessionId}`, type: 'charging_reminder',
    });
    if (customer.notificationPreferences?.push) await sendCustomerPush(customer._id, {
      title: 'SANFAANI', body: 'Your device may be ready for collection.',
      url: '/customer/device', tag: `charging-reminder-${charging.id}`,
    });
    charging.reminderSentAt = now;
    await charging.save();
  }
  return due.length;
}
