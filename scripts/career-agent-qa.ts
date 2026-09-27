import { validateCareerAgentEmailIntakeContract } from "../src/lib/automation/career-agent-email-intake-policy";

const errors = validateCareerAgentEmailIntakeContract();

if (errors.length > 0) {
  console.error("BLOCK — Career Agent automation contract failed QA:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("PASS — Career Agent automation contract");
console.log("- incremental mailbox intake only");
console.log("- explicit first-run cutoff");
console.log("- per-provider durable watermarks");
console.log("- failed scans do not advance watermarks");
console.log("- no historical backfill by default");
console.log("- zero-cost / no billing-backed infrastructure");
console.log("- no scoring, tailoring, or applying during intake");
