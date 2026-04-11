$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$envFile = Join-Path $scriptDir ".env"
$composeFile = Join-Path $repoRoot "docker-compose.dume.yml"
$managedReposComposeFile = Join-Path $repoRoot "docker-compose.dume.managed-repos.yml"
$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

if (-not (Test-Path $dockerExe)) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCommand) {
    $dockerExe = $dockerCommand.Source
  } else {
    throw "Docker CLI not found."
  }
}

while ($true) {
  try {
    & $dockerExe info | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

$managedReposEnabled = $false
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^OPENCLAW_ENABLE_MANAGED_REPOS=(.+)$') {
    $managedReposEnabled = $Matches[1].Trim() -eq '1'
  }
}

$composeArgs = @("compose", "--env-file", $envFile, "-f", $composeFile)
if ($managedReposEnabled) {
  $composeArgs += @("-f", $managedReposComposeFile, "up", "-d", "--build")
} else {
  $composeArgs += @("up", "-d")
}

& $dockerExe @composeArgs
