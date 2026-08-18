@echo off
setlocal
chcp 65001 >nul
title NOVUM ChatGPT - Update

set "EXT=%LOCALAPPDATA%\NOVUM-ChatGPT\extension"

if not exist "%EXT%" (
  echo NOVUM n'est pas encore installe.
  echo Lance d'abord INSTALL-NOVUM.bat.
  pause
  exit /b 1
)

echo.
echo NOVUM ChatGPT - mise a jour rapide
echo ==================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $base='https://raw.githubusercontent.com/Mwrtyy/extension-chat-gpt/main/extension'; $dst=Join-Path $env:LOCALAPPDATA 'NOVUM-ChatGPT\extension'; foreach($f in @('background.js','content.js','popup.js','popup.html','manifest.json')) { Write-Host ('Update '+$f+'...'); Invoke-WebRequest -UseBasicParsing ($base+'/'+$f) -OutFile (Join-Path $dst $f) }; Write-Host ''; Write-Host 'NOVUM extension mise a jour.' -ForegroundColor Green"

if errorlevel 1 (
  echo.
  echo La mise a jour a echoue.
  pause
  exit /b 1
)

echo.
echo Etape finale: dans Chrome, clique sur Recharger pour NOVUM PC Bridge,
echo puis actualise ton onglet ChatGPT avec Ctrl+R.
echo.
start "" chrome://extensions/
pause
endlocal
