#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
APP_DIR="/opt/job-search-terminal"
DATA_DIR="/var/lib/job-search-terminal"
DEVICE="/dev/disk/by-id/google-jst-data"
REPO_URL="https://github.com/SleepyBeethoven/job-search-terminal.git"
METADATA_BASE="http://metadata.google.internal/computeMetadata/v1/instance/attributes"

metadata_value() {
  curl -fsS -H "Metadata-Flavor: Google" "${METADATA_BASE}/$1" 2>/dev/null || true
}

CAREER_INTAKE_SPREADSHEET_ID="$(metadata_value career-intake-spreadsheet-id)"
CAREER_INTAKE_SHEET_NAME="$(metadata_value career-intake-sheet-name)"
CAREER_INTAKE_SHEET_NAME="${CAREER_INTAKE_SHEET_NAME:-Intake}"

timedatectl set-timezone Asia/Shanghai

apt-get update
apt-get install -y ca-certificates curl git build-essential python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# e2-micro is intentionally small. Swap makes npm ci/build reliable without
# changing the app's steady-state storage model.
if [[ "$(swapon --show --noheadings | wc -l)" -eq 0 ]]; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

for _ in {1..30}; do
  [[ -e "${DEVICE}" ]] && break
  sleep 2
done
if [[ ! -e "${DEVICE}" ]]; then
  echo "Persistent data disk jst-data was not found." >&2
  exit 1
fi

if ! blkid "${DEVICE}" >/dev/null 2>&1; then
  mkfs.ext4 -F "${DEVICE}"
fi

mkdir -p "${DATA_DIR}"
UUID="$(blkid -s UUID -o value "${DEVICE}")"
if ! grep -q "UUID=${UUID}" /etc/fstab; then
  echo "UUID=${UUID} ${DATA_DIR} ext4 defaults,nofail 0 2" >> /etc/fstab
fi
mountpoint -q "${DATA_DIR}" || mount "${DATA_DIR}"

if ! id -u jst >/dev/null 2>&1; then
  useradd --system --home "${DATA_DIR}" --shell /usr/sbin/nologin jst
fi
chown -R jst:jst "${DATA_DIR}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${APP_DIR}"
  BEFORE=""
else
  BEFORE="$(git -C "${APP_DIR}" rev-parse HEAD)"
  for runtime_dir in data output assets; do
    [[ -L "${APP_DIR}/${runtime_dir}" ]] && rm "${APP_DIR}/${runtime_dir}"
  done
fi

git -C "${APP_DIR}" fetch origin main
git -C "${APP_DIR}" reset --hard origin/main
AFTER="$(git -C "${APP_DIR}" rev-parse HEAD)"

for runtime_dir in data output assets; do
  rm -rf "${APP_DIR}/${runtime_dir}"
  mkdir -p "${DATA_DIR}/${runtime_dir}"
  ln -s "${DATA_DIR}/${runtime_dir}" "${APP_DIR}/${runtime_dir}"
done

if [[ "${BEFORE}" != "${AFTER}" || ! -f "${APP_DIR}/.next/BUILD_ID" ]]; then
  cd "${APP_DIR}"
  npm ci
  NEXT_TELEMETRY_DISABLED=1 npm run build
fi

chown -R jst:jst "${APP_DIR}" "${DATA_DIR}"

cat >/etc/job-search-terminal.env <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
JST_DATABASE_PATH=${DATA_DIR}/job-search-terminal.sqlite
CAREER_INTAKE_SPREADSHEET_ID=${CAREER_INTAKE_SPREADSHEET_ID}
CAREER_INTAKE_SHEET_NAME=${CAREER_INTAKE_SHEET_NAME}
EOF
chmod 600 /etc/job-search-terminal.env

cat >/etc/systemd/system/job-search-terminal.service <<'EOF'
[Unit]
Description=Job Search Terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jst
Group=jst
WorkingDirectory=/opt/job-search-terminal
EnvironmentFile=/etc/job-search-terminal.env
ExecStart=/usr/bin/npm start -- --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/job-search-terminal-retention.service <<'EOF'
[Unit]
Description=Career Agent retention cleanup
After=job-search-terminal.service

[Service]
Type=oneshot
User=jst
Group=jst
WorkingDirectory=/opt/job-search-terminal
EnvironmentFile=/etc/job-search-terminal.env
ExecStart=/usr/bin/npm run retention:cleanup
EOF

cat >/etc/systemd/system/job-search-terminal-retention.timer <<'EOF'
[Unit]
Description=Run Career Agent retention cleanup daily

[Timer]
OnCalendar=*-*-* 04:45:00
Persistent=true
Unit=job-search-terminal-retention.service

[Install]
WantedBy=timers.target
EOF

cat >/etc/systemd/system/job-search-terminal-vacuum.service <<'EOF'
[Unit]
Description=Career Agent weekly SQLite compaction
After=job-search-terminal-retention.service

[Service]
Type=oneshot
User=jst
Group=jst
WorkingDirectory=/opt/job-search-terminal
EnvironmentFile=/etc/job-search-terminal.env
ExecStart=/usr/bin/npm run retention:cleanup -- --vacuum
EOF

cat >/etc/systemd/system/job-search-terminal-vacuum.timer <<'EOF'
[Unit]
Description=Run Career Agent SQLite VACUUM weekly

[Timer]
OnCalendar=Sun *-*-* 04:50:00
Persistent=true
Unit=job-search-terminal-vacuum.service

[Install]
WantedBy=timers.target
EOF

cat >/etc/systemd/system/job-search-terminal-intake.service <<'EOF'
[Unit]
Description=Sync Terry OS Google Sheet intake queue into JST
After=network-online.target job-search-terminal.service
Wants=network-online.target

[Service]
Type=oneshot
User=jst
Group=jst
WorkingDirectory=/opt/job-search-terminal
EnvironmentFile=/etc/job-search-terminal.env
ExecStart=/usr/bin/npm run intake:sync
EOF

cat >/etc/systemd/system/job-search-terminal-intake.timer <<'EOF'
[Unit]
Description=Sync Career Agent intake after twice-daily mail scans

[Timer]
OnCalendar=*-*-* 05:10:00
OnCalendar=*-*-* 17:10:00
Persistent=true
Unit=job-search-terminal-intake.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now job-search-terminal.service
systemctl enable --now job-search-terminal-retention.timer
systemctl enable --now job-search-terminal-vacuum.timer
systemctl enable --now job-search-terminal-intake.timer

echo "Job Search Terminal is running on 127.0.0.1:3000."
echo "Database: ${DATA_DIR}/job-search-terminal.sqlite"
echo "Intake Sheet ID: ${CAREER_INTAKE_SPREADSHEET_ID:-not-configured}"
systemctl --no-pager --full status job-search-terminal.service || true
systemctl --no-pager list-timers 'job-search-terminal-*' || true
