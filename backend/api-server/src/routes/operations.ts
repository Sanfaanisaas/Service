import { Router, type Request } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  chargingCheckInInput, customerInput, customerProfileInput, productInput, productUpdateInput, saleInput, settingsInput, stockAdjustmentInput, workspaceInput,
} from '../contracts.js';
import { allow } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import {
  AppUser, ChargingSession, Customer, InventoryMovement, Notification, Product, Receipt, Sale,
  Setting, Transaction, WorkspaceBooking,
} from '../models/index.js';
import { checkIn, collect, updateStatus, verifyClaim } from '../services/charging.js';
import { createProduct, adjustStock, createSale } from '../services/inventory.js';
import { checkInWorkspace, checkOutWorkspace, registerWorkspace } from '../services/workspace.js';
import { ACTIVE_CHARGING, ACTIVE_WORKSPACE, audit, settings } from '../services/common.js';
import { businessDayBounds } from '../lib/dates.js';

export const operations = Router();
const staff = allow('admin', 'staff');
const admin = allow('admin');
const customerId = (req: Request) => {
  const id = req.authUser?.customerId;
  if (!id) throw new ApiError(403, 'CUSTOMER_PROFILE_REQUIRED', 'A customer profile is required for this request.');
  return id;
};
const routeParam = (value: string | string[] | undefined) => z.string().min(1).parse(value);
const receiptLookup = (value: string) => isValidObjectId(value)
  ? { $or: [{ _id: value }, { receiptNumber: value }] }
  : { receiptNumber: value };
const appUserResponse = (user: InstanceType<typeof AppUser>) => ({
  id: user.get('supabaseUserId') as string,
  appUserId: user.id,
  email: user.get('email') as string,
  name: user.get('name') as string | undefined,
  role: user.get('role') as 'admin' | 'staff' | 'customer',
  active: user.get('active') as boolean,
  customerId: user.get('customerId')?.toString() ?? null,
  createdAt: user.get('createdAt') instanceof Date ? user.get('createdAt').toISOString() : undefined,
});
const receiptDetail = async (receipt: InstanceType<typeof Receipt>) => {
  const value = receipt.toJSON() as Record<string, unknown>;
  if (receipt.type !== 'charging') return value;
  const charging = await ChargingSession.findById(receipt.referenceId).select('+secureClaimToken');
  return { ...value, claimToken: charging?.get('secureClaimToken') as string | undefined };
};

operations.get('/me', asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.authUser });
}));

