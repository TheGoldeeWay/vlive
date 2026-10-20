# VLive — Create Portable Distribution Package (PowerShell)
# Made by Goldee

$ErrorActionPreference = "Stop"
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$distDir = Join-Path $rootDir "dist"
$stageDir = Join-Path $distDir "VLive_Portable"
$zipFile = Join-Path $distDir "VLive_v2.0_Portable.zip"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VLive — Creating Portable Release Package" -ForegroundColor Cyan
Write-Host "  Made by Goldee" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force | Out-Null }
if (Test-Path $stageDir) { Remove-Item -Path $stageDir -Recurse -Force | Out-Null }
if (Test-Path $zipFile) { Remove-Item -Path $zipFile -Force | Out-Null }

New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageDir "web") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageDir "drivers") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageDir "resources") -Force | Out-Null

Write-Host "Copying binary and assets..." -ForegroundColor Yellow
Copy-Item (Join-Path $rootDir "VLive.exe") (Join-Path $stageDir "VLive.exe") -Force
Copy-Item (Join-Path $rootDir "drivers\teVirtualMIDI64.msi") (Join-Path $stageDir "drivers\teVirtualMIDI64.msi") -Force
Copy-Item (Join-Path $rootDir "resources\icon.ico") (Join-Path $stageDir "resources\icon.ico") -Force
Copy-Item (Join-Path $rootDir "web\*") (Join-Path $stageDir "web") -Recurse -Force

$readmeText = @"
VLive — Stage MIDI Controller & Studio
Version: 2.0.0
Made by Goldee
------------------------------------------------------------

QUICK START:
1. Double click VLive.exe to start the application.
2. VLive automatically registers "VLive MIDI Controller" with Windows.
3. In your DAW (Ableton Live, FL Studio, REAPER, Cubase, Studio One):
   - Open Preferences / Audio / MIDI.
   - Enable "VLive MIDI Controller" as both Track Input and Output.
4. Connect any phone, tablet, or browser on the same Wi-Fi:
   - Scan the QR code shown in the VLive window, or
   - Open http://[YOUR-PC-IP]:8088 on any mobile device.
   - Tap "Install App" on Android to add VLive to your home screen!

Automatic DAW Synchronization:
Any fader, knob, or project state loaded in your DAW automatically
moves and maps the controls on your VLive interface in real time!

Requirements: Windows 10/11 x64.
"@

Set-Content -Path (Join-Path $stageDir "README.txt") -Value $readmeText

Write-Host "Compressing portable distribution package..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipFile -Force

Remove-Item -Path $stageDir -Recurse -Force | Out-Null

if (Test-Path $zipFile) {
    $sizeMB = ((Get-Item $zipFile).Length / 1MB).ToString("0.00")
    Write-Host "[SUCCESS] Portable ZIP package created: $zipFile ($sizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Failed to create portable package!" -ForegroundColor Red
    exit 1
}
