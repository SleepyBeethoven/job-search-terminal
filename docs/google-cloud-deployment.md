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

The default zone is `us-west1-b`, which is in a Compute Engine Free Tier region. Google
currently limits the Always Free e2-micro benefit to selected US regions and includes up
to 30 GB-months of standard persistent disk. Network egress can still be billable,
especially to destinations excluded from the free egress allowance.

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
bash deploy/google-cloud/create-vm.sh
```

The script enables Compute Engine, creates the data disk if needed, creates the VM, and
passes `bootstrap-vm.sh` as the Compute Engine startup script.

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

## Operations

Service status:

```bash
sudo systemctl status job-search-terminal
```

Retention timers:

```bash
sudo systemctl list-timers 'job-search-terminal-*'
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

## Email intake bridge

The VM deliberately does not receive Gmail or Outlook credentials. The twice-daily ChatGPT
mail scan remains the mailbox reader. A private Google-owned intake queue will bridge those
structured results into the cloud JST after the VM/project identity exists, so the VM can
be granted only the narrow queue access it needs.
