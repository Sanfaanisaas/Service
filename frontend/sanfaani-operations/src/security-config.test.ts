import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production frontend security headers", () => {
  it("ships CSP, frame protection, content sniffing protection, referrer policy, and HSTS", async () => {
    const config = JSON.parse(
      await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
    );
    const catchAll = config.headers.find(
      (entry: { source: string }) => entry.source === "/(.*)",
    );
    const headers = Object.fromEntries(
      catchAll.headers.map((header: { key: string; value: string }) => [
        header.key,
        header.value,
      ]),
    );
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["Permissions-Policy"]).toContain("camera=(self)");
  });
});
