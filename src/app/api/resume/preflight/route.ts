import { NextResponse } from "next/server";
import {
  getEvaluationByJobId,
  getJobById,
  getJobGapResponses,
  getProfileSupplements,
  getResumeBuilderVersion,
  getResumes,
  getSkills,
  getUserProfile,
} from "@/lib/db/queries";
import type { ResumeSectionModeInput } from "@/lib/db/types";
import { estimateResumeBudget, resumeBudgetForMode } from "@/lib/documents/resume-budget";

export const dynamic = "force-dynamic";

type RequestBody = {
  jobId?: string;
  resumeId?: string;
  sectionModes?: ResumeSectionModeInput[];
  tailorMode?: "light" | "full";
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const jobId = String(body.jobId ?? "").trim();
  const resumeId = String(body.resumeId ?? "").trim();
  const tailorMode = body.tailorMode === "light" ? "light" : "full";

  if (!jobId || !resumeId) {
    return NextResponse.json({ error: "jobId and resumeId are required" }, { status: 400 });
  }

  const job = getJobById(jobId);
  const evaluation = getEvaluationByJobId(jobId);
  const resume = getResumes().find((entry) => entry.id === resumeId);
  const version = resume ? getResumeBuilderVersion(resume.id) : undefined;

  if (!job || !evaluation || !resume || !version) {
    return NextResponse.json({ error: "Job, evaluation, or resume lane is unavailable" }, { status: 400 });
  }
  if (version.status !== "approved") {
    return NextResponse.json({ error: "Approve this resume lane before tailoring it" }, { status: 400 });
  }

  const jobText = job.rawDescription || job.parsedDescription || [job.title, job.summary].filter(Boolean).join("\n");
  const resumeText = resume.extractedText?.trim() || JSON.stringify(version.sections);
  const evaluationText = JSON.stringify({
    evaluation,
    profile: getUserProfile(),
    skills: getSkills(),
    gapResponses: getJobGapResponses(jobId).filter((entry) => entry.qualityStatus === "addressed"),
    supplements: getProfileSupplements().filter((entry) => entry.qualityStatus === "addressed"),
  });

  const estimate = estimateResumeBudget({
    jobText,
    resumeText,
    evaluationText,
    sections: version.sections,
    sectionModes: body.sectionModes ?? [],
    budgetTokens: resumeBudgetForMode(tailorMode),
  });

  return NextResponse.json({
    ...estimate,
    tailorMode,
    note: "Token preflight is an estimate of AI request volume, not a ChatGPT plan-usage percentage or provider bill.",
  });
}
