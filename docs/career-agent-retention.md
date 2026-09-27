# Career Agent retention policy

The Career Agent keeps active opportunities useful and compacts stale ones instead of
letting job descriptions, AI outputs and generated files accumulate forever.

## Policy

| Opportunity state | Eligible for compaction |
|---|---:|
| Rejected | next retention run |
| Skipped | next retention run |
| Found / Reviewed / Resume generated | after 7 days without meaningful activity |
| Applied / Follow-up needed / Recruiter responded / Interviewing / Offer | after 30 days without meaningful activity |
| Any archived non-terminal job | after 7 days without meaningful activity |
| Pinned | never automatically compacted |

"Waiting for Terry" is stored as the existing `Reviewed` job state. A tailored job uses
the existing `Resume generated` state.

Meaningful activity is derived from the job update timestamp plus application updates,
generated documents and job-scoped activity records. Stage changes update the job timestamp.

## What compaction removes

Compaction removes job-specific heavy data:

- full and parsed job descriptions
- evaluation records and detailed evidence
- application-preparation data
- generated resume database content and generated PDF/HTML files
- application notes and answer drafts
- job-specific research, outreach links, gap responses and keyword links
- verbose activity history

## What remains

The `jobs` row becomes a small tombstone and remains in duplicate detection. It keeps:

- company
- title
- canonical posting URL / posting key
- source and location
- final/last status
- fit score and recommended lane (small numeric/text fields)
- first-seen date
- last meaningful activity snapshot
- compaction date and reason

This is deliberate: deleting the row entirely would allow the same stale posting to be
imported again as a new opportunity.

## CLI

Preview and compact eligible jobs:

```bash
npm run retention:cleanup
```

Also checkpoint WAL and run SQLite VACUUM:

```bash
npm run retention:cleanup -- --vacuum
```

The Google Cloud deployment runs normal retention daily at 04:45 Asia/Shanghai and a
VACUUM pass weekly on Sunday at 04:50. Neither task calls an AI provider.
