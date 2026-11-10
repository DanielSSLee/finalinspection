Add-Type -AssemblyName System.Drawing
$frontPath = Join-Path (Get-Location) 'pv-module-front-outline.png'
$backPath = Join-Path (Get-Location) 'pv-module-back-outline.png'
$front = [System.Drawing.Bitmap]::FromFile($frontPath)
$back = [System.Drawing.Bitmap]::FromFile($backPath)

$diffCount = 0
for ($x = 0; $x -lt 2280; $x++) {
    $cf = $front.GetPixel($x, 470)
    $cb = $back.GetPixel($x, 470)
    $bf = ($cf.R -lt 50 -and $cf.A -gt 200)
    $bb = ($cb.R -lt 50 -and $cb.A -gt 200)
    if ($bf -ne $bb) { $diffCount++ }
}
Write-Host "Diff count between front and back at y=470: $diffCount"
$front.Dispose()
$back.Dispose()

