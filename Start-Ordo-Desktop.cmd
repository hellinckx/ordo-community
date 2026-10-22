@echo off
cd /d "%~dp0"
set "EXE=apps\desktop\src-tauri\target\release\ordo.exe"
if exist "%EXE%" (
  start "" "%EXE%"
) else (
  echo Keine fertige EXE gefunden - starte Entwicklungsmodus ^(pnpm desktop^) ...
  call pnpm desktop
)
