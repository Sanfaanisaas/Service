import { Router } from 'express';
import webpush from 'web-push';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../lib/errors.js';
import { PushSubscription } from '../models/index.js';

export const push = Router();
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
push.get('/push/public-key', (_req, res) => res.json({ success: true, data: { publicKey: env.VAPID_PUBLIC_KEY ?? null } }));
push.post('/push/subscriptions', asyncHandler(async (req, res) => {
  const input = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) }).parse(req.body);
  const subscription = await PushSubscription.findOneAndUpdate(
    { endpoint: input.endpoint }, { ...input, userId: req.authUser!.appUserId, customerId: req.authUser!.customerId || undefined },
    { new: true, upsert: true },
  );
  res.status(201).json({ success: true, data: subscription });
}));
