import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../lib/errors.js';
import { Customer, PushSubscription } from '../models/index.js';
import '../services/push.js';

export const push = Router();
push.get('/push/public-key', (_req, res) => res.json({ success: true, data: { publicKey: env.VAPID_PUBLIC_KEY ?? null } }));
push.post('/push/subscriptions', asyncHandler(async (req, res) => {
  const input = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) }).parse(req.body);
  const subscription = await PushSubscription.findOneAndUpdate(
    { endpoint: input.endpoint }, { ...input, userId: req.authUser!.appUserId, customerId: req.authUser!.customerId || undefined },
    { new: true, upsert: true },
  );
  if (req.authUser!.customerId) await Customer.updateOne({ _id: req.authUser!.customerId }, { 'notificationPreferences.push': true });
  res.status(201).json({ success: true, data: { enabled: Boolean(subscription) } });
}));
push.delete('/push/subscriptions', asyncHandler(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
  await PushSubscription.deleteOne({ endpoint, userId: req.authUser!.appUserId });
  if (req.authUser!.customerId && await PushSubscription.countDocuments({ customerId: req.authUser!.customerId }) === 0) {
    await Customer.updateOne({ _id: req.authUser!.customerId }, { 'notificationPreferences.push': false });
  }
  res.json({ success: true, data: { enabled: false } });
}));
