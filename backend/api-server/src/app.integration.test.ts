import type { Express } from "express";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const supabaseAdmin = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  deleteUser: vi.fn(),
}));

type Identity = {
  id: string;
  email: string;
  user_metadata: { name: string; role?: string; app_role?: string };
};
const identities: Record<string, Identity> = {
  admin: {
    id: "supabase-admin",
    email: "admin@sanfaani.test",
    user_metadata: { name: "Admin" },
  },
  staff: {
    id: "supabase-staff",
    email: "staff@sanfaani.test",
    user_metadata: { name: "Staff" },
  },
  customerA: {
    id: "supabase-customer-a",
    email: "customer-a@sanfaani.test",
    user_metadata: { name: "Customer A" },
  },
  customerB: {
    id: "supabase-customer-b",
    email: "customer-b@sanfaani.test",
    user_metadata: { name: "Customer B" },
  },
};

// The API accepts a Supabase access token. The mock isolates SANFAANI's
// middleware/RBAC behaviour while Supabase token validation is covered by
// Supabase itself in production.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        identities[token]
          ? { data: { user: identities[token] }, error: null }
          : { data: { user: null }, error: new Error("invalid token") },
      admin: supabaseAdmin,
    },
  }),
}));

let replicaSet: MongoMemoryReplSet;
let app: Express;
let models: typeof import("./models/index.js");
let serverEnv: typeof import("./config/env.js").env;
let connectDatabase: typeof import("./lib/database.js").connectDatabase;
let disconnectDatabase: typeof import("./lib/database.js").disconnectDatabase;
let whatsappService: typeof import("./services/whatsapp.js");
let receiptDocumentService: typeof import("./services/receipt-document.js");

const auth = (token: keyof typeof identities) => ({
  Authorization: `Bearer ${token}`,
});
const api = () => request(app);

async function provision(
  role: "admin" | "staff" | "customer",
  token: keyof typeof identities,
) {
  await api().get("/api/me").set(auth(token)).expect(200);
  const user = await models.AppUser.findOneAndUpdate(
    { supabaseUserId: identities[token].id },
    { $set: { role, active: true } },
    { new: true },
  );
  if (!user) throw new Error("Test user was not provisioned");
  return user;
}

async function provisionCustomer(
  token: "customerA" | "customerB",
  phone: string,
) {
  const user = await provision("customer", token);
  const customer = await models.Customer.findOneAndUpdate(
    { email: identities[token].email },
    {
      $set: {
        name: identities[token].user_metadata.name,
        email: identities[token].email,
        phone,
      },
    },
    { new: true, runValidators: true },
  );
  if (!customer) throw new Error("Customer profile was not provisioned");
  user.set("customerId", customer.id);
  await user.save();
  return customer;
}

async function updateSettings(overrides: Record<string, number> = {}) {
  const setting = await models.Setting.findOneAndUpdate(
    { key: "business" },
    {
      $set: { chargingCapacity: 40, workspaceCapacity: 20, ...overrides },
      $setOnInsert: { key: "business" },
    },
    { new: true, upsert: true },
  );
  return setting;
}

function checkIn(
  phone: string,
  suffix = phone,
  overrides: Partial<{
    customerName: string;
    whatsappOptIn: boolean;
    amount: number;
    paymentMethod: "cash" | "transfer" | "card" | "other";
  }> = {},
) {
  return api()
    .post("/api/charging/check-in")
    .set(auth("staff"))
    .send({
      customerName: `Customer ${suffix}`,
      phone,
      deviceType: "phone",
      expectedMinutes: 30,
      amount: 500,
      paymentMethod: "cash",
      ...overrides,
    });
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: replicaSet.getUri(),
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-that-is-long-enough",
    SANFAANI_ADMIN_EMAIL: identities.admin.email,
    CLIENT_URL: "http://localhost:3000",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    WHATSAPP_ENABLED: "false",
    WHATSAPP_GRAPH_API_VERSION: "v20.0",
    WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_RECEIPT_TEMPLATE_NAME: "sanfaani_receipt",
    WHATSAPP_RECEIPT_TEMPLATE_LANGUAGE: "en",
  });
  ({ connectDatabase, disconnectDatabase } = await import("./lib/database.js"));
  ({ env: serverEnv } = await import("./config/env.js"));
  models = await import("./models/index.js");
  whatsappService = await import("./services/whatsapp.js");
  receiptDocumentService = await import("./services/receipt-document.js");
  ({ app } = await import("./app.js"));
  await connectDatabase();
  await Promise.all(Object.values(models).map((model) => model.init()));
});

beforeEach(async () => {
  await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
  serverEnv.WHATSAPP_ENABLED = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  supabaseAdmin.inviteUserByEmail.mockReset();
  supabaseAdmin.deleteUser.mockReset();
  supabaseAdmin.inviteUserByEmail.mockResolvedValue({
    data: {
      user: {
        id: "supabase-invited-staff",
        email: "invited@sanfaani.test",
      },
    },
    error: null,
  });
  supabaseAdmin.deleteUser.mockResolvedValue({ data: {}, error: null });
});

afterEach(async () => {
  await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
});
afterAll(async () => {
  await disconnectDatabase();
  await replicaSet.stop();
});

