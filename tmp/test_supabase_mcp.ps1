# Read-only connectivity test for the Supabase project
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# Load keys from .env
$envFile = Get-Content -Path "$PSScriptRoot\..\.env" -Raw
$supabaseUrl = ([regex]'SUPABASE_URL=(.+)').Match($envFile).Groups[1].Value.Trim()
$serviceKey = ([regex]'SUPABASE_SERVICE_ROLE_KEY=(.+)').Match($envFile).Groups[1].Value.Trim()

Write-Host "Supabase URL: $supabaseUrl"

# 1. List tables exposed by PostgREST
$headers = @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" }
$root = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/" -Headers $headers
$tables = $root.definitions | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
Write-Host "`n=== Tables exposed via REST ($($tables.Count)) ==="
Write-Host ($tables -join ', ')

# 2. Simple read from first table (limit 1)
$sample = $tables | Where-Object { $_ -match '^[a-z_]+$' } | Select-Object -First 1
if ($sample) {
    $rows = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/$($sample)?limit=1" -Headers $headers
    Write-Host "`n=== Sample read from '$sample' ==="
    Write-Host "Row count returned: $($rows.Count)"
    if ($rows.Count -gt 0) {
        Write-Host "Columns: $(($rows[0].PSObject.Properties.Name) -join ', ')"
    }
}

Write-Host "`nSupabase connectivity: OK"
