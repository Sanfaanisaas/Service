import { z } from 'zod';

export const userRoles = ['admin', 'staff', 'customer'] as const;
export type UserRole = (typeof userRoles)[number];
export const paymentMethods = ['cash', 'transfer', 'card', 'other'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const chargingStatuses = ['checked-in', 'charging', 'ready', 'collected', 'cancelled'] as const;
export type ChargingStatus = (typeof chargingStatuses)[number];
export const workspaceStatuses = ['registered', 'checked-in', 'checked-out', 'cancelled'] as const;
export type WorkspaceStatus = (typeof workspaceStatuses)[number];

const optionalText = z.string().trim().max(240).optional().or(z.literal(''));
export const customerInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  whatsappOptIn: z.boolean().default(false),
  notificationPreferences: z.object({ push: z.boolean(), inApp: z.boolean() }).default({ push: false, inApp: true }),
});
export const productInput = z.object({
  sku: z.string().trim().min(2).max(40).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(120), description: optionalText,
  category: z.string().trim().min(2).max(80),
  costPrice: z.coerce.number().min(0), sellingPrice: z.coerce.number().min(0),
  quantityOnHand: z.coerce.number().int().min(0), reorderThreshold: z.coerce.number().int().min(0),
  active: z.boolean().default(true),
});
export const stockAdjustmentInput = z.object({
  quantity: z.coerce.number().int().refine((value) => value !== 0, 'Quantity cannot be zero'),
  reason: z.string().trim().min(3).max(240),
});
export const chargingCheckInInput = z.object({
  customerName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(24),
  deviceType: z.enum(['phone', 'laptop', 'tablet', 'powerbank', 'other']),
  brand: optionalText, model: optionalText, color: optionalText, description: optionalText,
  expectedMinutes: z.coerce.number().int().min(5).max(1440),
  amount: z.coerce.number().min(0), paymentMethod: z.enum(paymentMethods),
});
export const workspaceInput = z.object({
  customerName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(24),
  email: z.string().email().optional().or(z.literal('')),
  deviceInfo: z.object({ type: optionalText, brand: optionalText, model: optionalText }).optional(),
  amount: z.coerce.number().min(0).default(0), paymentMethod: z.enum(paymentMethods).default('cash'),
  whatsappOptIn: z.boolean().default(false),
});
export const saleInput = z.object({
  customerId: z.string().optional(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().min(1) })).min(1),
  paymentMethod: z.enum(paymentMethods),
});
export const settingsInput = z.object({
  businessName: z.string().trim().min(2).max(120), businessAddress: optionalText, phone: optionalText,
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  chargingCapacity: z.coerce.number().int().min(1).max(200),
  workspaceCapacity: z.coerce.number().int().min(1).max(500),
  defaultChargingPrice: z.coerce.number().min(0), defaultWorkspacePrice: z.coerce.number().min(0),
  whatsappGroupInviteUrl: z.string().url().optional().or(z.literal('')),
  businessTimezone: z.string().min(3).max(80), receiptFooter: optionalText,
});

export interface Customer {
  id: string; name: string; phone?: string; email?: string; whatsappOptIn: boolean;
  notificationPreferences: { push: boolean; inApp: boolean }; createdAt: string; updatedAt: string;
}
export interface Product {
  id: string; sku: string; name: string; description?: string; category: string; costPrice: number;
  sellingPrice: number; quantityOnHand: number; reorderThreshold: number; active: boolean; createdAt: string; updatedAt: string;
}
export interface ChargingSession {
  id: string; customerId: string; customerName?: string; publicSessionId: string;
  device: { type: 'phone'|'laptop'|'tablet'|'powerbank'|'other'; brand?: string; model?: string; color?: string; description?: string };
  slotNumber: number; timeIn: string; estimatedReadyAt?: string; readyAt?: string; collectedAt?: string;
  status: ChargingStatus; amount: number; paymentStatus: 'pending'|'paid'; paymentMethod: PaymentMethod;
}
export interface WorkspaceBooking {
  id: string; customerId: string; customerName?: string; phone?: string;
  deviceInfo?: { type?: string; brand?: string; model?: string }; seatNumber?: number;
  timeIn?: string; timeOut?: string; amount: number; status: WorkspaceStatus; createdAt: string;
}
export interface Transaction {
  id: string; type: 'stock_sale'|'charging_fee'|'workspace_fee'|'inventory_purchase'|'expense'|'adjustment';
  amount: number; direction: 'income'|'expense'; paymentMethod: PaymentMethod; customerId?: string;
  referenceType?: string; referenceId?: string; description: string; createdBy: string; createdAt: string;
}
export interface Receipt {
  id: string; receiptNumber: string; type: 'sale'|'charging'|'workspace'; customerId?: string;
  customerName?: string; referenceId: string; claimId?: string; subtotal: number; total: number;
  paymentMethod: PaymentMethod; details?: Record<string, unknown>; generatedAt: string;
}
export interface DashboardSummary {
  today: { revenue: number; chargingRevenue: number; stockRevenue: number; workspaceRevenue: number; expenses: number; net: number };
  charging: { active: number; capacity: number; available: number };
  workspace: { occupied: number; capacity: number; available: number };
  lowStockCount: number; todayCustomers: number; readySessions: ChargingSession[];
  lowStockProducts: Product[]; recentTransactions: Transaction[];
}
