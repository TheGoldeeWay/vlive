@echo off
setlocal

cd /d "%~dp0\.."

if not exist "VLive.exe" (
    if not exist "build\Release\VLive.exe" (
        echo [!] VLive.exe not found. Building now...
        call scripts\build.bat
        if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
    )
)

echo [*] Starting VLive GUI Desktop Application...
if exist "VLive.exe" (
    start "" "VLive.exe" %*
) else (
    start "" "build\Release\VLive.exe" %*
)

