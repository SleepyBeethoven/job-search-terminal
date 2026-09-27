import { closeDatabase } from "../src/lib/db/client";
import { runRetentionCleanup } from "../src/lib/retention/job-retention";

const vacuum = process.argv.includes("--vacuum");

try {
  const result = runRetentionCleanup({ vacuum });
  console.log(JSON.stringify({
    candidates: result.candidates,
    compacted: result.compacted,
    vacuum,
    jobs: result.jobs.map((job) => ({
      id: job.id,
      company: job.company,
      title: job.title,
      status: job.status,
      reason: job.reason,
      lastActivityAt: job.lastActivityAt,
    })),
  }, null, 2));
} finally {
  closeDatabase();
}