describe("SANFAANI auth and RBAC", () => {
  it("exposes a minimal health response and allows only the configured browser origin", async () => {
    const health = await api().get("/api/health").expect(200);
    expect(health.body).toEqual({ success: true, data: { status: "ok" } });
    const allowed = await api()
      .get("/api/me")
      .set(auth("admin"))
      .set("Origin", "http://localhost:3000")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    const denied = await api()
      .get("/api/me")
      .set(auth("admin"))
      .set("Origin", "https://untrusted.example")
      .expect(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns 401 for missing and invalid tokens, accepts a valid Supabase user, and rejects an inactive AppUser", async () => {
    await api().get("/api/me").expect(401);
    await api()
      .get("/api/me")
      .set({ Authorization: "Bearer invalid" })
      .expect(401);
    await api().get("/api/me").set(auth("admin")).expect(200);
    await models.AppUser.updateOne(
      { supabaseUserId: identities.admin.id },
      { active: false },
    );
    await api().get("/api/me").set(auth("admin")).expect(403);
  });

  it("ignores public role injection through metadata, headers, query, and request body", async () => {
    identities.customerA.user_metadata.role = "admin";
    identities.customerA.user_metadata.app_role = "staff";
    const response = await api()
      .get("/api/me?role=admin")
      .set(auth("customerA"))
      .set("x-sanfaani-role", "admin")
      .send({ role: "admin" })
      .expect(200);
    expect(response.body.data.role).toBe("customer");
    const persisted = await models.AppUser.findOne({
      supabaseUserId: identities.customerA.id,
    });
    expect(persisted?.get("role")).toBe("customer");
    await api()
      .patch("/api/settings")
      .set(auth("customerA"))
      .send({ role: "admin" })
      .expect(403);
    delete identities.customerA.user_metadata.role;
    delete identities.customerA.user_metadata.app_role;
  });

  it("enforces operational and administrator privileges", async () => {
    await provision("staff", "staff");
    await provisionCustomer("customerA", "08000000001");
    for (const path of [
      "/api/charging",
      "/api/workspace",
      "/api/customers",
      "/api/products",
      "/api/sales",
      "/api/transactions",
      "/api/receipts",
      "/api/history",
      "/api/dashboard/summary",
      "/api/settings",
      "/api/staff",
    ]) {
      await api().get(path).set(auth("customerA")).expect(403);
    }
    await api()
      .patch("/api/settings")
      .set(auth("customerA"))
      .send({})
      .expect(403);
    await api().patch("/api/settings").set(auth("staff")).send({}).expect(403);
    const staff = await models.AppUser.findOne({
      supabaseUserId: identities.staff.id,
    });
    await api()
      .patch(`/api/staff/${staff!.id}/role`)
      .set(auth("staff"))
      .send({ role: "admin" })
      .expect(403);
    await checkIn("08000000002").expect(201);
    await provision("admin", "admin");
    await api()
      .patch("/api/settings")
      .set(auth("admin"))
      .send({
        businessName: "SANFAANI",
        currency: "NGN",
        chargingCapacity: 40,
        workspaceCapacity: 20,
        defaultChargingPrice: 1000,
        defaultWorkspacePrice: 1500,
        businessTimezone: "Africa/Lagos",
      })
      .expect(200);
  });

  it("allows only administrators to invite an audited active staff user", async () => {
    await provision("admin", "admin");
    await provision("staff", "staff");
    await provisionCustomer("customerA", "08000000001");

    const invitation = {
      email: "Invited@SANFAANI.test",
      name: "Invited Operator",
      role: "staff",
    };
    await api()
      .post("/api/staff/invite")
      .set(auth("staff"))
      .send(invitation)
      .expect(403);
    await api()
      .post("/api/staff/invite")
      .set(auth("customerA"))
      .send(invitation)
      .expect(403);
    await api()
      .post("/api/staff/invite")
      .set(auth("admin"))
      .send({ ...invitation, role: "admin" })
      .expect(400);

    supabaseAdmin.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: "supabase-failed-invite", email: "failed@sanfaani.test" } },
      error: null,
    });
    const failedAudit = vi.spyOn(models.AuditLog, "create")
      .mockRejectedValueOnce(new Error("controlled invite audit failure"));
    await api()
      .post("/api/staff/invite")
      .set(auth("admin"))
      .send({ ...invitation, email: "failed@sanfaani.test" })
      .expect(500);
    failedAudit.mockRestore();
    expect(supabaseAdmin.deleteUser).toHaveBeenCalledWith("supabase-failed-invite");
    expect(await models.AppUser.exists({ supabaseUserId: "supabase-failed-invite" })).toBeNull();

    const response = await api()
      .post("/api/staff/invite")
      .set(auth("admin"))
      .send(invitation)
      .expect(201);
    expect(response.body.data).toMatchObject({
      id: "supabase-invited-staff",
      email: "invited@sanfaani.test",
      name: "Invited Operator",
      role: "staff",
      active: true,
      customerId: null,
    });
    expect(supabaseAdmin.inviteUserByEmail).toHaveBeenCalledWith(
      "invited@sanfaani.test",
      {
        redirectTo: "http://localhost:3000/reset-password",
        data: { name: "Invited Operator" },
      },
    );
    expect(
      await models.AuditLog.findOne({ action: "STAFF_INVITED" }),
    ).toMatchObject({
      actorId: identities.admin.id,
      entityType: "user",
    });
  });

  it("preserves one active administrator while allowing audited account access changes", async () => {
    const admin = await provision("admin", "admin");
    await api()
      .patch(`/api/staff/${admin.id}/active`)
      .set(auth("admin"))
      .send({ active: false })
      .expect(409);
    await api()
      .patch(`/api/staff/${admin.id}/role`)
      .set(auth("admin"))
      .send({ role: "staff" })
      .expect(409);
    const secondAdmin = await provision("admin", "staff");
    await api()
      .patch(`/api/staff/${secondAdmin.id}/active`)
      .set(auth("admin"))
      .send({ active: false })
      .expect(200);
    const audit = await models.AuditLog.findOne({
      action: "USER_ACTIVE_UPDATED",
      entityId: secondAdmin.id,
    });
    expect(audit?.get("metadata")).toMatchObject({
      targetUser: secondAdmin.id,
      previousActive: true,
      active: false,
    });
  });
});

