#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/hydrate-managed-repos.sh"

TMPDIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

STATE_HOME="$TMPDIR/state"
mkdir -p "$STATE_HOME"

PY_REPO="$TMPDIR/python-repo"
mkdir -p "$PY_REPO"
cat >"$PY_REPO/requirements.txt" <<'EOF'
requests
EOF

NODE_REPO="$TMPDIR/node-repo"
mkdir -p "$NODE_REPO"
cat >"$NODE_REPO/package.json" <<'EOF'
{
  "name": "node-repo",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "left-pad": "1.3.0"
  }
}
EOF
cat >"$NODE_REPO/package-lock.json" <<'EOF'
{
  "name": "node-repo",
  "version": "0.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "node-repo",
      "version": "0.0.0",
      "dependencies": {
        "left-pad": "1.3.0"
      }
    },
    "node_modules/left-pad": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
      "integrity": "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==",
      "deprecated": "use String.prototype.padStart()"
    }
  }
}
EOF

OPENCLAW_STATE_HOME="$STATE_HOME" "$SCRIPT" "$PY_REPO" "$NODE_REPO"

test -x "$PY_REPO/.venv/bin/python" || test -x "$PY_REPO/.venv/Scripts/python.exe"
test -f "$PY_REPO/.venv/.hydrated"
test -d "$NODE_REPO/node_modules"
test -f "$NODE_REPO/node_modules/.hydrated"

PY_HASH_1=$(cat "$PY_REPO/.venv/.hydrated")
NODE_HASH_1=$(cat "$NODE_REPO/node_modules/.hydrated")

OPENCLAW_STATE_HOME="$STATE_HOME" "$SCRIPT" "$PY_REPO" "$NODE_REPO"

PY_HASH_2=$(cat "$PY_REPO/.venv/.hydrated")
NODE_HASH_2=$(cat "$NODE_REPO/node_modules/.hydrated")

test "$PY_HASH_1" = "$PY_HASH_2"
test "$NODE_HASH_1" = "$NODE_HASH_2"

echo "hydrate-managed-repos smoke test passed"
