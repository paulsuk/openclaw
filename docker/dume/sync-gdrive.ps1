$ErrorActionPreference = "Stop"

$rcloneExe = "C:\Users\sukpa\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.73.4-windows-amd64\rclone.exe"
$localPath = "C:\Users\sukpa\Documents\projects\gdrive_sync"
$remotePath = "gdrive:projects_sync"
$logDir = "C:\Users\sukpa\Documents\projects\.openclaw-docker\logs"
$logFile = Join-Path $logDir "rclone-sync.log"
$lockFile = Join-Path $logDir "rclone-sync.lock"

if (-not (Test-Path $rcloneExe)) {
  $rcloneCommand = Get-Command rclone -ErrorAction SilentlyContinue
  if ($rcloneCommand) {
    $rcloneExe = $rcloneCommand.Source
  } else {
    throw "rclone executable not found."
  }
}

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$lockHandle = $null

try {
  try {
    $lockHandle = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) skip overlapping sync run"
    exit 0
  }

  Add-Content -Path $logFile -Value "$(Get-Date -Format o) starting sync $localPath -> $remotePath"
  & $rcloneExe sync $localPath $remotePath --create-empty-src-dirs --transfers 4 --checkers 8
  Add-Content -Path $logFile -Value "$(Get-Date -Format o) sync completed"
} catch {
  Add-Content -Path $logFile -Value "$(Get-Date -Format o) sync failed: $($_.Exception.Message)"
  throw
} finally {
  if ($lockHandle) {
    $lockHandle.Dispose()
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
}
