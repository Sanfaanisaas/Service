import { expect, type APIResponse, type Page } from "@playwright/test";

export type TestRole = "admin" | "staff" | "customer";

const credentials: Record<
  TestRole,
  { email: string; password: string; destination: RegExp }
> = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? "",
    password: process.env.E2E_ADMIN_PASSWORD ?? "",
    destination: /\/admin\/dashboard$/,
  },
  staff: {
    email: process.env.E2E_STAFF_EMAIL ?? "",
    password: process.env.E2E_STAFF_PASSWORD ?? "",
    destination: /\/staff\/dashboard$/,
  },
  customer: {
    email: process.env.E2E_CUSTOMER_EMAIL ?? "",
    password: process.env.E2E_CUSTOMER_PASSWORD ?? "",
    destination: /\/access-restricted$/,
  },
};

export const apiBaseUrl = (process.env.E2E_API_URL ?? "").replace(/\/$/, "");

export async function login(page: Page, role: TestRole) {
  const identity = credentials[role];
  await page.goto("/sign-in");
  await page.getByTestId("input-email").fill(identity.email);
  await page.getByTestId("input-password").fill(identity.password);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await expect(page).toHaveURL(identity.destination);
}

export async function accessToken(page: Page) {
  const token = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const stored = localStorage.getItem(key);
      if (!stored) continue;
      const parsed = JSON.parse(stored) as { access_token?: string };
      if (parsed.access_token) return parsed.access_token;
    }
    return null;
  });
  expect(
    token,
    "Supabase access token should be stored after real login",
  ).toBeTruthy();
  return token!;
}

export async function api(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return page.request.fetch(`${apiBaseUrl}${path}`, {
    method,
    data,
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
  });
}

export function unique(prefix: string) {
  return `RC01-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function testPhone(seed = Date.now()) {
  return `080${String(seed).replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
}
