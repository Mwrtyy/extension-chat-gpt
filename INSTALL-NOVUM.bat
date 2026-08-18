@echo off
setlocal
chcp 65001 >nul
title NOVUM ChatGPT - Installation

set "LOCAL_INSTALL=%~dp0scripts\quick-install.ps1"
if exist "%LOCAL_INSTALL%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_INSTALL%"
  goto :done
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $tmp=Join-Path $env:TEMP ('novum-chatgpt-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force -Path $tmp ^| Out-Null; $zip=Join-Path $tmp 'repo.zip'; Write-Host 'Telechargement de NOVUM ChatGPT...' -ForegroundColor Cyan; Invoke-WebRequest -UseBasicParsing 'https://github.com/Mwrtyy/extension-chat-gpt/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $repo=Get-ChildItem $tmp -Directory ^| Where-Object { Test-Path (Join-Path $_.FullName 'scripts\quick-install.ps1') } ^| Select-Object -First 1; if(-not $repo){throw 'Archive NOVUM invalide.'}; & (Join-Path $repo.FullName 'scripts\quick-install.ps1')"

:done
if errorlevel 1 (
  echo.
  echo Installation echouee. Copie cette fenetre dans ChatGPT pour diagnostic.
  pause
)
endlocal
