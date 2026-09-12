# Run with Windows PowerShell. Only resize/encode the generated source; preserve alpha.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = $PSScriptRoot
$publicRoot = [IO.Path]::GetFullPath((Join-Path $iconRoot '../../public'))
$source = [Drawing.Image]::FromFile((Join-Path $iconRoot 'source.png'))
$pngs = @{}
try {
    foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512, 1024)) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $stream = [IO.MemoryStream]::new()
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, [Drawing.Rectangle]::new(0, 0, $size, $size))
            $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            $pngs[$size] = $stream.ToArray()
        } finally {
            $stream.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally { $source.Dispose() }

[IO.File]::WriteAllBytes((Join-Path $iconRoot 'icon.png'), $pngs[1024])
[IO.File]::WriteAllBytes((Join-Path $publicRoot 'app-icon.png'), $pngs[256])

# ICO directory entries contain PNG payloads at each Windows display size.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$ico = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($ico)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    foreach ($size in $sizes) {
        $dimension = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$pngs[$size].Length)
        $writer.Write([uint32]$offset)
        $offset += $pngs[$size].Length
    }
    foreach ($size in $sizes) { $writer.Write([byte[]]$pngs[$size]) }
    $writer.Flush()
    [IO.File]::WriteAllBytes((Join-Path $iconRoot 'icon.ico'), $ico.ToArray())
    [IO.File]::WriteAllBytes((Join-Path $publicRoot 'app-icon.ico'), $ico.ToArray())
} finally { $writer.Dispose(); $ico.Dispose() }

# Modern ICNS uses big-endian chunk lengths and PNG payloads.
function Write-BigEndian([IO.BinaryWriter]$Output, [uint32]$Value) {
    $bytes = [BitConverter]::GetBytes($Value)
    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    $Output.Write($bytes)
}
$chunks = [ordered]@{ icp4 = 16; icp5 = 32; icp6 = 64; ic07 = 128; ic08 = 256; ic09 = 512; ic10 = 1024 }
$icns = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($icns)
try {
    $total = 8
    foreach ($size in $chunks.Values) { $total += 8 + $pngs[$size].Length }
    $writer.Write([Text.Encoding]::ASCII.GetBytes('icns'))
    Write-BigEndian $writer $total
    foreach ($chunk in $chunks.GetEnumerator()) {
        $writer.Write([Text.Encoding]::ASCII.GetBytes($chunk.Key))
        Write-BigEndian $writer (8 + $pngs[$chunk.Value].Length)
        $writer.Write([byte[]]$pngs[$chunk.Value])
    }
    $writer.Flush()
    [IO.File]::WriteAllBytes((Join-Path $iconRoot 'icon.icns'), $icns.ToArray())
} finally { $writer.Dispose(); $icns.Dispose() }
Write-Output 'Exported PNG, Windows ICO (16-256px), and macOS ICNS (16-1024px).'
