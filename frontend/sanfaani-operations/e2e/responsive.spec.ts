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

test("priority Admin and Staff operations screens fit release viewports", async ({
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
      "/admin/customers",
      "/admin/receipts",
      "/admin/analytics",
      "/admin/settings",
      "/admin/staff",
    ]) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoPageOverflow(page);
    }
  }

});
