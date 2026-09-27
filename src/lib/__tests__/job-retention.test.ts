import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-27T12:00:00Z");
let directory: string;
let client: typeof import("@/lib/db/client");
let q: typeof import("@/lib/db/queries");
let retention: typeof import("@/lib/retention/job-retention");

beforeEach(async () => {
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "jst-retention-test-"));
  process.env.JST_DATABASE_PATH = path.join(directory, "test.sqlite");
  client = await import("@/lib/db/client");
  q = await import("@/lib/db/queries");
  retention = await import("@/lib/retention/job-retention");
});

afterEach(() => {
  client.closeDatabase();
  delete process.env.JST_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function addJob(id: string, status: string, ageDays: number) {
  q.insertScannedJobs([{
    id,
    company: "Acme",
    title: "AI Operations Specialist",
    url: `https://example.com/jobs/${id}`,
    source: "email-alert",
    location: "Remote",
    datePosted: null,
    firstSeenDate: "2026-09-01",
  }]);
  const db = client.getDatabase();
  db.prepare(
    "update jobs set status = ?, raw_description = 'large jd', parsed_description = 'large jd', created_at = datetime(?, ?), updated_at = datetime(?, ?) where id = ?"
  ).run(
    status,
    NOW.toISOString(),
    `-${ageDays} days`,
    NOW.toISOString(),
    `-${ageDays} days`,
    id
  );
  // Imports record activity too. Keep the fixture's complete activity clock in
  // sync with the backdated job so retention is testing policy age rather than
  // being kept alive by today's synthetic import event.
  db.prepare(
    "update activity_log set timestamp = datetime(?, ?) where entity_id = ?"
  ).run(NOW.toISOString(), `-${ageDays} days`, id);
}

describe("Career Agent retention policy", () => {
  it("compacts rejected and skipped jobs at the next cleanup", () => {
    addJob("rejected", "Rejected", 0);
    addJob("skipped", "Skipped", 0);
    const ids = retention.listRetentionCandidates(NOW).map((job) => job.id);
    expect(ids).toEqual(expect.arrayContaining(["rejected", "skipped"]));
  });

  it("keeps early-stage jobs for seven days, then compacts them", () => {
    addJob("six-days", "Reviewed", 6);
    addJob("eight-days", "Reviewed", 8);
    const ids = retention.listRetentionCandidates(NOW).map((job) => job.id);
    expect(ids).not.toContain("six-days");
    expect(ids).toContain("eight-days");
  });

  it("keeps active application stages for 30 days", () => {
    addJob("twenty-nine", "Interviewing", 29);
    addJob("thirty-one", "Interviewing", 31);
    const ids = retention.listRetentionCandidates(NOW).map((job) => job.id);
    expect(ids).not.toContain("twenty-nine");
    expect(ids).toContain("thirty-one");
  });

  it("never compacts pinned jobs", () => {
    addJob("pinned", "Rejected", 10);
    q.setJobRetentionPinned("pinned", true);
    client.getDatabase().prepare("update jobs set updated_at = datetime(?, '-10 days') where id = 'pinned'").run(NOW.toISOString());
    expect(retention.listRetentionCandidates(NOW).map((job) => job.id)).not.toContain("pinned");
  });

  it("removes heavy data but keeps the job tombstone for dedupe and outcome history", () => {
    addJob("old-role", "Reviewed", 8);
    const db = client.getDatabase();
    db.prepare(
      "insert into applications (id, job_id, company, role, status, applied_date, follow_up_date, notes, contact, response_status, fit_score, created_at, updated_at) values ('app-old', 'old-role', 'Acme', 'AI Operations Specialist', 'Reviewed', null, '', 'large notes', '', 'Reviewed', 80, datetime(?, '-8 days'), datetime(?, '-8 days'))"
    ).run(NOW.toISOString(), NOW.toISOString());

    const candidate = retention.listRetentionCandidates(NOW).find((job) => job.id === "old-role");
    expect(candidate).toBeTruthy();
    expect(retention.compactJobForRetention(candidate!, NOW)).toBe(true);

    const row = db.prepare(
      "select company, title, url, status, raw_description, parsed_description, archived, retention_compacted_at, retention_last_activity_at, retention_reason from jobs where id = 'old-role'"
    ).get() as Record<string, unknown>;

    expect(row).toMatchObject({
      company: "Acme",
      title: "AI Operations Specialist",
      url: "https://example.com/jobs/old-role",
      status: "Reviewed",
      raw_description: "",
      parsed_description: "",
      archived: 1,
      retention_reason: "early-stage-stale",
    });
    expect(String(row.retention_compacted_at)).not.toBe("");
    expect(String(row.retention_last_activity_at)).not.toBe("");
    expect(db.prepare("select count(*) as n from applications where job_id = 'old-role'").get()).toMatchObject({ n: 0 });
    expect(q.getJobDedupKeys().urls.has("https://example.com/jobs/old-role")).toBe(true);
  });
});
