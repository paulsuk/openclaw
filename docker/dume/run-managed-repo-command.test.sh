#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/run-managed-repo-command.sh"

TMPDIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

SECRET_ROOT="$TMPDIR/secrets"
REPO_DIR="$TMPDIR/repo"
mkdir -p "$SECRET_ROOT" "$REPO_DIR"

cat >"$SECRET_ROOT/ResyBot.env" <<'EOF'
RESY_API_KEY=test-api-key
RESY_AUTH_TOKEN=test-auth-token
EOF

cat >"$REPO_DIR/show-env.sh" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "${RESY_API_KEY}|${RESY_AUTH_TOKEN}|$(pwd)"
EOF
chmod +x "$REPO_DIR/show-env.sh"

OUTPUT=$(OPENCLAW_MANAGED_REPO_SECRET_ROOT="$SECRET_ROOT" "$SCRIPT" ResyBot.env "$REPO_DIR" -- sh "$REPO_DIR/show-env.sh")
test "$OUTPUT" = "test-api-key|test-auth-token|$REPO_DIR"

cat >"$REPO_DIR/show-pwd.sh" <<'EOF'
#!/bin/sh
set -eu
pwd
EOF
chmod +x "$REPO_DIR/show-pwd.sh"

OUTPUT=$(OPENCLAW_MANAGED_REPO_SECRET_ROOT="$SECRET_ROOT" "$SCRIPT" none "$REPO_DIR" -- sh "$REPO_DIR/show-pwd.sh")
test "$OUTPUT" = "$REPO_DIR"

echo "run-managed-repo-command smoke test passed"
