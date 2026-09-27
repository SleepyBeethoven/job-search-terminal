import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildTerryOsCareerSummary,
  defaultTerryOsCareerSummaryPath,
  terryOsCareerSummaryPath,
  writeTerryOsCareerSummary,
} from "@/lib/integrations/terry-os-summary";

const originalPath = process.env.JST_TERRY_OS_SUMMARY_FILE;

afterEach(() => {
  if (originalPath === undefined) delete process.env.JST_TERRY_OS_SUMMARY_FILE;
  else process.env.JST_TERRY_OS_SUMMARY_FILE = originalPath;
});

describe("Terry OS Career summary exporter", () => {
  it("exports only the approved six summary fields", () => {
    const summary = buildTerryOsCareerSummary(3, "2026-09-27T13:30:00.000Z");
    expect(summary).toEqual({
      schemaVersion: 1,
      status: "waiting_for_terry",
      health: "ok",
      needsTerry: 3,
      taskCode: "awaiting_review",
      updatedAt: "2026-09-27T13:30:00.000Z",
    });
    expect(Object.keys(summary).sort()).toEqual([
      "health",
      "needsTerry",
      "schemaVersion",
      "status",
      "taskCode",
      "updatedAt",
    ]);
  });

  it("reports idle when there is nothing pending", () => {
    expect(buildTerryOsCareerSummary(0, "2026-09-27T13:30:00.000Z")).toMatchObject({
      status: "idle",
      health: "ok",
      needsTerry: 0,
      taskCode: "idle",
    });
  });

  it("writes a blocked summary rather than leaking an exception when the count cannot be read", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "jst-terry-os-"));
    const file = path.join(folder, "career-summary.json");
    try {
      const summary = await writeTerryOsCareerSummary({
        filePath: file,
        pendingCount: () => { throw new Error("private database detail"); },
        now: () => "2026-09-27T13:30:00.000Z",
      });
      expect(summary).toMatchObject({
        status: "blocked",
        health: "error",
        needsTerry: 0,
        taskCode: "blocked",
      });
      const raw = await readFile(file, "utf8");
      expect(raw).not.toContain("private database detail");
      expect(JSON.parse(raw)).toEqual(summary);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("uses a private user-home runtime path by default and supports an explicit opt-out", () => {
    delete process.env.JST_TERRY_OS_SUMMARY_FILE;
    expect(defaultTerryOsCareerSummaryPath()).toContain(path.join(".terry-os", "runtime", "career-summary.json"));
    expect(terryOsCareerSummaryPath()).toBe(defaultTerryOsCareerSummaryPath());

    process.env.JST_TERRY_OS_SUMMARY_FILE = "off";
    expect(terryOsCareerSummaryPath()).toBeNull();
  });
});
