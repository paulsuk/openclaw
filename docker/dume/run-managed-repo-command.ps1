param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$SecretFileName,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$RepoDir,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Command
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "[run-managed-repo-command] $Message"
}

if (-not $Command -or $Command.Count -eq 0) {
    Fail "missing command"
}

$secretRoot = if ($env:OPENCLAW_MANAGED_REPO_SECRET_ROOT) {
    $env:OPENCLAW_MANAGED_REPO_SECRET_ROOT
} else {
    "C:\Users\sukpa\Documents\projects\.openclaw-docker\managed-repo-secrets"
}

$secretFile = Join-Path $secretRoot $SecretFileName

if (-not (Test-Path -LiteralPath $RepoDir -PathType Container)) {
    Fail "repo dir not found: $RepoDir"
}

if ($SecretFileName -ne "none") {
    if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) {
        Fail "secret file not found: $secretFile"
    }

    Get-Content -LiteralPath $secretFile | ForEach-Object {
        $line = $_.Trim()

        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $parts = $line -split "=", 2
        if ($parts.Count -ne 2) {
            Fail "invalid env line in ${secretFile}: $line"
        }

        $name = $parts[0].Trim()
        $value = $parts[1]

        if (-not $name) {
            Fail "invalid env var name in ${secretFile}: $line"
        }

        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

Push-Location -LiteralPath $RepoDir
try {
    & $Command[0] @($Command | Select-Object -Skip 1)
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
