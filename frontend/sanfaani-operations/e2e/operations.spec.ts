import { expect, test } from "@playwright/test";
import { api, login, testPhone, unique } from "./support";

test.describe("RC-01 transactional browser workflows", () => {
  test("charging check-in creates receipt and QR, then verifies and consumes the claim", async ({
    page,
  }) => {
    const customerName = unique("Charging");
    const phone = testPhone();
    await login(page, "staff");
    const before = await api(page, "GET", "/api/dashboard/summary");
    expect(before.status()).toBe(200);
    const capacityBefore = (await before.json()).data.charging
      .available as number;

    await page.goto("/admin/charging/new");
    await page.getByTestId("input-customer-name").fill(customerName);
    await page.getByTestId("input-phone").fill(phone);
    await page.getByTestId("input-brand").fill("RC Phone");
    await page.getByTestId("input-model").fill("Verification Device");
    await page.getByTestId("button-submit-checkin").click();
    const created = page.getByRole("dialog", { name: "Device checked in" });
    await expect(created).toBeVisible();
    const copy = await created.textContent();
    const claimId = copy?.match(/SF-CHG-\d{6}-\d{3}-[A-Z0-9]{4}/)?.[0];
    const receiptNumber = copy?.match(/SF-RCP-\d{6}-[A-Z0-9]{5}/)?.[0];
    expect(claimId).toBeTruthy();
    expect(receiptNumber).toBeTruthy();

    await created.getByRole("link", { name: "View receipt" }).click();
    const receiptRow = page
      .locator('[data-testid^="row-receipt-"]')
      .filter({ hasText: receiptNumber! });
    await expect(receiptRow).toBeVisible();
    const detailResponse = page.waitForResponse(
      (response) =>
        /\/api\/receipts\/[^/?]+$/.test(response.url()) &&
        response.status() === 200,
    );
    await receiptRow.getByRole("link", { name: "View" }).click();
    const detail = await detailResponse;
    const receipt = (await detail.json()).data as {
      claimToken: string;
      receiptNumber: string;
    };
    expect(receipt.claimToken).toHaveLength(43);
    await expect(
      page.getByAltText("Secure charging collection QR code"),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByTestId("button-download-pdf").click();
    expect((await download).suggestedFilename()).toBe(
      `SANFAANI-Receipt-${receiptNumber}.pdf`,
    );

    await page.goto("/admin/charging");
    const row = page
      .locator('[data-testid^="row-charging-"]')
      .filter({ hasText: customerName });
    await expect(row).toBeVisible();
    await row.locator('[data-testid^="button-ready-"]').click();
    await expect(row).toContainText("ready");
    const verified = await api(page, "POST", "/api/charging/verify-claim", {
      token: receipt.claimToken,
    });
    expect(verified.status()).toBe(200);
    expect((await verified.json()).data.eligibleForCollection).toBe(true);

    await row.locator('[data-testid^="button-collect-"]').click();
    await page.getByTestId("input-claim-code").fill(receipt.claimToken);
    await page.getByTestId("button-confirm-collection").click();
    await expect(row).toHaveCount(0);
    expect(
      (
        await api(page, "POST", "/api/charging/verify-claim", {
          token: receipt.claimToken,
        })
      ).status(),
    ).toBe(409);
    const after = await api(page, "GET", "/api/dashboard/summary");
    expect((await after.json()).data.charging.available).toBe(capacityBefore);
  });

  test("product creation, stock, sale, ledger receipt, and oversell rejection are real", async ({
    page,
  }) => {
    const sku = unique("SKU").toUpperCase();
    const productName = unique("Product");
    await login(page, "admin");
    await page.goto("/admin/inventory");
    await page.getByTestId("button-new-product").click();
    await page.getByTestId("input-product-sku").fill(sku);
    await page.getByTestId("input-product-name").fill(productName);
    await page.getByTestId("input-product-cost").fill("100");
    await page.getByTestId("input-product-price").fill("250");
    await page.getByTestId("input-product-quantity").fill("3");
    await page.getByTestId("input-product-threshold").fill("1");
    await page.getByTestId("button-submit-product").click();
    await page.getByTestId("input-search-products").fill(sku);
    const row = page
      .locator('[data-testid^="row-product-"]')
      .filter({ hasText: sku });
    await expect(row).toContainText("3");

    const products = await api(
      page,
      "GET",
      `/api/products?search=${encodeURIComponent(sku)}`,
    );
    const product = (await products.json()).data[0] as {
      id: string;
      quantityOnHand: number;
    };
    expect(product.quantityOnHand).toBe(3);
    try {
      await page.goto("/admin/sales");
      await page.getByRole("button").filter({ hasText: productName }).click();
      await page.getByTestId("button-complete-sale").click();
      await expect(
        page.getByRole("dialog", { name: "Sale complete" }),
      ).toContainText("Receipt SF-RCP-");
      await page
        .getByRole("dialog", { name: "Sale complete" })
        .getByRole("button", { name: "New sale" })
        .click();

      const afterSale = await api(
        page,
        "GET",
        `/api/products?search=${encodeURIComponent(sku)}`,
      );
      expect((await afterSale.json()).data[0].quantityOnHand).toBe(2);
      const oversell = await api(page, "POST", "/api/sales", {
        items: [{ productId: product.id, quantity: 3 }],
        paymentMethod: "cash",
      });
      expect(oversell.status()).toBe(409);
      const afterRejected = await api(
        page,
        "GET",
        `/api/products?search=${encodeURIComponent(sku)}`,
      );
      expect((await afterRejected.json()).data[0].quantityOnHand).toBe(2);
      expect(
        (
          await api(page, "GET", `/api/products/${product.id}/movements`)
        ).status(),
      ).toBe(200);
    } finally {
      await api(page, "DELETE", `/api/products/${product.id}`);
    }
  });

  test("workspace registration, payment receipt, occupancy, and checkout complete in browser", async ({
    page,
  }) => {
    const visitor = unique("Workspace");
    await login(page, "staff");
    const before = await api(page, "GET", "/api/dashboard/summary");
    const occupiedBefore = (await before.json()).data.workspace
      .occupied as number;
    await page.goto("/admin/workspace");
    await page.getByTestId("button-new-booking").click();
    await page.getByTestId("input-workspace-name").fill(visitor);
    await page
      .getByTestId("input-workspace-phone")
      .fill(testPhone(Date.now() + 1));
    await page.getByTestId("input-workspace-amount").fill("1000");
    await page.getByTestId("button-submit-workspace").click();
    await expect(
      page.getByRole("dialog", { name: "Visitor registered" }),
    ).toContainText("Receipt SF-RCP-");
    await page
      .getByRole("dialog", { name: "Visitor registered" })
      .getByRole("button", { name: "Done" })
      .click();
    const row = page
      .locator('[data-testid^="row-workspace-"]')
      .filter({ hasText: visitor });
    await expect(row).toContainText("registered");
    await row.locator('[data-testid^="button-workspace-checkin-"]').click();
    await expect(row).toContainText("checked-in");
    const occupied = await api(page, "GET", "/api/dashboard/summary");
    expect((await occupied.json()).data.workspace.occupied).toBe(
      occupiedBefore + 1,
    );
    page.once("dialog", (dialog) => dialog.accept());
    await row.locator('[data-testid^="button-workspace-checkout-"]').click();
    await expect(row).toHaveCount(0);
    const after = await api(page, "GET", "/api/dashboard/summary");
    expect((await after.json()).data.workspace.occupied).toBe(occupiedBefore);
  });
});