// Customer-facing endpoints intentionally derive ownership from the verified
// application user. No browser supplied customer identifier is accepted.
operations.get('/customer/me', allow('customer'), asyncHandler(async (req, res) => {
  const customer = await Customer.findById(customerId(req));
  if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer profile not found.');
  res.json({ success: true, data: { ...customer.toJSON(), accountStatus: req.authUser!.active ? 'active' : 'inactive' } });
}));
operations.patch('/customer/me', allow('customer'), asyncHandler(async (req, res) => {
  const input = customerProfileInput.parse(req.body);
  const customer = await Customer.findById(customerId(req));
  if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer profile not found.');
  customer.name = input.name;
  customer.phone = input.phone;
  customer.whatsappOptIn = input.whatsappOptIn;
  customer.set('notificationPreferences.inApp', input.notificationPreferences.inApp);
  customer.set('notificationPreferences.chargingReminders', input.notificationPreferences.chargingReminders);
  customer.set('notificationPreferences.workspaceAvailability', input.notificationPreferences.workspaceAvailability);
  await customer.save();
  await AppUser.updateOne({ _id: req.authUser!.appUserId }, { name: customer.name });
  await audit(req.authUser!.id, 'CUSTOMER_PROFILE_UPDATED', 'customer', customer.id, {
    whatsappOptIn: customer.whatsappOptIn,
    chargingReminders: customer.get('notificationPreferences.chargingReminders') as boolean,
    workspaceAvailability: customer.get('notificationPreferences.workspaceAvailability') as boolean,
  });
  res.json({ success: true, data: { ...customer.toJSON(), accountStatus: 'active' } });
}));
operations.get('/customer/me/charging', allow('customer'), asyncHandler(async (req, res) => {
  const id = customerId(req);
  const view = z.enum(['active', 'history', 'latest']).optional().parse(req.query.view);
  if (view === 'latest') {
    const latest = await ChargingSession.findOne({ customerId: id }).sort({ createdAt: -1 });
    res.json({ success: true, data: { activeSession: latest?.status && ACTIVE_CHARGING.includes(latest.status) ? latest : null, recentSessions: latest ? [latest] : [] } });
    return;
  }
  if (view === 'active') {
    const activeSession = await ChargingSession.findOne({ customerId: id, status: { $in: ACTIVE_CHARGING } }).sort({ createdAt: -1 });
    res.json({ success: true, data: { activeSession, recentSessions: activeSession ? [activeSession] : [] } });
    return;
  }
  const [activeSession, recentSessions] = await Promise.all([
    ChargingSession.findOne({ customerId: id, status: { $in: ACTIVE_CHARGING } }).sort({ createdAt: -1 }),
    ChargingSession.find({ customerId: id }).sort({ createdAt: -1 }).limit(20),
  ]);
  res.json({ success: true, data: { activeSession, recentSessions } });
}));
operations.get('/customer/me/workspace', allow('customer'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await WorkspaceBooking.find({ customerId: customerId(req) }).sort({ createdAt: -1 }).limit(50) });
}));
operations.get('/customer/me/receipts', allow('customer'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Receipt.find({ customerId: customerId(req) }).sort({ generatedAt: -1 }).limit(200) });
}));
operations.get('/customer/me/receipts/:id', allow('customer'), asyncHandler(async (req, res) => {
  const receipt = await Receipt.findOne({
    customerId: customerId(req),
    ...receiptLookup(routeParam(req.params.id)),
  });
  if (!receipt) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
  res.json({ success: true, data: await receiptDetail(receipt) });
}));
operations.get('/customer/me/notifications', allow('customer'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Notification.find({ customerId: customerId(req) }).sort({ createdAt: -1 }).limit(100) });
}));
operations.patch('/customer/me/notifications/:id/read', allow('customer'), asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, customerId: customerId(req) }, { read: true }, { new: true },
  );
  if (!notification) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  res.json({ success: true, data: notification });
}));

operations.get('/customers', staff, asyncHandler(async (req, res) => {
  const search = z.string().trim().max(100).optional().parse(req.query.search);
  const filter = search ? { $or: [
    { name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } },
  ] } : {};
  res.json({ success: true, data: await Customer.find(filter).sort({ createdAt: -1 }).limit(100) });
}));
operations.post('/customers', staff, asyncHandler(async (req, res) => {
  const input = customerInput.parse(req.body);
  const customer = await Customer.create(input);
  await audit(req.authUser!.id, 'CUSTOMER_CREATED', 'customer', customer.id);
  res.status(201).json({ success: true, data: customer });
}));
operations.get('/customers/:id', staff, asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  res.json({ success: true, data: customer });
}));

operations.get('/charging', staff, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await ChargingSession.find({ status: { $in: ACTIVE_CHARGING } }).sort({ status: -1, slotNumber: 1 }) });
}));
operations.get('/charging/:id', staff, asyncHandler(async (req, res) => {
  const charging = await ChargingSession.findById(routeParam(req.params.id));
  if (!charging) throw new ApiError(404, 'CHARGING_NOT_FOUND', 'Charging session not found.');
  res.json({ success: true, data: charging });
}));
operations.post('/charging/check-in', staff, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await checkIn(chargingCheckInInput.parse(req.body), req.authUser!.id) });
}));
operations.patch('/charging/:id/status', staff, asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['charging', 'ready', 'cancelled']) }).parse(req.body);
  res.json({ success: true, data: await updateStatus(routeParam(req.params.id), status, req.authUser!.id) });
}));
operations.post('/charging/:id/ready', staff, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateStatus(routeParam(req.params.id), 'ready', req.authUser!.id) });
}));
operations.post('/charging/:id/collect', staff, asyncHandler(async (req, res) => {
  const { claimId } = z.object({ claimId: z.string().min(10) }).parse(req.body);
  res.json({ success: true, data: await collect(routeParam(req.params.id), claimId, req.authUser!.id) });
}));
operations.post('/charging/verify-claim', staff, asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
  res.json({ success: true, data: await verifyClaim(token) });
}));

