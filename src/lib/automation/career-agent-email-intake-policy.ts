import contract from "../../../config/career-agent-email-intake.json";

export type CareerAgentEmailProvider = "gmail" | "outlook";

export type EmailIntakeBoundaryDecision =
  | { allowed: true; receivedAt: string; lowerBound: string }
  | { allowed: false; reason: "invalid-received-at" | "missing-watermark" | "before-hard-cutoff" | "already-covered"; lowerBound: string };

export function hardCutoffAt(): string {
  return contract.hardCutoffAt;
}

export function effectiveEmailIntakeLowerBound(lastSuccessfulScanAt?: string | null): string {
  const hardCutoffMs = Date.parse(contract.hardCutoffAt);
  const lastSuccessMs = lastSuccessfulScanAt ? Date.parse(lastSuccessfulScanAt) : Number.NaN;
  if (!Number.isFinite(lastSuccessMs)) return contract.hardCutoffAt;
  return lastSuccessMs > hardCutoffMs ? new Date(lastSuccessMs).toISOString() : contract.hardCutoffAt;
}

export function checkEmailIntakeBoundary(input: {
  receivedAt: string;
  lastSuccessfulScanAt?: string | null;
  requireWatermark?: boolean;
}): EmailIntakeBoundaryDecision {
  const receivedMs = Date.parse(input.receivedAt);
  const hasValidWatermark = Boolean(input.lastSuccessfulScanAt) && Number.isFinite(Date.parse(input.lastSuccessfulScanAt ?? ""));
  const lowerBound = effectiveEmailIntakeLowerBound(input.lastSuccessfulScanAt);
  const lowerBoundMs = Date.parse(lowerBound);

  if (input.requireWatermark && !hasValidWatermark) {
    return { allowed: false, reason: "missing-watermark", lowerBound };
  }
  if (!Number.isFinite(receivedMs)) {
    return { allowed: false, reason: "invalid-received-at", lowerBound };
  }
  if (receivedMs <= Date.parse(contract.hardCutoffAt)) {
    return { allowed: false, reason: "before-hard-cutoff", lowerBound };
  }
  if (receivedMs <= lowerBoundMs) {
    return { allowed: false, reason: "already-covered", lowerBound };
  }

  return { allowed: true, receivedAt: new Date(receivedMs).toISOString(), lowerBound };
}

export function nextSuccessfulWatermark(input: {
  currentLastSuccessAt?: string | null;
  scanCompletedAt: string;
  succeeded: boolean;
}): string {
  const current = effectiveEmailIntakeLowerBound(input.currentLastSuccessAt);
  if (!input.succeeded) return current;

  const completedMs = Date.parse(input.scanCompletedAt);
  if (!Number.isFinite(completedMs)) return current;
  const currentMs = Date.parse(current);
  return completedMs > currentMs ? new Date(completedMs).toISOString() : current;
}

export function validateCareerAgentEmailIntakeContract(): string[] {
  const errors: string[] = [];
  const cutoff = Date.parse(contract.hardCutoffAt);

  if (contract.mode !== "incremental-only") errors.push("mode must remain incremental-only");
  if (!Number.isFinite(cutoff)) errors.push("hardCutoffAt must be a valid timestamp");
  if (contract.rules.historicalBackfillByDefault !== false) errors.push("historical backfill must be disabled by default");
  if (contract.rules.readUnreadIsBoundary !== false) errors.push("read/unread status must not define the intake boundary");
  if (contract.rules.advanceWatermarkOnlyOnSuccess !== true) errors.push("watermark must advance only after a successful scan");
  if (contract.rules.providerFailuresAreIndependent !== true) errors.push("mailbox provider failures must remain independent");
  if (contract.rules.apiRequiresWatermark !== true) errors.push("connected-mail API must require a provider watermark");
  if (contract.rules.storeFullEmailBody !== false) errors.push("queue must not store full email bodies");
  if (contract.rules.storeFullJobDescriptionInQueue !== false) errors.push("queue must not store full job descriptions");
  if (contract.rules.autoScore || contract.rules.autoTailor || contract.rules.autoApply) {
    errors.push("email intake must stop before score, tailoring, or application");
  }
  if (!contract.qa.mandatory) errors.push("mandatory QA gate cannot be disabled");
  if (contract.bridge.transport !== "google-apps-script-web-app") errors.push("Career Agent bridge must use the approved Apps Script transport");
  if (contract.bridge.auth !== "shared-secret-post-body") errors.push("Career Agent bridge secret must travel in the POST body");
  if (contract.bridge.enabledByEnvironment !== true) errors.push("Career Agent bridge must be opt-in through environment configuration");
  if (contract.bridge.autoSyncTarget !== "pending-review") errors.push("Career Agent bridge may sync only to Pending Review");
  if (contract.bridge.ackOnlyAfterLocalQueueWrite !== true) errors.push("Career Agent bridge may acknowledge only after local queue write");
  if (contract.bridge.zeroCostRequired !== true) errors.push("Career Agent bridge must remain zero-cost");
  if (contract.providers.length !== 2 || !contract.providers.includes("gmail") || !contract.providers.includes("outlook")) {
    errors.push("gmail and outlook must both have independent watermarks");
  }

  return errors;
}
