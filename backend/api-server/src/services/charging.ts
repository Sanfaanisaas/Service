import mongoose from 'mongoose';
import type { z } from 'zod';
import type { chargingCheckInInput } from '../contracts.js';
import { claimId, secureToken } from '../lib/ids.js';
import { ApiError } from '../lib/errors.js';
import { ChargingSession, Customer, Notification, ResourceLock } from '../models/index.js';
import { audit, customerByPhone, releasePosition, reservePosition, settings, assertTransition } from './common.js';
import { generateReceipt, recordIncome } from './ledger.js';
import { sendCustomerPush } from './push.js';

type Input = z.infer<typeof chargingCheckInInput>;

export async function checkIn(input: Input, actorId: string) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const config = await settings(session);
      const lock = await reservePosition('charging', config.chargingCapacity, session);
      const customer = await customerByPhone(input, session);
      let publicSessionId = claimId(lock.position);
      for (let tries = 0; tries < 5 && await ChargingSession.exists({ publicSessionId }).session(session); tries += 1) publicSessionId = claimId(lock.position);
      const [charging] = await ChargingSession.create([{
        customerId: customer._id, customerName: customer.name, publicSessionId, secureClaimToken: secureToken(),
        device: { type: input.deviceType, brand: input.brand, model: input.model, color: input.color, description: input.description },
        slotNumber: lock.position, timeIn: new Date(),
        estimatedReadyAt: new Date(Date.now() + input.expectedMinutes * 60_000), status: 'charging',
        amount: input.amount, paymentStatus: input.amount > 0 ? 'paid' : 'pending', paymentMethod: input.paymentMethod,
      }], { session });
      lock.referenceId = charging._id;
      await lock.save({ session });
      if (input.amount > 0) await recordIncome({
        type: 'charging_fee', amount: input.amount, paymentMethod: input.paymentMethod,
        customerId: customer._id, referenceType: 'charging_session', referenceId: charging._id,
        description: `Charging fee for ${customer.name}`, createdBy: actorId,
      }, session);
      const receipt = await generateReceipt({
        type: 'charging', customerId: customer._id, customerName: customer.name, referenceId: charging._id,
        claimId: publicSessionId, total: input.amount, paymentMethod: input.paymentMethod,
        details: { device: charging.device, slotNumber: lock.position, timeIn: charging.timeIn, estimatedReadyAt: charging.estimatedReadyAt },
      }, session);
      await audit(actorId, 'CHARGING_CHECKED_IN', 'charging_session', charging.id, { slotNumber: lock.position }, session);
      return { session: charging, receipt };
    });
  } finally { await session.endSession(); }
}

export async function updateStatus(id: string, next: 'charging'|'ready'|'cancelled', actorId: string) {
  const current = await ChargingSession.findById(id);
  if (!current) throw new ApiError(404, 'CHARGING_NOT_FOUND', 'Charging session not found.');
  assertTransition(current.status, next, 'charging');
  current.status = next;
  if (next === 'ready') current.readyAt = new Date();
  await current.save();
  if (next === 'ready') {
    const customer = await Customer.findById(current.customerId);
    if (customer?.notificationPreferences?.inApp) await Notification.create({
      customerId: current.customerId, title: 'Your device is ready',
      message: `Your device should now be ready for collection. Claim ID: ${current.publicSessionId}`,
      type: 'charging_ready',
    });
    if (customer?.notificationPreferences?.push && customer.notificationPreferences?.chargingReminders !== false) {
      await sendCustomerPush(current.customerId, {
        title: 'SANFAANI', body: 'Your device is ready for collection.',
        url: '/customer/device', tag: `charging-ready-${current.id}`,
      });
    }
  }
  if (next === 'cancelled') await releasePosition('charging', current.id);
  await audit(actorId, next === 'ready' ? 'CHARGING_MARKED_READY' : 'CHARGING_STATUS_UPDATED', 'charging_session', current.id);
  return current;
}

export async function collect(id: string, presentedClaimId: string, actorId: string) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const current = await ChargingSession.findOne({
        _id: id,
        status: 'ready',
        $or: [{ publicSessionId: presentedClaimId }, { secureClaimToken: presentedClaimId }],
      }).session(session);
      if (!current) throw new ApiError(404, 'CLAIM_NOT_VERIFIED', 'The claim ID could not be verified.');
      assertTransition(current.status, 'collected', 'charging');
      current.status = 'collected'; current.collectedAt = new Date();
      await current.save({ session });
      await releasePosition('charging', current.id, session);
      await audit(actorId, 'CHARGING_COLLECTED', 'charging_session', current.id, undefined, session);
      return current;
    });
  } finally { await session.endSession(); }
}

export async function verifyClaim(token: string) {
  const current = await ChargingSession.findOne({ secureClaimToken: token }).select('+secureClaimToken');
  if (!current) throw new ApiError(404, 'CLAIM_NOT_VERIFIED', 'The secure claim could not be verified.');
  if (current.status === 'collected') throw new ApiError(409, 'CLAIM_ALREADY_USED', 'This claim has already been collected.');
  if (current.status !== 'ready') throw new ApiError(409, 'DEVICE_NOT_READY', 'This device is not ready for collection.');
  return {
    sessionId: current.id,
    claimId: current.publicSessionId,
    customerName: current.customerName,
    device: current.device,
    slotNumber: current.slotNumber,
    status: current.status,
    readyAt: current.readyAt,
    eligibleForCollection: true,
  };
}
