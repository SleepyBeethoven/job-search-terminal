# Career Agent automation QA contract

This is the operational review contract for Terry OS Career Agent automation. It
exists because scheduled intake can cause large, silent side effects even when the
code change itself looks small.

## Gate

Any email intake, scheduled scan, synchronization, retention change, cloud storage
change, or external action must pass Central QA before it is enabled. The repository
also runs `npm run career-agent:qa` as a required CI step so this contract cannot be
silently skipped during a pull request.

The reviewer does not redesign the feature. It checks the implementation against the
declared contract and returns **PASS**, **PASS WITH FIXES**, or **BLOCK**.

## Email intake contract

The source of truth is `config/career-agent-email-intake.json`.

Current rules:

- Gmail and Outlook are independent sources.
- Historical backfill is disabled by default.
- The hard first-run cutoff is **2026-09-27 11:07 Asia/Shanghai**.
- Each provider has a durable `last_success_at` watermark in the Google Sheet
  `Terry OS — Career Agent Intake Queue`, tab `State`.
- A scan only considers messages received strictly after that provider's
  `last_success_at`.
- Read/unread state never defines the scan boundary.
- A failed provider scan records the failure but does not change
  `last_success_at`.
- One provider failing does not affect the other's watermark.
- Intake stops after writing lightweight `Pending Review` rows. It does not score,
  tailor, apply, or run expensive downstream work.
- Queue rows keep short structured fields and snippets, not full email bodies or full
  job descriptions.

## Mandatory preflight

Before a scheduled mailbox read:

1. Read the two provider rows from `State`.
2. Confirm `hard_cutoff_at` and `last_success_at` are valid timestamps.
3. Confirm `last_success_at >= hard_cutoff_at`.
4. Confirm any connected-mail API handoff includes the provider's current
   `last_success_at`; the API fails closed when it is missing.
5. If any state is missing or malformed, return **BLOCK** and do not read that
   mailbox.
6. Search only the interval strictly after `last_success_at`.
7. On success, advance only that provider's watermark to the scan completion time.
8. On failure, leave its watermark unchanged.

## Zero-cost constraint

Career Agent V1 must not require a billing account or paid cloud infrastructure.
Google Drive/Sheets and connected mailbox tools may be used within their free personal
account limits. Billing-backed Compute Engine, Cloud SQL, Cloud Run, or equivalent
infrastructure is outside the current contract.

## Retention

Retention remains independent of email intake:

- Rejected/Skipped: compact at the next cleanup.
- Early-stage inactive work: compact after 7 days.
- Active stages: compact after 30 days without meaningful activity.
- Pinned: exempt.
- Keep a lightweight tombstone for duplicate prevention and outcome history.
