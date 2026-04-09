$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$envFile = Join-Path $scriptDir ".env"
$composeFile = Join-Path $repoRoot "docker-compose.dume.yml"

while ($true) {
  try {
    docker info | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

docker compose --env-file $envFile -f $composeFile up -d
