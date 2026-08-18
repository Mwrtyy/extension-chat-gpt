$ErrorActionPreference = "Stop"

$BaseUrl = "http://127.0.0.1:8765"
$TokenPath = Join-Path $env:USERPROFILE ".novum-pc-bridge\token.txt"

if (-not (Test-Path $TokenPath)) {
    throw "Pairing token not found. Run scripts\install.ps1 first."
}

$Token = (Get-Content -Raw $TokenPath).Trim()
$Headers = @{ "X-Novum-Token" = $Token }

Write-Host "[1/3] Health" -ForegroundColor Cyan
$health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
if (-not $health.ok) { throw "Health check failed" }
Write-Host "OK - agent v$($health.version)" -ForegroundColor Green

Write-Host "[2/3] pc.status" -ForegroundColor Cyan
$statusBody = @{ tool = "pc.status"; args = @{} } | ConvertTo-Json -Depth 5
$status = Invoke-RestMethod -Uri "$BaseUrl/tool" -Method Post -Headers $Headers -ContentType "application/json" -Body $statusBody
if (-not $status.ok) { throw "pc.status failed" }
Write-Host "OK - $($status.result.user)@$($status.result.hostname)" -ForegroundColor Green

Write-Host "[3/3] fs.list USERPROFILE" -ForegroundColor Cyan
$listBody = @{ tool = "fs.list"; args = @{ path = $env:USERPROFILE; limit = 5 } } | ConvertTo-Json -Depth 5
$list = Invoke-RestMethod -Uri "$BaseUrl/tool" -Method Post -Headers $Headers -ContentType "application/json" -Body $listBody
if (-not $list.ok) { throw "fs.list failed" }
Write-Host "OK - returned $($list.result.entries.Count) entries" -ForegroundColor Green

Write-Host ""
Write-Host "NOVUM bridge smoke test PASSED." -ForegroundColor Green
