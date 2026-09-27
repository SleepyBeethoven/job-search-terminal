import { describe, expect, it } from "vitest";
import {
  pendingCandidateIdForQueueId,
  queueRowToPendingCandidate,
  syncCareerAgentQueue,
  type CareerAgentQueueRow,
} from "@/lib/scanner/career-agent-queue-sync";

const ROW: CareerAgentQueueRow = {
  queue_id: "gmail:message-123:job-1",
  scanned_at: "2026-09-27T09:00:00Z",
  provider: "gmail",
  message_id: "message-123",
  company: "Example AI",
  title: "AI Quality Reviewer",
  location: "Sydney",
  salary: "",
  posting_url: "https://example.com/jobs/123",
  source: "LinkedIn",
  snippet: "Review bilingual AI outputs, follow quality guidelines, calibrate edge cases, and work with operations teams on consistent evaluation decisions.",
  status: "Pending Review",
  imported_job_id: "",
  processed_at: "",
  last_error: "",
};

describe("Career Agent Google Sheet queue bridge", () => {
  it("maps a lightweight queue row into the existing pending-review model", () => {
    const candidate = queueRowToPendingCandidate(ROW);
    expect(candidate).toMatchObject({
      id: pendingCandidateIdForQueueId(ROW.queue_id),
      company: "Example AI",
      position: "AI Quality Reviewer",
      location: "Sydney",
      originalPostingUrl: "https://example.com/jobs/123",
      postingResolutionStatus: "resolved",
      titleMatch: "good",
    });
    expect(candidate?.jobDescription).toContain("Review bilingual AI outputs");
  });

  it("keeps a row without a direct posting link in Pending Review for resolution", () => {
    const candidate = queueRowToPendingCandidate({ ...ROW, queue_id: "q2", posting_url: "" });
    expect(candidate).toMatchObject({
      postingResolutionStatus: "needs_resolution",
      originalPostingUrl: "",
      confidence: "low",
    });
    expect(candidate?.url.startsWith("email-alert://job/")).toBe(true);
  });

  it("writes locally before acknowledging the cloud row and is idempotent", async () => {
    const pendingIds = new Set<string>();
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push(body);
      if (body.action === "pending") {
        return new Response(JSON.stringify({ ok: true, rows: [ROW] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, acknowledged: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const deps = {
      fetchImpl,
      savePending: (candidates: Array<{ id: string }>) => {
        for (const candidate of candidates) pendingIds.add(candidate.id);
      },
      getPendingByIds: (ids: string[]) => ids.filter((id) => pendingIds.has(id)),
      logActivityFn: () => undefined,
    };

    const first = await syncCareerAgentQueue(
      { url: "https://script.google.com/macros/s/example/exec", token: "secret" },
      deps,
    );
    expect(first).toMatchObject({ fetched: 1, valid: 1, queued: 1, alreadyQueued: 0, acknowledged: 1 });
    expect(calls.map((call) => call.action)).toEqual(["pending", "ack"]);

    calls.length = 0;
    const second = await syncCareerAgentQueue(
      { url: "https://script.google.com/macros/s/example/exec", token: "secret" },
      deps,
    );
    expect(second).toMatchObject({ queued: 0, alreadyQueued: 1, acknowledged: 1 });
    expect(calls.map((call) => call.action)).toEqual(["pending", "ack"]);
  });

  it("does not acknowledge cloud rows if the local pending write fails", async () => {
    const actions: unknown[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      actions.push(body.action);
      return new Response(JSON.stringify({ ok: true, rows: [ROW] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(
      syncCareerAgentQueue(
        { url: "https://script.google.com/macros/s/example/exec", token: "secret" },
        {
          fetchImpl,
          savePending: () => {
            throw new Error("local write failed");
          },
          getPendingByIds: () => [],
          logActivityFn: () => undefined,
        },
      ),
    ).rejects.toThrow("local write failed");

    expect(actions).toEqual(["pending"]);
  });

  it("skips malformed or already-processed rows", () => {
    expect(queueRowToPendingCandidate({ ...ROW, queue_id: "", status: "Pending Review" })).toBeNull();
    expect(queueRowToPendingCandidate({ ...ROW, queue_id: "done", status: "Synced to JST" })).toBeNull();
  });
});
