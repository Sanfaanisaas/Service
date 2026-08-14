import assert from "node:assert/strict";
import test from "node:test";
import { secretChecks } from "./secret-patterns.mjs";

const assignment = (label) =>
  secretChecks.find((check) => check.label === label);
const serviceRoleKey = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
const vapidPrivateKey = ["VAPID", "PRIVATE", "KEY"].join("_");

test("empty secret assignments do not consume the next line", () => {
  const source = `${serviceRoleKey}=\nCLIENT_URL=https://example.test\n${vapidPrivateKey}=\nVAPID_SUBJECT=mailto:test@example.test`;
  for (const check of secretChecks) {
    check.pattern.lastIndex = 0;
    assert.equal(check.pattern.test(source), false, check.label);
  }
});

test("non-empty private assignments are detected", () => {
  const serviceRole = assignment("non-empty Supabase service-role assignment");
  const vapid = assignment("non-empty VAPID private-key assignment");
  assert(serviceRole && vapid);
  serviceRole.pattern.lastIndex = 0;
  vapid.pattern.lastIndex = 0;
  assert.equal(
    serviceRole.pattern.test(`${serviceRoleKey}=actual-secret`),
    true,
  );
  assert.equal(vapid.pattern.test(`${vapidPrivateKey} = actual-secret`), true);
});
