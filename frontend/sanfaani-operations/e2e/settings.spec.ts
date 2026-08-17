import { expect, test } from "@playwright/test";
import { api, login } from "./support";

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

test("admin settings propagate to the charging screen and are restored", async ({ page }) => {
  await login(page, "admin");
  const current = await api(page, "GET", "/api/settings");
  expect(current.status()).toBe(200);
  const original = settingsInput((await current.json()).data);
  const nextCapacity = Number(original.chargingCapacity) + 1;
  try {
    await page.goto("/admin/settings");
    await page.getByTestId("input-settings-charging-capacity").fill(String(nextCapacity));
    await page.getByTestId("button-save-settings").click();
    await expect(page.getByText("Settings saved. Operational capacity has been refreshed.")).toBeVisible();
    await page.goto("/admin/charging");
    await expect(page.getByText(new RegExp(`/ ${nextCapacity} occupied$`))).toBeVisible();
  } finally {
    expect((await api(page, "PATCH", "/api/settings", original)).status()).toBe(200);
  }
});
