Add-Type -AssemblyName System.Drawing
$frontPath = Join-Path (Get-Location) 'pv-module-front-outline.png'
$backPath = Join-Path (Get-Location) 'pv-module-back-outline.png'
$front = [System.Drawing.Bitmap]::FromFile($frontPath)
$back = [System.Drawing.Bitmap]::FromFile($backPath)

Write-Host "=== Measuring pv-module-back-outline.png vs pv-module-front-outline.png ==="

# 1. Back Outline Frame Bounds
# Find minX, maxX, minY, maxY
$bMinX = $back.Width; $bMaxX = 0; $bMinY = $back.Height; $bMaxY = 0
for ($y = 0; $y -lt $back.Height; $y += 2) {
    for ($x = 0; $x -lt $back.Width; $x += 2) {
        $c = $back.GetPixel($x, $y)
        if ($c.R -lt 50 -and $c.A -gt 200) {
            if ($x -lt $bMinX) { $bMinX = $x }
            if ($x -gt $bMaxX) { $bMaxX = $x }
            if ($y -lt $bMinY) { $bMinY = $y }
            if ($y -gt $bMaxY) { $bMaxY = $y }
        }
    }
}
Write-Host "Back Black Outer Bounds: X: $bMinX to $bMaxX, Y: $bMinY to $bMaxY"

# Frame thickness on back:
$backFrameLeft = @()
for ($x = 0; $x -lt 100; $x++) {
    $c = $back.GetPixel($x, 567)
    if ($c.R -lt 50 -and $c.A -gt 200) { $backFrameLeft += $x }
}
Write-Host "Back Left frame black pixels: $($backFrameLeft -join ', ')"

$backFrameRight = @()
for ($x = $back.Width - 100; $x -lt $back.Width; $x++) {
    $c = $back.GetPixel($x, 567)
    if ($c.R -lt 50 -and $c.A -gt 200) { $backFrameRight += $x }
}
Write-Host "Back Right frame black pixels: $($backFrameRight -join ', ')"

$backFrameTop = @()
for ($y = 0; $y -lt 100; $y++) {
    $c = $back.GetPixel(500, $y)
    if ($c.R -lt 50 -and $c.A -gt 200) { $backFrameTop += $y }
}
Write-Host "Back Top frame black pixels: $($backFrameTop -join ', ')"

$backFrameBottom = @()
for ($y = $back.Height - 100; $y -lt $back.Height; $y++) {
    $c = $back.GetPixel(500, $y)
    if ($c.R -lt 50 -and $c.A -gt 200) { $backFrameBottom += $y }
}
Write-Host "Back Bottom frame black pixels: $($backFrameBottom -join ', ')"

# 2. Back Columns Scan: scan horizontal line along Y = 300 (inside row B cells, avoiding JBoxes)
$inCell = $false
$cellStart = 0
$backCols = @()
for ($x = 10; $x -lt 2270; $x++) {
    $c = $back.GetPixel($x, 300)
    $isWhite = ($c.R -gt 200 -and $c.G -gt 200 -and $c.B -gt 200)
    if ($isWhite -and -not $inCell) {
        $inCell = $true
        $cellStart = $x
    } elseif (-not $isWhite -and $inCell) {
        $inCell = $false
        if (($x - $cellStart) -gt 30) {
            $backCols += [PSCustomObject]@{
                Col = $backCols.Count + 1
                Start = $cellStart
                End = $x - 1
                Width = ($x - $cellStart)
            }
        }
    }
}
Write-Host "Back Outline: Found $($backCols.Count) columns at Y=300:"
foreach ($c in $backCols) {
    Write-Host "Col $($c.Col): X $($c.Start) to $($c.End) (W=$($c.Width)) - pct: $([math]::Round($c.Start/2280*100, 3))% to $([math]::Round($c.End/2280*100, 3))%"
}

# 3. Back Rows Scan: scan vertical line along X = 500 (col 6)
$inRow = $false
$rowStart = 0
$backRows = @()
for ($y = 10; $y -lt 1130; $y++) {
    $c = $back.GetPixel(500, $y)
    $isWhite = ($c.R -gt 200 -and $c.G -gt 200 -and $c.B -gt 200)
    if ($isWhite -and -not $inRow) {
        $inRow = $true
        $rowStart = $y
    } elseif (-not $isWhite -and $inRow) {
        $inRow = $false
        if (($y - $rowStart) -gt 30) {
            $backRows += [PSCustomObject]@{
                Row = [char](65 + $backRows.Count)
                Start = $rowStart
                End = $y - 1
                Height = ($y - $rowStart)
            }
        }
    }
}
Write-Host "Back Outline: Found $($backRows.Count) rows at X=500:"
foreach ($r in $backRows) {
    Write-Host "Row $($r.Row): Y $($r.Start) to $($r.End) (H=$($r.Height)) - pct: $([math]::Round($r.Start/1134*100, 3))% to $([math]::Round($r.End/1134*100, 3))%"
}

$front.Dispose()
$back.Dispose()

