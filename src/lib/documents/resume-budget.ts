import type { ResumeBuilderSection, ResumeSectionModeInput } from "../db/types";

export type ResumeBudgetStatus = "within_budget" | "near_budget" | "over_budget";

export type ResumeBudgetEstimate = {
  lowTokens: number;
  highTokens: number;
  budgetTokens: number;
  status: ResumeBudgetStatus;
  unitCount: number;
  sharedContextTokens: number;
  preparationAllowanceTokens: number;
};

export type ResumeBudgetInput = {
  jobText: string;
  resumeText: string;
  evaluationText: string;
  sections: ResumeBuilderSection[];
  sectionModes: ResumeSectionModeInput[];
  budgetTokens: number;
};

/** Rough tokenizer for preflight only. It intentionally returns a range, never a bill. */
export function approxTokens(text: string): number {
  const asciiChars = [...text].filter((char) => char.charCodeAt(0) < 128).length;
  const nonAsciiChars = text.length - asciiChars;
  return Math.ceil(asciiChars / 4 + nonAsciiChars / 1.8);
}

function roundUp(value: number): number {
  const step = value < 10_000 ? 500 : 1_000;
  return Math.ceil(value / step) * step;
}

function updateModeById(sectionModes: ResumeSectionModeInput[]): Map<string, ResumeSectionModeInput["mode"]> {
  return new Map(sectionModes.map((entry) => [entry.sectionId, entry.mode]));
}

function sectionUnitCount(section: ResumeBuilderSection): number {
  if (section.type === "experience") {
    return Math.max(0, section.experience?.filter((entry) => entry.bullets.length > 0).length ?? 0);
  }
  if (section.type === "summary") return section.text?.trim() ? 1 : 1;
  if (section.type === "skills") return (section.items?.length ?? 0) > 0 ? 1 : 0;
  if (section.type === "impact" || section.type === "recognition" || section.type === "custom") {
    return (section.items?.length ?? 0) > 0 || Boolean(section.text?.trim()) ? 1 : 0;
  }
  return 0;
}

export function estimateResumeBudget(input: ResumeBudgetInput): ResumeBudgetEstimate {
  const modes = updateModeById(input.sectionModes);
  const updatedSections = input.sections.filter((section) => modes.get(section.id) === "update");
  const unitCount = updatedSections.reduce((total, section) => total + sectionUnitCount(section), 0);

  // Each writer unit receives the same approved-resume + posting + evaluation prefix.
  // The constant covers the writer's static truth/style instructions and prompt framing.
  const sharedContextTokens =
    approxTokens(input.jobText) +
    approxTokens(input.resumeText) +
    approxTokens(input.evaluationText) +
    2_000;

  const selectedSectionTokens = approxTokens(JSON.stringify(updatedSections));
  const unitTaskTokens = selectedSectionTokens + unitCount * 350;
  const outputAllowance = unitCount * 500;

  // Lower bound assumes provider/local prefix caching after the first writer call and
  // an already reusable application-preparation stage.
  const low = sharedContextTokens + unitTaskTokens + outputAllowance;

  // Upper bound assumes the shared prefix is charged/read for every writer unit,
  // plus one uncached application-preparation pass and modest repair/retry headroom.
  const preparationAllowanceTokens = approxTokens(input.jobText) + approxTokens(input.resumeText) + 2_000;
  const high =
    sharedContextTokens * Math.max(1, unitCount) +
    Math.ceil(unitTaskTokens * 1.25) +
    Math.ceil(outputAllowance * 1.5) +
    preparationAllowanceTokens;

  const lowTokens = roundUp(low);
  const highTokens = roundUp(Math.max(lowTokens, high));
  const budgetTokens = Math.max(1_000, input.budgetTokens);
  const status: ResumeBudgetStatus =
    highTokens <= budgetTokens
      ? "within_budget"
      : highTokens <= budgetTokens * 1.25
        ? "near_budget"
        : "over_budget";

  return {
    lowTokens,
    highTokens,
    budgetTokens,
    status,
    unitCount,
    sharedContextTokens: roundUp(sharedContextTokens),
    preparationAllowanceTokens: roundUp(preparationAllowanceTokens),
  };
}

export function resumeBudgetForMode(mode: "light" | "full"): number {
  const key = mode === "light" ? "RESUME_LIGHT_BUDGET_TOKENS" : "RESUME_FULL_BUDGET_TOKENS";
  const configured = Number(process.env[key] ?? "");
  if (Number.isFinite(configured) && configured >= 1_000) return Math.round(configured);
  return mode === "light" ? 18_000 : 50_000;
}
