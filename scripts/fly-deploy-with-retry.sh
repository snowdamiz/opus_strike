#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: bash scripts/${SCRIPT_NAME} <flyctl deploy command...>

Retries a Fly deploy command to absorb transient Fly Machines API failures.

Environment:
  FLY_DEPLOY_ATTEMPTS             Number of attempts before failing (default: 3)
  FLY_DEPLOY_RETRY_DELAY_SECONDS  Initial retry delay in seconds (default: 20)
EOF
}

read_positive_int() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid ${name}: ${value}" >&2
    exit 2
  fi

  printf '%s' "$value"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if (( $# == 0 )); then
  usage >&2
  exit 2
fi

attempts="$(read_positive_int FLY_DEPLOY_ATTEMPTS "${FLY_DEPLOY_ATTEMPTS:-3}")"
delay_seconds="$(read_positive_int FLY_DEPLOY_RETRY_DELAY_SECONDS "${FLY_DEPLOY_RETRY_DELAY_SECONDS:-20}")"

attempt=1
while true; do
  echo "Fly deploy attempt ${attempt}/${attempts}: $*"

  set +e
  "$@"
  status=$?
  set -e

  if (( status == 0 )); then
    exit 0
  fi

  if (( attempt >= attempts )); then
    echo "Fly deploy failed after ${attempts} attempts with exit code ${status}." >&2
    exit "$status"
  fi

  echo "Fly deploy failed with exit code ${status}; retrying in ${delay_seconds}s..." >&2
  sleep "$delay_seconds"

  attempt=$((attempt + 1))
  delay_seconds=$((delay_seconds * 2))
done
