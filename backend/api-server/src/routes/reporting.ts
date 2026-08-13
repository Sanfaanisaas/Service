import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { allow } from '../middleware/auth.js';
import { businessDayBounds } from '../lib/dates.js';
import { ChargingSession, Customer, Product, Receipt, Sale, Transaction, WorkspaceBooking } from '../models/index.js';
import { ACTIVE_CHARGING, ACTIVE_WORKSPACE, settings } from '../services/common.js';

export const reporting = Router();
const staff = allow('admin', 'staff');
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