describe("customer ownership", () => {
  it("keeps dormant customer self-service APIs available after production UI removal", async () => {
    await provisionCustomer("customerA", "08000000010");
    for (const path of [
      "/api/customer/me",
      "/api/customer/me/charging?view=latest",
      "/api/customer/me/workspace",
      "/api/customer/me/receipts",
      "/api/customer/me/notifications",
    ]) {
      await api().get(path).set(auth("customerA")).expect(200);
    }
  });

  it("returns only customer A charging, workspace, receipts, and notifications", async () => {
    await provision("staff", "staff");
    const customerA = await provisionCustomer("customerA", "08000000011");
    const customerB = await provisionCustomer("customerB", "08000000012");
    const chargingA = await checkIn("08000000011", "A").expect(201);
    const chargingB = await checkIn("08000000012", "B").expect(201);
    const workspaceA = await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Customer A",
        phone: "08000000011",
        amount: 250,
        paymentMethod: "cash",
      })
      .expect(201);
    const workspaceB = await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Customer B",
        phone: "08000000012",
        amount: 250,
        paymentMethod: "cash",
      })
      .expect(201);
    await models.Notification.create([
      {
        customerId: customerA.id,
        title: "A notice",
        message: "Only A can read this",
        type: "system",
      },
      {
        customerId: customerB.id,
        title: "B notice",
        message: "Only B can read this",
        type: "system",
      },
    ]);
    const charging = await api()
      .get("/api/customer/me/charging")
      .set(auth("customerA"))
      .expect(200);
    expect(charging.body.data.recentSessions).toHaveLength(1);
    expect(charging.body.data.recentSessions[0].customerId).toBe(customerA.id);
    await api()
      .get(`/api/charging/${chargingA.body.data.session.id}`)
      .set(auth("customerB"))
      .expect(403);
    const workspace = await api()
      .get("/api/customer/me/workspace")
      .set(auth("customerA"))
      .expect(200);
    expect(workspace.body.data).toHaveLength(1);
    expect(workspace.body.data[0].customerId).toBe(customerA.id);
    const receipts = await api()
      .get("/api/customer/me/receipts")
      .set(auth("customerA"))
      .expect(200);
    expect(receipts.body.data).toHaveLength(2);
    expect(
      receipts.body.data.every(
        (receipt: { customerId: string }) =>
          receipt.customerId === customerA.id,
      ),
    ).toBe(true);
    const ownedReceipt = await api()
      .get(`/api/customer/me/receipts/${receipts.body.data[0].id}`)
      .set(auth("customerA"))
      .expect(200);
    expect(ownedReceipt.body.data.id).toBe(receipts.body.data[0].id);
    await api()
      .get(`/api/customer/me/receipts/${receipts.body.data[0].id}`)
      .set(auth("customerB"))
      .expect(404);
    const notifications = await api()
      .get("/api/customer/me/notifications")
      .set(auth("customerA"))
      .expect(200);
    expect(notifications.body.data).toHaveLength(1);
    expect(notifications.body.data[0].customerId).toBe(customerA.id);
    const chargingForB = await api()
      .get(`/api/customer/me/charging?view=history&customerId=${customerA.id}`)
      .set(auth("customerB"))
      .expect(200);
    expect(chargingForB.body.data.recentSessions).toHaveLength(1);
    expect(chargingForB.body.data.recentSessions[0].id).toBe(
      chargingB.body.data.session.id,
    );
    const workspaceForB = await api()
      .get(`/api/customer/me/workspace?customerId=${customerA.id}`)
      .set(auth("customerB"))
      .expect(200);
    expect(workspaceForB.body.data).toHaveLength(1);
    expect(workspaceForB.body.data[0].id).toBe(
      workspaceB.body.data.booking.id,
    );
    const receiptsForB = await api()
      .get(`/api/customer/me/receipts?customerId=${customerA.id}`)
      .set(auth("customerB"))
      .expect(200);
    expect(receiptsForB.body.data).toHaveLength(2);
    expect(
      receiptsForB.body.data.every(
        (receipt: { customerId: string }) => receipt.customerId === customerB.id,
      ),
    ).toBe(true);
    const notificationsForB = await api()
      .get(`/api/customer/me/notifications?customerId=${customerA.id}`)
      .set(auth("customerB"))
      .expect(200);
    expect(notificationsForB.body.data).toHaveLength(1);
    expect(notificationsForB.body.data[0].customerId).toBe(customerB.id);
    await api()
      .get(`/api/customer/me/receipts/${chargingA.body.data.receipt.id}`)
      .set(auth("customerB"))
      .expect(404);
    await api()
      .patch(`/api/customer/me/notifications/${notifications.body.data[0].id}/read`)
      .set(auth("customerB"))
      .expect(404);
    const profileForB = await api()
      .patch("/api/customer/me")
      .set(auth("customerB"))
      .send({
        customerId: customerA.id,
        name: "Customer B",
        phone: "08000000012",
        whatsappOptIn: false,
        notificationPreferences: {
          inApp: true,
          chargingReminders: true,
          workspaceAvailability: false,
        },
      })
      .expect(200);
    expect(profileForB.body.data.id).toBe(customerB.id);
    expect(await models.WorkspaceBooking.countDocuments({
      _id: workspaceA.body.data.booking.id,
      customerId: customerA.id,
    })).toBe(1);
    const marked = await api()
      .patch(
        `/api/customer/me/notifications/${notifications.body.data[0].id}/read`,
      )
      .set(auth("customerA"))
      .expect(200);
    expect(marked.body.data.read).toBe(true);
  });
});

