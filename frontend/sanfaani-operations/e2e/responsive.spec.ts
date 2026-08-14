import { expect, test } from "@playwright/test";
import { login } from "./support";

const sizes = [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test("priority admin, staff, and customer screens fit release viewports", async ({
  page,
}) => {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/sign-in");
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expectNoPageOverflow(page);
  }

  await login(page, "admin");
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const route of [
      "/admin/dashboard",
      "/admin/charging",
      "/admin/inventory",
      "/admin/sales",
      "/admin/workspace",
      "/admin/receipts",
    ]) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoPageOverflow(page);
    }
  }

  await page.getByTestId("button-logout").click();
  await login(page, "customerA");
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const route of [
      "/customer",
      "/customer/device",
      "/customer/workspace",
      "/customer/receipts",
      "/customer/profile",
    ]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoPageOverflow(page);
    }
  }
});
