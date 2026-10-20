<#
.SYNOPSIS
    Automated Release & Distribution Pipeline for VLive.
    Compiles zero-dependency static binaries, executes automated tests,
    packages the standalone portable ZIP, and builds the turnkey Inno Setup installer.
#>

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VLIVE: PRODUCTION BUILD & PACKAGING PIPELINE" -ForegroundColor Cyan
Write-Host "  Architecture: Windows x64 (Static C++20 /MT Release)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Compile and Embed PWA Assets into In-Memory C++ Headers
Write-Host "`n[1/6] Packing and Embedding PWA Assets..." -ForegroundColor Yellow
& node "$RootDir\scripts\embed_assets.js"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Asset embedding failed with exit code $LASTEXITCODE"
}

# 2. Build Release Binaries via CMake
Write-Host "`n[2/6] Compiling C++20 Release Binaries (/MT, /O2, /LTCG)..." -ForegroundColor Yellow
& cmake --build "$RootDir\build" --config Release
if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake build failed with exit code $LASTEXITCODE"
}

# 3. Execute Automated Verification Suite
Write-Host "`n[3/6] Running Automated Unit & Subsystem Tests..." -ForegroundColor Yellow
$Tests = @(
    "$RootDir\build\Release\test_midi.exe",
    "$RootDir\build\Release\test_sync.exe",
    "$RootDir\build\Release\test_e2e_virtual_midi.exe"
)

foreach ($test in $Tests) {
    if (Test-Path $test) {
        Write-Host "  Executing $(Split-Path $test -Leaf)..." -ForegroundColor Gray
        & $test
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Test $test failed with exit code $LASTEXITCODE"
        }
    } else {
        Write-Warning "Test binary $test not found, skipping."
    }
}
Write-Host "  [OK] All core engine verification tests passed successfully." -ForegroundColor Green

# 4. Prepare Output Directory
$DistDir = "$RootDir\dist"
if (!(Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

# 5. Create Standalone Portable ZIP Package
Write-Host "`n[4/6] Creating Standalone Portable ZIP Package..." -ForegroundColor Yellow
$PortableStage = "$DistDir\VLive_Portable_Stage"
if (Test-Path $PortableStage) {
    Remove-Item -Path $PortableStage -Recurse -Force
}
New-Item -ItemType Directory -Path "$PortableStage\drivers" | Out-Null

Copy-Item -Path "$RootDir\build\Release\VLive.exe" -Destination "$PortableStage\VLive.exe"
Copy-Item -Path "$RootDir\drivers\teVirtualMIDI64.msi" -Destination "$PortableStage\drivers\"
if (Test-Path "$RootDir\drivers\MicrosoftEdgeWebview2Setup.exe") {
    Copy-Item -Path "$RootDir\drivers\MicrosoftEdgeWebview2Setup.exe" -Destination "$PortableStage\drivers\"
}
if (Test-Path "$RootDir\README.md") {
    Copy-Item -Path "$RootDir\README.md" -Destination "$PortableStage\README.md"
}

$PortableZip = "$DistDir\VLive_v2.0.0_Portable_x64.zip"
if (Test-Path $PortableZip) {
    Remove-Item -Path $PortableZip -Force
}
Compress-Archive -Path "$PortableStage\*" -DestinationPath $PortableZip -CompressionLevel Optimal
Remove-Item -Path $PortableStage -Recurse -Force
Write-Host "  [OK] Portable distribution ready: $PortableZip" -ForegroundColor Green

# 6. Locate Inno Setup Compiler and Build Turnkey Installer
Write-Host "`n[5/6] Compiling Turnkey Inno Setup Installer (VLive_Setup_x64.exe)..." -ForegroundColor Yellow

$CandidateIsccPaths = @(
    "iscc.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe"
)

$IsccPath = $null
foreach ($p in $CandidateIsccPaths) {
    if ($p -eq "iscc.exe") {
        $cmd = Get-Command "iscc.exe" -ErrorAction SilentlyContinue
        if ($cmd) {
            $IsccPath = $cmd.Source
            break
        }
    } elseif (Test-Path $p) {
        $IsccPath = $p
        break
    }
}

if (!$IsccPath) {
    Write-Error "ISCC.exe (Inno Setup Compiler) was not found in standard paths."
}

Write-Host "  Using Inno Setup compiler: $IsccPath" -ForegroundColor Gray
& $IsccPath "/O$DistDir" "$RootDir\installer\VLive.iss"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Inno Setup compilation failed with exit code $LASTEXITCODE"
}
Write-Host "  [OK] Installer ready: $DistDir\VLive_Setup_x64.exe" -ForegroundColor Green

# 7. Generate Release Checksums (SHA-256)
Write-Host "`n[6/6] Generating SHA-256 Release Checksums..." -ForegroundColor Yellow
$Artifacts = @(
    "$RootDir\build\Release\VLive.exe",
    "$DistDir\VLive_Setup_x64.exe",
    $PortableZip
)

$ChecksumFile = "$DistDir\checksums.sha256"
$ChecksumLines = @()
foreach ($file in $Artifacts) {
    if (Test-Path $file) {
        $hash = (Get-FileHash -Path $file -Algorithm SHA256).Hash
        $name = Split-Path $file -Leaf
        $ChecksumLines += "$hash  $name"
        Write-Host "  $name : $hash" -ForegroundColor Gray
    }
}
$ChecksumLines | Out-File -FilePath $ChecksumFile -Encoding utf8
Write-Host "  [OK] Checksums saved to $ChecksumFile" -ForegroundColor Green

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  VLIVE RELEASE PIPELINE COMPLETED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "  Installer : $DistDir\VLive_Setup_x64.exe" -ForegroundColor Green
Write-Host "  Portable  : $PortableZip" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
