import { describe, expect, it } from "vitest";
import { estimateResumeBudget } from "@/lib/documents/resume-budget";
import type { ResumeBuilderSection, ResumeSectionModeInput } from "@/lib/db/types";

const sections: ResumeBuilderSection[] = [
  { id: "header", type: "header", title: "Header", header: { name: "Terry", headline: "", contactItems: [] } },
  { id: "summary", type: "summary", title: "Summary", text: "Bilingual operations professional." },
  {
    id: "experience",
    type: "experience",
    title: "Experience",
    experience: [
      { title: "Role A", organization: "A", dateRange: "2025", bullets: ["Did one thing.", "Did another thing."] },
      { title: "Role B", organization: "B", dateRange: "2024", bullets: ["Improved a workflow."] },
    ],
  },
  { id: "skills", type: "skills", title: "Skills", items: ["Salesforce", "Excel", "Mandarin"] },
];

const lightModes: ResumeSectionModeInput[] = [
  { sectionId: "header", mode: "keep" },
  { sectionId: "summary", mode: "update" },
  { sectionId: "experience", mode: "keep" },
  { sectionId: "skills", mode: "update" },
];

const fullModes: ResumeSectionModeInput[] = [
  { sectionId: "header", mode: "keep" },
  { sectionId: "summary", mode: "update" },
  { sectionId: "experience", mode: "update" },
  { sectionId: "skills", mode: "update" },
];

function estimate(sectionModes: ResumeSectionModeInput[], budgetTokens = 50_000) {
  return estimateResumeBudget({
    jobText: "CRM Operations Specialist ".repeat(120),
    resumeText: "Approved resume evidence ".repeat(160),
    evaluationText: "Evaluation and profile context ".repeat(80),
    sections,
    sectionModes,
    budgetTokens,
  });
}

describe("resume token preflight", () => {
  it("counts Light Tailor as summary plus skills only", () => {
    const result = estimate(lightModes);
    expect(result.unitCount).toBe(2);
  });

  it("counts each experience role as a separate Full Tailor writer unit", () => {
    const result = estimate(fullModes);
    expect(result.unitCount).toBe(4);
  });

  it("estimates Full Tailor above Light Tailor for the same job and lane", () => {
    expect(estimate(fullModes).highTokens).toBeGreaterThan(estimate(lightModes).highTokens);
  });

  it("blocks when the conservative upper estimate exceeds the ceiling by more than 25%", () => {
    expect(estimate(fullModes, 1_000).status).toBe("over_budget");
  });

  it("never reports a single exact token figure", () => {
    const result = estimate(lightModes);
    expect(result.highTokens).toBeGreaterThan(result.lowTokens);
  });
});
