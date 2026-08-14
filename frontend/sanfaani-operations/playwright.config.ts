import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(
    resolve(dirname(fileURLToPath(import.meta.url)), ".env.e2e"),
  );
} catch {
  // CI provides protected variables directly. A local file is optional.
}

const required = [
  "E2E_BASE_URL",
  "E2E_API_URL",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_ANON_KEY",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_STAFF_EMAIL",
  "E2E_STAFF_PASSWORD",
  "E2E_CUSTOMER_A_EMAIL",
  "E2E_CUSTOMER_A_PASSWORD",
  "E2E_CUSTOMER_A_PHONE",
  "E2E_CUSTOMER_B_EMAIL",
  "E2E_CUSTOMER_B_PASSWORD",
  "E2E_CUSTOMER_B_PHONE",
] as const;

if (process.env.E2E_ALLOW_MISSING !== "1") {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(
      `RC-01 E2E environment is incomplete. Missing: ${missing.join(", ")}`,
    );
  if (
    !process.env.E2E_BASE_URL!.startsWith("https://") &&
    process.env.E2E_ALLOW_INSECURE !== "1"
  ) {
    throw new Error(
      "E2E_BASE_URL must use HTTPS. Set E2E_ALLOW_INSECURE=1 only for an intentional local run.",
    );
  }
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
