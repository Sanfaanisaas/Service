import { expect, test } from "@playwright/test";
import { api, login, testPhone, unique } from "./support";

const settingsInput = (value: Record<string, unknown>) => ({
  businessName: value.businessName,
  businessAddress: value.businessAddress ?? "",
  phone: value.phone ?? "",
  currency: value.currency,
  chargingCapacity: value.chargingCapacity,
  workspaceCapacity: value.workspaceCapacity,
  defaultChargingPrice: value.defaultChargingPrice,
  defaultWorkspacePrice: value.defaultWorkspacePrice,
  whatsappGroupInviteUrl: value.whatsappGroupInviteUrl ?? "",
  businessTimezone: value.businessTimezone,
  receiptFooter: value.receiptFooter ?? "",
});

test.describe("RC-01 settings, profile, and customer isolation", () => {
  test("admin settings propagate to the charging screen and are restored", async ({
    page,
  }) => {
    await login(page, "admin");
    const current = await api(page, "GET", "/api/settings");
    expect(current.status()).toBe(200);
    const original = settingsInput((await current.json()).data);
    const nextCapacity = Number(original.chargingCapacity) + 1;
    try {
      await page.goto("/admin/settings");
      await page
        .getByTestId("input-settings-charging-capacity")
        .fill(String(nextCapacity));
      await page.getByTestId("button-save-settings").click();
      await expect(
        page.getByText(
          "Settings saved. Operational capacity has been refreshed.",
        ),
      ).toBeVisible();
      await page.goto("/admin/charging");
      await expect(
        page.getByText(new RegExp(`/ ${nextCapacity} occupied$`)),
      ).toBeVisible();
    } finally {
      expect(
        (await api(page, "PATCH", "/api/settings", original)).status(),
      ).toBe(200);
    }
  });

  test("customer profile and independent preferences persist across reload", async ({
    page,
  }) => {
    await login(page, "customerA");
    const current = await api(page, "GET", "/api/customer/me");
    const original = (await current.json()).data;
    const name = unique("Customer-A");
    const phone = testPhone(Date.now() + 2);
    try {
      await page.goto("/customer/profile");
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Phone").fill(phone);
      await page.getByLabel("Workspace availability").check();
      await page.getByLabel("WhatsApp consent").uncheck();
      await page.getByTestId("button-save-profile").click();
      await expect(
        page.getByText("Profile and preferences saved."),
      ).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Name")).toHaveValue(name);
      await expect(page.getByLabel("Phone")).toHaveValue(phone);
      await expect(page.getByLabel("Workspace availability")).toBeChecked();
      await expect(page.getByLabel("WhatsApp consent")).not.toBeChecked();
    } finally {
      await api(page, "PATCH", "/api/customer/me", {
        name: original.name,
        phone: process.env.E2E_CUSTOMER_A_PHONE!,
        whatsappOptIn: original.whatsappOptIn,
        notificationPreferences: {
          inApp: original.notificationPreferences.inApp,
          chargingReminders: original.notificationPreferences.chargingReminders,
          workspaceAvailability:
            original.notificationPreferences.workspaceAvailability,
        },
      });
    }
  });

  test("Customer A and Customer B receive only their owned resources", async ({
    browser,
  }) => {
    const aContext = await browser.newContext();
    const bContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    const staff = await staffContext.newPage();
    await login(a, "customerA");
    await login(b, "customerB");
    await login(staff, "staff");
    const originalA = (await (await api(a, "GET", "/api/customer/me")).json())
      .data;
    const originalB = (await (await api(b, "GET", "/api/customer/me")).json())
      .data;
    const phoneA = testPhone(Date.now() + 3);
    const phoneB = testPhone(Date.now() + 4);
    const profilePayload = (original: Record<string, any>, phone: string) => ({
      name: original.name,
      phone,
      whatsappOptIn: original.whatsappOptIn,
      notificationPreferences: {
        inApp: original.notificationPreferences.inApp,
        chargingReminders: original.notificationPreferences.chargingReminders,
        workspaceAvailability:
          original.notificationPreferences.workspaceAvailability,
      },
    });
    const chargingIds: string[] = [];
    const workspaceIds: string[] = [];
    try {
      expect(
        (
          await api(
            a,
            "PATCH",
            "/api/customer/me",
            profilePayload(originalA, phoneA),
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await api(
            b,
            "PATCH",
            "/api/customer/me",
            profilePayload(originalB, phoneB),
          )
        ).status(),
      ).toBe(200);
      const chargeA = await api(staff, "POST", "/api/charging/check-in", {
        customerName: originalA.name,
        phone: phoneA,
        deviceType: "phone",
        expectedMinutes: 30,
        amount: 0,
        paymentMethod: "cash",
      });
      const chargeB = await api(staff, "POST", "/api/charging/check-in", {
        customerName: originalB.name,
        phone: phoneB,
        deviceType: "phone",
        expectedMinutes: 30,
        amount: 0,
        paymentMethod: "cash",
      });
      expect(chargeA.status()).toBe(201);
      expect(chargeB.status()).toBe(201);
      const dataA = (await chargeA.json()).data;
      const dataB = (await chargeB.json()).data;
      chargingIds.push(dataA.session.id, dataB.session.id);
      const workspaceA = await api(staff, "POST", "/api/workspace/register", {
        customerName: originalA.name,
        phone: phoneA,
        amount: 0,
        paymentMethod: "cash",
      });
      const workspaceB = await api(staff, "POST", "/api/workspace/register", {
        customerName: originalB.name,
        phone: phoneB,
        amount: 0,
        paymentMethod: "cash",
      });
      expect(workspaceA.status()).toBe(201);
      const wsA = (await workspaceA.json()).data;
      workspaceIds.push(wsA.booking.id);
      expect(workspaceB.status()).toBe(201);
      const wsB = (await workspaceB.json()).data;
      workspaceIds.push(wsB.booking.id);

      const aCharging = (
        await (
          await api(a, "GET", "/api/customer/me/charging?view=history")
        ).json()
      ).data.recentSessions;
      expect(
        aCharging.some((item: { id: string }) => item.id === dataA.session.id),
      ).toBe(true);
      expect(
        aCharging.some((item: { id: string }) => item.id === dataB.session.id),
      ).toBe(false);
      const aWorkspace = (
        await (await api(a, "GET", "/api/customer/me/workspace")).json()
      ).data;
      expect(
        aWorkspace.some((item: { id: string }) => item.id === wsA.booking.id),
      ).toBe(true);
      expect(
        aWorkspace.some((item: { id: string }) => item.id === wsB.booking.id),
      ).toBe(false);
      expect(
        (
          await api(a, "GET", `/api/customer/me/receipts/${dataA.receipt.id}`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await api(b, "GET", `/api/customer/me/receipts/${dataA.receipt.id}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await api(a, "GET", `/api/customer/me/receipts/${dataB.receipt.id}`)
        ).status(),
      ).toBe(404);
      await a.goto("/customer/device");
      await expect(a.getByText(dataA.session.publicSessionId)).toBeVisible();
      await expect(a.getByText(dataB.session.publicSessionId)).toHaveCount(0);
    } finally {
      for (const id of chargingIds)
        await api(staff, "PATCH", `/api/charging/${id}/status`, {
          status: "cancelled",
        });
      for (const id of workspaceIds) {
        await api(staff, "POST", `/api/workspace/${id}/check-in`);
        await api(staff, "POST", `/api/workspace/${id}/check-out`);
      }
      await api(
        a,
        "PATCH",
        "/api/customer/me",
        profilePayload(originalA, process.env.E2E_CUSTOMER_A_PHONE!),
      );
      await api(
        b,
        "PATCH",
        "/api/customer/me",
        profilePayload(originalB, process.env.E2E_CUSTOMER_B_PHONE!),
      );
      await aContext.close();
      await bContext.close();
      await staffContext.close();
    }
  });
});
