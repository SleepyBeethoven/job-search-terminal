import { createHash } from "node:crypto";
import {
  getJobById,
  getJobByUrl,
  savePendingEmailCandidates,
} from "@/lib/db/queries";
import type { PendingEmailJobCandidateInput } from "@/lib/db/types";
import { canonicalizeJobPostingUrl } from "@/lib/scanner/email-job-alert-importer";

const DEFAULT_SHEET_NAME = "Intake";
const DEFAULT_RETENTION_DAYS = 7;
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export type SheetIntakeRow = {
  rowNumber: number;
  queueId: string;
  scannedAt: string;
  provider: string;
  messageId: string;
  company: string;
  title: string;
  location: string;
  salary: string;
  postingUrl: string;
  source: string;
  snippet: string;
  status: string;
  importedJobId: string;
  processedAt: string;
  lastError: string;
};

export type SheetIntakeSyncResult = {
  scanned: number;
  queued: number;
  alreadyKnown: number;
  errors: number;
  pruned: number;
};

type GoogleTokenResponse = {
  access_token?: string;
};

type SheetsValuesResponse = {
  values?: unknown[][];
};

function requiredSpreadsheetId(): string {
  const value = process.env.CAREER_INTAKE_SPREADSHEET_ID?.trim();
  if (!value) {
    throw new Error("CAREER_INTAKE_SPREADSHEET_ID is required.");
  }
  return value;
}

