import { createHash } from "node:crypto";
import {
  getPendingEmailCandidatesByIds,
  logActivity,
  savePendingEmailCandidates,
} from "@/lib/db/queries";
import type { PendingEmailJobCandidateInput } from "@/lib/db/types";

export type CareerAgentQueueRow = {
  queue_id: string;
  scanned_at: string;
  provider: string;
  message_id: string;
  company: string;
  title: string;
  location: string;
  salary: string;
  posting_url: string;
  source: string;
  snippet: string;
  status: string;
  imported_job_id: string;
  processed_at: string;
  last_error: string;
};

type BridgeResponse = {
  ok: boolean;
  rows?: CareerAgentQueueRow[];
  acknowledged?: number;
  error?: string;
};

type SyncDependencies = {
  fetchImpl?: typeof fetch;
  savePending?: (candidates: PendingEmailJobCandidateInput[]) => void;
  getPendingByIds?: (ids: string[]) => unknown[];
};

export type CareerAgentQueueSyncResult = {
  fetched: number;
  valid: number;
  queued: number;
  alreadyQueued: number;
  acknowledged: number;
  skipped: number;
};

const DEFAULT_POLL_MS = 5 * 60 * 1000;
const MIN_SNIPPET_DESCRIPTION_LENGTH = 100;
let started = false;

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 20);
}

function httpPostingUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function pendingCandidateIdForQueueId(queueId: string): string {
  return `career-agent-queue-${hash(queueId)}`;
}

export function queueRowToPendingCandidate(row: CareerAgentQueueRow): PendingEmailJobCandidateInput | null {
  const queueId = row.queue_id.trim();
  const company = row.company.trim();
  const position = row.title.trim();
  if (!queueId || !company || !position || row.status !== "Pending Review") return null;

  const directUrl = httpPostingUrl(row.posting_url);
  const unresolvedKey = hash(`${queueId}:${company}:${position}`);
  const localUrl = `email-alert://job/${unresolvedKey}`;
  const url = directUrl || localUrl;
  const location = row.location.trim() || "Not specified";
  const snippet = row.snippet.trim().slice(0, 1000);
  const provider = row.provider.trim() || "other";
  const messageId = row.message_id.trim() || queueId;
  const scannedAt = Number.isFinite(Date.parse(row.scanned_at)) ? new Date(row.scanned_at).toISOString() : new Date().toISOString();

  return {
    id: pendingCandidateIdForQueueId(queueId),
    batchId: `career-agent-sheet-${scannedAt.slice(0, 10)}`,
    emailSubject: `Career Agent intake: ${position} at ${company}`,
    emailFrom: provider,
    emailDate: scannedAt,
    sourceFilename: `career-agent-sheet-${provider}-${hash(messageId)}.message`,
    company,
    position,
    location,
    url,
    sourceUrl: url,
    originalPostingUrl: directUrl,
    jobDescription: snippet.length >= MIN_SNIPPET_DESCRIPTION_LENGTH ? snippet : "",
    salaryNotes: row.salary.trim() || "Not captured.",
    snippet,
    confidence: directUrl ? "high" : "low",
    extractionNotes: "Synced from Terry OS Google Sheet intake queue.",
    postingResolutionStatus: directUrl ? "resolved" : "needs_resolution",
    postingSearchQuery: [company, position, location, "job"].filter(Boolean).join(" "),
    candidateLinks: directUrl ? [directUrl] : [],
    discoveredAt: scannedAt,
    // The scheduled Career Agent scan already filters for relevance before writing
    // the private queue. Human approval still happens before the job enters Jobs.
    titleMatch: "good",
  };
}

function readBridgeConfig(): { url: string; token: string } | null {
  const url = (process.env.JST_CAREER_AGENT_QUEUE_URL ?? "").trim();
  const token = (process.env.JST_CAREER_AGENT_QUEUE_TOKEN ?? "").trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, token };
}

async function postBridge(
  url: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<BridgeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    const body = (await response.json()) as BridgeResponse;
    if (!body.ok) throw new Error(body.error || "Bridge returned an error");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncCareerAgentQueue(
  config = readBridgeConfig(),
  deps: SyncDependencies = {},
): Promise<CareerAgentQueueSyncResult> {
  if (!config) {
    return { fetched: 0, valid: 0, queued: 0, alreadyQueued: 0, acknowledged: 0, skipped: 0 };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const savePending = deps.savePending ?? savePendingEmailCandidates;
  const getPendingByIds = deps.getPendingByIds ?? getPendingEmailCandidatesByIds;

  const pending = await postBridge(config.url, {
    token: config.token,
    action: "pending",
  }, fetchImpl);

  const rows = Array.isArray(pending.rows) ? pending.rows : [];
  const candidates = rows
    .map(queueRowToPendingCandidate)
    .filter((candidate): candidate is PendingEmailJobCandidateInput => Boolean(candidate));

  const candidateIds = candidates.map((candidate) => candidate.id);
  const existingBefore = getPendingByIds(candidateIds).length;

  if (candidates.length > 0) {
    savePending(candidates);
  }

  const existingAfter = getPendingByIds(candidateIds).length;
  const queued = Math.max(0, existingAfter - existingBefore);
  const alreadyQueued = Math.max(0, candidates.length - queued);

  let acknowledged = 0;
  if (candidates.length > 0) {
    const ack = await postBridge(config.url, {
      token: config.token,
      action: "ack",
      queueIds: rows
        .filter((row) => queueRowToPendingCandidate(row))
        .map((row) => row.queue_id),
      processedAt: new Date().toISOString(),
    }, fetchImpl);
    acknowledged = Number(ack.acknowledged ?? 0);
  }

  const result = {
    fetched: rows.length,
    valid: candidates.length,
    queued,
    alreadyQueued,
    acknowledged,
    skipped: rows.length - candidates.length,
  };

  if (rows.length > 0) {
    logActivity(
      "career-agent-queue-sync",
      "google-sheet",
      `Career Agent queue sync received ${rows.length} rows and queued ${queued} new candidates`,
      result,
    );
  }

  return result;
}

export function startCareerAgentQueueSync() {
  if (started) return;
  const config = readBridgeConfig();
  if (!config) return;

  started = true;
  const pollMsRaw = Number(process.env.JST_CAREER_AGENT_QUEUE_POLL_MS ?? DEFAULT_POLL_MS);
  const pollMs = Number.isFinite(pollMsRaw) && pollMsRaw >= 60_000 ? pollMsRaw : DEFAULT_POLL_MS;

  const run = async () => {
    try {
      await syncCareerAgentQueue(config);
    } catch (error) {
      console.warn("[career-agent-queue] sync failed:", error);
    }
  };

  void run();
  const timer = setInterval(() => void run(), pollMs);
  timer.unref?.();
}