operations.get('/workspace', staff, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await WorkspaceBooking.find({ status: { $in: ACTIVE_WORKSPACE } }).sort({ createdAt: -1 }) });
}));
operations.post('/workspace/register', staff, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await registerWorkspace(workspaceInput.parse(req.body), req.authUser!.id) });
}));
operations.post('/workspace/:id/check-in', staff, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await checkInWorkspace(routeParam(req.params.id), req.authUser!.id) });
}));
operations.post('/workspace/:id/check-out', staff, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await checkOutWorkspace(routeParam(req.params.id), req.authUser!.id) });
}));

operations.get('/products', staff, asyncHandler(async (req, res) => {
  const search = z.string().trim().max(100).optional().parse(req.query.search);
  const category = z.string().trim().max(80).optional().parse(req.query.category);
  const filter = {
    ...(search ? { $or: [{ name: { $regex: search, $options: 'i' } }, { sku: { $regex: search, $options: 'i' } }] } : {}),
    ...(category ? { category } : {}),
  };
  res.json({ success: true, data: await Product.find(filter).sort({ name: 1 }) });
}));
operations.post('/products', admin, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createProduct(productInput.parse(req.body), req.authUser!.id) });
}));
operations.patch('/products/:id', admin, asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, productUpdateInput.parse(req.body), { new: true, runValidators: true });
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  await audit(req.authUser!.id, 'PRODUCT_UPDATED', 'product', product.id);
  res.json({ success: true, data: product });
}));
operations.delete('/products/:id', admin, asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  await audit(req.authUser!.id, 'PRODUCT_DEACTIVATED', 'product', product.id);
  res.json({ success: true, data: product });
}));
operations.post('/products/:id/adjust', admin, asyncHandler(async (req, res) => {
  const input = stockAdjustmentInput.parse(req.body);
  res.json({ success: true, data: await adjustStock(routeParam(req.params.id), input.quantity, input.type, input.reason, input.note || undefined, req.authUser!.id) });
}));
operations.get('/products/:id/movements', staff, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await InventoryMovement.find({ productId: req.params.id }).sort({ createdAt: -1 }) });
}));

operations.get('/sales', staff, asyncHandler(async (_req, res) => res.json({ success: true, data: await Sale.find().sort({ createdAt: -1 }).limit(100) })));
operations.post('/sales', staff, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createSale(saleInput.parse(req.body), req.authUser!.id) });
}));
operations.get('/sales/:id', staff, asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND', 'Sale not found.');
  res.json({ success: true, data: sale });
}));

operations.get('/transactions', staff, asyncHandler(async (req, res) => {
  const period = z.enum(['today', 'yesterday', 'week', 'month']).optional().parse(req.query.period);
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  let range: { $gte?: Date; $lte?: Date; $lt?: Date } | undefined = from || to ? { ...(from && !Number.isNaN(from.getTime()) ? { $gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { $lte: to } : {}) } : undefined;
  if (period && !range) {
    const config = await settings(); const now = new Date();
    if (period === 'today') range = { $gte: businessDayBounds(config.businessTimezone, now).start, $lt: businessDayBounds(config.businessTimezone, now).end };
    if (period === 'yesterday') { const day = new Date(now.getTime() - 86_400_000); const bounds = businessDayBounds(config.businessTimezone, day); range = { $gte: bounds.start, $lt: bounds.end }; }
    if (period === 'week') { const day = new Intl.DateTimeFormat('en-US', { timeZone: config.businessTimezone, weekday: 'short' }).format(now); const offset = ({ Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 } as Record<string, number>)[day] ?? 0; const bounds = businessDayBounds(config.businessTimezone, new Date(now.getTime() - offset * 86_400_000)); range = { $gte: bounds.start, $lt: businessDayBounds(config.businessTimezone, now).end }; }
    if (period === 'month') { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.businessTimezone, year: 'numeric', month: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value])); const bounds = businessDayBounds(config.businessTimezone, new Date(`${parts.year}-${parts.month}-01T12:00:00Z`)); range = { $gte: bounds.start, $lt: businessDayBounds(config.businessTimezone, now).end }; }
  }
  res.json({ success: true, data: await Transaction.find(range ? { createdAt: range } : {}).sort({ createdAt: -1 }).limit(500) });
}));
operations.get('/receipts', staff, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await Receipt.find().sort({ generatedAt: -1 }).limit(200) });
}));
operations.get('/receipts/:id', staff, asyncHandler(async (req, res) => {
  const receipt = await Receipt.findOne(receiptLookup(routeParam(req.params.id)));
  if (!receipt) throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
  res.json({ success: true, data: await receiptDetail(receipt) });
}));

