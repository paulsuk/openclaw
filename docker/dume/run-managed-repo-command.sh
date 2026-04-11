#!/bin/sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  run-managed-repo-command.sh <secret-file> <repo-dir> -- <command...>

Example:
  run-managed-repo-command.sh ResyBot.env /workspace/repos/ResyBot -- python3 -m cli.main plan ...
  run-managed-repo-command.sh none /workspace/repos/ResyBot -- python3 -m cli.main --help
EOF
  exit 2
}

if [ "$#" -lt 4 ]; then
  usage
fi

secret_file_name="$1"
repo_dir="$2"
shift 2

if [ "$1" != "--" ]; then
  usage
fi
shift 1

if [ "$#" -eq 0 ]; then
  usage
fi

secret_root="${OPENCLAW_MANAGED_REPO_SECRET_ROOT:-/home/node/.openclaw/managed-repo-secrets}"
secret_file="$secret_root/$secret_file_name"

if [ ! -d "$repo_dir" ]; then
  echo "[run-managed-repo-command] repo dir not found: $repo_dir" >&2
  exit 1
fi

if [ "$secret_file_name" != "none" ]; then
  if [ ! -f "$secret_file" ]; then
    echo "[run-managed-repo-command] secret file not found: $secret_file" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$secret_file"
  set +a
fi

cd "$repo_dir"
exec "$@"
