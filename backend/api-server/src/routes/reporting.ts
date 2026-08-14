import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { allow } from '../middleware/auth.js';
import { businessDayBounds } from '../lib/dates.js';
import { ChargingSession, Customer, InventoryMovement, Product, Receipt, Sale, Transaction, WorkspaceBooking } from '../models/index.js';
import { ACTIVE_CHARGING, ACTIVE_WORKSPACE, settings } from '../services/common.js';

export const reporting = Router();
const staff = allow('admin', 'staff');
const admin = allow('admin');
const reportQuery = z.object({
  period: z.enum(['today', 'yesterday', '7-days', '30-days', 'this-month', 'custom']).default('30-days'),
  from: z.string().date().optional(), to: z.string().date().optional(),
});

async function reportingRange(query: unknown) {
  const input = reportQuery.parse(query);
  const config = await settings();
  const now = new Date();
  if (input.period === 'custom') {
    if (!input.from || !input.to) throw new ApiError(400, 'DATE_RANGE_REQUIRED', 'Custom reports require from and to dates.');
    const start = businessDayBounds(config.businessTimezone, new Date(`${input.from}T12:00:00Z`)).start;
    const end = businessDayBounds(config.businessTimezone, new Date(`${input.to}T12:00:00Z`)).end;
    if (end <= start) throw new ApiError(400, 'INVALID_DATE_RANGE', 'The report end date must not be before the start date.');
    if (end.getTime() - start.getTime() > 366 * 86_400_000) throw new ApiError(400, 'DATE_RANGE_TOO_LARGE', 'Reports are limited to 366 days.');
    return { start, end, timezone: config.businessTimezone, input };
  }
  if (input.period === 'today') { const bounds = businessDayBounds(config.businessTimezone, now); return { ...bounds, timezone: config.businessTimezone, input }; }
  if (input.period === 'yesterday') { const bounds = businessDayBounds(config.businessTimezone, new Date(now.getTime() - 86_400_000)); return { ...bounds, timezone: config.businessTimezone, input }; }
  if (input.period === 'this-month') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.businessTimezone, year: 'numeric', month: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
    return { start: businessDayBounds(config.businessTimezone, new Date(`${parts.year}-${parts.month}-01T12:00:00Z`)).start, end: businessDayBounds(config.businessTimezone, now).end, timezone: config.businessTimezone, input };
  }
  const days = input.period === '7-days' ? 7 : 30;
  return { start: businessDayBounds(config.businessTimezone, new Date(now.getTime() - (days - 1) * 86_400_000)).start, end: businessDayBounds(config.businessTimezone, now).end, timezone: config.businessTimezone, input };
}

const transactionModule = (type: string) => type === 'stock_sale' ? 'inventory' : type === 'charging_fee' ? 'charging' : type === 'workspace_fee' ? 'workspace' : 'other';
reporting.get('/dashboard/summary', staff, asyncHandler(async (_req, res) => {
  const config = await settings();
  const { start, end } = businessDayBounds(config.businessTimezone);
  const [transactions, activeCharging, activeWorkspace, lowStock, customers, readySessions] = await Promise.all([
    Transaction.find({ createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }),
    ChargingSession.countDocuments({ status: { $in: ACTIVE_CHARGING } }),
    WorkspaceBooking.countDocuments({ status: { $in: ACTIVE_WORKSPACE } }),
    Product.find({ active: true, $expr: { $lte: ['$quantityOnHand', '$reorderThreshold'] } }).sort({ quantityOnHand: 1 }),
    Customer.countDocuments({ createdAt: { $gte: start, $lt: end } }),
    ChargingSession.find({ status: 'ready' }).sort({ readyAt: 1 }).limit(20),
  ]);
  const income = transactions.filter((item) => item.direction === 'income');
  const total = (type?: string) => income.filter((item) => !type || item.type === type).reduce((sum, item) => sum + item.amount, 0);
  const expenses = transactions.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + item.amount, 0);
  res.json({ success: true, data: {
    // Keep the detailed breakdown while exposing the stable dashboard contract.
    todayRevenue: total(),
    today: { revenue: total(), chargingRevenue: total('charging_fee'), stockRevenue: total('stock_sale'), workspaceRevenue: total('workspace_fee'), expenses, net: total() - expenses },
    charging: { active: activeCharging, capacity: config.chargingCapacity, available: Math.max(config.chargingCapacity - activeCharging, 0) },
    workspace: { occupied: activeWorkspace, capacity: config.workspaceCapacity, available: Math.max(config.workspaceCapacity - activeWorkspace, 0) },
    lowStockCount: lowStock.length, todayCustomers: customers, readySessions, lowStockProducts: lowStock.slice(0, 8),
    recentTransactions: transactions.slice(0, 8),
  } });
}));

