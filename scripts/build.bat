@echo off
setlocal enabledelayedexpansion

echo ====================================================================
echo  VLIVE MIDI CONTROLLER - BUILD SCRIPT
echo ====================================================================

:: Locate MSVC environment
set "VCVARS="
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
)

if not defined VCVARS (
    echo [!] Could not automatically find vcvars64.bat. Please run from a Developer Command Prompt.
) else (
    echo [*] Initializing MSVC environment from: !VCVARS!
    call "!VCVARS!"
)

echo.
echo [*] Configuring CMake project...
cmake -B build -G "Visual Studio 17 2022" -A x64
if %ERRORLEVEL% neq 0 (
    echo [X] CMake configuration failed.
    exit /b %ERRORLEVEL%
)

echo.
echo [*] Compiling Release binaries (VLive.exe Native GUI, vlive_core, test_midi, test_sync)...
cmake --build build --config Release
if %ERRORLEVEL% neq 0 (
    echo [X] Build failed.
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================================
echo  [✓] BUILD SUCCESSFUL!
echo  Binaries located in: build\Release\
echo  Run: scripts\run.bat to start VLive!
echo ====================================================================
