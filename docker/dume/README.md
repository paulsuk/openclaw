# DUM-E Docker Runtime

This directory contains Paul's host-side control-plane files for the local DUM-E runtime.

## Runtime Modes

### Base runtime

This is the default shape for installs that do not need Linux-native coding repos inside Docker.

- Compose file: `docker-compose.dume.yml`
- Runtime image: `OPENCLAW_IMAGE`
- Shared writable workspace: `/workspace/shared`
- No `/workspace/repos`
- No managed-repo dependency hydration

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
- `hydrate-managed-repos.sh`
  - Hash-based repo dependency hydrator
  - Rehydrates Python repos when `requirements.txt` changes
  - Rehydrates Node repos when `package-lock.json` changes, or `package.json` changes if no lockfile exists
- `hydrate-managed-repos.test.sh`
  - Host smoke test for the hydrator
- `start-dume-docker.ps1`
  - Host startup wrapper
  - Reads `.env`
  - Uses only base compose in base mode
  - Adds the managed-repo override and `--build` only when `OPENCLAW_ENABLE_MANAGED_REPOS=1`
- `sync-gdrive.ps1`
  - Host-side recurring `rclone` loop

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
& $docker exec dume-openclaw sh -lc "/workspace/repos/ResyBot/.venv/bin/python - <<'PY'
import requests, dotenv
print('resybot-python-ok')
PY"
& $docker exec dume-openclaw sh -lc "/workspace/repos/fantasy-analytics/api/.venv/bin/python - <<'PY'
import requests, dotenv, duckdb, pyarrow, scipy
print('fa-api-python-ok')
PY"
& $docker exec dume-openclaw sh -lc "test -d /workspace/repos/fantasy-analytics/web/node_modules && echo fantasy-web-node-modules-ok"
```

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