describe("browser push subscriptions", () => {
  it("stores and removes only the authenticated customer browser subscription", async () => {
    const customer = await provisionCustomer("customerA", "08000000019");
    const subscription = {
      endpoint: "https://push.example.test/customer-a",
      keys: { p256dh: "public-key", auth: "auth-key" },
    };
    const created = await api()
      .post("/api/push/subscriptions")
      .set(auth("customerA"))
      .send(subscription)
      .expect(201);
    expect(created.body.data).toEqual({ enabled: true });
    expect(
      await models.PushSubscription.countDocuments({ customerId: customer.id }),
    ).toBe(1);
    expect(
      (await models.Customer.findById(customer.id))?.notificationPreferences
        ?.push,
    ).toBe(true);
    await api()
      .delete("/api/push/subscriptions")
      .set(auth("customerB"))
      .send({ endpoint: subscription.endpoint })
      .expect(200);
    expect(
      await models.PushSubscription.countDocuments({ customerId: customer.id }),
    ).toBe(1);
    await api()
      .delete("/api/push/subscriptions")
      .set(auth("customerA"))
      .send({ endpoint: subscription.endpoint })
      .expect(200);
    expect(
      await models.PushSubscription.countDocuments({ customerId: customer.id }),
    ).toBe(0);
    expect(
      (await models.Customer.findById(customer.id))?.notificationPreferences
        ?.push,
    ).toBe(false);
  });
});

describe("customer profile and consent", () => {
  it("persists valid profile edits and keeps each consent independent", async () => {
    await provisionCustomer("customerA", "08000000029");
    const updated = await api()
      .patch("/api/customer/me")
      .set(auth("customerA"))
      .send({
        name: "Customer Alpha",
        phone: "+234 800 000 0029",
        whatsappOptIn: true,
        notificationPreferences: {
          inApp: false,
          chargingReminders: true,
          workspaceAvailability: false,
        },
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: "Customer Alpha",
      phone: "+234 800 000 0029",
      whatsappOptIn: true,
      accountStatus: "active",
    });
    expect(updated.body.data.notificationPreferences).toMatchObject({
      push: false,
      inApp: false,
      chargingReminders: true,
      workspaceAvailability: false,
    });
    await api()
      .patch("/api/customer/me")
      .set(auth("customerA"))
      .send({
        name: "Customer Alpha",
        phone: "invalid",
        whatsappOptIn: false,
        notificationPreferences: {
          inApp: true,
          chargingReminders: false,
          workspaceAvailability: true,
        },
      })
      .expect(400);
    const persisted = await api()
      .get("/api/customer/me")
      .set(auth("customerA"))
      .expect(200);
    expect(persisted.body.data.phone).toBe("+234 800 000 0029");
  });
});

