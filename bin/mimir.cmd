@echo off
rem mimir launcher for Windows (cmd and PowerShell): runs src\cli\main.ts with bun, like bin/mimir does on POSIX shells.
rem UNTESTED: written from the documentation of cmd and bun; it has never been run on a Windows machine.
setlocal
set "MIMIR_ROOT=%~dp0.."
if not exist "%MIMIR_ROOT%\src\cli\main.ts" (
  echo mimir: cannot find %MIMIR_ROOT%\src\cli\main.ts ^(the launcher must stay in ^<mimir^>\bin^) 1>&2
  exit /b 2
)
set "MIMIR_BUN_EXE=bun"
if defined MIMIR_BUN set "MIMIR_BUN_EXE=%MIMIR_BUN%"
where "%MIMIR_BUN_EXE%" >nul 2>nul
if errorlevel 1 if not exist "%MIMIR_BUN_EXE%" (
  echo mimir: bun is required but was not found on PATH ^(install: https://bun.sh, or set MIMIR_BUN to bun.exe^) 1>&2
  exit /b 2
)
"%MIMIR_BUN_EXE%" "%MIMIR_ROOT%\src\cli\main.ts" %*
exit /b %ERRORLEVEL%
