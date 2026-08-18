$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AgentSource = Join-Path $RepoRoot "agent\novum_agent.py"
$StateDir = Join-Path $env:USERPROFILE ".novum-pc-bridge"
$ConfigPath = Join-Path $StateDir "config.json"
$TokenPath = Join-Path $StateDir "token.txt"

Write-Host ""
Write-Host "NOVUM ChatGPT PC Bridge v0.1" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

if (-not (Test-Path $AgentSource)) {
    throw "Agent not found: $AgentSource"
}

$Python = $null
foreach ($candidate in @("py", "python")) {
    try {
        & $candidate --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $Python = $candidate
            break
        }
    } catch {}
}

if (-not $Python) {
    throw "Python 3 was not found. Install Python, then run this script again."
}

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

if (-not (Test-Path $ConfigPath)) {
    $config = [ordered]@{
        host = "127.0.0.1"
        port = 8765
        allowed_roots = @("%USERPROFILE%")
        allow_write = $true
        allow_shell = $false
        shell_timeout_seconds = 120
        max_read_bytes = 2000000
        max_list_entries = 500
    }

    Write-Host ""
    Write-Host "By default ChatGPT can read/write inside your Windows user profile." -ForegroundColor Yellow
    $shellAnswer = Read-Host "Enable shell.run for this test? This lets ChatGPT execute commands as your current Windows user. [y/N]"
    if ($shellAnswer -match '^(y|yes|o|oui)$') {
        $config.allow_shell = $true
    }

    $json = $config | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Created $ConfigPath" -ForegroundColor Green
} else {
    Write-Host "Keeping existing config: $ConfigPath" -ForegroundColor DarkGray
}

if (-not (Test-Path $TokenPath)) {
    $token = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Minimum 0 -Maximum 16) })
    [System.IO.File]::WriteAllText($TokenPath, $token, [System.Text.Encoding]::ASCII)
} else {
    $token = (Get-Content -Raw $TokenPath).Trim()
}

$Launcher = Join-Path $StateDir "start-novum-agent.cmd"
$pythonCommand = if ($Python -eq "py") { "py -3" } else { "python" }
$launcherBody = @"
@echo off
cd /d "$RepoRoot"
$pythonCommand "$AgentSource"
pause
"@
[System.IO.File]::WriteAllText($Launcher, $launcherBody, [System.Text.Encoding]::ASCII)

Write-Host ""
Write-Host "Installed local state in: $StateDir" -ForegroundColor Green
Write-Host ""
Write-Host "PAIRING TOKEN" -ForegroundColor Cyan
Write-Host $token -ForegroundColor White
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Double-click: $Launcher"
Write-Host "  2. Chrome -> chrome://extensions -> Developer mode -> Load unpacked"
Write-Host "  3. Select: $(Join-Path $RepoRoot 'extension')"
Write-Host "  4. Open ChatGPT, open the NOVUM extension popup, paste the token above"
Write-Host "  5. Enable Arm, click Test agent, then Inject protocol into ChatGPT"
Write-Host ""
Write-Host "Config: $ConfigPath"
Write-Host "Token:  $TokenPath"
Write-Host ""
Write-Host "The v0.1 agent binds to localhost only. Do NOT expose port 8765 to the internet." -ForegroundColor Yellow