reporting.get('/history', staff, asyncHandler(async (req, res) => {
  const config = await settings();
  const parsedDate = z.string().date().optional().parse(req.query.date);
  const type = z.enum(['all', 'charging', 'workspace', 'sales', 'transactions']).default('all').parse(req.query.type);
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
  const { start, end } = businessDayBounds(config.businessTimezone, parsedDate ? new Date(`${parsedDate}T12:00:00Z`) : new Date());
  const range = { createdAt: { $gte: start, $lt: end } };
  const [charging, workspace, sales, transactions] = await Promise.all([
    ChargingSession.find(range).sort({ createdAt: -1 }), WorkspaceBooking.find(range).sort({ createdAt: -1 }),
    Sale.find(range).sort({ createdAt: -1 }), Transaction.find(range).sort({ createdAt: -1 }),
  ]);
  const records = [
    ...charging.map((record) => ({ kind: 'charging', timestamp: record.get('createdAt') as Date, record })),
    ...workspace.map((record) => ({ kind: 'workspace', timestamp: record.get('createdAt') as Date, record })),
    ...sales.map((record) => ({ kind: 'sales', timestamp: record.get('createdAt') as Date, record })),
    ...transactions.map((record) => ({ kind: 'transactions', timestamp: record.get('createdAt') as Date, record })),
  ].filter((item) => type === 'all' || item.kind === type).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const revenue = transactions.filter((item) => item.direction === 'income').reduce((sum, item) => sum + item.amount, 0);
  res.json({ success: true, data: {
    date: start,
    summary: { chargingCount: charging.length, workspaceCount: workspace.length, salesCount: sales.length, revenue },
    transactions, charging, workspace, sales,
    records: records.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: records.length, pages: Math.ceil(records.length / limit) },
  } });
}));

reporting.get('/search', staff, asyncHandler(async (req, res) => {
  const q = z.string().trim().min(2).max(100).parse(req.query.q);
  const rx = new RegExp(q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
  const [customers, products, charging, receipts] = await Promise.all([
    Customer.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] }).limit(8),
    Product.find({ $or: [{ name: rx }, { sku: rx }] }).limit(8),
    ChargingSession.find({ $or: [{ publicSessionId: rx }, { customerName: rx }] }).limit(8),
    Receipt.find({ receiptNumber: rx }).limit(8),
  ]);
  res.json({ success: true, data: [
    ...customers.map((item) => ({ type: 'Customer', id: item.id, title: item.name, subtitle: item.phone })),
    ...products.map((item) => ({ type: 'Product', id: item.id, title: item.name, subtitle: item.sku })),
    ...charging.map((item) => ({ type: 'Charging Session', id: item.id, title: item.publicSessionId, subtitle: item.customerName })),
    ...receipts.map((item) => ({ type: 'Receipt', id: item.id, title: item.receiptNumber, subtitle: item.type })),
  ] });
}));