operations.get('/notifications', staff, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Notification.find({ userId: req.authUser!.appUserId }).sort({ createdAt: -1 }).limit(100) });
}));
operations.patch('/notifications/:id/read', staff, asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, userId: req.authUser!.appUserId };
  res.json({ success: true, data: await Notification.findOneAndUpdate(filter, { read: true }, { new: true }) });
}));

operations.get('/settings', staff, asyncHandler(async (_req, res) => res.json({ success: true, data: await settings() })));
operations.patch('/settings', admin, asyncHandler(async (req, res) => {
  const input = settingsInput.parse(req.body);
  const current = await settings();
  const activeCharging = await ChargingSession.countDocuments({ status: { $in: ACTIVE_CHARGING } });
  const activeWorkspace = await WorkspaceBooking.countDocuments({ status: { $in: ACTIVE_WORKSPACE } });
  if (input.chargingCapacity < activeCharging || input.workspaceCapacity < activeWorkspace) throw new ApiError(409, 'CAPACITY_BELOW_OCCUPANCY', 'Capacity cannot be lower than current occupancy.');
  Object.assign(current, input); await current.save();
  await audit(req.authUser!.id, 'SETTINGS_UPDATED', 'setting', current.id);
  res.json({ success: true, data: current });
}));
operations.get('/staff', admin, asyncHandler(async (_req, res) => {
  const users = await AppUser.find().sort({ createdAt: -1 });
  res.json({ success: true, data: users.map(appUserResponse) });
}));
operations.patch('/staff/:id/role', admin, asyncHandler(async (req, res) => {
  const { role } = z.object({ role: z.enum(['admin', 'staff', 'customer']) }).parse(req.body);
  const user = await AppUser.findById(req.params.id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
  const previousRole = user.get('role');
  if (previousRole === 'admin' && role !== 'admin') {
    const activeAdminCount = await AppUser.countDocuments({ role: 'admin', active: true });
    if (user.get('active') && activeAdminCount <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'At least one active administrator must remain.');
  }
  user.set('role', role);
  await user.save();
  await audit(req.authUser!.id, 'USER_ROLE_UPDATED', 'user', user.id, { actor: req.authUser!.id, targetUser: user.id, previousRole, newRole: role, timestamp: new Date().toISOString() });
  res.json({ success: true, data: appUserResponse(user) });
}));
operations.patch('/staff/:id/active', admin, asyncHandler(async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const user = await AppUser.findById(req.params.id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
  if (!active && user.get('role') === 'admin' && user.get('active')) {
    const activeAdminCount = await AppUser.countDocuments({ role: 'admin', active: true });
    if (activeAdminCount <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'At least one active administrator must remain.');
  }
  const previousActive = user.get('active');
  user.set('active', active);
  await user.save();
  await audit(req.authUser!.id, 'USER_ACTIVE_UPDATED', 'user', user.id, { actor: req.authUser!.id, targetUser: user.id, previousActive, active, timestamp: new Date().toISOString() });
  res.json({ success: true, data: appUserResponse(user) });
}));
