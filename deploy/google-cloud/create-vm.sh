#!/usr/bin/env bash
set -euo pipefail

INSTANCE="${INSTANCE:-terry-career-agent}"
DATA_DISK="${DATA_DISK:-terry-career-agent-data}"
ZONE="${ZONE:-us-west1-b}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-micro}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-10GB}"
DATA_DISK_SIZE="${DATA_DISK_SIZE:-10GB}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-terry-career-agent}"
CAREER_INTAKE_SPREADSHEET_ID="${CAREER_INTAKE_SPREADSHEET_ID:-}"
CAREER_INTAKE_SHEET_NAME="${CAREER_INTAKE_SHEET_NAME:-Intake}"

if [[ -z "${CAREER_INTAKE_SPREADSHEET_ID}" ]]; then
  echo "CAREER_INTAKE_SPREADSHEET_ID is required for the private intake bridge." >&2
  echo "Example: CAREER_INTAKE_SPREADSHEET_ID=YOUR_PRIVATE_SHEET_ID bash deploy/google-cloud/create-vm.sh" >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Set a Google Cloud project first: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Using project: ${PROJECT_ID}"
echo "Zone: ${ZONE}"

gcloud services enable   compute.googleapis.com   iam.googleapis.com   sheets.googleapis.com   --project "${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}"     --project "${PROJECT_ID}"     --display-name "Terry Career Agent"
fi

if ! gcloud compute disks describe "${DATA_DISK}" --zone "${ZONE}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute disks create "${DATA_DISK}"     --project "${PROJECT_ID}"     --zone "${ZONE}"     --size "${DATA_DISK_SIZE}"     --type pd-standard
fi

if ! gcloud compute instances describe "${INSTANCE}" --zone "${ZONE}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute instances create "${INSTANCE}"     --project "${PROJECT_ID}"     --zone "${ZONE}"     --machine-type "${MACHINE_TYPE}"     --image-family debian-12     --image-project debian-cloud     --boot-disk-size "${BOOT_DISK_SIZE}"     --boot-disk-type pd-standard     --no-boot-disk-auto-delete     --disk "name=${DATA_DISK},device-name=jst-data,mode=rw,boot=no,auto-delete=no"     --service-account "${SA_EMAIL}"     --scopes "https://www.googleapis.com/auth/spreadsheets"     --metadata "career-intake-spreadsheet-id=${CAREER_INTAKE_SPREADSHEET_ID},career-intake-sheet-name=${CAREER_INTAKE_SHEET_NAME}"     --metadata-from-file startup-script=deploy/google-cloud/bootstrap-vm.sh
else
  echo "Instance ${INSTANCE} already exists; leaving it unchanged."
fi

cat <<EOF

VM creation requested.

Career Agent service account:
  ${SA_EMAIL}

The intake Sheet must be shared with that address as Editor before the
05:10 / 17:10 queue sync can read and update it.

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
