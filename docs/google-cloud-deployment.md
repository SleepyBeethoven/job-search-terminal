# Google Cloud deployment — Career Agent

This deployment keeps Job Search Terminal private and moves runtime storage off the user's
computer.

## Architecture

- Compute Engine `e2-micro` VM
- Debian 12
- 10 GB `pd-standard` boot disk
- separate 10 GB `pd-standard` data disk with auto-delete disabled
- SQLite database and mutable `data/`, `output/`, and `assets/` directories on the data disk
- JST listens only on `127.0.0.1:3000`
- browser access through an SSH tunnel; port 3000 is not opened publicly
- systemd keeps JST running
- daily retention cleanup at 04:45 Asia/Shanghai
- weekly SQLite VACUUM Sunday at 04:50 Asia/Shanghai
- private Google Sheet intake sync at 05:10 and 17:10 Asia/Shanghai

The default VM shape intentionally stays small. Check current Google Cloud pricing and
Free Tier conditions before deployment because network egress and other usage can still be
billable.

## One-time setup

The provisioning script is intended to be run from Google Cloud Shell, so no local SDK or
repository checkout is required.

1. Create/select a Google Cloud project and attach a billing account.
2. Open Cloud Shell.
3. Run:

```bash
git clone https://github.com/SleepyBeethoven/job-search-terminal.git
cd job-search-terminal
gcloud config set project YOUR_PROJECT_ID
CAREER_INTAKE_SPREADSHEET_ID=YOUR_PRIVATE_SHEET_ID bash deploy/google-cloud/create-vm.sh
```

The script:

- enables Compute Engine, IAM and Google Sheets APIs
- creates a dedicated `terry-career-agent` service account
- creates the persistent data disk if needed
- creates the VM with only the Google Sheets OAuth scope required by the intake bridge
- passes the private Sheet ID to the VM as instance metadata
- installs JST, retention timers, and the twice-daily Sheet intake timer

The script prints the service-account email. Share the private intake Sheet with that exact
address as **Editor**. The VM does not need Gmail or Outlook credentials.

## Open JST

From Cloud Shell or another machine with gcloud:

```bash
gcloud compute ssh terry-career-agent \
  --zone=us-west1-b \
  -- -L 3000:127.0.0.1:3000
```

Then browse to:

```
http://127.0.0.1:3000
```

Do not create a firewall rule exposing TCP/3000.

## Data location

The persistent disk is mounted at:

```
/var/lib/job-search-terminal
```

The primary database is:

```
/var/lib/job-search-terminal/job-search-terminal.sqlite
```

The repository's mutable directories are symlinked onto that disk:

- `data/`
- `output/`
- `assets/`

The disk is attached with auto-delete disabled, so deleting the VM does not delete the
Career Agent data disk. Deleting the data disk itself is irreversible.

## Email intake bridge

The mailbox reader remains the twice-daily ChatGPT task. It writes only structured job
lead fields plus a short snippet to a private Google Sheet.

At 05:10 and 17:10 the VM runs:

```bash
npm run intake:sync
```

The sync:

1. reads only rows whose status is `Pending Review`
2. maps them into JST's existing pending-email review queue
3. skips postings already known to JST
4. writes `Queued in JST`, `Already known`, or `Error` back to the Sheet
5. clears processed bridge rows after seven days

Full mailbox content is not copied to the VM or the Sheet.

## Operations

Service status:

```bash
sudo systemctl status job-search-terminal
```

All Career Agent timers:

```bash
sudo systemctl list-timers 'job-search-terminal-*'
```

Run intake sync manually:

```bash
sudo -u jst bash -lc 'cd /opt/job-search-terminal && npm run intake:sync'
```

Run cleanup manually:

```bash
sudo -u jst bash -lc 'cd /opt/job-search-terminal && npm run retention:cleanup'
```

Run cleanup plus SQLite VACUUM:

```bash
sudo -u jst bash -lc 'cd /opt/job-search-terminal && npm run retention:cleanup -- --vacuum'
```

Startup-script logs:

```bash
sudo journalctl -u google-startup-scripts.service -n 200 --no-pager
```
