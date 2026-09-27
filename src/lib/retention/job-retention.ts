import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/client";

export type RetentionReason = "terminal" | "early-stage-stale" | "stage-stale";

export type RetentionCandidate = {
  id: string;
  company: string;
  title: string;
  status: string;
  archived: boolean;
  lastActivityAt: string;
  reason: RetentionReason;
};

const TERMINAL_STATUSES = new Set(["Rejected", "Skipped"]);
const EARLY_STAGE_STATUSES = new Set(["Found", "Reviewed", "Resume generated"]);

export function retentionDaysFor(status: string, archived: boolean): number {
  if (TERMINAL_STATUSES.has(status)) return 0;
  if (EARLY_STAGE_STATUSES.has(status) || archived) return 7;
  return 30;
}

function lastActivityJdExpression(alias = "jobs") {
  return `max(
    coalesce(julianday(${alias}.updated_at), 0),
    coalesce(julianday(${alias}.created_at), 0),
    coalesce((select max(julianday(applications.updated_at)) from applications where applications.job_id = ${alias}.id), 0),
    coalesce((select max(julianday(generated_documents.created_at)) from generated_documents where generated_documents.job_id = ${alias}.id), 0),
    coalesce((
      select max(julianday(activity_log.timestamp))
      from activity_log
      where activity_log.entity_id = ${alias}.id
        and activity_log.entity_type in (
          'job', 'application', 'application_answers', 'company_research',
          'outreach', 'gap_response', 'generated_document'
        )
    ), 0)
  )`;
}

function reasonFor(status: string, archived: boolean): RetentionReason {
  if (TERMINAL_STATUSES.has(status)) return "terminal";
  if (EARLY_STAGE_STATUSES.has(status) || archived) return "early-stage-stale";
  return "stage-stale";
}

export function listRetentionCandidates(now = new Date()): RetentionCandidate[] {
  const database = getDatabase();
  const rows = database
    .prepare(
      `select
        jobs.id,
        jobs.company,
        jobs.title,
        jobs.status,
        jobs.archived,
        ${lastActivityJdExpression("jobs")} as last_activity_jd,
        datetime(${lastActivityJdExpression("jobs")}) as last_activity_at
       from jobs
       where jobs.retention_pinned = 0
         and jobs.retention_compacted_at = ''`
    )
    .all() as Array<{
      id: string;
      company: string;
      title: string;
      status: string;
      archived: number;
      last_activity_jd: number;
      last_activity_at: string;
    }>;

  const nowJd = now.getTime() / 86_400_000 + 2_440_587.5;
  return rows
    .filter((row) => {
      const days = retentionDaysFor(row.status, row.archived === 1);
      return row.last_activity_jd > 0 && row.last_activity_jd <= nowJd - days;
    })
    .map((row) => ({
      id: row.id,
      company: row.company,
      title: row.title,
      status: row.status,
      archived: row.archived === 1,
      lastActivityAt: row.last_activity_at,
      reason: reasonFor(row.status, row.archived === 1),
    }))
    .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt));
}

function managedOutputPath(value: string): string | null {
  if (!value.trim()) return null;
  const outputRoot = path.resolve(process.cwd(), "output");
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(process.cwd(), value);
  return resolved === outputRoot || resolved.startsWith(`${outputRoot}${path.sep}`) ? resolved : null;
}

function removeGeneratedFiles(paths: string[]) {
  for (const value of new Set(paths)) {
    const target = managedOutputPath(value);
    if (!target || !existsSync(target)) continue;
    rmSync(target, { force: true });
  }
}

export function compactJobForRetention(candidate: RetentionCandidate, now = new Date()): boolean {
  const database = getDatabase();
  const current = listRetentionCandidates(now).find((item) => item.id === candidate.id);
  if (!current) return false;

  const generatedFiles = database
    .prepare("select pdf_url as pdfUrl, html_url as htmlUrl from generated_documents where job_id = ?")
    .all(candidate.id) as Array<{ pdfUrl: string; htmlUrl: string }>;

  database.transaction(() => {
    const params = { jobId: candidate.id };

    database.prepare("delete from application_answer_drafts where job_id = @jobId").run(params);
    database.prepare("delete from outreach_drafts where job_id = @jobId").run(params);
    database.prepare("delete from company_research where job_id = @jobId").run(params);
    database.prepare("delete from evaluation_feedback where job_id = @jobId").run(params);
    database.prepare("delete from application_preparation where job_id = @jobId").run(params);
    database.prepare("delete from job_keyword_concepts where job_id = @jobId").run(params);
    database.prepare("delete from job_contact_links where job_id = @jobId").run(params);
    database.prepare("delete from story_job_links where job_id = @jobId").run(params);
    database.prepare("delete from evaluations where job_id = @jobId").run(params);
    database.prepare("delete from applications where job_id = @jobId").run(params);
    database.prepare("delete from generated_documents where job_id = @jobId").run(params);
    database.prepare("delete from job_gap_responses where job_id = @jobId").run(params);
    database.prepare("update story_bank set source_job_id = null where source_job_id = @jobId").run(params);

    // Keep only one tiny audit event for the compacted opportunity.
    database.prepare("delete from activity_log where entity_id = @jobId").run(params);

    database
      .prepare(
        `update jobs set
          raw_description = '',
          parsed_description = '',
          summary = '',
          why_it_matches = '',
          main_concern = '',
          salary_notes = '',
          requirement_match_json = '[]',
          resume_evidence_json = '[]',
          gaps_json = '[]',
          red_flags_json = '[]',
          liveness_reason = '',
          liveness_evidence_url = '',
          posting_search_query = '',
          archived = 1,
          retention_compacted_at = current_timestamp,
          retention_last_activity_at = @lastActivityAt,
          retention_reason = @reason,
          updated_at = current_timestamp
        where id = @jobId
          and retention_pinned = 0
          and retention_compacted_at = ''`
      )
      .run({
        ...params,
        lastActivityAt: current.lastActivityAt,
        reason: current.reason,
      });

    database
      .prepare(
        `insert into activity_log (id, entity_type, entity_id, action, timestamp, details_json)
         values (@id, 'job', @jobId, 'Retention compacted', @timestamp, @detailsJson)`
      )
      .run({
        id: `retention-${candidate.id}-${Date.now()}`,
        jobId: candidate.id,
        timestamp: new Date().toISOString(),
        detailsJson: JSON.stringify({
          status: current.status,
          reason: current.reason,
          lastActivityAt: current.lastActivityAt,
        }),
      });
  })();

  removeGeneratedFiles(generatedFiles.flatMap((row) => [row.pdfUrl, row.htmlUrl]));
  return true;
}

export function runRetentionCleanup(options: { now?: Date; vacuum?: boolean } = {}) {
  const now = options.now ?? new Date();
  const candidates = listRetentionCandidates(now);
  const compacted: RetentionCandidate[] = [];

  for (const candidate of candidates) {
    if (compactJobForRetention(candidate, now)) compacted.push(candidate);
  }

  if (options.vacuum) {
    const database = getDatabase();
    try {
      database.pragma("wal_checkpoint(TRUNCATE)");
      database.exec("vacuum");
    } catch (error) {
      console.warn("[retention] Compaction succeeded but SQLite VACUUM could not run:", error);
    }
  }

  return { candidates: candidates.length, compacted: compacted.length, jobs: compacted };
}
