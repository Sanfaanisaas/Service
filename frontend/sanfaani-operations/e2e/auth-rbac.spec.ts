import { expect, test } from "@playwright/test";
import { accessToken, api, login, type TestRole } from "./support";

test.describe("RC-01 real authentication and authorization", () => {
  for (const role of ["admin", "staff", "customerA"] as TestRole[]) {
    test(`${role} signs in, restores the session, logs out, and loses protected access`, async ({
      page,
    }) => {
      await login(page, role);
      await page.reload();
      await expect(page).not.toHaveURL(/\/sign-in/);
      const me = await api(page, "GET", "/api/me");
      expect(me.status()).toBe(200);
      const body = await me.json();
      expect(body.data.role).toBe(
        role.startsWith("customer") ? "customer" : role,
      );

      const logout = role.startsWith("customer")
        ? page.getByTestId("button-customer-logout")
        : page.getByTestId("button-logout");
      await logout.click();
      await expect(page).toHaveURL(/\/sign-in/);
      await page.goto(
        role.startsWith("customer") ? "/customer/profile" : "/admin/dashboard",
      );
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }

  test("backend RBAC rejects customer and staff privilege escalation", async ({
    page,
  }) => {
    await login(page, "customerA");
    for (const path of [
      "/api/settings",
      "/api/charging",
      "/api/workspace",
      "/api/customers",
      "/api/products",
      "/api/sales",
      "/api/transactions",
      "/api/receipts",
      "/api/staff",
      "/api/dashboard/summary",
    ]) {
      expect((await api(page, "GET", path)).status()).toBe(403);
    }
    for (const path of [
      "/admin/dashboard",
      "/admin/settings",
      "/admin/staff",
      "/admin/analytics",
      "/admin/inventory",
      "/admin/transactions",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/customer$/);
    }
    const customerMe = await api(page, "GET", "/api/me?role=admin");
    expect(customerMe.status()).toBe(200);
    expect((await customerMe.json()).data.role).toBe("customer");

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(page, "staff");
    expect((await api(page, "PATCH", "/api/settings", {})).status()).toBe(403);
    expect(
      (
        await api(page, "PATCH", "/api/staff/000000000000000000000000/role", {
          role: "admin",
        })
      ).status(),
    ).toBe(403);
  });

  test("Supabase metadata cannot promote a customer application role", async ({
    page,
  }) => {
    await login(page, "customerB");
    const token = await accessToken(page);
    const update = await page.request.put(
      `${process.env.E2E_SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: process.env.E2E_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
        },
        data: { data: { role: "admin", app_role: "admin" } },
      },
    );
    expect(update.ok()).toBeTruthy();
    try {
      const me = await api(page, "GET", "/api/me?role=admin");
      expect(me.status()).toBe(200);
      expect((await me.json()).data.role).toBe("customer");
      expect(
        (await api(page, "PATCH", "/api/settings", { role: "admin" })).status(),
      ).toBe(403);
    } finally {
      await page.request.put(`${process.env.E2E_SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: process.env.E2E_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
        },
        data: { data: { role: null, app_role: null } },
      });
    }
  });

  test("inactive application users receive 403 and recover after reactivation", async ({
    browser,
  }) => {
    const customerContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const customer = await customerContext.newPage();
    const admin = await adminContext.newPage();
    await login(customer, "customerB");
    await login(admin, "admin");
    const staff = await api(admin, "GET", "/api/staff");
    expect(staff.status()).toBe(200);
    const users = (await staff.json()).data as Array<{
      appUserId: string;
      email: string;
    }>;
    const target = users.find(
      (user) =>
        user.email.toLowerCase() ===
        process.env.E2E_CUSTOMER_B_EMAIL!.toLowerCase(),
    );
    expect(
      target,
      "Customer B must already have an AppUser record",
    ).toBeTruthy();
    try {
      expect(
        (
          await api(admin, "PATCH", `/api/staff/${target!.appUserId}/active`, {
            active: false,
          })
        ).status(),
      ).toBe(200);
      expect((await api(customer, "GET", "/api/me")).status()).toBe(403);
    } finally {
      expect(
        (
          await api(admin, "PATCH", `/api/staff/${target!.appUserId}/active`, {
            active: true,
          })
        ).status(),
      ).toBe(200);
      await customerContext.close();
      await adminContext.close();
    }
  });
});
