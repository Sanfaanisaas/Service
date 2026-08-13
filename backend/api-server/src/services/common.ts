import type { ClientSession } from 'mongoose';
import { AuditLog, Customer, ResourceLock, Setting } from '../models/index.js';
import { ApiError } from '../lib/errors.js';

export const ACTIVE_CHARGING = ['checked-in', 'charging', 'ready'];
export const ACTIVE_WORKSPACE = ['registered', 'checked-in'];

export async function settings(session?: ClientSession) {
  return Setting.findOneAndUpdate(
    { key: 'business' }, { $setOnInsert: { key: 'business' } }, { new: true, upsert: true, session },
  );
}
export async function customerByPhone(input: {
  customerName: string; phone: string; email?: string; whatsappOptIn?: boolean;
}, session?: ClientSession) {
  return Customer.findOneAndUpdate(
    { phone: input.phone },
    {
      $set: { name: input.customerName, ...(input.email ? { email: input.email } : {}) },
      $setOnInsert: {
        phone: input.phone, whatsappOptIn: input.whatsappOptIn ?? false,
        notificationPreferences: { push: false, inApp: true },
      },
    },
    { new: true, upsert: true, runValidators: true, session },
  );
}
export async function ensurePositions(resource: 'charging'|'workspace', capacity: number, session?: ClientSession) {
  if (capacity < 1) throw new ApiError(409, 'CAPACITY_INVALID', 'Capacity must be at least one.');
  const operations = Array.from({ length: capacity }, (_, index) => ({
    updateOne: {
      filter: { resource, position: index + 1 },
      update: { $setOnInsert: { resource, position: index + 1, occupied: false, referenceId: null } },
      upsert: true,
    },
  }));
  await ResourceLock.bulkWrite(operations, { session });
}
export async function reservePosition(resource: 'charging'|'workspace', capacity: number, session?: ClientSession) {
  await ensurePositions(resource, capacity, session);
  const position = await ResourceLock.findOneAndUpdate(
    { resource, position: { $lte: capacity }, occupied: false },
    { $set: { occupied: true } },
    { new: true, sort: { position: 1 }, session },
  );
  if (!position) {
    const code = resource === 'charging' ? 'CHARGING_CAPACITY_REACHED' : 'WORKSPACE_CAPACITY_REACHED';
    throw new ApiError(409, code, resource === 'charging'
      ? `All ${capacity} charging slots are currently occupied.`
      : `All ${capacity} workspace seats are currently occupied.`);
  }
  return position;
}
export async function releasePosition(resource: 'charging'|'workspace', referenceId: string, session?: ClientSession) {
  await ResourceLock.updateOne({ resource, referenceId }, { $set: { occupied: false, referenceId: null } }, { session });
}
export async function audit(actorId: string, action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>, session?: ClientSession) {
  await AuditLog.create([{ actorId, action, entityType, entityId, metadata }], { session });
}
export function assertTransition(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    'checked-in': ['charging', 'cancelled'], charging: ['ready', 'cancelled'],
    ready: ['collected', 'cancelled'], registered: ['checked-in', 'cancelled'], 'checked-out': [],
  };
  if (!allowed[current]?.includes(next)) throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `Cannot move from ${current} to ${next}.`);
}