reporting.get('/analytics', admin, asyncHandler(async (req, res) => {
  const { start, end, timezone } = await reportingRange(req.query);
  const match = { createdAt: { $gte: start, $lt: end } };
  const [ledger, trend, chargingDaily, chargingPeak, chargingDurations, workspaceDaily, workspacePeak, topProducts, lowStock, inventoryValue, stockOuts, customerActivity] = await Promise.all([
    Transaction.aggregate([{ $match: match }, { $group: { _id: { direction: '$direction', type: '$type' }, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: match }, { $group: { _id: { day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone } }, direction: '$direction' }, total: { $sum: '$amount' } } }, { $sort: { '_id.day': 1 } }]),
    ChargingSession.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone } }, sessions: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ChargingSession.aggregate([{ $match: match }, { $group: { _id: { $hour: { date: '$timeIn', timezone } }, sessions: { $sum: 1 } } }, { $sort: { sessions: -1 } }, { $limit: 1 }]),
    ChargingSession.aggregate([{ $match: { ...match, collectedAt: { $ne: null } } }, { $group: { _id: null, averageDurationMs: { $avg: { $subtract: ['$collectedAt', '$timeIn'] } }, averageCollectionDelayMs: { $avg: { $cond: [{ $and: ['$readyAt', '$collectedAt'] }, { $subtract: ['$collectedAt', '$readyAt'] }, null] } } } }]),
    WorkspaceBooking.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone } }, visits: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    WorkspaceBooking.aggregate([{ $match: match }, { $group: { _id: { $hour: { date: '$createdAt', timezone } }, visits: { $sum: 1 } } }, { $sort: { visits: -1 } }, { $limit: 1 }]),
    Sale.aggregate([{ $match: match }, { $unwind: '$items' }, { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } }, { $sort: { quantity: -1 } }, { $limit: 10 }]),
    Product.find({ active: true, $expr: { $lte: ['$quantityOnHand', '$reorderThreshold'] } }).sort({ quantityOnHand: 1 }).limit(20),
    Product.aggregate([{ $match: { active: true } }, { $group: { _id: null, value: { $sum: { $multiply: ['$costPrice', '$quantityOnHand'] } } } }]),
    InventoryMovement.countDocuments({ createdAt: match.createdAt, newQuantity: 0 }),
    Promise.all([ChargingSession.distinct('customerId', match), WorkspaceBooking.distinct('customerId', match), Sale.distinct('customerId', { ...match, customerId: { $ne: null } })]),
  ]);
  const income = ledger.filter((item) => item._id.direction === 'income').reduce((sum, item) => sum + item.total, 0);
  const expenses = ledger.filter((item) => item._id.direction === 'expense').reduce((sum, item) => sum + item.total, 0);
  const moduleRevenue = { inventory: 0, charging: 0, workspace: 0, other: 0 };
  ledger.filter((item) => item._id.direction === 'income').forEach((item) => { moduleRevenue[transactionModule(item._id.type) as keyof typeof moduleRevenue] += item.total; });
  const trendByDay = new Map<string, { date: string; income: number; expenses: number; net: number }>();
  trend.forEach((item) => { const row = trendByDay.get(item._id.day) ?? { date: item._id.day, income: 0, expenses: 0, net: 0 }; row[item._id.direction === 'income' ? 'income' : 'expenses'] += item.total; row.net = row.income - row.expenses; trendByDay.set(item._id.day, row); });
  const uniqueCustomers = new Set(customerActivity.flat().filter(Boolean).map(String));
  res.json({ success: true, data: {
    range: { from: start, to: end, timezone },
    revenue: { income, expenses, net: income - expenses, stockSales: moduleRevenue.inventory, charging: moduleRevenue.charging, workspace: moduleRevenue.workspace },
    revenueTrend: [...trendByDay.values()], moduleRevenue,
    charging: { sessionsPerDay: chargingDaily.map((item) => ({ date: item._id, sessions: item.sessions })), peakCheckInHour: chargingPeak[0]?._id ?? null, averageDurationMinutes: Math.round((chargingDurations[0]?.averageDurationMs ?? 0) / 60_000), readyToCollectionMinutes: Math.round((chargingDurations[0]?.averageCollectionDelayMs ?? 0) / 60_000) },
    workspace: { visitsPerDay: workspaceDaily.map((item) => ({ date: item._id, visits: item.visits })), peakUsageHour: workspacePeak[0]?._id ?? null, revenue: moduleRevenue.workspace },
    inventory: { topProducts: topProducts.map((item) => ({ productId: item._id, name: item.name, quantity: item.quantity, revenue: item.revenue })), lowStock, stockOutFrequency: stockOuts, estimatedValue: inventoryValue[0]?.value ?? 0 },
    customers: { unique: uniqueCustomers.size, charging: customerActivity[0].length, workspace: customerActivity[1].length },
  } });
}));

const csvCell = (value: unknown) => {
  const safe = String(value ?? '').replace(/^([=+\-@])/, "'$1").replaceAll('"', '""');
  return `"${safe}"`;
};
reporting.get('/reports/export', admin, asyncHandler(async (req, res) => {
  const dataset = z.enum(['transactions', 'sales', 'charging', 'workspace']).parse(req.query.dataset);
  const { start, end } = await reportingRange(req.query);
  const match = { createdAt: { $gte: start, $lt: end } };
  let headings: string[] = []; let rows: unknown[][] = [];
  if (dataset === 'transactions') { const values = await Transaction.find(match).sort({ createdAt: -1 }); headings = ['Date', 'Description', 'Type', 'Direction', 'Payment Method', 'Amount']; rows = values.map((item) => [item.get('createdAt'), item.description, item.type, item.direction, item.paymentMethod, item.amount]); }
  if (dataset === 'sales') { const values = await Sale.find(match).sort({ createdAt: -1 }); headings = ['Date', 'Sale ID', 'Items', 'Payment Method', 'Total']; rows = values.map((item) => [item.get('createdAt'), item.id, item.items.map((line) => `${line.name} x${line.quantity}`).join('; '), item.paymentMethod, item.total]); }
  if (dataset === 'charging') { const values = await ChargingSession.find(match).sort({ createdAt: -1 }); headings = ['Date', 'Claim ID', 'Customer', 'Device', 'Slot', 'Status', 'Amount']; rows = values.map((item) => [item.timeIn, item.publicSessionId, item.customerName, `${item.device?.brand ?? ''} ${item.device?.model ?? item.device?.type ?? 'unknown'}`.trim(), item.slotNumber, item.status, item.amount]); }
  if (dataset === 'workspace') { const values = await WorkspaceBooking.find(match).sort({ createdAt: -1 }); headings = ['Date', 'Customer', 'Seat', 'Status', 'Time In', 'Time Out', 'Amount']; rows = values.map((item) => [item.get('createdAt'), item.customerName, item.seatNumber, item.status, item.timeIn, item.timeOut, item.amount]); }
  const csv = [headings, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.type('text/csv').attachment(`sanfaani-${dataset}-${start.toISOString().slice(0, 10)}.csv`).send(csv);
}));
