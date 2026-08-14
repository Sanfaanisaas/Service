import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { secretChecks } from "./secret-patterns.mjs";

let tracked;
try {
  tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
} catch (error) {
  // Some restricted runners return EPERM after producing a successful,
  // zero-status result. Accept only that exact condition; real git failures
  // must still fail the release gate.
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    error.status === 0 &&
    "stdout" in error &&
    typeof error.stdout === "string"
  ) {
    tracked = error.stdout;
  } else {
    throw error;
  }
}
const files = tracked.split("\0").filter(Boolean);
const findings = [];

for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  for (const check of secretChecks) {
    check.pattern.lastIndex = 0;
    for (const match of source.matchAll(check.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} — ${check.label}`);
    }
  }
}

if (findings.length) {
  console.error("Potential tracked secrets found (values suppressed):");
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}
console.log(
  `Repository secret scan: PASS (${files.length} tracked/untracked files checked; values never printed)`,
);
