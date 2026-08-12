import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  auditLogsTable,
  chargingSessionsTable,
  customersTable,
  inventoryMovementsTable,
  productsTable,
  receiptsTable,
  salesTable,
  settingsTable,
  transactionsTable,
  workspaceBookingsTable,
} from "@workspace/db";
import {
  CheckInChargingSessionBody,
  CheckInChargingSessionResponse,
  CheckInWorkspaceBookingResponse,
  CheckInWorkspaceBookingParams,
  CollectChargingSessionBody,
  CollectChargingSessionParams,
  CollectChargingSessionResponse,
  CreateCustomerBody,
  CreateCustomerResponse,
  CreateProductBody,
  CreateProductResponse,
  CreateSaleBody,
  CreateSaleResponse,
  GetDashboardSummaryResponse,
  ListChargingSessionsResponse,
  ListCustomersQueryParams,
  ListCustomersResponse,
  ListHistoryQueryParams,
  ListHistoryResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  ListReceiptsResponse,
  ListSalesResponse,
  ListTransactionsQueryParams,
  ListTransactionsResponse,
  ListWorkspaceBookingsResponse,
  RegisterWorkspaceBookingBody,
  RegisterWorkspaceBookingResponse,
  UpdateChargingStatusBody,
  UpdateChargingStatusParams,
  UpdateChargingStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const ACTIVE_CHARGING = ["checked-in", "charging", "ready"] as const;
const ACTIVE_WORKSPACE = ["registered", "checked-in"] as const;
const DEFAULT_CAPACITY = 40;
const DEFAULT_WORKSPACE_CAPACITY = 20;

type PaymentMethod = "cash" | "transfer" | "card" | "other";

function amount(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function makeCode(prefix: string): string {
  const day = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `SF-${prefix}-${day}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function ensureSettings() {
  await db.insert(settingsTable).values({ id: "default" }).onConflictDoNothing();
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, "default"));
  return settings ?? {
    id: "default",
    businessName: "SANFAANI",
    currency: "NGN",
    chargingCapacity: DEFAULT_CAPACITY,
    workspaceCapacity: DEFAULT_WORKSPACE_CAPACITY,
    defaultChargingPrice: "1000",
    defaultWorkspacePrice: "1500",
    whatsappGroupInviteUrl: null,
    timezone: "Africa/Lagos",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function audit(actorId: string, action: string, entityType: string, entityId?: string) {
  await db.insert(auditLogsTable).values({
    id: randomUUID(),
    actorId,
    action,
    entityType,
    entityId,
  });
}

function customerView(row: typeof customersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    whatsappOptIn: row.whatsappOptIn,
    notificationPreferences: row.notificationPreferences,
    createdAt: row.createdAt,
  };
}

function productView(row: typeof productsTable.$inferSelect) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    costPrice: amount(row.costPrice),
    sellingPrice: amount(row.sellingPrice),
    quantityOnHand: row.quantityOnHand,
    reorderThreshold: row.reorderThreshold,
    active: row.active,
    updatedAt: row.updatedAt,
  };
}

function chargingView(row: typeof chargingSessionsTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    publicSessionId: row.publicSessionId,
    device: row.device,
    slotNumber: row.slotNumber,
    timeIn: row.timeIn,
    estimatedReadyAt: row.estimatedReadyAt,
    readyAt: row.readyAt,
    collectedAt: row.collectedAt,
    status: row.status,
    amount: amount(row.amount),
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
  };
}

function workspaceView(row: typeof workspaceBookingsTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    phone: row.phone,
    deviceInfo: row.deviceInfo,
    timeIn: row.timeIn,
    timeOut: row.timeOut,
    amount: amount(row.amount),
    status: row.status,
    createdAt: row.createdAt,
  };
}

function transactionView(row: typeof transactionsTable.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    amount: amount(row.amount),
    direction: row.direction,
    paymentMethod: row.paymentMethod,
    description: row.description,
    createdAt: row.createdAt,
  };
}

function receiptView(row: typeof receiptsTable.$inferSelect) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    type: row.type,
    customerName: row.customerName,
    referenceId: row.referenceId,
    claimId: row.claimId,
    subtotal: amount(row.subtotal),
    total: amount(row.total),
    paymentMethod: row.paymentMethod,
    generatedAt: row.createdAt,
  };
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const settings = await ensureSettings();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [transactions, sessions, workspace, products, customers] = await Promise.all([
    db.select().from(transactionsTable).where(sql`${transactionsTable.createdAt} >= ${start}`).orderBy(desc(transactionsTable.createdAt)),
    db.select().from(chargingSessionsTable).where(inArray(chargingSessionsTable.status, [...ACTIVE_CHARGING])),
    db.select().from(workspaceBookingsTable).where(inArray(workspaceBookingsTable.status, [...ACTIVE_WORKSPACE])),
    db.select().from(productsTable).where(eq(productsTable.active, true)).orderBy(productsTable.name),
    db.select().from(customersTable).where(sql`${customersTable.createdAt} >= ${start}`),
  ]);
  const ready = sessions.filter((session) => session.status === "ready");
  const lowStock = products.filter((product) => product.quantityOnHand <= product.reorderThreshold);
  const result = {
    todayRevenue: transactions.filter((item) => item.direction === "income").reduce((sum, item) => sum + amount(item.amount), 0),
    charging: { active: sessions.length, capacity: settings.chargingCapacity, available: Math.max(settings.chargingCapacity - sessions.length, 0) },
    workspace: { occupied: workspace.length, capacity: settings.workspaceCapacity, available: Math.max(settings.workspaceCapacity - workspace.length, 0) },
    lowStockCount: lowStock.length,
    todayCustomers: customers.length,
    recentTransactions: transactions.slice(0, 6).map(transactionView),
    readySessions: ready.map(chargingView),
    lowStockProducts: lowStock.slice(0, 6).map(productView),
  };
  res.json(GetDashboardSummaryResponse.parse(result));
  req.log.info({ userId: req.userId }, "Dashboard summary loaded");
});

router.get("/customers", async (req, res): Promise<void> => {
  const parsed = ListCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.trim();
  const rows = await db.select().from(customersTable)
    .where(search ? or(ilike(customersTable.name, `%${search}%`), ilike(customersTable.phone, `%${search}%`)) : undefined)
    .orderBy(desc(customersTable.createdAt));
  res.json(ListCustomersResponse.parse(rows.map(customerView)));
});

router.post("/customers", async (req, res): Promise<void> => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const existing = input.phone
    ? (await db.select().from(customersTable).where(eq(customersTable.phone, input.phone)).limit(1))[0]
    : undefined;
  if (existing) {
    res.status(200).json(CreateCustomerResponse.parse(customerView(existing)));
    return;
  }
  const [row] = await db.insert(customersTable).values({
    id: randomUUID(),
    name: input.name,
    phone: input.phone,
    email: input.email,
    whatsappOptIn: input.whatsappOptIn ?? false,
    notificationPreferences: input.notificationPreferences ?? { push: false, inApp: true },
  }).returning();
  await audit(req.userId ?? "system", "CUSTOMER_CREATED", "customer", row.id);
  res.status(201).json(CreateCustomerResponse.parse(customerView(row)));
});

router.get("/charging", async (_req, res): Promise<void> => {
  const rows = await db.select().from(chargingSessionsTable).where(inArray(chargingSessionsTable.status, [...ACTIVE_CHARGING])).orderBy(chargingSessionsTable.slotNumber);
  res.json(ListChargingSessionsResponse.parse(rows.map(chargingView)));
});

router.post("/charging/check-in", async (req, res): Promise<void> => {
  const parsed = CheckInChargingSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(743210)`);
    const settings = await ensureSettings();
    const active = await tx.select().from(chargingSessionsTable).where(inArray(chargingSessionsTable.status, [...ACTIVE_CHARGING]));
    if (active.length >= settings.chargingCapacity) {
      return null;
    }
    const used = new Set(active.map((session) => session.slotNumber));
    const slotNumber = Array.from({ length: settings.chargingCapacity }, (_, index) => index + 1).find((slot) => !used.has(slot));
    if (!slotNumber) return null;
    const existing = (await tx.select().from(customersTable).where(eq(customersTable.phone, input.phone)).limit(1))[0];
    const customer = existing ?? (await tx.insert(customersTable).values({
      id: randomUUID(),
      name: input.customerName,
      phone: input.phone,
      notificationPreferences: { push: false, inApp: true },
      whatsappOptIn: false,
    }).returning())[0];
    const id = randomUUID();
    const publicSessionId = makeCode("CHG");
    const [session] = await tx.insert(chargingSessionsTable).values({
      id,
      customerId: customer.id,
      customerName: customer.name,
      publicSessionId,
      secureClaimToken: randomBytes(24).toString("hex"),
      device: { type: input.deviceType, brand: input.brand, model: input.model, color: input.color, description: input.description },
      slotNumber,
      timeIn: now,
      estimatedReadyAt: new Date(now.getTime() + input.expectedMinutes * 60_000),
      status: "charging",
      amount: String(input.amount),
      paymentStatus: input.amount > 0 ? "paid" : "pending",
      paymentMethod: input.paymentMethod,
    }).returning();
    if (input.amount > 0) {
      await tx.insert(transactionsTable).values({
        id: randomUUID(),
        type: "charging_fee",
        amount: String(input.amount),
        direction: "income",
        paymentMethod: input.paymentMethod,
        customerId: customer.id,
        referenceType: "charging_session",
        referenceId: id,
        description: `Charging fee for ${customer.name}`,
        createdBy: req.userId ?? "system",
      });
    }
    const [receipt] = await tx.insert(receiptsTable).values({
      id: randomUUID(),
      receiptNumber: makeCode("RCP"),
      type: "charging",
      customerId: customer.id,
      customerName: customer.name,
      referenceId: id,
      claimId: publicSessionId,
      subtotal: String(input.amount),
      total: String(input.amount),
      paymentMethod: input.paymentMethod,
    }).returning();
    return { session, receipt };
  });
  if (!result) {
    res.status(409).json({ success: false, error: { code: "CHARGING_CAPACITY_REACHED", message: "All charging slots are currently occupied." } });
    return;
  }
  await audit(req.userId ?? "system", "CHARGING_CHECKED_IN", "charging_session", result.session.id);
  res.status(201).json(CheckInChargingSessionResponse.parse({ session: chargingView(result.session), receipt: receiptView(result.receipt) }));
});

