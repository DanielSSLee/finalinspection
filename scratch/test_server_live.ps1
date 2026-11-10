$proc = Start-Process -FilePath 'C:\Python313\python.exe' -ArgumentList 'server.py' -PassThru
Start-Sleep -Seconds 2
try {
    $r1 = Invoke-WebRequest -Uri 'http://localhost:8080/' -UseBasicParsing
    Write-Host "GET / : status $($r1.StatusCode), length $($r1.Content.Length)"
    $r2 = Invoke-WebRequest -Uri 'http://localhost:8080/second' -UseBasicParsing
    Write-Host "GET /second : status $($r2.StatusCode), length $($r2.Content.Length)"
    $r3 = Invoke-WebRequest -Uri 'http://localhost:8080/api/telemetry?module_id=USM0112208260078' -UseBasicParsing
    Write-Host "GET /api/telemetry : status $($r3.StatusCode), length $($r3.Content.Length)"
} finally {
    Stop-Process -Id $proc.Id -Force
}

