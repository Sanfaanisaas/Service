import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const customersTable = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    notificationPreferences: jsonb("notification_preferences")
      .$type<{ push: boolean; inApp: boolean }>()
      .notNull()
      .default({ push: false, inApp: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("customers_phone_idx").on(table.phone)],
);

export const productsTable = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
    sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }).notNull(),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    reorderThreshold: integer("reorder_threshold").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("products_sku_idx").on(table.sku)],
);

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  quantity: integer("quantity").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  ...timestamps,
});

export const chargingSessionsTable = pgTable(
  "charging_sessions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    publicSessionId: text("public_session_id").notNull(),
    secureClaimToken: text("secure_claim_token").notNull(),
    device: jsonb("device")
      .$type<{
        type: "phone" | "laptop" | "tablet" | "powerbank" | "other";
        brand?: string;
        model?: string;
        color?: string;
        description?: string;
      }>()
      .notNull(),
    slotNumber: integer("slot_number").notNull(),
    timeIn: timestamp("time_in", { withTimezone: true }).notNull(),
    estimatedReadyAt: timestamp("estimated_ready_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    status: text("status").notNull().default("checked-in"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    paymentMethod: text("payment_method").notNull().default("cash"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("charging_public_session_idx").on(table.publicSessionId),
    uniqueIndex("charging_secure_claim_idx").on(table.secureClaimToken),
  ],
);

export const workspaceBookingsTable = pgTable("workspace_bookings", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  deviceInfo: jsonb("device_info").$type<{ type?: string; brand?: string; model?: string }>(),
  timeIn: timestamp("time_in", { withTimezone: true }),
  timeOut: timestamp("time_out", { withTimezone: true }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("registered"),
  ...timestamps,
});

export const salesTable = pgTable("sales", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  items: jsonb("items")
    .$type<Array<{ productId: string; name: string; quantity: number; unitPrice: number; subtotal: number }>>()
    .notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  ...timestamps,
});

export const transactionsTable = pgTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  direction: text("direction").notNull(),
  paymentMethod: text("payment_method").notNull(),
  customerId: text("customer_id"),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  description: text("description").notNull(),
  createdBy: text("created_by").notNull(),
  ...timestamps,
});

export const receiptsTable = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    receiptNumber: text("receipt_number").notNull(),
    type: text("type").notNull(),
    customerId: text("customer_id"),
    customerName: text("customer_name"),
    referenceId: text("reference_id").notNull(),
    claimId: text("claim_id"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    paymentMethod: text("payment_method").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("receipts_number_idx").on(table.receiptNumber)],
);

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const settingsTable = pgTable("settings", {
  id: text("id").primaryKey(),
  businessName: text("business_name").notNull().default("SANFAANI"),
  currency: text("currency").notNull().default("NGN"),
  chargingCapacity: integer("charging_capacity").notNull().default(40),
  workspaceCapacity: integer("workspace_capacity").notNull().default(20),
  defaultChargingPrice: numeric("default_charging_price", { precision: 12, scale: 2 }).notNull().default("1000"),
  defaultWorkspacePrice: numeric("default_workspace_price", { precision: 12, scale: 2 }).notNull().default("1500"),
  whatsappGroupInviteUrl: text("whatsapp_group_invite_url"),
  timezone: text("timezone").notNull().default("Africa/Lagos"),
  ...timestamps,
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ createdAt: true, updatedAt: true });
export const insertProductSchema = createInsertSchema(productsTable).omit({ createdAt: true, updatedAt: true });
export type Customer = typeof customersTable.$inferSelect;
export type Product = typeof productsTable.$inferSelect;
export type ChargingSession = typeof chargingSessionsTable.$inferSelect;
export type WorkspaceBooking = typeof workspaceBookingsTable.$inferSelect;
export type Sale = typeof salesTable.$inferSelect;
export type Transaction = typeof transactionsTable.$inferSelect;
export type Receipt = typeof receiptsTable.$inferSelect;
export type AppSettings = typeof settingsTable.$inferSelect;
export type SanfaaniJson = z.infer<z.ZodTypeAny>;