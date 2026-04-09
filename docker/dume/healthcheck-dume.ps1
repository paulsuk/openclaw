$ErrorActionPreference = "Stop"

$response = Invoke-RestMethod -Uri "http://127.0.0.1:18789/healthz"
$response | ConvertTo-Json -Depth 10
