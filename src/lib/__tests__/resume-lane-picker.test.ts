import { describe, expect, it } from "vitest";
import { coerceResumeBaseToLane, pickResumeBase } from "@/lib/evaluation/resume-lane-picker";

const lanes = [
  "R1 — AI Quality / Evaluation",
  "R2 — AI Operations / Reviewer Lead / Training & Onboarding",
  "R3 — CRM / Customer Lifecycle / Engagement Operations",
  "R4 — Project / Business Operations",
  "R5 — China Market / Bilingual Operations",
];

describe("Terry OS resume lane routing", () => {
  it.each([
    ["Bilingual AI Evaluator - Mandarin", lanes[0]],
    ["AI Quality Analyst / Annotation QA", lanes[0]],
    ["Reviewer Lead, AI Operations", lanes[1]],
    ["Calibration and Training Lead", lanes[1]],
    ["CRM Operations Specialist - Salesforce", lanes[2]],
    ["Customer Lifecycle & Engagement Manager", lanes[2]],
    ["Project Coordinator - Process Improvement", lanes[3]],
    ["Business Operations Coordinator", lanes[3]],
    ["Mandarin Bilingual Operations Specialist", lanes[4]],
    ["China Market Operations - WeCom", lanes[4]],
  ])("routes %s to %s", (archetype, expected) => {
    expect(pickResumeBase(archetype, lanes)).toBe(expected);
  });

  it("uses the role archetype to refine a generic stored recommendation", () => {
    expect(
      coerceResumeBaseToLane(
        "Operations",
        "CRM Operations Specialist with Salesforce and customer lifecycle ownership",
        lanes
      )
    ).toBe(lanes[2]);
  });

  it("keeps a manually saved valid lane", () => {
    expect(
      coerceResumeBaseToLane(
        lanes[4],
        "CRM Operations Specialist",
        lanes
      )
    ).toBe(lanes[4]);
  });

  it("preserves the upstream generic fallback for non-Terry lane sets", () => {
    const generic = ["Leadership Resume", "Operations Resume"];
    expect(pickResumeBase("Operations Manager", generic)).toBe("Operations Resume");
  });
});
