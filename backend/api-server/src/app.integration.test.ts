import type { Express } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Identity = { id: string; email: string; user_metadata: { name: string } };
const identities: Record<string, Identity> = {
  admin: { id: 'supabase-admin', email: 'admin@sanfaani.test', user_metadata: { name: 'Admin' } },
  staff: { id: 'supabase-staff', email: 'staff@sanfaani.test', user_metadata: { name: 'Staff' } },
  customerA: { id: 'supabase-customer-a', email: 'customer-a@sanfaani.test', user_metadata: { name: 'Customer A' } },
  customerB: { id: 'supabase-customer-b', email: 'customer-b@sanfaani.test', user_metadata: { name: 'Customer B' } },
};

// The API accepts a Supabase access token. The mock isolates SANFAANI's
// middleware/RBAC behaviour while Supabase token validation is covered by
// Supabase itself in production.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => identities[token]
        ? { data: { user: identities[token] }, error: null }
        : { data: { user: null }, error: new Error('invalid token') },
    },
  }),
}));

let replicaSet: MongoMemoryReplSet;
let app: Express;
let models: typeof import('./models/index.js');
let connectDatabase: typeof import('./lib/database.js').connectDatabase;
let disconnectDatabase: typeof import('./lib/database.js').disconnectDatabase;

const auth = (token: keyof typeof identities) => ({ Authorization: `Bearer ${token}` });
const api = () => request(app);

async function provision(role: 'admin' | 'staff' | 'customer', token: keyof typeof identities) {
  await api().get('/api/me').set(auth(token)).expect(200);
  const user = await models.AppUser.findOneAndUpdate(
    { supabaseUserId: identities[token].id }, { $set: { role, active: true } }, { new: true },
  );
  if (!user) throw new Error('Test user was not provisioned');
  return user;
}

async function provisionCustomer(token: 'customerA' | 'customerB', phone: string) {
  const user = await provision('customer', token);
  const customer = await models.Customer.findOneAndUpdate(
    { email: identities[token].email },
    { $set: { name: identities[token].user_metadata.name, email: identities[token].email, phone } },
    { new: true, runValidators: true },
  );
  if (!customer) throw new Error('Customer profile was not provisioned');
  user.set('customerId', customer.id);
  await user.save();
  return customer;
}

async function updateSettings(overrides: Record<string, number> = {}) {
  const setting = await models.Setting.findOneAndUpdate(
    { key: 'business' },
    { $set: { chargingCapacity: 40, workspaceCapacity: 20, ...overrides }, $setOnInsert: { key: 'business' } },
    { new: true, upsert: true },
  );
  return setting;
}

function checkIn(phone: string, suffix = phone) {
  return api().post('/api/charging/check-in').set(auth('staff')).send({
    customerName: `Customer ${suffix}`, phone, deviceType: 'phone', expectedMinutes: 30, amount: 500, paymentMethod: 'cash',
  });
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    NODE_ENV: 'test', MONGODB_URI: replicaSet.getUri(), SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-that-is-long-enough', SANFAANI_ADMIN_EMAIL: identities.admin.email,
    CLIENT_URL: 'http://localhost:3000',
  });
  ({ connectDatabase, disconnectDatabase } = await import('./lib/database.js'));
  models = await import('./models/index.js');
  ({ app } = await import('./app.js'));
  await connectDatabase();
  await Promise.all(Object.values(models).map((model) => model.init()));
});

afterEach(async () => { await Promise.all(Object.values(models).map((model) => model.deleteMany({}))); });
afterAll(async () => { await disconnectDatabase(); await replicaSet.stop(); });

