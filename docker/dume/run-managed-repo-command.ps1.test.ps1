Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "run-managed-repo-command.ps1"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("run-managed-repo-command-" + [guid]::NewGuid().ToString("N"))
$secretRoot = Join-Path $tempRoot "secrets"
$repoDir = Join-Path $tempRoot "repo"

New-Item -ItemType Directory -Path $secretRoot | Out-Null
New-Item -ItemType Directory -Path $repoDir | Out-Null

try {
    Set-Content -LiteralPath (Join-Path $secretRoot "ResyBot.env") -Value @"
RESY_API_KEY=test-api-key
RESY_AUTH_TOKEN=test-auth-token
"@ -NoNewline

    Set-Content -LiteralPath (Join-Path $repoDir "show-env.ps1") -Value @'
Write-Output "$env:RESY_API_KEY|$env:RESY_AUTH_TOKEN|$((Get-Location).Path)"
'@ -NoNewline

    $env:OPENCLAW_MANAGED_REPO_SECRET_ROOT = $secretRoot
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath "ResyBot.env" $repoDir powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoDir "show-env.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "wrapper exited with code $LASTEXITCODE"
    }

    $expected = "test-api-key|test-auth-token|$repoDir"
    if (($output | Out-String).Trim() -ne $expected) {
        throw "unexpected output: $output"
    }

    Set-Content -LiteralPath (Join-Path $repoDir "show-pwd.ps1") -Value @'
Write-Output (Get-Location).Path
'@ -NoNewline

    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath "none" $repoDir powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoDir "show-pwd.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "wrapper exited with code $LASTEXITCODE for no-secret path"
    }

    if (($output | Out-String).Trim() -ne $repoDir) {
        throw "unexpected no-secret output: $output"
    }

    Write-Output "run-managed-repo-command PowerShell smoke test passed"
} finally {
    Remove-Item Env:OPENCLAW_MANAGED_REPO_SECRET_ROOT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
