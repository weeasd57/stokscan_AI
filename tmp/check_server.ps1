try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 5
    Write-Output ('UP: ' + $r.StatusCode)
} catch {
    Write-Output ('DOWN: ' + $_.Exception.Message)
}