describe('SANFAANI auth and RBAC', () => {
  it('exposes a minimal health response and allows only the configured browser origin', async () => {
    const health = await api().get('/api/health').expect(200);
    expect(health.body).toEqual({ success: true, data: { status: 'ok' } });
    const allowed = await api().get('/api/me').set(auth('admin')).set('Origin', 'http://localhost:3000').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await api().get('/api/me').set(auth('admin')).set('Origin', 'https://untrusted.example').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://untrusted.example');
  });

  it('returns 401 for missing and invalid tokens, accepts a valid Supabase user, and rejects an inactive AppUser', async () => {
    await api().get('/api/me').expect(401);
    await api().get('/api/me').set({ Authorization: 'Bearer invalid' }).expect(401);
    await api().get('/api/me').set(auth('admin')).expect(200);
    await models.AppUser.updateOne({ supabaseUserId: identities.admin.id }, { active: false });
    await api().get('/api/me').set(auth('admin')).expect(403);
  });

  it('enforces operational and administrator privileges', async () => {
    await provision('staff', 'staff');
    await provisionCustomer('customerA', '08000000001');
    await api().get('/api/charging').set(auth('customerA')).expect(403);
    await api().get('/api/dashboard/summary').set(auth('customerA')).expect(403);
    await api().patch('/api/settings').set(auth('customerA')).send({}).expect(403);
    await api().patch('/api/settings').set(auth('staff')).send({}).expect(403);
    const staff = await models.AppUser.findOne({ supabaseUserId: identities.staff.id });
    await api().patch(`/api/staff/${staff!.id}/role`).set(auth('staff')).send({ role: 'admin' }).expect(403);
    await checkIn('08000000002').expect(201);
    await provision('admin', 'admin');
    await api().patch('/api/settings').set(auth('admin')).send({
      businessName: 'SANFAANI', currency: 'NGN', chargingCapacity: 40, workspaceCapacity: 20,
      defaultChargingPrice: 1000, defaultWorkspacePrice: 1500, businessTimezone: 'Africa/Lagos',
    }).expect(200);
  });

  it('preserves one active administrator while allowing audited account access changes', async () => {
    const admin = await provision('admin', 'admin');
    await api().patch(`/api/staff/${admin.id}/active`).set(auth('admin')).send({ active: false }).expect(409);
    await api().patch(`/api/staff/${admin.id}/role`).set(auth('admin')).send({ role: 'staff' }).expect(409);
    const secondAdmin = await provision('admin', 'staff');
    await api().patch(`/api/staff/${secondAdmin.id}/active`).set(auth('admin')).send({ active: false }).expect(200);
    const audit = await models.AuditLog.findOne({ action: 'USER_ACTIVE_UPDATED', entityId: secondAdmin.id });
    expect(audit?.get('metadata')).toMatchObject({ targetUser: secondAdmin.id, previousActive: true, active: false });
  });
});

describe('customer ownership', () => {
  it('returns only customer A charging, workspace, receipts, and notifications', async () => {
    await provision('staff', 'staff');
    const customerA = await provisionCustomer('customerA', '08000000011');
    const customerB = await provisionCustomer('customerB', '08000000012');
    const chargingA = await checkIn('08000000011', 'A').expect(201);
    await checkIn('08000000012', 'B').expect(201);
    await api().post('/api/workspace/register').set(auth('staff')).send({ customerName: 'Customer A', phone: '08000000011', amount: 250, paymentMethod: 'cash' }).expect(201);
    await api().post('/api/workspace/register').set(auth('staff')).send({ customerName: 'Customer B', phone: '08000000012', amount: 250, paymentMethod: 'cash' }).expect(201);
    await models.Notification.create([
      { customerId: customerA.id, title: 'A notice', message: 'Only A can read this', type: 'system' },
      { customerId: customerB.id, title: 'B notice', message: 'Only B can read this', type: 'system' },
    ]);
    const charging = await api().get('/api/customer/me/charging').set(auth('customerA')).expect(200);
    expect(charging.body.data.recentSessions).toHaveLength(1);
    expect(charging.body.data.recentSessions[0].customerId).toBe(customerA.id);
    await api().get(`/api/charging/${chargingA.body.data.session.id}`).set(auth('customerB')).expect(403);
    const workspace = await api().get('/api/customer/me/workspace').set(auth('customerA')).expect(200);
    expect(workspace.body.data).toHaveLength(1);
    expect(workspace.body.data[0].customerId).toBe(customerA.id);
    const receipts = await api().get('/api/customer/me/receipts').set(auth('customerA')).expect(200);
    expect(receipts.body.data).toHaveLength(2);
    expect(receipts.body.data.every((receipt: { customerId: string }) => receipt.customerId === customerA.id)).toBe(true);
    const ownedReceipt = await api().get(`/api/customer/me/receipts/${receipts.body.data[0].id}`).set(auth('customerA')).expect(200);
    expect(ownedReceipt.body.data.id).toBe(receipts.body.data[0].id);
    await api().get(`/api/customer/me/receipts/${receipts.body.data[0].id}`).set(auth('customerB')).expect(404);
    const notifications = await api().get('/api/customer/me/notifications').set(auth('customerA')).expect(200);
    expect(notifications.body.data).toHaveLength(1);
    const marked = await api().patch(`/api/customer/me/notifications/${notifications.body.data[0].id}/read`).set(auth('customerA')).expect(200);
    expect(marked.body.data.read).toBe(true);
  });
});

