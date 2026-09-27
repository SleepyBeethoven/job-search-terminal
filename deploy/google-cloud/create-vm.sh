#!/usr/bin/env bash
set -euo pipefail

INSTANCE="${INSTANCE:-terry-career-agent}"
DATA_DISK="${DATA_DISK:-terry-career-agent-data}"
ZONE="${ZONE:-us-west1-b}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-micro}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-10GB}"
DATA_DISK_SIZE="${DATA_DISK_SIZE:-10GB}"

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Set a Google Cloud project first: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

echo "Using project: ${PROJECT_ID}"
echo "Zone: ${ZONE}"

gcloud services enable compute.googleapis.com --project "${PROJECT_ID}"

if ! gcloud compute disks describe "${DATA_DISK}" --zone "${ZONE}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute disks create "${DATA_DISK}"     --project "${PROJECT_ID}"     --zone "${ZONE}"     --size "${DATA_DISK_SIZE}"     --type pd-standard
fi

if ! gcloud compute instances describe "${INSTANCE}" --zone "${ZONE}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute instances create "${INSTANCE}"     --project "${PROJECT_ID}"     --zone "${ZONE}"     --machine-type "${MACHINE_TYPE}"     --image-family debian-12     --image-project debian-cloud     --boot-disk-size "${BOOT_DISK_SIZE}"     --boot-disk-type pd-standard     --no-boot-disk-auto-delete     --disk "name=${DATA_DISK},device-name=jst-data,mode=rw,boot=no,auto-delete=no"     --metadata enable-oslogin=TRUE     --metadata-from-file startup-script=deploy/google-cloud/bootstrap-vm.sh
else
  echo "Instance ${INSTANCE} already exists; leaving it unchanged."
fi

cat <<EOF

VM creation requested.

The app intentionally does NOT expose port 3000 publicly.
After the startup script finishes, open it through an SSH tunnel:

  gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT_ID} -- -L 3000:127.0.0.1:3000

Then open:
  http://127.0.0.1:3000

Startup logs:
  gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT_ID} --command="sudo journalctl -u google-startup-scripts.service -n 200 --no-pager"

JST service:
  gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT_ID} --command="sudo systemctl status job-search-terminal --no-pager"
EOF
