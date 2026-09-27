# Security Agent v0.1

Security Agent is a governance agent. It does not build product features and it does
not decide whether a workflow is useful. Its job is to prevent private data, credentials,
and private cloud identifiers from crossing into public code or an unapproved external
system.

## Verdicts

- **PASS** — no blocking security finding.
- **PASS WITH FIXES** — the design can proceed, but a non-blocking security issue must
  be corrected.
- **BLOCK** — do not merge, deploy, or enable the workflow.

## Public-repository assumption

This fork is public. Security Agent therefore treats every tracked file and every commit
as potentially world-readable and durable.

The following must never be committed:

- API keys, OAuth credentials, passwords, private keys, or bridge secrets
- local SQLite databases
- resumes, generated resumes, application exports, or screenshots containing personal data
- personal email addresses, phone numbers, or home addresses
- private Google Sheet identifiers or private connector identifiers
- runtime data under `data/`, `output/`, `assets/`, or `memory/`

Private values belong in environment variables, Google Apps Script Properties, the
private Google Sheet State tab, or another explicitly approved private store.

## Two-layer protection

1. **GitHub native secret scanning / push protection** catches supported credential
   patterns in the public repository.
2. **Security Agent Gate** runs `npm run security:check` in CI and catches Terry OS
   privacy boundaries that a generic secret scanner does not understand.

The local gate scans tracked files, not ignored runtime files.

## Mandatory Security review

Security review is mandatory when a change touches any of:

- authentication, OAuth, tokens, keys, or session data
- email, Drive, calendar, contacts, resumes, or personal profile data
- public GitHub files or generated artifacts
- a new cloud store, connector, webhook, public endpoint, or data export
- sharing permissions or access-control rules
- retention/deletion of sensitive information
- logs, screenshots, diagnostics, or analytics containing user data

For external data flows, Security Agent checks:

1. **Data minimization** — send/store only fields needed for the declared purpose.
2. **Destination** — exactly where the data leaves the local machine.
3. **Access** — who or what can read/write it.
4. **Credentials** — credentials stay out of public code and URLs.
5. **Retention** — define when staged data is removed.
6. **Failure mode** — failure must not broaden access or leak data.
7. **Public exposure** — public repo/web endpoint contents contain no private identifiers.
8. **Execution proof** — automated checks cover the important boundaries.

## Current Career Agent boundary

The Google Sheet intake queue may hold only lightweight lead fields and timestamps.
Full email bodies, full job descriptions, resumes, application answers, and the local
SQLite database remain outside that queue.

The Sheet identifier itself is private runtime state. The public Apps Script discovers
the bound Sheet during one-time initialization and stores its ID in Script Properties.
The public repository does not need the identifier.

## Historical note

A Google Sheet identifier had previously been committed to this public fork. A Sheet ID
is not an authentication secret and does not grant access by itself, but it is still an
unnecessary private identifier. Current code no longer contains it. Rewriting public Git
history is not required for this identifier alone; actual leaked credentials would require
immediate rotation and a separate incident response.
