# Zero-cost Google Sheet bridge

Career Agent can move new mailbox leads from the private Google Sheet queue into
JST without a paid VM, Cloud Run, Cloud SQL, or a billing account.

## Flow

```text
Gmail / Outlook
      ↓
scheduled ChatGPT intake (05:00 / 17:00)
      ↓
private Google Sheet
  Intake + State
      ↓
Google Apps Script web app
      ↓
JST local Pending Review
```

JST remains the main job database. The Google Sheet is only a lightweight staging
queue and watermark store.

## What is stored in Google

The queue contains only:

- queue id and scan timestamp
- mailbox provider and source message id
- company, title, location, and salary text when present
- posting URL
- short snippet
- queue status and processing timestamps

It does not store full email bodies, full job descriptions, resumes, generated
documents, application answers, or the local SQLite database.

Rows older than seven days are removed by the Apps Script cleanup trigger.

## One-time setup

This is the only manual setup required for the bridge.

1. Open the Google Sheet **Terry OS — Career Agent Intake Queue**.
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with
   `deploy/google-apps-script/career-agent-queue.gs`.
4. Save the project.
5. Run `initializeCareerAgentBridge` once and approve the requested Google
   authorization. It creates a long random bridge secret and the free daily
   seven-day cleanup trigger.
6. Copy the logged value beginning with `CAREER_AGENT_BRIDGE_SECRET=`.
7. Choose **Deploy → New deployment → Web app**.
8. Execute as the deploying user. Allow the web app to be reached by **Anyone**
   so the local JST process can call it without a separate Google OAuth flow.
   Queue data is still gated by the long secret sent inside the POST body.
9. Copy the Web app `/exec` URL.

Do not share the deployment URL together with the secret.

## Configure JST

Set these environment variables before starting JST:

```bash
JST_CAREER_AGENT_QUEUE_URL="https://script.google.com/macros/s/.../exec"
JST_CAREER_AGENT_QUEUE_TOKEN="<the generated secret>"
```

Optional:

```bash
JST_CAREER_AGENT_QUEUE_POLL_MS=300000
```

The minimum poll interval is one minute; five minutes is the default.

## Runtime behavior

When both URL and token are present:

1. JST syncs once on startup.
2. While JST is running, it checks the queue every five minutes.
3. Only rows with `status = Pending Review` are considered.
4. Valid rows are inserted into the existing email-candidate Pending Review
   queue.
5. Only after the local write succeeds does JST acknowledge the cloud row as
   `Synced to JST`.
6. A retry is idempotent: the same `queue_id` maps to the same local candidate
   id, so an interrupted acknowledgement does not duplicate the lead.
7. The bridge stops at Pending Review. It does not score, tailor, apply, or send
   anything. Those actions remain behind the existing human approval flow.

If the URL or token is missing, JST does not attempt any cloud queue connection.

## Failure rules

- Local write fails → do not acknowledge the Sheet row.
- Apps Script acknowledgement fails → keep the local candidate; the next sync
  retries the acknowledgement without creating another local candidate.
- Invalid or already processed Sheet rows are skipped.
- The Apps Script endpoint accepts queue actions only when the shared secret
  matches.
- The existing mailbox cutoff and per-provider watermark rules remain upstream
  of this bridge.