describe("WhatsApp receipt delivery", () => {
  it("persists explicit charging consent and queues opted-in charging receipts only", async () => {
    await provision("staff", "staff");

    const optedOut = await checkIn("08000000200", "opted-out").expect(201);
    expect(await models.ReceiptDelivery.countDocuments()).toBe(0);
    expect(
      (await models.Customer.findById(optedOut.body.data.session.customerId))
        ?.whatsappOptIn,
    ).toBe(false);

    const optedIn = await checkIn("08000000201", "opted-in", {
      whatsappOptIn: true,
    }).expect(201);

    expect(
      (await models.Customer.findById(optedIn.body.data.session.customerId))
        ?.whatsappOptIn,
    ).toBe(true);
    expect(
      await models.ReceiptDelivery.findOne({
        receiptId: optedIn.body.data.receipt.id,
        channel: "whatsapp",
      }),
    ).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("queues opted-in paid workspace receipts and safely skips zero-value workspace registrations", async () => {
    await provision("staff", "staff");

    const paid = await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Workspace WhatsApp",
        phone: "08000000202",
        amount: 200,
        paymentMethod: "cash",
        whatsappOptIn: true,
      })
      .expect(201);

    expect(paid.body.data.receipt).toBeTruthy();
    expect(
      await models.ReceiptDelivery.countDocuments({
        receiptId: paid.body.data.receipt.id,
        channel: "whatsapp",
      }),
    ).toBe(1);

    const free = await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Workspace Free",
        phone: "08000000203",
        amount: 0,
        paymentMethod: "cash",
        whatsappOptIn: true,
      })
      .expect(201);

    expect(free.body.data.receipt).toBeUndefined();
    expect(
      await models.WorkspaceBooking.countDocuments({
        _id: free.body.data.booking.id,
      }),
    ).toBe(1);
    expect(
      await models.ReceiptDelivery.countDocuments({
        customerId: free.body.data.booking.customerId,
      }),
    ).toBe(0);
  });

  it("queues opted-in existing sale customers", async () => {
    await provision("staff", "staff");
    const customer = await models.Customer.create({
      name: "Sale WhatsApp",
      phone: "08000000204",
      whatsappOptIn: true,
    });
    const product = await models.Product.create({
      sku: "WA-SALE",
      name: "WhatsApp sale item",
      category: "test",
      costPrice: 50,
      sellingPrice: 100,
      quantityOnHand: 2,
      reorderThreshold: 0,
    });

    const sale = await api()
      .post("/api/sales")
      .set(auth("staff"))
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cash",
      })
      .expect(201);

    expect(
      await models.ReceiptDelivery.findOne({
        receiptId: sale.body.data.receipt.id,
        channel: "whatsapp",
      }),
    ).toMatchObject({
      customerId: customer._id,
      status: "pending",
    });
  });

  it("keeps enqueue and manual resend idempotent and staff/admin-only", async () => {
    await provision("admin", "admin");
    await provision("staff", "staff");
    await provision("customer", "customerA");

    const created = await checkIn("08000000205", "manual", {
      whatsappOptIn: true,
    }).expect(201);
    const receiptId = created.body.data.receipt.id;

    await whatsappService.enqueueReceiptWhatsApp(receiptId);
    await whatsappService.enqueueReceiptWhatsApp(receiptId);
    expect(
      await models.ReceiptDelivery.countDocuments({
        receiptId,
        channel: "whatsapp",
      }),
    ).toBe(1);

    await api()
      .get(`/api/receipts/${receiptId}/delivery`)
      .set(auth("customerA"))
      .expect(403);
    await api()
      .post(`/api/receipts/${receiptId}/send-whatsapp`)
      .set(auth("customerA"))
      .expect(403);

    await api()
      .get(`/api/receipts/${receiptId}/delivery`)
      .set(auth("staff"))
      .expect(200);
    await api()
      .post(`/api/receipts/${receiptId}/send-whatsapp`)
      .set(auth("admin"))
      .expect(202);
    await api()
      .post(`/api/receipts/${receiptId}/send-whatsapp`)
      .set(auth("staff"))
      .expect(202);

    expect(
      await models.ReceiptDelivery.countDocuments({
        receiptId,
        channel: "whatsapp",
      }),
    ).toBe(1);
    expect(
      await models.AuditLog.countDocuments({
        action: "RECEIPT_WHATSAPP_REQUESTED",
        entityId: receiptId,
      }),
    ).toBe(2);
  });

  it("does not call the provider while WhatsApp is disabled", async () => {
    await provision("staff", "staff");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const created = await checkIn("08000000206", "disabled", {
      whatsappOptIn: true,
    }).expect(201);

    await whatsappService.processPendingReceiptDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await models.ReceiptDelivery.findOne({
        receiptId: created.body.data.receipt.id,
      }),
    ).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("records provider failure without rolling back completed operations", async () => {
    await provision("staff", "staff");
    serverEnv.WHATSAPP_ENABLED = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 190 } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const created = await checkIn("08000000207", "provider-failure", {
      whatsappOptIn: true,
    }).expect(201);

    await whatsappService.processPendingReceiptDeliveries();

    expect(
      await models.ChargingSession.countDocuments({
        _id: created.body.data.session.id,
      }),
    ).toBe(1);
    expect(
      await models.Transaction.countDocuments({
        referenceId: created.body.data.session.id,
      }),
    ).toBe(1);
    expect(
      await models.Receipt.countDocuments({
        _id: created.body.data.receipt.id,
      }),
    ).toBe(1);
    expect(
      await models.ReceiptDelivery.findOne({
        receiptId: created.body.data.receipt.id,
      }),
    ).toMatchObject({
      status: "failed",
      attempts: 1,
      lastErrorCode: "WHATSAPP_GRAPH_190",
    });
  });

  it("retries stale processing deliveries and sends with mocked provider calls", async () => {
    await provision("staff", "staff");
    serverEnv.WHATSAPP_ENABLED = true;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "media-id" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const created = await checkIn("08000000208", "stale", {
      whatsappOptIn: true,
    }).expect(201);
    await models.ReceiptDelivery.updateOne(
      { receiptId: created.body.data.receipt.id },
      {
        status: "processing",
        lastAttemptAt: new Date(Date.now() - 10 * 60_000),
      },
    );

    await whatsappService.processPendingReceiptDeliveries();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      await models.ReceiptDelivery.findOne({
        receiptId: created.body.data.receipt.id,
      }),
    ).toMatchObject({
      status: "sent",
      attempts: 1,
      providerMessageId: "wamid.test",
    });
  });

  it("preserves the exact secure charging QR payload in receipt detail and server PDF generation", async () => {
    await provision("staff", "staff");
    const QRCode = (await import("qrcode")).default;
    const qrSpy = vi.spyOn(QRCode, "toDataURL");

    const created = await checkIn("08000000209", "secure-qr", {
      whatsappOptIn: true,
    }).expect(201);
    const session = await models.ChargingSession.findById(
      created.body.data.session.id,
    ).select("+secureClaimToken");
    const token = session?.get("secureClaimToken") as string;

    const detail = await api()
      .get(`/api/receipts/${created.body.data.receipt.id}`)
      .set(auth("staff"))
      .expect(200);
    expect(detail.body.data.claimToken).toBe(token);

    await receiptDocumentService.createReceiptPdf(created.body.data.receipt.id);
    expect(qrSpy).toHaveBeenCalledWith(
      `sanfaani://claim/${token}`,
      expect.objectContaining({
        errorCorrectionLevel: "M",
      }),
    );
  });
});

