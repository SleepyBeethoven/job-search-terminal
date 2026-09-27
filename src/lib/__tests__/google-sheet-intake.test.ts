import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let client: typeof import("@/lib/db/client");
let queries: typeof import("@/lib/db/queries");
let intake: typeof import("@/lib/scanner/google-sheet-intake");

function queueRow(status = "Pending Review") {
  return [
    "queue-1",
    "2026-09-27T05:00:00+08:00",
    "gmail",
    "gmail-message-123",
    "Acme AI",
    "AI Operations Specialist",
    "Sydney NSW",
    "AUD 90,000",
    "https://www.linkedin.com/jobs/view/123456?trackingId=abc",
    "LinkedIn Jobs",
    "A relevant AI operations role supporting bilingual quality workflows.",
    status,
    status === "Pending Review" ? "" : "em-existing",
    status === "Pending Review" ? "" : "2026-09-27T05:10:00+08:00",
    "",
  ];
}

beforeEach(async () => {
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "jst-sheet-intake-test-"));
  process.env.JST_DATABASE_PATH = path.join(directory, "test.sqlite");
  process.env.CAREER_INTAKE_SPREADSHEET_ID = "sheet-test-id";
  process.env.CAREER_INTAKE_SHEET_NAME = "Intake";
  process.env.GOOGLE_SHEETS_ACCESS_TOKEN = "test-token";
  client = await import("@/lib/db/client");
  queries = await import("@/lib/db/queries");
  intake = await import("@/lib/scanner/google-sheet-intake");
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.closeDatabase();
  delete process.env.JST_DATABASE_PATH;
  delete process.env.CAREER_INTAKE_SPREADSHEET_ID;
  delete process.env.CAREER_INTAKE_SHEET_NAME;
  delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  rmSync(directory, { recursive: true, force: true });
});

describe("Google Sheet intake queue", () => {
  it("maps the fixed queue columns into a pending email candidate", () => {
    const row = intake.parseSheetRows([queueRow()])[0];
    const candidate = intake.sheetRowToPendingCandidate(row);

    expect(candidate.company).toBe("Acme AI");
    expect(candidate.position).toBe("AI Operations Specialist");
    expect(candidate.location).toBe("Sydney NSW");
    expect(candidate.salaryNotes).toBe("AUD 90,000");
    expect(candidate.originalPostingUrl).toBe("https://www.linkedin.com/jobs/view/123456");
    expect(candidate.postingResolutionStatus).toBe("resolved");
    expect(candidate.candidateLinks).toEqual(["https://www.linkedin.com/jobs/view/123456"]);
    expect(candidate.sourceFilename).toContain("gmail-message-123");
  });

  it("queues Pending Review rows in JST and writes the queue outcome back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [queueRow()] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalUpdatedRows: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [queueRow("Queued in JST")] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await intake.syncGoogleSheetIntake({
      now: new Date("2026-09-27T05:10:00+08:00"),
    });

    expect(result).toMatchObject({
      scanned: 1,
      queued: 1,
      alreadyKnown: 0,
      errors: 0,
      pruned: 0,
    });
    const pending = queries.getPendingEmailCandidates();
    expect(pending).toHaveLength(1);
    expect(pending[0].company).toBe("Acme AI");
    expect(pending[0].position).toBe("AI Operations Specialist");

    const writeCall = fetchMock.mock.calls[1];
    expect(String(writeCall[0])).toContain("/values:batchUpdate");
    expect(String(writeCall[1]?.body)).toContain("Queued in JST");
  });

  it("does not requeue a posting already present in JST", async () => {
    queries.insertManualJob({
      id: "known-job",
      company: "Acme AI",
      title: "AI Operations Specialist",
      url: "https://www.linkedin.com/jobs/view/123456",
      rawDescription: "Existing job description",
      datePosted: "2026-09-27",
      firstSeenDate: "2026-09-27",
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [queueRow()] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalUpdatedRows: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [queueRow("Already known")] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await intake.syncGoogleSheetIntake({
      now: new Date("2026-09-27T05:10:00+08:00"),
    });

    expect(result.queued).toBe(0);
    expect(result.alreadyKnown).toBe(1);
    expect(queries.getPendingEmailCandidates()).toHaveLength(0);
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain("Already known");
  });

  it("prunes processed bridge rows after seven days", async () => {
    const processed = queueRow("Queued in JST");
    processed[13] = "2026-09-10T05:10:00+08:00";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [processed] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ clearedRanges: ["Intake!A2:O2"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await intake.syncGoogleSheetIntake({
      now: new Date("2026-09-27T05:10:00+08:00"),
    });

    expect(result.scanned).toBe(0);
    expect(result.pruned).toBe(1);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/values:batchClear");
  });
});
