# Terry OS Career Agent intake queue

The intake Sheet is a transport bridge between ChatGPT mailbox connectors and the private
Google Cloud JST instance. It is intentionally not a second job database.

## Flow

```
05:00 / 17:00
ChatGPT Gmail + Outlook scan
        ↓
private Google Sheet
status = Pending Review
        ↓
05:10 / 17:10
GCP JST intake sync
        ↓
JST pending review queue
        ↓
Terry decides
Use Template / Light Tailor / Full Tailor / Skip
```

No scoring, tailoring or application happens merely because a mailbox scan found a role.

## Columns

The `Intake` tab uses exactly these columns:

1. `queue_id`
2. `scanned_at`
3. `provider`
4. `message_id`
5. `company`
6. `title`
7. `location`
8. `salary`
9. `posting_url`
10. `source`
11. `snippet`
12. `status`
13. `imported_job_id`
14. `processed_at`
15. `last_error`

The bridge stores a short snippet only. Full email bodies and full job descriptions do not
belong in this Sheet.

## Status lifecycle

- `Pending Review` — written by the twice-daily mailbox scan and waiting for JST.
- `Queued in JST` — copied into JST's existing pending review database.
- `Already known` — JST already contains the posting.
- `Error` — the row could not be consumed; `last_error` contains a bounded diagnostic.

Processed rows are cleared after seven days. JST's retention policy separately controls
the longer-lived opportunity record and dedupe tombstones.

## Identity and dedupe

A direct posting URL is canonicalized before it reaches JST. LinkedIn tracking parameters,
for example, do not create a second job. If no direct posting URL exists, the bridge
creates a stable fallback identity from the queue/message/job fields and marks the posting
as needing resolution.

The bridge does not perform expensive cross-mailbox comparison. The mailbox scan only
avoids obvious repeats in the queue, and JST's existing posting identity remains the final
dedupe guard.