function sheetName(): string {
  return process.env.CAREER_INTAKE_SHEET_NAME?.trim() || DEFAULT_SHEET_NAME;
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function parseSheetRows(values: unknown[][]): SheetIntakeRow[] {
  return values
    .map((row, index) => ({
      rowNumber: index + 2,
      queueId: asText(row[0]),
      scannedAt: asText(row[1]),
      provider: asText(row[2]),
      messageId: asText(row[3]),
      company: asText(row[4]),
      title: asText(row[5]),
      location: asText(row[6]),
      salary: asText(row[7]),
      postingUrl: asText(row[8]),
      source: asText(row[9]),
      snippet: asText(row[10]),
      status: asText(row[11]),
      importedJobId: asText(row[12]),
      processedAt: asText(row[13]),
      lastError: asText(row[14]),
    }))
    .filter((row) => row.queueId || row.company || row.title || row.postingUrl);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stableSheetJobId(row: SheetIntakeRow, canonicalUrl: string): string {
  const identity = canonicalUrl || [
    row.queueId,
    row.provider,
    row.messageId,
    row.company,
    row.title,
    row.location,
  ].join(":");
  return `em-${createHash("sha1").update(`sheet:${identity}`).digest("hex").slice(0, 16)}`;
}

export function sheetRowToPendingCandidate(row: SheetIntakeRow): PendingEmailJobCandidateInput {
  const canonicalUrl = isHttpUrl(row.postingUrl)
    ? canonicalizeJobPostingUrl(row.postingUrl)
    : "";
  const id = stableSheetJobId(row, canonicalUrl);
  const fallbackUrl = `email-alert://job/${id.replace(/^em-/, "")}`;
  const resolved = Boolean(canonicalUrl);
  const url = canonicalUrl || fallbackUrl;
  const provider = ["gmail", "outlook"].includes(row.provider.toLowerCase())
    ? row.provider.toLowerCase()
    : "other";

  return {
    id,
    batchId: `sheet-batch-${createHash("sha1").update(row.scannedAt || row.queueId || id).digest("hex").slice(0, 16)}`,
    emailSubject: row.title || "Queued job alert",
    emailFrom: row.source || provider,
    emailDate: row.scannedAt,
    sourceFilename: `sheet-${provider}-${row.messageId || row.queueId || id}.queue`,
    company: row.company || "Unknown company",
    position: row.title || "Unknown role",
    location: row.location || "Not specified",
    url,
    sourceUrl: url,
    originalPostingUrl: canonicalUrl,
    jobDescription: row.snippet.length >= 100 ? row.snippet : "",
    salaryNotes: row.salary,
    snippet: row.snippet.slice(0, 1500),
    confidence: resolved ? "high" : "low",
    extractionNotes: resolved
      ? "Structured lead received through Terry OS Google Sheet intake queue."
      : "Structured lead received through Terry OS queue without a direct posting URL.",
    postingResolutionStatus: resolved ? "resolved" : "needs_resolution",
    postingSearchQuery: [row.company, row.title, row.location, "job"].filter(Boolean).join(" "),
    candidateLinks: canonicalUrl ? [canonicalUrl] : [],
    discoveredAt: row.scannedAt || new Date().toISOString(),
    titleMatch: "unknown",
  };
}

async function getAccessToken(): Promise<string> {
  const envToken = process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;

  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Could not obtain Google Compute service-account token: ${response.status}`);
  }
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!payload.access_token) throw new Error("Google metadata token response had no access_token.");
  return payload.access_token;
}

async function sheetsFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${requiredSpreadsheetId()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readQueueRows(token: string): Promise<SheetIntakeRow[]> {
  const range = encodeURIComponent(`${sheetName()}!A2:O`);
  const response = await sheetsFetch(token, `/values/${range}?majorDimension=ROWS`);
  if (!response.ok) {
    throw new Error(`Google Sheets queue read failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as SheetsValuesResponse;
  return parseSheetRows(payload.values ?? []);
}

async function writeRowOutcomes(
  token: string,
  updates: Array<{
    rowNumber: number;
    status: string;
    importedJobId: string;
    processedAt: string;
    lastError: string;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const data = updates.map((update) => ({
    range: `${sheetName()}!L${update.rowNumber}:O${update.rowNumber}`,
    majorDimension: "ROWS",
    values: [[update.status, update.importedJobId, update.processedAt, update.lastError]],
  }));
  const response = await sheetsFetch(token, "/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data }),
  });
  if (!response.ok) {
    throw new Error(`Google Sheets outcome write failed: ${response.status} ${await response.text()}`);
  }
}

function findKnownJob(candidate: PendingEmailJobCandidateInput): string {
  const byId = getJobById(candidate.id);
  if (byId) return byId.id;
  if (candidate.originalPostingUrl) {
    const byUrl = getJobByUrl(candidate.originalPostingUrl);
    if (byUrl) return byUrl.id;
  }
  return "";
}

function olderThan(dateText: string, now: Date, days: number): boolean {
  const millis = Date.parse(dateText);
  return Number.isFinite(millis) && millis <= now.getTime() - days * 86_400_000;
}

async function pruneProcessedRows(
  token: string,
  rows: SheetIntakeRow[],
  now: Date,
  retentionDays: number,
): Promise<number> {
  const ranges = rows
    .filter((row) => row.status && row.status !== "Pending Review")
    .filter((row) => olderThan(row.processedAt || row.scannedAt, now, retentionDays))
    .map((row) => `${sheetName()}!A${row.rowNumber}:O${row.rowNumber}`);

  if (ranges.length === 0) return 0;
  const response = await sheetsFetch(token, "/values:batchClear", {
    method: "POST",
    body: JSON.stringify({ ranges }),
  });
  if (!response.ok) {
    throw new Error(`Google Sheets queue prune failed: ${response.status} ${await response.text()}`);
  }
  return ranges.length;
}

export async function syncGoogleSheetIntake(options: {
  now?: Date;
  retentionDays?: number;
} = {}): Promise<SheetIntakeSyncResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const token = await getAccessToken();
  const rows = await readQueueRows(token);
  const pendingRows = rows.filter((row) => row.status === "Pending Review");

  const updates: Array<{
    rowNumber: number;
    status: string;
    importedJobId: string;
    processedAt: string;
    lastError: string;
  }> = [];
  let queued = 0;
  let alreadyKnown = 0;
  let errors = 0;

  for (const row of pendingRows) {
    try {
      if (!row.company || !row.title) {
        throw new Error("company and title are required");
      }
      const candidate = sheetRowToPendingCandidate(row);
      const knownJobId = findKnownJob(candidate);
      if (knownJobId) {
        alreadyKnown += 1;
        updates.push({
          rowNumber: row.rowNumber,
          status: "Already known",
          importedJobId: knownJobId,
          processedAt: now.toISOString(),
          lastError: "",
        });
        continue;
      }

      savePendingEmailCandidates([candidate]);
      queued += 1;
      updates.push({
        rowNumber: row.rowNumber,
        status: "Queued in JST",
        importedJobId: candidate.id,
        processedAt: now.toISOString(),
        lastError: "",
      });
    } catch (error) {
      errors += 1;
      updates.push({
        rowNumber: row.rowNumber,
        status: "Error",
        importedJobId: "",
        processedAt: now.toISOString(),
        lastError: String(error).slice(0, 500),
      });
    }
  }

  await writeRowOutcomes(token, updates);
  const refreshedRows = updates.length > 0 ? await readQueueRows(token) : rows;
  const pruned = await pruneProcessedRows(token, refreshedRows, now, retentionDays);

  return {
    scanned: pendingRows.length,
    queued,
    alreadyKnown,
    errors,
    pruned,
  };
}
