@echo off
setlocal EnableDelayedExpansion
title Ordo
cd /d "%~dp0"

echo.
echo   =====================================
echo    Ordo - Buchhaltung, Projekte und Lager
echo   =====================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [!] pnpm nicht gefunden. Bitte Node.js ^>= 22 installieren und "corepack enable" ausfuehren.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [i] Erster Start: Abhaengigkeiten werden installiert ...
  call pnpm install
  if errorlevel 1 ( echo [!] Installation fehlgeschlagen. & pause & exit /b 1 )
)

set "EXE=apps\desktop\src-tauri\target\release\ordo.exe"

echo   [1] Desktop-App starten (fertige EXE, empfohlen)
echo   [2] Web-App im Browser (Entwicklungsserver, http://localhost:5174/app/)
echo   [3] Desktop-App im Entwicklungsmodus (Tauri dev, mit Hot-Reload)
echo   [4] Desktop-App neu bauen (Installer + EXE)
echo   [5] Tests ausfuehren
echo   [0] Beenden
echo.
choice /c 123450 /n /m "Auswahl: "
set "SEL=%errorlevel%"

if "%SEL%"=="1" goto exe
if "%SEL%"=="2" goto web
if "%SEL%"=="3" goto desktopdev
if "%SEL%"=="4" goto build
if "%SEL%"=="5" goto test
exit /b 0

:exe
if exist "%EXE%" (
  start "" "%EXE%"
  exit /b 0
)
echo [i] Noch keine EXE gebaut - baue jetzt (dauert beim ersten Mal einige Minuten) ...
goto build

:web
call :portcheck
if "!PORTBUSY!"=="1" (
  echo [i] Auf Port 5174 laeuft bereits ein Ordo-Server - oeffne Browser.
  start "" http://localhost:5174/app/
  pause
  exit /b 0
)
start "" http://localhost:5174/app/
call pnpm --filter @ordo/app dev
exit /b 0

:desktopdev
call :portcheck
if "!PORTBUSY!"=="1" (
  echo [!] Port 5174 ist belegt ^(laeuft noch "pnpm dev" in einem anderen Fenster?^).
  echo     Bitte das andere Fenster schliessen und erneut versuchen.
  pause
  exit /b 1
)
call pnpm desktop
exit /b 0

:build
call pnpm desktop:build
if errorlevel 1 ( echo [!] Build fehlgeschlagen. & pause & exit /b 1 )
echo.
echo [OK] Fertig:
echo      Installer: apps\desktop\src-tauri\target\release\bundle\nsis\
echo      Portable:  %EXE%
echo.
choice /c JN /n /m "EXE jetzt starten? [J/N] "
if errorlevel 2 exit /b 0
start "" "%EXE%"
exit /b 0

:test
call pnpm test
pause
exit /b 0

:portcheck
set "PORTBUSY=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":5174 .*LISTEN" /c:":5174 .*ABH"') do set "PORTBUSY=1"
exit /b 0
