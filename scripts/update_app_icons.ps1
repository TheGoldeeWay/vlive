Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\my assets\Vliveicon.png"
$webDir = Join-Path $PSScriptRoot "..\web"
$resDir = Join-Path $PSScriptRoot "..\resources"

if (-not (Test-Path $srcPath)) {
    Write-Error "Source icon not found at: $srcPath"
    exit 1
}

$srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)

function Resize-Bitmap($bmp, $w, $h) {
    $dest = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($bmp, 0, 0, $w, $h)
    $g.Dispose()
    return $dest
}

# 1. Generate web PNGs
$p512 = Resize-Bitmap $srcBmp 512 512
$p512.Save((Join-Path $webDir "icon-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$p512.Dispose()

$p192 = Resize-Bitmap $srcBmp 192 192
$p192.Save((Join-Path $webDir "icon-192.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$p192.Dispose()

Write-Host "Generated icon-512.png and icon-192.png"

# 2. Build Multi-Resolution ICO File
# Standard Windows ICO format supporting PNG-compressed frames:
# 256, 128, 64, 48, 32, 24, 16
$sizes = @(256, 128, 64, 48, 32, 24, 16)
$frameBytesList = @()

foreach ($sz in $sizes) {
    $resized = Resize-Bitmap $srcBmp $sz $sz
    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $resized.Dispose()
    $ms.Dispose()
    $frameBytesList += ,@($sz, $bytes)
}

$srcBmp.Dispose()

# Assemble ICO binary
$numImages = $frameBytesList.Count
$headerSize = 6
$dirEntrySize = 16
$entriesSize = $numImages * $dirEntrySize
$currentOffset = $headerSize + $entriesSize

$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)

# ICONDIR header
$writer.Write([UInt16]0)          # Reserved, must be 0
$writer.Write([UInt16]1)          # Type: 1 = ICO
$writer.Write([UInt16]$numImages) # Count of images

# ICONDIRENTRY entries
foreach ($frame in $frameBytesList) {
    $sz = $frame[0]
    $data = $frame[1]
    $len = $data.Length

    $wByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $hByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }

    $writer.Write($wByte)                    # Width
    $writer.Write($hByte)                    # Height
    $writer.Write([byte]0)                   # Color count (0 for >= 8bpp)
    $writer.Write([byte]0)                   # Reserved
    $writer.Write([UInt16]1)                 # Color planes (1)
    $writer.Write([UInt16]32)                # Bit count (32bpp)
    $writer.Write([UInt32]$len)              # Size of image data
    $writer.Write([UInt32]$currentOffset)    # Offset of image data

    $currentOffset += $len
}

# Write image data blobs
foreach ($frame in $frameBytesList) {
    $writer.Write($frame[1])
}

$writer.Flush()
$icoBytes = $icoStream.ToArray()
$writer.Dispose()
$icoStream.Dispose()

$icoDest = Join-Path $resDir "icon.ico"
[System.IO.File]::WriteAllBytes($icoDest, $icoBytes)
Write-Host "Generated multi-resolution ICO at: $icoDest (Size: $($icoBytes.Length) bytes)"

# Also copy to web/favicon.ico
$favDest = Join-Path $webDir "favicon.ico"
[System.IO.File]::WriteAllBytes($favDest, $icoBytes)

# Generate web/icon.svg with embedded high-res image
$p512Bytes = [System.IO.File]::ReadAllBytes((Join-Path $webDir "icon-512.png"))
$b64 = [Convert]::ToBase64String($p512Bytes)
$svgContent = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <image width="512" height="512" href="data:image/png;base64,$b64" />
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $webDir "icon.svg"), $svgContent)
Write-Host "Generated web/icon.svg"

Write-Host "All application & installer icon files generated successfully!"
