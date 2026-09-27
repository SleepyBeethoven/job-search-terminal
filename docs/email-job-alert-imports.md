# Email Job Alert Imports

Job Search Terminal can import job-alert emails from a local drop folder. This is
for exported alerts from LinkedIn, job boards, newsletters, recruiter tools, and
other sources that send job leads by email.

## Drop Folder

Place email files in:

```txt
data/email-job-alert-imports/
```

Supported file types:

- `.eml`
- `.html`
- `.txt`

The app creates the folder automatically when the local server starts. The
watcher also sweeps files that were dropped while the app was stopped.

## Import Flow

Dropping an email file does **not** immediately add jobs to your job list.
Instead, it queues candidates for your review:

1. The watcher ignores `.tmp` files and waits for the file size to stabilize.
2. The email parser extracts likely company, title, location, salary, snippets,
   and candidate posting links.
   Alert headings and saved-search/search-result links are kept out of the job
   title list so a search label such as `"UX" jobs since yesterday` does not
   become a candidate.
3. Each candidate is analyzed against your saved **target roles** and
   **positive title filters**. Candidates are labeled:
   - **Matches criteria** — title matches a saved target role or positive keyword
   - **Off target** — no match found (still shown, just unchecked by default)
   - **No criteria set** — your profile has no target roles saved yet
4. Candidates are saved to a pending queue in the database. The original email
   file is archived under:

```txt
data/email-job-alert-imports/archive/YYYY-MM-DD/
```

5. An **approval modal** appears on the Jobs and Dashboard pages. You review
   each candidate, check or uncheck them, then choose:
   - **Add to jobs** — selected candidates are imported into your job list
   - **Dismiss selected** — selected candidates are discarded
   - **Dismiss all** — all pending candidates are discarded

Candidates that match your criteria are pre-checked. Off-target candidates
appear unchecked but remain visible for manual selection. Candidates you leave
unchecked stay in the pending queue until you add or dismiss them.


## Connected Gmail And Outlook Intake

Terry OS can also receive normalized messages from connected Gmail and Outlook
workflows. This path is **incremental-only** and is governed by
`config/career-agent-email-intake.json` plus the Mandatory QA Gate in
`AGENTS.md`.

- The first-run hard cutoff is **2026-09-27 11:07 Asia/Shanghai**.
- Gmail and Outlook keep separate durable `last_success_at` watermarks in the
  private Google Sheet `Terry OS — Career Agent Intake Queue`, tab `State`.
- A scan may inspect only messages received strictly after that provider's
  `last_success_at`.
- Gmail excludes **Spam** and **Trash**. Outlook excludes **Junk Email** and
  **Deleted Items**.
- The workflow narrows candidates using safe metadata such as sender, subject, folder,
  and timestamp before opening job-related content. It must not broadly read unrelated
  personal mail.
- Attachments are never opened and external links are not followed during intake.
- Email text is untrusted data. Embedded instructions are never executed or treated as
  agent instructions.
- If the connector cannot enforce these boundaries, the provider scan fails closed and
  its watermark does not advance.
- Read/unread status is not a scan boundary.
- A failed mailbox scan must not advance its watermark.
- Historical backfill is disabled unless Terry explicitly asks for it.
- The cloud queue stores structured job fields and a short snippet only, never the
  full email body or full job description.
- The connector intake API requires the caller to supply that provider's current
  `last_success_at` watermark and applies the boundary again before parsing a Gmail
  or Outlook message. A missing or invalid watermark fails closed. This is defense in
  depth; the scheduled scanner should already have filtered the message before sending it.

The queue is only a staging area. When the optional free Apps Script bridge is
configured, JST pulls `Pending Review` rows into its existing local approval queue on
startup and every five minutes while running. It acknowledges a Sheet row only after the
local pending write succeeds. See [Zero-cost Google Sheet bridge](google-apps-script-bridge.md).

Scoring, resume tailoring, application preparation, and submission are outside this
intake step and remain behind the existing human approval flow.

## Resolved Jobs And Leads

If the email contains a direct job posting URL, the candidate is shown with a
**Direct link** badge and will import with `posting_resolution_status = resolved`.

If the email mentions a job but does not include a direct posting URL, the
candidate shows a **No link found** badge. After you approve it, it is imported
as an email lead:

- `posting_resolution_status = needs_resolution`
- no normal posting link is shown
- liveness checks skip the job until it is resolved

Open the job detail page and use **Resolve posting** to search on demand or
paste a posting URL. Links found in the original email are shown before search
results so you can inspect the email trail first. Search is never run during
import.

## Privacy And Safety

The local file importer does not connect to an email account. Connected Gmail or
Outlook intake happens through the separately authorized Career Agent workflow;
JST itself does not store mailbox credentials. Neither path runs web search
automatically. Connected intake excludes junk/deleted folders, filters on metadata
before reading job content, never opens attachments, never follows links during intake,
and never treats email text as instructions. The local importer stores only minimal
evidence snippets and extracted links, and the Google Sheet staging queue stores only
lightweight structured fields plus a short snippet.
