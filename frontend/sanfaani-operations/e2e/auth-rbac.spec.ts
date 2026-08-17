import { expect, test } from "@playwright/test";
import { api, login, type TestRole } from "./support";

test.describe("RC-01 real authentication and authorization", () => {
  for (const role of ["admin", "staff"] as TestRole[]) {
    test(`${role} signs in, restores the session, logs out, and loses protected access`, async ({
      page,
    }) => {
      await login(page, role);
      await page.reload();
      await expect(page).not.toHaveURL(/\/sign-in/);
      const me = await api(page, "GET", "/api/me");
      expect(me.status()).toBe(200);
      const body = await me.json();
      expect(body.data.role).toBe(role);

      await page.getByTestId("button-logout").click();
      await expect(page).toHaveURL(/\/sign-in/);
      await page.goto("/admin/dashboard");
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }

  test("a customer-role account is denied the operations console", async ({
    page,
  }) => {
    await login(page, "customer");
    await expect(page.getByTestId("operations-access-restricted")).toHaveText(
      "This account does not have access to the SANFAANI operations console.",
    );
    const me = await api(page, "GET", "/api/me?role=admin");
    expect(me.status()).toBe(200);
    expect((await me.json()).data.role).toBe("customer");
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
      await expect(page).toHaveURL(/\/access-restricted$/);
    }
    for (const removedPath of ["/sign-up", "/customer", "/customer/profile", "/customer/receipts"]) {
      await page.goto(removedPath);
      await expect(page.getByText("404 Page Not Found")).toBeVisible();
    }
  });

  test("staff cannot access administrative UI or mutate administrative APIs", async ({ page }) => {
    await login(page, "staff");
    expect((await api(page, "PATCH", "/api/settings", {})).status()).toBe(403);
    expect((await api(page, "POST", "/api/staff/invite", { email: "blocked@example.test", role: "staff" })).status()).toBe(403);
    expect(
      (
        await api(page, "PATCH", "/api/staff/000000000000000000000000/role", {
          role: "admin",
        })
      ).status(),
    ).toBe(403);
    for (const path of ["/admin/settings", "/admin/staff", "/admin/analytics"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/staff\/dashboard$/);
    }
  });

  test("inactive application users receive 403 and recover after reactivation", async ({
    browser,
  }) => {
    const staffContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    const admin = await adminContext.newPage();
    await login(staffPage, "staff");
    await login(admin, "admin");
    const staffList = await api(admin, "GET", "/api/staff");
    expect(staffList.status()).toBe(200);
    const users = (await staffList.json()).data as Array<{
      appUserId: string;
      email: string;
    }>;
    const target = users.find(
      (user) =>
        user.email.toLowerCase() ===
        process.env.E2E_STAFF_EMAIL!.toLowerCase(),
    );
    expect(
      target,
      "The operational staff identity must already have an AppUser record",
    ).toBeTruthy();
    try {
      expect(
        (
          await api(admin, "PATCH", `/api/staff/${target!.appUserId}/active`, {
            active: false,
          })
        ).status(),
      ).toBe(200);
      expect((await api(staffPage, "GET", "/api/me")).status()).toBe(403);
      await staffPage.reload();
      await expect(staffPage).toHaveURL(/\/sign-in$/);
      expect(await staffPage.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token")))).toBe(false);
    } finally {
      expect(
        (
          await api(admin, "PATCH", `/api/staff/${target!.appUserId}/active`, {
            active: true,
          })
        ).status(),
      ).toBe(200);
      await staffContext.close();
      await adminContext.close();
    }
  });
});
