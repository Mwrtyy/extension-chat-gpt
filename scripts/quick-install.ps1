$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InstallRoot = Join-Path $env:LOCALAPPDATA "NOVUM-ChatGPT"
$StateDir = Join-Path $env:USERPROFILE ".novum-pc-bridge"
$AgentDir = Join-Path $InstallRoot "agent"
$ExtensionDir = Join-Path $InstallRoot "extension"
$AgentPath = Join-Path $AgentDir "novum_agent.py"
$TokenPath = Join-Path $StateDir "token.txt"
$ConfigPath = Join-Path $StateDir "config.json"
$StartAgentVbs = Join-Path $InstallRoot "start-agent.vbs"
$LaunchScript = Join-Path $InstallRoot "launch-novum.ps1"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "NOVUM ChatGPT.lnk"

Write-Host ""
Write-Host "NOVUM ChatGPT - installation rapide" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

function Find-Python {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @{ File = $py.Source; Prefix = "-3" } }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python -and $python.Source -notlike "*WindowsApps*") {
        return @{ File = $python.Source; Prefix = "" }
    }

    $candidates = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs\Python") -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($candidates) { return @{ File = $candidates[0].FullName; Prefix = "" } }
    return $null
}

$pythonInfo = Find-Python
if (-not $pythonInfo) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Python 3 n'est pas installe et winget est introuvable. Installe Python 3 puis relance INSTALL-NOVUM.bat."
    }

    Write-Host "Python absent -> installation automatique de Python 3.12..." -ForegroundColor Yellow
    & $winget.Source install --id Python.Python.3.12 -e --scope user --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "L'installation automatique de Python a echoue." }
    Start-Sleep -Seconds 2
    $pythonInfo = Find-Python
    if (-not $pythonInfo) { throw "Python a ete installe mais n'a pas ete retrouve. Ferme/reouvre Windows puis relance l'installateur." }
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $StateDir | Out-Null

if (Test-Path $AgentDir) { Remove-Item $AgentDir -Recurse -Force }
if (Test-Path $ExtensionDir) { Remove-Item $ExtensionDir -Recurse -Force }
Copy-Item (Join-Path $RepoRoot "agent") $AgentDir -Recurse -Force
Copy-Item (Join-Path $RepoRoot "extension") $ExtensionDir -Recurse -Force

# Full current-user filesystem visibility on mounted Windows filesystem drives.
$roots = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root } | ForEach-Object { $_.Root } | Sort-Object -Unique)
if (-not $roots) { $roots = @($env:USERPROFILE) }

$config = [ordered]@{
    host = "127.0.0.1"
    port = 8765
    allowed_roots = $roots
    allow_write = $true
    allow_shell = $true
    shell_timeout_seconds = 120
    max_read_bytes = 2000000
    max_list_entries = 500
}
$configJson = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($ConfigPath, $configJson, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $TokenPath) {
    $token = (Get-Content -Raw $TokenPath).Trim()
} else {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    [System.IO.File]::WriteAllText($TokenPath, $token, [System.Text.Encoding]::ASCII)
}

# The installed unpacked extension receives the pairing token automatically.
$localConfig = "globalThis.NOVUM_BOOTSTRAP_TOKEN = `"$token`";`r`n"
[System.IO.File]::WriteAllText((Join-Path $ExtensionDir "local-config.js"), $localConfig, [System.Text.Encoding]::ASCII)

$prefix = [string]$pythonInfo.Prefix
$pythonFile = [string]$pythonInfo.File
$command = if ($prefix) {
    "`"$pythonFile`" $prefix `"$AgentPath`""
} else {
    "`"$pythonFile`" `"$AgentPath`""
}

$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "$($command.Replace('"','""'))", 0, False
"@
[System.IO.File]::WriteAllText($StartAgentVbs, $vbs, [System.Text.Encoding]::ASCII)

$launch = @'
$ErrorActionPreference = "SilentlyContinue"
$InstallRoot = Join-Path $env:LOCALAPPDATA "NOVUM-ChatGPT"
$StartAgentVbs = Join-Path $InstallRoot "start-agent.vbs"
$online = $false
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 1
    $online = [bool]$health.ok
} catch {}
if (-not $online) {
    Start-Process -FilePath "wscript.exe" -ArgumentList @("`"$StartAgentVbs`"") -WindowStyle Hidden
    Start-Sleep -Milliseconds 1200
}

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) }

$url = "https://chatgpt.com/?novum=1"
if ($chromeCandidates.Count -gt 0) {
    Start-Process -FilePath $chromeCandidates[0] -ArgumentList @($url)
} else {
    Start-Process $url
}
'@
[System.IO.File]::WriteAllText($LaunchScript, $launch, (New-Object System.Text.UTF8Encoding($false)))

# Desktop shortcut: after first-time Chrome extension loading, this is the only thing to launch.
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($DesktopShortcut)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LaunchScript`""
$shortcut.WorkingDirectory = $InstallRoot
$chromeIcon = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($chromeIcon) { $shortcut.IconLocation = "$chromeIcon,0" }
$shortcut.Save()

# Start the local agent now.
Start-Process -FilePath "wscript.exe" -ArgumentList @("`"$StartAgentVbs`"") -WindowStyle Hidden
Start-Sleep -Milliseconds 1200
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 3
    if (-not $health.ok) { throw "health false" }
    Write-Host "Agent NOVUM: OK" -ForegroundColor Green
} catch {
    Write-Host "L'agent n'a pas repondu. Le raccourci a quand meme ete cree." -ForegroundColor Yellow
}

Set-Clipboard -Value $ExtensionDir

Write-Host ""
Write-Host "Installation terminee." -ForegroundColor Green
Write-Host "Une seule etape Chrome reste a faire UNE FOIS :" -ForegroundColor Cyan
Write-Host "  1. Active 'Mode developpeur' dans chrome://extensions" -ForegroundColor White
Write-Host "  2. Clique 'Charger l'extension non empaquetee' et choisis le dossier deja ouvert." -ForegroundColor White
Write-Host ""
Write-Host "Dossier extension (copie dans le presse-papiers):" -ForegroundColor DarkGray
Write-Host $ExtensionDir -ForegroundColor White
Write-Host ""
Write-Host "Apres ca: double-clic sur 'NOVUM ChatGPT' sur ton Bureau = tout se lance." -ForegroundColor Green
Write-Host ""
Write-Host "Acces v0.2 rapide: fichiers sur les lecteurs montes + ecriture + terminal en droits utilisateur Windows." -ForegroundColor Yellow
Write-Host "Ce n'est PAS encore le broker Administrateur/SYSTEM." -ForegroundColor Yellow

Start-Process explorer.exe -ArgumentList @("`"$ExtensionDir`"")

$chromeCandidates2 = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) }
if ($chromeCandidates2.Count -gt 0) {
    Start-Process -FilePath $chromeCandidates2[0] -ArgumentList @("chrome://extensions/")
} else {
    Start-Process "chrome://extensions/"
}

Write-Host ""
Write-Host "Appuie sur Entree quand l'extension est chargee pour ouvrir NOVUM ChatGPT." -ForegroundColor Cyan
[void](Read-Host)
& $LaunchScript