router.patch("/charging/:id/status", async (req, res): Promise<void> => {
  const params = UpdateChargingStatusParams.safeParse(req.params);
  const body = UpdateChargingStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid charging status request." });
    return;
  }
  const [row] = await db.update(chargingSessionsTable).set({
    status: body.data.status,
    readyAt: body.data.status === "ready" ? new Date() : undefined,
    updatedAt: new Date(),
  }).where(eq(chargingSessionsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Charging session not found." });
    return;
  }
  await audit(req.userId ?? "system", body.data.status === "ready" ? "CHARGING_MARKED_READY" : "CHARGING_STATUS_UPDATED", "charging_session", row.id);
  res.json(UpdateChargingStatusResponse.parse(chargingView(row)));
});

router.post("/charging/:id/collect", async (req, res): Promise<void> => {
  const params = CollectChargingSessionParams.safeParse(req.params);
  const body = CollectChargingSessionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid collection request." });
    return;
  }
  const [row] = await db.update(chargingSessionsTable).set({
    status: "collected",
    collectedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(chargingSessionsTable.id, params.data.id), eq(chargingSessionsTable.publicSessionId, body.data.claimId))).returning();
  if (!row) {
    res.status(404).json({ error: "Claim ID could not be verified." });
    return;
  }
  await audit(req.userId ?? "system", "CHARGING_COLLECTED", "charging_session", row.id);
  res.json(CollectChargingSessionResponse.parse(chargingView(row)));
});

