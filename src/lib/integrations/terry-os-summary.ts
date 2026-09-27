import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { countPendingEmailCandidates } from "@/lib/db/queries";

export type TerryOsCareerSummary = {
  schemaVersion: 1;
  status: "idle" | "working" | "waiting_for_terry" | "blocked" | "completed";
  health: "ok" | "warning" | "error" | "unknown";
  needsTerry: number;
  taskCode: "idle" | "reviewing" | "awaiting_review" | "blocked" | "completed";
  updatedAt: string;
};

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
let started = false;

export function defaultTerryOsCareerSummaryPath(): string {
  return path.join(homedir(), ".terry-os", "runtime", "career-summary.json");
}

export function terryOsCareerSummaryPath(): string | null {
  const configured = process.env.JST_TERRY_OS_SUMMARY_FILE?.trim();
  if (configured?.toLowerCase() === "off") return null;
  return configured || defaultTerryOsCareerSummaryPath();
}

export function buildTerryOsCareerSummary(
  pendingReviewCount: number,
  updatedAt = new Date().toISOString(),
): TerryOsCareerSummary {
  if (!Number.isSafeInteger(pendingReviewCount) || pendingReviewCount < 0) {
    throw new Error("Pending review count must be a non-negative integer");
  }

  if (pendingReviewCount > 0) {
    return {
      schemaVersion: 1,
      status: "waiting_for_terry",
      health: "ok",
      needsTerry: pendingReviewCount,
      taskCode: "awaiting_review",
      updatedAt,
    };
  }

  return {
    schemaVersion: 1,
    status: "idle",
    health: "ok",
    needsTerry: 0,
    taskCode: "idle",
    updatedAt,
  };
}

function buildBlockedSummary(updatedAt = new Date().toISOString()): TerryOsCareerSummary {
  return {
    schemaVersion: 1,
    status: "blocked",
    health: "error",
    needsTerry: 0,
    taskCode: "blocked",
    updatedAt,
  };
}

async function writePrivateJsonAtomically(filePath: string, value: TerryOsCareerSummary): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeTerryOsCareerSummary(options: {
  filePath?: string | null;
  pendingCount?: () => number;
  now?: () => string;
} = {}): Promise<TerryOsCareerSummary | null> {
  const filePath = options.filePath === undefined ? terryOsCareerSummaryPath() : options.filePath;
  if (!filePath) return null;

  const now = options.now ?? (() => new Date().toISOString());
  const pendingCount = options.pendingCount ?? countPendingEmailCandidates;

  let summary: TerryOsCareerSummary;
  try {
    summary = buildTerryOsCareerSummary(pendingCount(), now());
  } catch {
    summary = buildBlockedSummary(now());
  }

  await writePrivateJsonAtomically(filePath, summary);
  return summary;
}

export async function refreshTerryOsCareerSummary(): Promise<boolean> {
  try {
    await writeTerryOsCareerSummary();
    return true;
  } catch {
    console.warn("[terry-os-summary] refresh failed");
    return false;
  }
}

export function startTerryOsCareerSummaryExporter(): void {
  if (started || terryOsCareerSummaryPath() === null) return;
  started = true;

  void refreshTerryOsCareerSummary();

  const configured = Number(process.env.JST_TERRY_OS_SUMMARY_REFRESH_MS ?? DEFAULT_REFRESH_MS);
  const refreshMs = Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_REFRESH_MS;

  const timer = setInterval(() => void refreshTerryOsCareerSummary(), refreshMs);
  timer.unref?.();
}
