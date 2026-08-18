@echo off
setlocal
chcp 65001 >nul
title NOVUM ChatGPT - Installation

set "LOCAL_INSTALL=%~dp0scripts\quick-install.ps1"
set "NOVUM_EXT=%LOCALAPPDATA%\NOVUM-ChatGPT\extension"
set "NOVUM_AGENT=%LOCALAPPDATA%\NOVUM-ChatGPT\agent\novum_agent.py"

if exist "%LOCAL_INSTALL%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_INSTALL%"
  set "INSTALL_RC=%ERRORLEVEL%"
  goto :finish
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $tmp=Join-Path $env:TEMP ('novum-chatgpt-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force -Path $tmp ^| Out-Null; $zip=Join-Path $tmp 'repo.zip'; Write-Host 'Telechargement de NOVUM ChatGPT...' -ForegroundColor Cyan; Invoke-WebRequest -UseBasicParsing 'https://github.com/Mwrtyy/extension-chat-gpt/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $repo=Get-ChildItem $tmp -Directory ^| Where-Object { Test-Path (Join-Path $_.FullName 'scripts\quick-install.ps1') } ^| Select-Object -First 1; if(-not $repo){throw 'Archive NOVUM invalide.'}; & (Join-Path $repo.FullName 'scripts\quick-install.ps1')"
set "INSTALL_RC=%ERRORLEVEL%"

:finish
if "%INSTALL_RC%"=="0" goto :success

rem If the agent and extension were already installed, a late Chrome-launch failure
rem must not make the whole installation look broken. This is the exact recovery
rem path for Windows machines where Chrome discovery/opening fails after Agent OK.
if exist "%NOVUM_EXT%\manifest.json" if exist "%NOVUM_AGENT%" (
  echo.
  echo Installation NOVUM terminee. Seule l'ouverture automatique de Chrome a echoue.
  echo Le dossier de l'extension va s'ouvrir maintenant.
  start "" explorer.exe "%NOVUM_EXT%"
  echo.
  echo Dans Chrome : ouvre chrome://extensions
  echo Active Mode developpeur ^> Charger l'extension non empaquetee
  echo Puis choisis :
  echo %NOVUM_EXT%
  echo.
  echo Apres ca, utilise le raccourci NOVUM ChatGPT sur le Bureau.
  pause
  exit /b 0
)

echo.
echo Installation echouee. Copie cette fenetre dans ChatGPT pour diagnostic.
pause
exit /b %INSTALL_RC%

:success
exit /b 0
