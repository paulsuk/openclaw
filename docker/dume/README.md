# DUM-E Docker Runtime

This directory contains Paul's host-side control-plane files for the local DUM-E runtime.

## Release Ritual

When Paul wants local DUM-E to pick up new OpenClaw fork changes, use this sequence:

1. Push the desired changes to Paul's fork.
2. Publish or retag `ghcr.io/paulsuk/openclaw:live` so it points at the fork build DUM-E should run.
3. Restart local DUM-E from `start-dume-docker.ps1`.
4. Rebuild the local DUM-E overlay only if the overlay itself changed or if power-user managed-repo support needs a refreshed image.

The important rule is that `ghcr.io/paulsuk/openclaw:live` is the normal release handoff surface for Paul's machine. The local overlay is a second layer on top of that base image, not the primary release vehicle.

Upstream fork sync is a separate maintenance lane. Keeping `paulsuk/openclaw` current with `openclaw/openclaw` does not by itself change the running DUM-E image. The runtime still changes only when `ghcr.io/paulsuk/openclaw:live` is published or retagged and then pulled/restarted locally.

## Runtime Modes

### Base runtime

This is the default shape for installs that do not need Linux-native coding repos inside Docker.

- Compose file: `docker-compose.dume.yml`
- Runtime image: `OPENCLAW_IMAGE`
- Shared writable workspace: `/workspace/shared`
- No `/workspace/repos`
- No managed-repo dependency hydration
- Follows `ghcr.io/paulsuk/openclaw:live` directly after a normal restart

Set:

```env
OPENCLAW_ENABLE_MANAGED_REPOS=0
OPENCLAW_AUTO_HYDRATE_MANAGED_REPOS=0
OPENCLAW_RUNTIME_IMAGE=<same as OPENCLAW_IMAGE>
```

### Power-user managed-repo mode

This is Paul's current machine setup for coding inside DUM-E.

- Base compose: `docker-compose.dume.yml`
- Override compose: `docker-compose.dume.managed-repos.yml`
- Runtime image: `OPENCLAW_DUME_IMAGE`
- Managed repo root: `/workspace/repos`
- Managed repo volume: `dume_managed_repos`
- Python repos use repo-local `.venv`
- Node repos use repo-local `node_modules`
- Still tracks the published `ghcr.io/paulsuk/openclaw:live` base first; the local overlay is only for optional power-user extras

Set:

```env
OPENCLAW_ENABLE_MANAGED_REPOS=1
OPENCLAW_AUTO_HYDRATE_MANAGED_REPOS=1
OPENCLAW_RUNTIME_IMAGE=openclaw-dume-local
OPENCLAW_DUME_IMAGE=openclaw-dume-local
OPENCLAW_MANAGED_REPOS=/workspace/repos/ResyBot,/workspace/repos/fantasy-analytics/api,/workspace/repos/fantasy-analytics/web
```

## Files

- `Dockerfile`
  - Small local overlay image on top of `OPENCLAW_IMAGE`
  - Adds `python3-pip` and `python3-venv`
  - Installs `/usr/local/bin/hydrate-managed-repos.sh`
  - Installs `/usr/local/bin/run-managed-repo-command.sh`
- `hydrate-managed-repos.sh`
  - Hash-based repo dependency hydrator
  - Rehydrates Python repos when `requirements.txt` changes
  - Rehydrates Node repos when `package-lock.json` changes, or `package.json` changes if no lockfile exists
- `run-managed-repo-command.sh`
  - Loads one repo-specific `.env` file from the private runtime secret root
  - Executes a command inside the target managed repo with those vars exported
- `run-managed-repo-command.ps1`
  - Host-side equivalent for Windows development
  - Loads one repo-specific `.env` file from the same canonical secret root
  - Executes a command inside the target host repo with those vars exported for that process only
- `hydrate-managed-repos.test.sh`
  - Host smoke test for the hydrator
- `run-managed-repo-command.test.sh`
  - Host smoke test for repo-secret injection
- `run-managed-repo-command.ps1.test.ps1`
  - Host PowerShell smoke test for repo-secret injection
- `start-dume-docker.ps1`
  - Host startup wrapper
  - Reads `.env`
  - Uses only base compose in base mode
  - Adds the managed-repo override and `--build` only when `OPENCLAW_ENABLE_MANAGED_REPOS=1`
- `sync-gdrive.ps1`
  - Host-side recurring `rclone` loop

## Update Paths

### Normal release uptake

