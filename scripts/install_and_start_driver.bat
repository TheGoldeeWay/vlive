@echo off
setlocal
echo ==========================================================
echo   VLive - Virtual MIDI Driver Auto-Configurator
echo   Configuring teVirtualMIDI64 Service for DAWs...
echo ==========================================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Administrator privileges required to manage kernel drivers.
    echo Requesting elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: 1. Install MSI if driver not installed
set "DRIVER_MSI=%~dp0..\drivers\teVirtualMIDI64.msi"
if exist "%DRIVER_MSI%" (
    echo [1/3] Ensuring teVirtualMIDI driver is installed...
    msiexec.exe /i "%DRIVER_MSI%" /qn /norestart
) else (
    echo [1/3] Bundled driver MSI not found in drivers folder, checking existing installation...
)

:: 2. Configure service to Auto-Start
echo [2/3] Setting teVirtualMIDI64 service start type to AUTO...
sc.exe config teVirtualMIDI64 start= auto

:: 3. Start the driver service
echo [3/3] Starting teVirtualMIDI64 driver service...
net.exe start teVirtualMIDI64

echo.
sc.exe query teVirtualMIDI64
echo.
echo ==========================================================
echo   SUCCESS! The Virtual MIDI Driver is running and configured
echo   to start automatically on every system boot.
echo ==========================================================
echo.
timeout /t 5
