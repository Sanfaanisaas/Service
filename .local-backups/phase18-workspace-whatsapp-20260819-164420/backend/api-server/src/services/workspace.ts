import mongoose from 'mongoose';
import type { z } from 'zod';
import type { workspaceInput } from '../contracts.js';
import { ApiError } from '../lib/errors.js';
import { Customer, Notification, ResourceLock, WorkspaceBooking } from '../models/index.js';
import { ACTIVE_WORKSPACE, assertTransition, audit, customerByPhone, releasePosition, reservePosition, settings } from './common.js';
import { generateReceipt, recordIncome } from './ledger.js';
import { sendCustomerPush } from './push.js';

type Input = z.infer<typeof workspaceInput>;
export async function registerWorkspace(input: Input, actorId: string) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const config = await settings(session);
      const lock = await reservePosition('workspace', config.workspaceCapacity, session);
      const customer = await customerByPhone(input, session);
      const [booking] = await WorkspaceBooking.create([{
        customerId: customer._id, customerName: customer.name, phone: input.phone,
        deviceInfo: input.deviceInfo, seatNumber: lock.position, amount: input.amount,
        paymentMethod: input.paymentMethod, status: 'registered',
      }], { session });
      lock.referenceId = booking._id;
      await lock.save({ session });
      if (input.amount > 0) await recordIncome({
        type: 'workspace_fee', amount: input.amount, paymentMethod: input.paymentMethod,
        customerId: customer._id, referenceType: 'workspace_booking', referenceId: booking._id,
        description: `Workspace fee for ${customer.name}`, createdBy: actorId,
      }, session);
      const receipt = input.amount > 0 ? await generateReceipt({
        type: 'workspace', customerId: customer._id, customerName: customer.name, referenceId: booking._id,
        total: input.amount, paymentMethod: input.paymentMethod, details: { seatNumber: lock.position },
      }, session) : undefined;
      await audit(actorId, 'WORKSPACE_REGISTERED', 'workspace_booking', booking.id, { seatNumber: lock.position }, session);
      return { booking, receipt, whatsappGroupInviteUrl: config.whatsappGroupInviteUrl };
    });
  } finally { await session.endSession(); }
}
export async function checkInWorkspace(id: string, actorId: string) {
  const booking = await WorkspaceBooking.findById(id);
  if (!booking) throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace booking not found.');
  assertTransition(booking.status, 'checked-in', 'workspace');
  booking.status = 'checked-in'; booking.timeIn = new Date();
  await booking.save();
  await audit(actorId, 'WORKSPACE_CHECKED_IN', 'workspace_booking', booking.id);
  return booking;
}
export async function checkOutWorkspace(id: string, actorId: string) {
  const session = await mongoose.startSession();
  let wasFull = false;
  try {
    const result = await session.withTransaction(async () => {
      const booking = await WorkspaceBooking.findById(id).session(session);
      if (!booking) throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace booking not found.');
      const config = await settings(session);
      wasFull = await WorkspaceBooking.countDocuments({ status: { $in: ACTIVE_WORKSPACE } }).session(session) >= config.workspaceCapacity;
      assertTransition(booking.status, 'checked-out', 'workspace');
      booking.status = 'checked-out'; booking.timeOut = new Date();
      await booking.save({ session });
      await releasePosition('workspace', booking.id, session);
      await audit(actorId, 'WORKSPACE_CHECKED_OUT', 'workspace_booking', booking.id, undefined, session);
      return booking;
    });
    if (wasFull) await notifyWorkspaceAvailable();
    return result;
  } finally { await session.endSession(); }
}

async function notifyWorkspaceAvailable(now = new Date()) {
  const cutoff = new Date(now.getTime() - 6 * 60 * 60_000);
  const eligible = await Customer.find({
    'notificationPreferences.workspaceAvailability': true,
    $or: [{ lastWorkspaceNotificationAt: null }, { lastWorkspaceNotificationAt: { $lte: cutoff } }],
  });
  await Promise.all(eligible.map(async (candidate) => {
    const customer = await Customer.findOneAndUpdate({
      _id: candidate._id,
      $or: [{ lastWorkspaceNotificationAt: null }, { lastWorkspaceNotificationAt: { $lte: cutoff } }],
    }, { lastWorkspaceNotificationAt: now }, { new: true });
    if (!customer) return;
    if (customer.notificationPreferences?.inApp) await Notification.create({
      customerId: customer._id, title: 'Workspace available',
      message: 'A SANFAANI workspace place is now available.', type: 'workspace_available',
    });
    if (customer.notificationPreferences?.push) await sendCustomerPush(customer._id, {
      title: 'SANFAANI', body: 'A workspace place is now available.',
      url: '/customer/workspace', tag: 'workspace-available',
    });
  }));
}
