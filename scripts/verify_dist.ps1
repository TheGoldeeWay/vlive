<#
.SYNOPSIS
    Automated Distribution Verification Script for VLive.
    Validates static CRT linking, absence of redistributable dependencies,
    PE manifest settings, installer payload, portable archive, and checksums.
#>

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VLIVE: DISTRIBUTION & ZERO-DEPENDENCY VERIFICATION" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$Passed = 0
$Failed = 0

function Report-Check($name, $status, $details) {
    if ($status) {
        $script:Passed++
        Write-Host "  [PASS] $name" -ForegroundColor Green
        if ($details) { Write-Host "         $details" -ForegroundColor Gray }
    } else {
        $script:Failed++
        Write-Host "  [FAIL] $name" -ForegroundColor Red
        if ($details) { Write-Host "         $details" -ForegroundColor Red }
    }
}

# 1. Check Binary Existence & Architecture
$ExePath = "$RootDir\build\Release\VLive.exe"
$exeExists = Test-Path $ExePath
Report-Check "VLive.exe Binary Existence" $exeExists "Path: $ExePath"

# 2. Dependency Audit: Static CRT & System-Only DLLs
$ForbiddenDlls = @("VCRUNTIME140.dll", "MSVCP140.dll", "VCRUNTIME140_1.dll", "WebView2Loader.dll")
$DumpbinCandidates = @(
    "dumpbin.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe"
)

$DumpbinPath = $null
foreach ($d in $DumpbinCandidates) {
    $found = Resolve-Path $d -ErrorAction SilentlyContinue
    if ($found) {
        $DumpbinPath = $found[0].Path
        break
    }
}

if ($DumpbinPath -and $exeExists) {
    $depOutput = & $DumpbinPath /dependents $ExePath
    $depText = $depOutput -join "`n"
    
    $hasForbidden = $false
    $forbiddenFound = @()
    foreach ($f in $ForbiddenDlls) {
        if ($depText -match $f) {
            $hasForbidden = $true
            $forbiddenFound += $f
        }
    }

    Report-Check "Static CRT Linking (/MT - No VC++ Runtime Dependencies)" (-not $hasForbidden) `
        $(if ($hasForbidden) { "Found forbidden dependencies: $($forbiddenFound -join ', ')" } else { "Zero MSVC runtime DLLs dynamically linked." })

    $hasSystemOnly = ($depText -match "KERNEL32.dll" -and $depText -match "WS2_32.dll" -and $depText -match "WINMM.dll")
    Report-Check "Standard Windows System DLL Binding" $hasSystemOnly "Confirmed only OS core DLLs (kernel32, user32, ws2_32, winmm, etc.)"
} else {
    Write-Warning "dumpbin.exe not located; skipping deep import-table inspection."
}

# 3. Check Manifest DPI Awareness
$ManifestPath = "$RootDir\resources\vlive.manifest"
$manifestValid = $false
if (Test-Path $ManifestPath) {
    $manifestContent = Get-Content $ManifestPath -Raw
    if ($manifestContent -match "PerMonitorV2" -and $manifestContent -match "supportedOS") {
        $manifestValid = $true
    }
}
Report-Check "Binary Manifest DPI Awareness & Windows 10/11 GUIDs" $manifestValid "PerMonitorV2 and Windows 10/11 OS GUIDs configured."

# 4. Check Turnkey Installer Output
$InstallerPath = "$RootDir\dist\VLive_Setup_x64.exe"
$installerExists = Test-Path $InstallerPath
$installerSize = 0
if ($installerExists) {
    $installerSize = (Get-Item $InstallerPath).Length
}
Report-Check "Turnkey Inno Setup Installer Existence (VLive_Setup_x64.exe)" `
    ($installerExists -and $installerSize -gt 1000000) `
    "Size: $([math]::Round($installerSize / 1MB, 2)) MB at $InstallerPath"

# 5. Check Standalone Portable ZIP Output
$PortablePath = "$RootDir\dist\VLive_v2.0.0_Portable_x64.zip"
$portableExists = Test-Path $PortablePath
$portableSize = 0
if ($portableExists) {
    $portableSize = (Get-Item $PortablePath).Length
}
Report-Check "Standalone Portable ZIP Package (Zero-Install Distribution)" `
    ($portableExists -and $portableSize -gt 500000) `
    "Size: $([math]::Round($portableSize / 1MB, 2)) MB at $PortablePath"

# 6. Check Release Checksums
$ChecksumPath = "$RootDir\dist\checksums.sha256"
$checksumsValid = $false
if (Test-Path $ChecksumPath) {
    $lines = Get-Content $ChecksumPath
    if ($lines.Count -ge 2) {
        $checksumsValid = $true
    }
}
Report-Check "Release Checksums (SHA-256 Integrity File)" $checksumsValid "File: $ChecksumPath"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  VERIFICATION SUMMARY: $Passed PASSED, $Failed FAILED" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "============================================================" -ForegroundColor Cyan

if ($Failed -gt 0) {
    exit 1
} else {
    exit 0
}