describe("atomic operations and financial records", () => {
  it("rolls back charging, sale, and workspace writes when receipt creation fails", async () => {
    await provision("staff", "staff");
    await updateSettings({ chargingCapacity: 2, workspaceCapacity: 2 });

    const failNextReceipt = () => vi
      .spyOn(models.Receipt, "create")
      .mockRejectedValueOnce(new Error("controlled receipt failure"));

    let receiptFailure = failNextReceipt();
    const chargingFailure = await checkIn("08000000050", "rollback")
      .expect(500);
    receiptFailure.mockRestore();
    expect(chargingFailure.body).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "SANFAANI could not complete this operation.",
      },
    });
    expect(await models.Customer.countDocuments({ phone: "08000000050" })).toBe(0);
    expect(await models.ChargingSession.countDocuments()).toBe(0);
    expect(await models.ResourceLock.countDocuments({ resource: "charging", occupied: true })).toBe(0);
    expect(await models.ResourceLock.countDocuments({ resource: "charging", referenceId: { $ne: null } })).toBe(0);
    expect(await models.Transaction.countDocuments()).toBe(0);
    expect(await models.Receipt.countDocuments()).toBe(0);
    expect(await models.AuditLog.countDocuments()).toBe(0);

    const product = await models.Product.create({
      sku: "ROLLBACK-SALE",
      name: "Rollback sale",
      category: "test",
      costPrice: 50,
      sellingPrice: 100,
      quantityOnHand: 2,
      reorderThreshold: 0,
    });
    receiptFailure = failNextReceipt();
    await api()
      .post("/api/sales")
      .set(auth("staff"))
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cash",
      })
      .expect(500);
    receiptFailure.mockRestore();
    expect((await models.Product.findById(product.id))?.quantityOnHand).toBe(2);
    expect(await models.Sale.countDocuments()).toBe(0);
    expect(await models.InventoryMovement.countDocuments()).toBe(0);
    expect(await models.Transaction.countDocuments()).toBe(0);
    expect(await models.Receipt.countDocuments()).toBe(0);

    receiptFailure = failNextReceipt();
    await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Workspace rollback",
        phone: "08000000051",
        amount: 200,
        paymentMethod: "cash",
      })
      .expect(500);
    receiptFailure.mockRestore();
    expect(await models.Customer.countDocuments({ phone: "08000000051" })).toBe(0);
    expect(await models.WorkspaceBooking.countDocuments()).toBe(0);
    expect(await models.ResourceLock.countDocuments({ resource: "workspace", occupied: true })).toBe(0);
    expect(await models.ResourceLock.countDocuments({ resource: "workspace", referenceId: { $ne: null } })).toBe(0);
    expect(await models.Transaction.countDocuments()).toBe(0);
    expect(await models.Receipt.countDocuments()).toBe(0);
    expect(await models.AuditLog.countDocuments()).toBe(0);
  });

  it("creates products and records audited stock adjustments", async () => {
    await provision("admin", "admin");
    const created = await api()
      .post("/api/products")
      .set(auth("admin"))
      .send({
        sku: "RC-RESTOCK",
        name: "RC restock product",
        category: "test",
        costPrice: 50,
        sellingPrice: 100,
        quantityOnHand: 2,
        reorderThreshold: 1,
      })
      .expect(201);
    const productId = created.body.data.id;
    await api()
      .post(`/api/products/${productId}/adjust`)
      .set(auth("admin"))
      .send({
        quantity: 3,
        type: "restock",
        reason: "RC verification restock",
      })
      .expect(200);

    expect((await models.Product.findById(productId))?.quantityOnHand).toBe(5);
    expect(await models.InventoryMovement.find({ productId }).sort({ createdAt: 1 })).toMatchObject([
      {
        previousQuantity: 0,
        quantity: 2,
        newQuantity: 2,
        type: "opening",
        createdBy: identities.admin.id,
      },
      {
        previousQuantity: 2,
        quantity: 3,
        newQuantity: 5,
        type: "restock",
        reason: "RC verification restock",
        createdBy: identities.admin.id,
      },
    ]);
    expect(
      await models.AuditLog.countDocuments({
        action: "INVENTORY_ADJUSTED",
        entityId: productId,
      }),
    ).toBe(1);
  });

  it("verifies the secure QR credential and rejects it after one collection", async () => {
    await provision("staff", "staff");
    const created = await checkIn("08000000021", "secure-claim").expect(201);
    const session = await models.ChargingSession.findById(
      created.body.data.session.id,
    ).select("+secureClaimToken");
    const token = session?.get("secureClaimToken") as string;
    expect(token).toHaveLength(43);
    await api()
      .patch(`/api/charging/${session!.id}/status`)
      .set(auth("staff"))
      .send({ status: "ready" })
      .expect(200);
    await api()
      .post("/api/charging/verify-claim")
      .set(auth("staff"))
      .send({ token: "x".repeat(43) })
      .expect(404);
    await api()
      .post(`/api/charging/${session!.id}/collect`)
      .set(auth("staff"))
      .send({ claimId: "SF-CHG-WRONG-CLAIM" })
      .expect(404);
    const verified = await api()
      .post("/api/charging/verify-claim")
      .set(auth("staff"))
      .send({ token })
      .expect(200);
    expect(verified.body.data).toMatchObject({
      sessionId: session!.id,
      eligibleForCollection: true,
      status: "ready",
    });
    expect(verified.body.data.secureClaimToken).toBeUndefined();
    await api()
      .post(`/api/charging/${session!.id}/collect`)
      .set(auth("staff"))
      .send({ claimId: token })
      .expect(200);
    await api()
      .post("/api/charging/verify-claim")
      .set(auth("staff"))
      .send({ token })
      .expect(409);
    await api()
      .post(`/api/charging/${session!.id}/collect`)
      .set(auth("staff"))
      .send({ claimId: token })
      .expect(404);
  });

  it("admits 40 active charging sessions, rejects the 41st, never duplicates a slot, and frees a collected slot", async () => {
    await provision("staff", "staff");
    await updateSettings({ chargingCapacity: 40 });
    const results = await Promise.all(
      Array.from({ length: 41 }, (_, index) =>
        checkIn(`0800001${String(index).padStart(3, "0")}`, String(index)),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(40);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    const sessions = await models.ChargingSession.find({
      status: { $in: ["checked-in", "charging", "ready"] },
    });
    expect(await models.Receipt.countDocuments({ type: "charging" })).toBe(40);
    expect(
      await models.Transaction.countDocuments({ type: "charging_fee" }),
    ).toBe(40);
    expect(
      await models.AuditLog.countDocuments({ action: "CHARGING_CHECKED_IN" }),
    ).toBe(40);
    expect(new Set(sessions.map((session) => session.slotNumber)).size).toBe(
      40,
    );
    const finalSlot = sessions.find((session) => session.slotNumber === 40)!;
    await api()
      .patch(`/api/charging/${finalSlot.id}/status`)
      .set(auth("staff"))
      .send({ status: "ready" })
      .expect(200);
    await api()
      .post(`/api/charging/${finalSlot.id}/collect`)
      .set(auth("staff"))
      .send({ claimId: finalSlot.publicSessionId })
      .expect(200);
    await checkIn("0800001999", "replacement").expect(201);
  });

  it("never oversells inventory and writes the central ledger and receipts for charging, sales, and workspace payments", async () => {
    await provision("staff", "staff");
    const product = await models.Product.create({
      sku: "TEST-STOCK",
      name: "Test stock",
      category: "test",
      costPrice: 50,
      sellingPrice: 100,
      quantityOnHand: 1,
      reorderThreshold: 0,
    });
    const [firstSale, secondSale] = await Promise.all([
      api()
        .post("/api/sales")
        .set(auth("staff"))
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cash",
        }),
      api()
        .post("/api/sales")
        .set(auth("staff"))
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cash",
        }),
    ]);
    expect(
      [firstSale.status, secondSale.status].filter((status) => status === 201),
    ).toHaveLength(1);
    expect([firstSale.status, secondSale.status]).toContain(409);
    expect((await models.Product.findById(product.id))!.quantityOnHand).toBe(0);
    await checkIn("08000000031").expect(201);
    await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Workspace payer",
        phone: "08000000032",
        amount: 200,
        paymentMethod: "cash",
      })
      .expect(201);
    expect(
      await models.Transaction.countDocuments({ type: "stock_sale" }),
    ).toBe(1);
    expect(
      await models.Transaction.countDocuments({ type: "charging_fee" }),
    ).toBe(1);
    expect(
      await models.Transaction.countDocuments({ type: "workspace_fee" }),
    ).toBe(1);
    const receipts = await models.Receipt.find();
    expect(receipts).toHaveLength(3);
    expect(new Set(receipts.map((receipt) => receipt.receiptNumber)).size).toBe(
      3,
    );
  });

  it("checks a workspace visitor out, releases the seat, and retains history", async () => {
    await provision("staff", "staff");
    await updateSettings({ workspaceCapacity: 1 });
    const registration = await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Workspace lifecycle",
        phone: "08000000041",
        amount: 200,
        paymentMethod: "cash",
        deviceInfo: { type: "laptop", brand: "RC", model: "Workspace" },
      })
      .expect(201);
    const bookingId = registration.body.data.booking.id;
    expect(registration.body.data.booking.deviceInfo).toEqual({
      type: "laptop",
      brand: "RC",
      model: "Workspace",
    });

    await api()
      .post(`/api/workspace/${bookingId}/check-in`)
      .set(auth("staff"))
      .expect(200);
    const beforeRejected = {
      bookings: await models.WorkspaceBooking.countDocuments(),
      receipts: await models.Receipt.countDocuments(),
      transactions: await models.Transaction.countDocuments(),
      audits: await models.AuditLog.countDocuments(),
    };
    await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Rejected workspace visitor",
        phone: "08000000043",
        amount: 200,
        paymentMethod: "cash",
      })
      .expect(409);
    expect(await models.WorkspaceBooking.countDocuments()).toBe(
      beforeRejected.bookings,
    );
    expect(await models.Receipt.countDocuments()).toBe(beforeRejected.receipts);
    expect(await models.Transaction.countDocuments()).toBe(
      beforeRejected.transactions,
    );
    expect(await models.AuditLog.countDocuments()).toBe(beforeRejected.audits);
    await api()
      .post(`/api/workspace/${bookingId}/check-out`)
      .set(auth("staff"))
      .expect(200);

    const booking = await models.WorkspaceBooking.findById(bookingId);
    expect(booking).toMatchObject({ status: "checked-out" });
    expect(booking?.timeOut).toBeInstanceOf(Date);
    expect(await models.WorkspaceBooking.countDocuments({ _id: bookingId })).toBe(1);
    expect(await models.Receipt.countDocuments({ referenceId: bookingId })).toBe(1);
    expect(await models.Transaction.countDocuments({ referenceId: bookingId })).toBe(1);
    expect(await models.ResourceLock.findOne({ resource: "workspace", position: 1 })).toMatchObject({
      occupied: false,
      referenceId: null,
    });
    expect(await models.AuditLog.countDocuments({ action: "WORKSPACE_CHECKED_OUT", entityId: bookingId })).toBe(1);
    const active = await api().get("/api/workspace").set(auth("staff")).expect(200);
    expect(active.body.data).toHaveLength(0);
  });

  it("persists explicit WhatsApp consent for an existing workspace customer", async () => {
    await provision("staff", "staff");
    const customer = await models.Customer.create({
      name: "Existing workspace customer",
      phone: "08000000042",
      whatsappOptIn: false,
    });

    await api()
      .post("/api/workspace/register")
      .set(auth("staff"))
      .send({
        customerName: "Existing workspace customer",
        phone: "08000000042",
        amount: 0,
        paymentMethod: "cash",
        whatsappOptIn: true,
      })
      .expect(201);

    expect((await models.Customer.findById(customer.id))?.whatsappOptIn).toBe(
      true,
    );
  });

  it("audits role changes with the actor, previous role, and new role", async () => {
    await provision("admin", "admin");
    const staff = await provision("staff", "staff");
    await api()
      .patch(`/api/staff/${staff.id}/role`)
      .set(auth("admin"))
      .send({ role: "customer" })
      .expect(200);
    const audit = await models.AuditLog.findOne({
      action: "USER_ROLE_UPDATED",
    });
    expect(audit?.get("metadata")).toMatchObject({
      actor: identities.admin.id,
      targetUser: staff.id,
      previousRole: "staff",
      newRole: "customer",
    });
  });
});

