Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Get-Item "$scriptDir\..").FullName
$srcPath = Join-Path $rootDir "my assets\Vliveicon.png"
$resDir = Join-Path $rootDir "resources"
$webDir = Join-Path $rootDir "web"

if (-not (Test-Path $srcPath)) {
    Write-Error "Source icon not found at: $srcPath"
    exit 1
}

$srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)

function Resize-Image($src, $w, $h) {
    $dest = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    return $dest
}

# 1. Export Web PNGs
$p512 = Resize-Image $srcBmp 512 512
$p512.Save((Join-Path $webDir "icon-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$p512.Dispose()

$p192 = Resize-Image $srcBmp 192 192
$p192.Save((Join-Path $webDir "icon-192.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$p192.Dispose()

Write-Host "Generated web/icon-512.png and web/icon-192.png"

# 2. Build multi-frame ICO data
# Standard sizes: 256 (PNG), 128 (DIB), 64 (DIB), 48 (DIB), 32 (DIB), 24 (DIB), 16 (DIB)
$frames = @()

# 256x256 as PNG
$bmp256 = Resize-Image $srcBmp 256 256
$ms256 = New-Object System.IO.MemoryStream
$bmp256.Save($ms256, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms256.ToArray()
$bmp256.Dispose()
$ms256.Dispose()
$frames += ,@(256, 32, $pngBytes)

# Sizes for uncompressed DIB frames
$dibSizes = @(128, 64, 48, 32, 24, 16)
foreach ($sz in $dibSizes) {
    $resized = Resize-Image $srcBmp $sz $sz
    $rect = New-Object System.Drawing.Rectangle(0, 0, $sz, $sz)
    $bmpData = $resized.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    
    $stride = [Math]::Abs($bmpData.Stride)
    $pixelBytes = New-Object byte[] ($stride * $sz)
    [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $pixelBytes, 0, $pixelBytes.Length)
    $resized.UnlockBits($bmpData)
    $resized.Dispose()

    # DIB scanlines are bottom-to-top
    $andRowBytes = [int]([Math]::Ceiling($sz / 32.0) * 4)
    $andMaskSize = $andRowBytes * $sz
    $xorSize = $sz * $sz * 4
    $dibHeaderSize = 40
    $totalDibSize = $dibHeaderSize + $xorSize + $andMaskSize

    $dibMs = New-Object System.IO.MemoryStream($totalDibSize)
    $dibWriter = New-Object System.IO.BinaryWriter($dibMs)

    # BITMAPINFOHEADER
    $dibWriter.Write([UInt32]40)                # biSize
    $dibWriter.Write([Int32]$sz)                 # biWidth
    $dibWriter.Write([Int32]($sz * 2))           # biHeight (doubled for XOR + AND)
    $dibWriter.Write([UInt16]1)                  # biPlanes
    $dibWriter.Write([UInt16]32)                 # biBitCount
    $dibWriter.Write([UInt32]0)                  # biCompression (BI_RGB)
    $dibWriter.Write([UInt32]$xorSize)           # biSizeImage
    $dibWriter.Write([Int32]0)                   # biXPelsPerMeter
    $dibWriter.Write([Int32]0)                   # biYPelsPerMeter
    $dibWriter.Write([UInt32]0)                  # biClrUsed
    $dibWriter.Write([UInt32]0)                  # biClrImportant

    # Write XOR image (bottom-up BGRA)
    for ($y = $sz - 1; $y -ge 0; $y--) {
        $rowOffset = $y * $stride
        $dibWriter.Write($pixelBytes, $rowOffset, $sz * 4)
    }

    # Write AND mask (all zeros for 32bpp alpha icon)
    $zeroRow = New-Object byte[] $andRowBytes
    for ($y = 0; $y -lt $sz; $y++) {
        $dibWriter.Write($zeroRow, 0, $andRowBytes)
    }

    $dibWriter.Flush()
    $dibBytes = $dibMs.ToArray()
    $dibWriter.Dispose()
    $dibMs.Dispose()

    $frames += ,@($sz, 32, $dibBytes)
}

$srcBmp.Dispose()

# 3. Assemble ICO Binary
$numImages = $frames.Count
$headerSize = 6
$dirEntrySize = 16
$offset = $headerSize + ($numImages * $dirEntrySize)

$icoMs = New-Object System.IO.MemoryStream
$icoWriter = New-Object System.IO.BinaryWriter($icoMs)

# ICONDIR
$icoWriter.Write([UInt16]0)          # Reserved
$icoWriter.Write([UInt16]1)          # Type = 1 (ICO)
$icoWriter.Write([UInt16]$numImages) # Count

foreach ($f in $frames) {
    $sz = $f[0]
    $bpp = $f[1]
    $data = $f[2]
    $len = $data.Length

    $wByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
    $hByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }

    $icoWriter.Write($wByte)                 # Width
    $icoWriter.Write($hByte)                 # Height
    $icoWriter.Write([byte]0)                # Color count
    $icoWriter.Write([byte]0)                # Reserved
    $icoWriter.Write([UInt16]1)              # Color planes
    $icoWriter.Write([UInt16]$bpp)           # Bits per pixel
    $icoWriter.Write([UInt32]$len)           # Bytes in resource
    $icoWriter.Write([UInt32]$offset)        # Image offset

    $offset += $len
}

foreach ($f in $frames) {
    $icoWriter.Write($f[2])
}

$icoWriter.Flush()
$allIcoBytes = $icoMs.ToArray()
$icoWriter.Dispose()
$icoMs.Dispose()

# Save ICO to resources/icon.ico, root icon.ico, and web/favicon.ico
$icoPaths = @(
    (Join-Path $resDir "icon.ico"),
    (Join-Path $rootDir "icon.ico"),
    (Join-Path $webDir "favicon.ico")
)

foreach ($p in $icoPaths) {
    [System.IO.File]::WriteAllBytes($p, $allIcoBytes)
    Write-Host "Written ICO ($($allIcoBytes.Length) bytes) to: $p"
}

# 4. Generate SVG embedding the authentic 512x512 logo
$p512Bytes = [System.IO.File]::ReadAllBytes((Join-Path $webDir "icon-512.png"))
$b64 = [Convert]::ToBase64String($p512Bytes)
$svgContent = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <image width="512" height="512" href="data:image/png;base64,$b64" />
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $webDir "icon.svg"), $svgContent)
Write-Host "Generated web/icon.svg"
Write-Host "All icons regenerated successfully from my assets/Vliveicon.png!"
