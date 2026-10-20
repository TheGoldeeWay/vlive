$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RootDir "dist"
$StageDir = Join-Path $DistDir "VLive_Distribution_Stage"

if (Test-Path $StageDir) {
    Remove-Item $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $StageDir "drivers") | Out-Null

Write-Host "Staging distribution files..." -ForegroundColor Cyan
Copy-Item (Join-Path $DistDir "VLive_Setup_x64.exe") $StageDir
Copy-Item (Join-Path $RootDir "VLive.exe") $StageDir
Copy-Item (Join-Path $DistDir "VLive_v2.0.0_Portable_x64.zip") $StageDir
Copy-Item (Join-Path $DistDir "RELEASE_NOTES.txt") $StageDir
Copy-Item (Join-Path $DistDir "checksums.sha256") $StageDir
if (Test-Path (Join-Path $DistDir "VLive_User_Manual.pdf")) {
    Copy-Item (Join-Path $DistDir "VLive_User_Manual.pdf") $StageDir
}
if (Test-Path (Join-Path $RootDir "README.md")) {
    Copy-Item (Join-Path $RootDir "README.md") $StageDir
}
Copy-Item (Join-Path $RootDir "drivers\teVirtualMIDI64.msi") (Join-Path $StageDir "drivers")
if (Test-Path (Join-Path $RootDir "drivers\MicrosoftEdgeWebview2Setup.exe")) {
    Copy-Item (Join-Path $RootDir "drivers\MicrosoftEdgeWebview2Setup.exe") (Join-Path $StageDir "drivers")
}

$FinalZipDist = Join-Path $DistDir "VLive_v2.0.0_Final_Distribution_x64.zip"
$FinalZipRoot = Join-Path $RootDir "VLive_Final_Distribution_x64.zip"

if (Test-Path $FinalZipDist) { Remove-Item $FinalZipDist -Force }
if (Test-Path $FinalZipRoot) { Remove-Item $FinalZipRoot -Force }

Write-Host "Compressing final distribution archive..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $FinalZipDist -CompressionLevel Optimal
Copy-Item $FinalZipDist $FinalZipRoot

Remove-Item $StageDir -Recurse -Force

$hash = (Get-FileHash -Path $FinalZipDist -Algorithm SHA256).Hash
$sizeMb = [math]::Round((Get-Item $FinalZipDist).Length / 1MB, 2)

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  FINAL DISTRIBUTION ARCHIVE READY!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  In dist/ : $FinalZipDist" -ForegroundColor Cyan
Write-Host "  In root/ : $FinalZipRoot" -ForegroundColor Cyan
Write-Host "  File Size: $sizeMb MB" -ForegroundColor Yellow
Write-Host "  SHA-256  : $hash" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
