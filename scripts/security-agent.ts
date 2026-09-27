import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanSecurityEntries, securityVerdict, validateSecurityPolicy, type SecurityScanEntry } from "../src/lib/security/security-agent";

const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
]);

const entries: SecurityScanEntry[] = paths.map((filePath) => {
  const lower = filePath.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (binaryExtensions.has(ext)) return { path: filePath };
  try {
    return { path: filePath, content: readFileSync(filePath, "utf8") };
  } catch {
    return { path: filePath };
  }
});

const policy = JSON.parse(readFileSync("config/security-agent.json", "utf8")) as unknown;
const findings = [...scanSecurityEntries(entries), ...validateSecurityPolicy(policy)];
const verdict = securityVerdict(findings);

if (findings.length === 0) {
  console.log("PASS — Security Agent v0.2");
  console.log("- no tracked runtime user data");
  console.log("- no obvious personal mailbox addresses");
  console.log("- no private Google Sheet identifier in public code");
  console.log("- no common hard-coded credential pattern detected");
  console.log("- Internet Safety Baseline v2 is enabled
- mailbox intake is metadata-first and excludes junk/deleted folders
- external content cannot override agent instructions
- GitHub public-repo secret scanning remains a second layer");
  process.exit(0);
}

console.error(`${verdict} — Security Agent v0.2`);
for (const finding of findings) {
  console.error(`- [${finding.rule}] ${finding.path}: ${finding.detail}`);
}
process.exit(verdict === "BLOCK" ? 1 : 0);