router.get("/workspace", async (_req, res): Promise<void> => {
  const rows = await db.select().from(workspaceBookingsTable).where(inArray(workspaceBookingsTable.status, [...ACTIVE_WORKSPACE])).orderBy(desc(workspaceBookingsTable.createdAt));
  res.json(ListWorkspaceBookingsResponse.parse(rows.map(workspaceView)));
});

router.post("/workspace/register", async (req, res): Promise<void> => {
  const parsed = RegisterWorkspaceBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(743211)`);
    const settings = await ensureSettings();
    const active = await tx.select().from(workspaceBookingsTable).where(inArray(workspaceBookingsTable.status, [...ACTIVE_WORKSPACE]));
    if (active.length >= settings.workspaceCapacity) return null;
    const existing = (await tx.select().from(customersTable).where(eq(customersTable.phone, input.phone)).limit(1))[0];
    const customer = existing ?? (await tx.insert(customersTable).values({
      id: randomUUID(),
      name: input.customerName,
      phone: input.phone,
      email: input.email,
      whatsappOptIn: input.whatsappOptIn ?? false,
      notificationPreferences: { push: false, inApp: true },
    }).returning())[0];
    const [booking] = await tx.insert(workspaceBookingsTable).values({
      id: randomUUID(),
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      deviceInfo: input.deviceInfo,
      amount: String(input.amount ?? 0),
      status: "registered",
    }).returning();
    if ((input.amount ?? 0) > 0) {
      await tx.insert(transactionsTable).values({
        id: randomUUID(),
        type: "workspace_fee",
        amount: String(input.amount),
        direction: "income",
        paymentMethod: "cash",
        customerId: customer.id,
        referenceType: "workspace_booking",
        referenceId: booking.id,
        description: `Workspace fee for ${customer.name}`,
        createdBy: req.userId ?? "system",
      });
    }
    return booking;
  });
  if (!result) {
    res.status(409).json({ success: false, error: { code: "WORKSPACE_CAPACITY_REACHED", message: "Workspace capacity has been reached." } });
    return;
  }
  await audit(req.userId ?? "system", "WORKSPACE_REGISTERED", "workspace_booking", result.id);
  res.status(201).json(RegisterWorkspaceBookingResponse.parse(workspaceView(result)));
});

router.post("/workspace/:id/check-in", async (req, res): Promise<void> => {
  const params = CheckInWorkspaceBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(workspaceBookingsTable).set({ status: "checked-in", timeIn: new Date(), updatedAt: new Date() }).where(eq(workspaceBookingsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Workspace booking not found." });
    return;
  }
  await audit(req.userId ?? "system", "WORKSPACE_CHECKED_IN", "workspace_booking", row.id);
  res.json(CheckInWorkspaceBookingResponse.parse(workspaceView(row)));
});

router.post("/workspace/:id/check-out", async (req, res): Promise<void> => {
  const params = (await import("@workspace/api-zod")).CheckOutWorkspaceBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.update(workspaceBookingsTable).set({ status: "checked-out", timeOut: new Date(), updatedAt: new Date() }).where(eq(workspaceBookingsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Workspace booking not found." });
    return;
  }
  await audit(req.userId ?? "system", "WORKSPACE_CHECKED_OUT", "workspace_booking", row.id);
  res.json((await import("@workspace/api-zod")).CheckOutWorkspaceBookingResponse.parse(workspaceView(row)));
});

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, category } = parsed.data;
  const rows = await db.select().from(productsTable).where(and(eq(productsTable.active, true), search ? or(ilike(productsTable.name, `%${search}%`), ilike(productsTable.sku, `%${search}%`)) : undefined, category ? eq(productsTable.category, category) : undefined)).orderBy(productsTable.name);
  res.json(ListProductsResponse.parse(rows.map(productView)));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const [row] = await db.insert(productsTable).values({
    id: randomUUID(),
    sku: input.sku,
    name: input.name,
    description: input.description,
    category: input.category,
    costPrice: String(input.costPrice),
    sellingPrice: String(input.sellingPrice),
    quantityOnHand: input.quantityOnHand,
    reorderThreshold: input.reorderThreshold,
  }).returning();
  await audit(req.userId ?? "system", "PRODUCT_CREATED", "product", row.id);
  res.status(201).json(CreateProductResponse.parse(productView(row)));
});

router.get("/sales", async (_req, res): Promise<void> => {
  const rows = await db.select().from(salesTable).orderBy(desc(salesTable.createdAt)).limit(50);
  res.json((await import("@workspace/api-zod")).ListSalesResponse.parse(rows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    itemCount: row.items.length,
    total: amount(row.total),
    paymentMethod: row.paymentMethod,
    createdAt: row.createdAt,
  }))));
});

router.post("/sales", async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const result = await db.transaction(async (tx) => {
    const saleItems: Array<{ productId: string; name: string; quantity: number; unitPrice: number; subtotal: number }> = [];
    for (const item of input.items) {
      const [product] = await tx.select().from(productsTable).where(and(eq(productsTable.id, item.productId), eq(productsTable.active, true))).limit(1);
      if (!product || product.quantityOnHand < item.quantity) return null;
      const [updated] = await tx.update(productsTable).set({ quantityOnHand: sql`${productsTable.quantityOnHand} - ${item.quantity}`, updatedAt: new Date() }).where(and(eq(productsTable.id, item.productId), sql`${productsTable.quantityOnHand} >= ${item.quantity}`)).returning();
      if (!updated) return null;
      saleItems.push({ productId: product.id, name: product.name, quantity: item.quantity, unitPrice: amount(product.sellingPrice), subtotal: item.quantity * amount(product.sellingPrice) });
      await tx.insert(inventoryMovementsTable).values({ id: randomUUID(), productId: product.id, quantity: -item.quantity, reason: "sale", createdBy: req.userId ?? "system" });
    }
    const total = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
    const saleId = randomUUID();
    const [sale] = await tx.insert(salesTable).values({ id: saleId, customerId: input.customerId, items: saleItems, total: String(total), paymentMethod: input.paymentMethod }).returning();
    await tx.insert(transactionsTable).values({ id: randomUUID(), type: "stock_sale", amount: String(total), direction: "income", paymentMethod: input.paymentMethod, customerId: input.customerId, referenceType: "sale", referenceId: saleId, description: "Inventory sale", createdBy: req.userId ?? "system" });
    const [receipt] = await tx.insert(receiptsTable).values({ id: randomUUID(), receiptNumber: makeCode("RCP"), type: "sale", customerId: input.customerId, referenceId: saleId, subtotal: String(total), total: String(total), paymentMethod: input.paymentMethod }).returning();
    return { sale, receipt };
  });
  if (!result) {
    res.status(409).json({ success: false, error: { code: "INSUFFICIENT_INVENTORY", message: "One or more products do not have enough stock." } });
    return;
  }
  const saleView = { id: result.sale.id, customerId: result.sale.customerId, itemCount: result.sale.items.length, total: amount(result.sale.total), paymentMethod: result.sale.paymentMethod, createdAt: result.sale.createdAt };
  await audit(req.userId ?? "system", "TRANSACTION_CREATED", "sale", result.sale.id);
  res.status(201).json(CreateSaleResponse.parse({ sale: saleView, receipt: receiptView(result.receipt) }));
});

router.get("/transactions", async (req, res): Promise<void> => {
  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt)).limit(100);
  res.json(ListTransactionsResponse.parse(rows.map(transactionView)));
});

router.get("/receipts", async (_req, res): Promise<void> => {
  const rows = await db.select().from(receiptsTable).orderBy(desc(receiptsTable.createdAt)).limit(100);
  res.json(ListReceiptsResponse.parse(rows.map(receiptView)));
});

router.get("/history", async (req, res): Promise<void> => {
  const parsed = ListHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const date = parsed.data.date ? new Date(`${parsed.data.date}T00:00:00.000Z`) : new Date(new Date().toISOString().slice(0, 10));
  const next = new Date(date.getTime() + 86_400_000);
  const [transactions, charging, workspace, sales] = await Promise.all([
    db.select().from(transactionsTable).where(and(sql`${transactionsTable.createdAt} >= ${date}`, sql`${transactionsTable.createdAt} < ${next}`)).orderBy(desc(transactionsTable.createdAt)),
    db.select().from(chargingSessionsTable).where(and(sql`${chargingSessionsTable.createdAt} >= ${date}`, sql`${chargingSessionsTable.createdAt} < ${next}`)),
    db.select().from(workspaceBookingsTable).where(and(sql`${workspaceBookingsTable.createdAt} >= ${date}`, sql`${workspaceBookingsTable.createdAt} < ${next}`)),
    db.select().from(salesTable).where(and(sql`${salesTable.createdAt} >= ${date}`, sql`${salesTable.createdAt} < ${next}`)),
  ]);
  const response = {
    date: date.toISOString().slice(0, 10),
    summary: {
      chargingCount: charging.length,
      workspaceCount: workspace.length,
      salesCount: sales.length,
      revenue: transactions.filter((row) => row.direction === "income").reduce((sum, row) => sum + amount(row.amount), 0),
    },
    transactions: transactions.map(transactionView),
    charging: charging.map(chargingView),
    workspace: workspace.map(workspaceView),
    sales: sales.map((row) => ({ id: row.id, customerId: row.customerId, itemCount: row.items.length, total: amount(row.total), paymentMethod: row.paymentMethod, createdAt: row.createdAt })),
  };
  res.json(ListHistoryResponse.parse(response));
});

export default router;