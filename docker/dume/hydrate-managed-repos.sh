#!/bin/sh
set -eu

log() {
  printf '%s\n' "[hydrate-managed-repos] $*" >&2
}

repo_id() {
  printf '%s' "$1" | sed 's#^/##; s#[^A-Za-z0-9._-]#_#g'
}

sha_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    python3 - <<'PY' "$1"
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
print(hashlib.sha256(path.read_bytes()).hexdigest())
PY
  fi
}

ensure_python_repo() {
  repo="$1"
  req="$repo/requirements.txt"
  venv_dir="$repo/.venv"
  marker="$venv_dir/.hydrated"
  wanted_hash=$(sha_file "$req")
  venv_python="$venv_dir/bin/python"

  if [ ! -x "$venv_python" ] && [ -x "$venv_dir/Scripts/python.exe" ]; then
    venv_python="$venv_dir/Scripts/python.exe"
  fi

  if [ -x "$venv_python" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$wanted_hash" ]; then
    log "python deps up to date: $repo"
    return 0
  fi

  log "hydrating python repo: $repo"
  python3 -m venv "$venv_dir"
  venv_python="$venv_dir/bin/python"
  if [ ! -x "$venv_python" ] && [ -x "$venv_dir/Scripts/python.exe" ]; then
    venv_python="$venv_dir/Scripts/python.exe"
  fi
  "$venv_python" -m pip install --upgrade pip setuptools wheel
  "$venv_python" -m pip install -r "$req"
  printf '%s\n' "$wanted_hash" >"$marker"
}

ensure_node_repo() {
  repo="$1"
  lockfile="$repo/package-lock.json"
  pkgfile="$repo/package.json"
  node_modules="$repo/node_modules"
  marker="$node_modules/.hydrated"
  source_file="$lockfile"

  if [ -f "$lockfile" ]; then
    install_cmd="npm ci"
  else
    source_file="$pkgfile"
    install_cmd="npm install"
  fi

  wanted_hash=$(sha_file "$source_file")

  if [ -d "$node_modules" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$wanted_hash" ]; then
    log "node deps up to date: $repo"
    return 0
  fi

  log "hydrating node repo: $repo"
  rm -rf "$node_modules"
  (
    cd "$repo"
    $install_cmd
  )
  mkdir -p "$node_modules"
  printf '%s\n' "$wanted_hash" >"$marker"
}

hydrate_repo() {
  repo="$1"
  if [ ! -d "$repo" ]; then
    log "skipping missing repo: $repo"
    return 0
  fi

  if [ -f "$repo/requirements.txt" ]; then
    ensure_python_repo "$repo"
  fi

  if [ -f "$repo/package-lock.json" ] || [ -f "$repo/package.json" ]; then
    ensure_node_repo "$repo"
  fi
}

collect_repos() {
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@"
    return 0
  fi

  if [ -n "${OPENCLAW_MANAGED_REPOS:-}" ]; then
    printf '%s' "$OPENCLAW_MANAGED_REPOS" | tr ',' '\n'
    return 0
  fi

  cat <<'EOF'
/workspace/repos/ResyBot
/workspace/repos/fantasy-analytics/api
/workspace/repos/fantasy-analytics/web
EOF
}

main() {
  collect_repos "$@" | while IFS= read -r repo; do
    [ -n "$repo" ] || continue
    hydrate_repo "$repo"
  done
}

main "$@"