describe('browser push subscriptions', () => {
  it('stores and removes only the authenticated customer browser subscription', async () => {
    const customer = await provisionCustomer('customerA', '08000000019');
    const subscription = { endpoint: 'https://push.example.test/customer-a', keys: { p256dh: 'public-key', auth: 'auth-key' } };
    const created = await api().post('/api/push/subscriptions').set(auth('customerA')).send(subscription).expect(201);
    expect(created.body.data).toEqual({ enabled: true });
    expect(await models.PushSubscription.countDocuments({ customerId: customer.id })).toBe(1);
    expect((await models.Customer.findById(customer.id))?.notificationPreferences?.push).toBe(true);
    await api().delete('/api/push/subscriptions').set(auth('customerB')).send({ endpoint: subscription.endpoint }).expect(200);
    expect(await models.PushSubscription.countDocuments({ customerId: customer.id })).toBe(1);
    await api().delete('/api/push/subscriptions').set(auth('customerA')).send({ endpoint: subscription.endpoint }).expect(200);
    expect(await models.PushSubscription.countDocuments({ customerId: customer.id })).toBe(0);
    expect((await models.Customer.findById(customer.id))?.notificationPreferences?.push).toBe(false);
  });
});

describe('customer profile and consent', () => {
  it('persists valid profile edits and keeps each consent independent', async () => {
    await provisionCustomer('customerA', '08000000029');
    const updated = await api().patch('/api/customer/me').set(auth('customerA')).send({
      name: 'Customer Alpha', phone: '+234 800 000 0029', whatsappOptIn: true,
      notificationPreferences: { inApp: false, chargingReminders: true, workspaceAvailability: false },
    }).expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Customer Alpha', phone: '+234 800 000 0029', whatsappOptIn: true, accountStatus: 'active' });
    expect(updated.body.data.notificationPreferences).toMatchObject({ push: false, inApp: false, chargingReminders: true, workspaceAvailability: false });
    await api().patch('/api/customer/me').set(auth('customerA')).send({
      name: 'Customer Alpha', phone: 'invalid', whatsappOptIn: false,
      notificationPreferences: { inApp: true, chargingReminders: false, workspaceAvailability: true },
    }).expect(400);
    const persisted = await api().get('/api/customer/me').set(auth('customerA')).expect(200);
    expect(persisted.body.data.phone).toBe('+234 800 000 0029');
  });
});

