import { existsSync } from "node:fs";
import { validateCareerAgentEmailIntakeContract } from "../src/lib/automation/career-agent-email-intake-policy";

const errors = validateCareerAgentEmailIntakeContract();

if (existsSync("deploy/google-cloud")) {
  errors.push("billing-backed Google Cloud deployment files must not ship in the zero-cost Career Agent plan");
}

if (errors.length > 0) {
  console.error("BLOCK — Career Agent automation contract failed QA:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("PASS — Career Agent automation contract");
console.log("- incremental mailbox intake only");
console.log("- explicit first-run cutoff");
console.log("- per-provider durable watermarks");
console.log("- connector API requires the current provider watermark");
console.log("- zero-cost Apps Script bridge is opt-in and syncs only to Pending Review");
console.log("- cloud rows are acknowledged only after a successful local queue write");
console.log("- failed scans do not advance watermarks");
console.log("- no historical backfill by default");
console.log("- Gmail excludes Spam/Trash; Outlook excludes Junk/Deleted");
console.log("- metadata-first filtering; no broad personal-mail read");
console.log("- no attachment open, link follow, or instruction following from email content");
console.log("- zero-cost / no billing-backed infrastructure");
console.log("- no scoring, tailoring, or applying during intake");
