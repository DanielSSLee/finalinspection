Add-Type -AssemblyName System.Drawing
$frontPath = Join-Path (Get-Location) 'pv-module-front-outline.png'
$backPath = Join-Path (Get-Location) 'pv-module-back-outline.png'
$front = [System.Drawing.Bitmap]::FromFile($frontPath)
$back = [System.Drawing.Bitmap]::FromFile($backPath)

# Scan horizontal line along Y = 470 (inside Row C cells)
# Find every cell column start and end!
$inCell = $false
$cellStart = 0
$cols = @()

for ($x = 20; $x -lt 2260; $x++) {
    $c = $front.GetPixel($x, 470)
    $isWhite = ($c.R -gt 200 -and $c.G -gt 200 -and $c.B -gt 200)
    if ($isWhite -and -not $inCell) {
        $inCell = $true
        $cellStart = $x
    } elseif (-not $isWhite -and $inCell) {
        $inCell = $false
        # Filter out tiny gaps if any
        if (($x - $cellStart) -gt 30) {
            $cols += [PSCustomObject]@{
                Col = $cols.Count + 1
                Start = $cellStart
                End = $x - 1
                Width = ($x - $cellStart)
            }
        }
    }
}

Write-Host "Found $($cols.Count) columns at Y=470:"
foreach ($c in $cols) {
    Write-Host "Col $($c.Col): X $($c.Start) to $($c.End) (W=$($c.Width)) - pct: $([math]::Round($c.Start/2280*100, 2))% to $([math]::Round($c.End/2280*100, 2))%"
}

# Now let's find the exact small junction box rectangles in $back!
# Let's inspect the junction boxes in pv-module-back-outline.png
# Save small crops of JBX1, JBX2, JBX3 to inspect and print exact bounds!
function Scan-Box($startY, $endY, $name) {
    # Scan in x between 1100 and 1180
    $rects = @()
    # Let's find the rectangle outline by checking where horizontal and vertical lines meet
    for ($y = $startY; $y -le $endY; $y++) {
        for ($x = 1115; $x -le 1175; $x++) {
            $c = $back.GetPixel($x, $y)
            if ($c.R -lt 50 -and $c.A -gt 200) {
                # found a black pixel
            }
        }
    }
}

# Let's find the exact rectangle for JBX2:
# In the center: between col 12 (ends at ~1138) and col 13 (starts at ~1152)
# Wait, let's see where the rectangle borders are in X and Y:
Write-Host "=== JBX2 Pixel Scan ==="
for ($y = 520; $y -le 620; $y++) {
    $blackXInRow = @()
    for ($x = 1100; $x -le 1190; $x++) {
        $c = $back.GetPixel($x, $y)
        if ($c.R -lt 50 -and $c.A -gt 200) { $blackXInRow += $x }
    }
    if ($blackXInRow.Count -gt 5) {
        Write-Host "Y=$y : Xs = $($blackXInRow[0]) to $($blackXInRow[-1]) (count: $($blackXInRow.Count))"
    }
}

Write-Host "=== JBX1 Pixel Scan ==="
for ($y = 150; $y -le 240; $y++) {
    $blackXInRow = @()
    for ($x = 1100; $x -le 1190; $x++) {
        $c = $back.GetPixel($x, $y)
        if ($c.R -lt 50 -and $c.A -gt 200) { $blackXInRow += $x }
    }
    if ($blackXInRow.Count -gt 5) {
        Write-Host "Y=$y : Xs = $($blackXInRow[0]) to $($blackXInRow[-1]) (count: $($blackXInRow.Count))"
    }
}

Write-Host "=== JBX3 Pixel Scan ==="
for ($y = 900; $y -le 990; $y++) {
    $blackXInRow = @()
    for ($x = 1100; $x -le 1190; $x++) {
        $c = $back.GetPixel($x, $y)
        if ($c.R -lt 50 -and $c.A -gt 200) { $blackXInRow += $x }
    }
    if ($blackXInRow.Count -gt 5) {
        Write-Host "Y=$y : Xs = $($blackXInRow[0]) to $($blackXInRow[-1]) (count: $($blackXInRow.Count))"
    }
}

$front.Dispose()
$back.Dispose()