describe('atomic operations and financial records', () => {
  it('verifies the secure QR credential and rejects it after one collection', async () => {
    await provision('staff', 'staff');
    const created = await checkIn('08000000021', 'secure-claim').expect(201);
    const session = await models.ChargingSession.findById(created.body.data.session.id).select('+secureClaimToken');
    const token = session?.get('secureClaimToken') as string;
    expect(token).toHaveLength(43);
    await api().patch(`/api/charging/${session!.id}/status`).set(auth('staff')).send({ status: 'ready' }).expect(200);
    const verified = await api().post('/api/charging/verify-claim').set(auth('staff')).send({ token }).expect(200);
    expect(verified.body.data).toMatchObject({ sessionId: session!.id, eligibleForCollection: true, status: 'ready' });
    expect(verified.body.data.secureClaimToken).toBeUndefined();
    await api().post(`/api/charging/${session!.id}/collect`).set(auth('staff')).send({ claimId: token }).expect(200);
    await api().post('/api/charging/verify-claim').set(auth('staff')).send({ token }).expect(409);
    await api().post(`/api/charging/${session!.id}/collect`).set(auth('staff')).send({ claimId: token }).expect(404);
  });

  it('admits 40 active charging sessions, rejects the 41st, never duplicates a slot, and frees a collected slot', async () => {
    await provision('staff', 'staff');
    await updateSettings({ chargingCapacity: 40 });
    const results = await Promise.all(Array.from({ length: 41 }, (_, index) => checkIn(`0800001${String(index).padStart(3, '0')}`, String(index))));
    expect(results.filter((result) => result.status === 201)).toHaveLength(40);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    const sessions = await models.ChargingSession.find({ status: { $in: ['checked-in', 'charging', 'ready'] } });
    expect(new Set(sessions.map((session) => session.slotNumber)).size).toBe(40);
    const finalSlot = sessions.find((session) => session.slotNumber === 40)!;
    await api().patch(`/api/charging/${finalSlot.id}/status`).set(auth('staff')).send({ status: 'ready' }).expect(200);
    await api().post(`/api/charging/${finalSlot.id}/collect`).set(auth('staff')).send({ claimId: finalSlot.publicSessionId }).expect(200);
    await checkIn('0800001999', 'replacement').expect(201);
  });

  it('never oversells inventory and writes the central ledger and receipts for charging, sales, and workspace payments', async () => {
    await provision('staff', 'staff');
    const product = await models.Product.create({ sku: 'TEST-STOCK', name: 'Test stock', category: 'test', costPrice: 50, sellingPrice: 100, quantityOnHand: 1, reorderThreshold: 0 });
    const [firstSale, secondSale] = await Promise.all([
      api().post('/api/sales').set(auth('staff')).send({ items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash' }),
      api().post('/api/sales').set(auth('staff')).send({ items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash' }),
    ]);
    expect([firstSale.status, secondSale.status].filter((status) => status === 201)).toHaveLength(1);
    expect([firstSale.status, secondSale.status]).toContain(409);
    expect((await models.Product.findById(product.id))!.quantityOnHand).toBe(0);
    await checkIn('08000000031').expect(201);
    await api().post('/api/workspace/register').set(auth('staff')).send({ customerName: 'Workspace payer', phone: '08000000032', amount: 200, paymentMethod: 'cash' }).expect(201);
    expect(await models.Transaction.countDocuments({ type: 'stock_sale' })).toBe(1);
    expect(await models.Transaction.countDocuments({ type: 'charging_fee' })).toBe(1);
    expect(await models.Transaction.countDocuments({ type: 'workspace_fee' })).toBe(1);
    const receipts = await models.Receipt.find();
    expect(receipts).toHaveLength(3);
    expect(new Set(receipts.map((receipt) => receipt.receiptNumber)).size).toBe(3);
  });

  it('audits role changes with the actor, previous role, and new role', async () => {
    await provision('admin', 'admin');
    const staff = await provision('staff', 'staff');
    await api().patch(`/api/staff/${staff.id}/role`).set(auth('admin')).send({ role: 'customer' }).expect(200);
    const audit = await models.AuditLog.findOne({ action: 'USER_ROLE_UPDATED' });
    expect(audit?.get('metadata')).toMatchObject({ actor: identities.admin.id, targetUser: staff.id, previousRole: 'staff', newRole: 'customer' });
  });
});

describe('admin analytics and exports', () => {
  it('aggregates revenue from the central ledger and keeps reports admin-only', async () => {
    await provision('admin', 'admin');
    await provision('staff', 'staff');
    await models.Transaction.create([
      { type: 'stock_sale', amount: 300, direction: 'income', paymentMethod: 'cash', description: 'Stock income', createdBy: 'test' },
      { type: 'charging_fee', amount: 150, direction: 'income', paymentMethod: 'cash', description: 'Charging income', createdBy: 'test' },
      { type: 'expense', amount: 80, direction: 'expense', paymentMethod: 'cash', description: 'Expense', createdBy: 'test' },
    ]);
    await api().get('/api/analytics?period=today').set(auth('staff')).expect(403);
    await api().get('/api/analytics?period=today').set(auth('customerA')).expect(403);
    const report = await api().get('/api/analytics?period=today').set(auth('admin')).expect(200);
    expect(report.body.data.revenue).toMatchObject({ income: 450, expenses: 80, net: 370, stockSales: 300, charging: 150, workspace: 0 });
    expect(report.body.data.revenueTrend[0]).toMatchObject({ income: 450, expenses: 80, net: 370 });
    const csv = await api().get('/api/reports/export?dataset=transactions&period=today').set(auth('admin')).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Stock income');
  });
});