describe("admin analytics and exports", () => {
  it("aggregates revenue from the central ledger and keeps reports admin-only", async () => {
    await provision("admin", "admin");
    await provision("staff", "staff");
    await models.Transaction.create([
      {
        type: "stock_sale",
        amount: 300,
        direction: "income",
        paymentMethod: "cash",
        description: "Stock income",
        createdBy: "test",
      },
      {
        type: "charging_fee",
        amount: 150,
        direction: "income",
        paymentMethod: "cash",
        description: "Charging income",
        createdBy: "test",
      },
      {
        type: "expense",
        amount: 80,
        direction: "expense",
        paymentMethod: "cash",
        description: "Expense",
        createdBy: "test",
      },
    ]);
    await api()
      .get("/api/analytics?period=today")
      .set(auth("staff"))
      .expect(403);
    await api()
      .get("/api/analytics?period=today")
      .set(auth("customerA"))
      .expect(403);
    const report = await api()
      .get("/api/analytics?period=today")
      .set(auth("admin"))
      .expect(200);
    expect(report.body.data.revenue).toMatchObject({
      income: 450,
      expenses: 80,
      net: 370,
      stockSales: 300,
      charging: 150,
      workspace: 0,
    });
    expect(report.body.data.revenueTrend[0]).toMatchObject({
      income: 450,
      expenses: 80,
      net: 370,
    });
    const csv = await api()
      .get("/api/reports/export?dataset=transactions&period=today")
      .set(auth("admin"))
      .expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Stock income");
  });
});
