import { describe, expect, it } from "vitest";
import {
  checkEmailIntakeBoundary,
  effectiveEmailIntakeLowerBound,
  hardCutoffAt,
  nextSuccessfulWatermark,
  validateCareerAgentEmailIntakeContract,
} from "@/lib/automation/career-agent-email-intake-policy";

describe("Career Agent email intake safety contract", () => {
  it("passes the mandatory QA contract", () => {
    expect(validateCareerAgentEmailIntakeContract()).toEqual([]);
  });

  it("uses Terry's explicit first-run cutoff when no successful scan exists", () => {
    expect(hardCutoffAt()).toBe("2026-09-27T11:07:00+08:00");
    expect(effectiveEmailIntakeLowerBound(null)).toBe("2026-09-27T11:07:00+08:00");
  });

  it("blocks connector intake when the current provider watermark is missing", () => {
    expect(checkEmailIntakeBoundary({
      receivedAt: "2026-09-27T09:30:01Z",
      lastSuccessfulScanAt: null,
      requireWatermark: true,
    })).toMatchObject({ allowed: false, reason: "missing-watermark" });
  });

  it("rejects every historical message at or before the hard cutoff regardless of unread state", () => {
    expect(checkEmailIntakeBoundary({
      receivedAt: "2026-09-27T03:06:59Z",
      lastSuccessfulScanAt: null,
    })).toMatchObject({ allowed: false, reason: "before-hard-cutoff" });

    expect(checkEmailIntakeBoundary({
      receivedAt: "2026-09-27T03:07:00Z",
      lastSuccessfulScanAt: null,
    })).toMatchObject({ allowed: false, reason: "before-hard-cutoff" });
  });

  it("accepts only messages strictly after the provider's last successful watermark", () => {
    expect(checkEmailIntakeBoundary({
      receivedAt: "2026-09-27T09:30:01Z",
      lastSuccessfulScanAt: "2026-09-27T09:30:00Z",
    })).toMatchObject({ allowed: true });

    expect(checkEmailIntakeBoundary({
      receivedAt: "2026-09-27T09:30:00Z",
      lastSuccessfulScanAt: "2026-09-27T09:30:00Z",
    })).toMatchObject({ allowed: false, reason: "already-covered" });
  });

  it("does not advance a watermark after a failed mailbox scan", () => {
    expect(nextSuccessfulWatermark({
      currentLastSuccessAt: "2026-09-27T09:30:00Z",
      scanCompletedAt: "2026-09-27T21:00:00Z",
      succeeded: false,
    })).toBe("2026-09-27T09:30:00.000Z");
  });

  it("advances only the successful provider watermark to the later completion time", () => {
    expect(nextSuccessfulWatermark({
      currentLastSuccessAt: "2026-09-27T09:30:00Z",
      scanCompletedAt: "2026-09-27T21:00:00Z",
      succeeded: true,
    })).toBe("2026-09-27T21:00:00.000Z");
  });
});