Use this when fork changes landed in the published `ghcr.io/paulsuk/openclaw:live` image and the local overlay files did not change.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\sukpa\Documents\projects\openclaw\docker\dume\start-dume-docker.ps1
```

This should pull or reuse the updated `ghcr.io/paulsuk/openclaw:live` base and restart DUM-E without rebuilding any local overlay layer.

### Overlay rebuild required

Rebuild the local overlay only when one of these is true:

- files in `openclaw/docker/dume/` changed
- the managed-repo compose override changed
- the optional power-user repo tooling or dependency bootstrap changed

In that case, keep `OPENCLAW_ENABLE_MANAGED_REPOS=1` and rerun the same startup wrapper. The script adds `--build` in managed-repo mode, so the local overlay image is rebuilt as part of the restart.

### Managed repo hydration

Managed repo hydration is optional power-user behavior, not part of the base release ritual.

- Base runtime: no hydration step
- Power-user runtime: hydration may run automatically at startup when enabled
- Manual hydration is only needed if the managed repos exist and you want to refresh their dependency state explicitly

## Managed Repo Secrets

Canonical secret root:

- Host: `C:\Users\sukpa\Documents\projects\.openclaw-docker\managed-repo-secrets`
- Container: `/home/node/.openclaw/managed-repo-secrets`

Rules:

- one `.env` file per managed repo
- host and container share the same underlying files
- do not keep repo secrets in repo trees
- do not put repo secrets in `gdrive_sync`
- DUM-E may edit these files if necessary, but that is not the recommended default
- repos with no managed env can use `none` as the secret-file argument and still use the same wrapper surface

Current canonical files:

- `ResyBot.env`
- `fantasy-analytics-api.env`
- `fantasy-analytics-web.env` only if ever needed

Container execution pattern:

```sh
/usr/local/bin/run-managed-repo-command.sh ResyBot.env /workspace/repos/ResyBot -- python3 -m cli.main plan ...
/usr/local/bin/run-managed-repo-command.sh none /workspace/repos/ResyBot -- python3 -m cli.main --help
```

That pattern loads the repo env file at execution time instead of making all repo secrets ambient in the whole container.

Host execution pattern:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\sukpa\Documents\projects\openclaw\docker\dume\run-managed-repo-command.ps1 ResyBot.env C:\Users\sukpa\Documents\projects\ResyBot python -m cli.main plan ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\sukpa\Documents\projects\openclaw\docker\dume\run-managed-repo-command.ps1 none C:\Users\sukpa\Documents\projects\ResyBot python -m cli.main --help
```

That uses the same canonical host secret file without copying secrets into the repo tree.

## Verification

Host:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\sukpa\Documents\projects\openclaw\docker\dume\start-dume-docker.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

Managed-repo mode:

```powershell
$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

& $docker exec dume-openclaw sh -lc "python3 -m pip --version"
& $docker exec dume-openclaw sh -lc "/usr/local/bin/hydrate-managed-repos.sh /workspace/repos/ResyBot /workspace/repos/fantasy-analytics/api /workspace/repos/fantasy-analytics/web"
& $docker exec dume-openclaw sh -lc "/usr/local/bin/run-managed-repo-command.sh ResyBot.env /workspace/repos/ResyBot -- env | grep '^RESY_'"
& $docker exec dume-openclaw sh -lc "/workspace/repos/ResyBot/.venv/bin/python - <<'PY'
import requests, dotenv
print('resybot-python-ok')
PY"
& $docker exec dume-openclaw sh -lc "/workspace/repos/fantasy-analytics/api/.venv/bin/python - <<'PY'
import requests, dotenv, duckdb, pyarrow, scipy
print('fa-api-python-ok')
PY"
& $docker exec dume-openclaw sh -lc "test -d /workspace/repos/fantasy-analytics/web/node_modules && echo fantasy-web-node-modules-ok"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\sukpa\Documents\projects\openclaw\docker\dume\run-managed-repo-command.ps1.test.ps1
```

Release follow-through for power-user mode:

1. publish or retag `ghcr.io/paulsuk/openclaw:live`
2. rerun `start-dume-docker.ps1`
3. run manual hydration only if auto-hydration is disabled or you need to force a dependency refresh

Base-mode sanity:

```powershell
$tmp = Join-Path $env:TEMP "dume-no-managed.env"

@'
OPENCLAW_IMAGE=ghcr.io/paulsuk/openclaw:live
OPENCLAW_RUNTIME_IMAGE=ghcr.io/paulsuk/openclaw:live
OPENCLAW_CONTAINER_NAME=dume-openclaw-test
OPENCLAW_SHARED_GDRIVE_DIR=C:\Users\sukpa\Documents\projects\gdrive_sync
OPENCLAW_SHARED_EXCHANGE_DIR=C:\Users\sukpa\Documents\projects\exchange
OPENCLAW_STATE_DIR=C:\Users\sukpa\Documents\projects\.openclaw-docker
OPENCLAW_SSH_DIR=C:\Users\sukpa\.openclaw-docker-ssh
OPENCLAW_GATEWAY_PORT=28789
OPENCLAW_BRIDGE_PORT=28790
OPENCLAW_TZ=America/New_York
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_ENABLE_MANAGED_REPOS=0
OPENCLAW_AUTO_HYDRATE_MANAGED_REPOS=0
OPENCLAW_MANAGED_REPOS=
'@ | Set-Content -Path $tmp -NoNewline

& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose --env-file $tmp -f C:\Users\sukpa\Documents\projects\openclaw\docker-compose.dume.yml config
Remove-Item $tmp
```

In base mode, the resolved compose should:

- use `ghcr.io/paulsuk/openclaw:live`
- not mount `/workspace/repos`
- not require the managed-repo override compose file
