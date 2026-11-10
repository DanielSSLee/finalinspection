Add-Type -AssemblyName System.Drawing
Get-ChildItem -Filter '*.jpg' | ForEach-Object {
    $bmp = [System.Drawing.Bitmap]::FromFile($_.FullName)
    Write-Host "$($_.Name): $($bmp.Width) x $($bmp.Height)"
    $bmp.Dispose()
}

