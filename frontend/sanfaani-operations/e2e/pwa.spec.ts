import { expect, test } from "@playwright/test";
import { login } from "./support";

test.describe("RC-01 deployed PWA behaviour", () => {
  test("manifest, service worker, safe offline shell, and failed offline writes are explicit", async ({
    context,
    page,
  }) => {
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).display).toBe("standalone");
    expect((await page.request.get("/icons/icon-192.png")).status()).toBe(200);
    expect((await page.request.get("/icons/icon-512.png")).status()).toBe(200);
    expect((await page.request.get("/sw.js")).status()).toBe(200);

    await login(page, "staff");
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { active: Boolean(ready.active), scope: ready.scope };
    });
    expect(registration.active).toBe(true);
    expect(registration.scope).toContain(
      new URL(process.env.E2E_BASE_URL!).origin,
    );

    await page.goto("/admin/charging/new");
    await context.setOffline(true);
    try {
      await expect(page.getByTestId("offline-banner")).toContainText(
        "You're offline. Operational changes are temporarily unavailable.",
      );
      await page
        .getByTestId("input-customer-name")
        .fill("RC01 Offline Must Fail");
      await page.getByTestId("input-phone").fill("08099999999");
      await page.getByTestId("button-submit-checkin").click();
      await expect(page.getByTestId("status-checkin-error")).toBeVisible();
      await expect(
        page.getByRole("dialog", { name: "Device checked in" }),
      ).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/charging\/new$/);
  });

  test("camera flow exposes a non-camera fallback when scanning is unavailable", async ({
    page,
  }) => {
    await login(page, "staff");
    await page.goto("/admin/charging");
    await page.getByTestId("button-scan-claim").click();
    await expect(
      page.getByRole("dialog", { name: "Scan secure claim" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Enter the Claim ID manually|Point the camera|permission was not granted/,
      ),
    ).toBeVisible();
  });
});
