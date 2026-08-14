$tokenPath = Join-Path $env:USERPROFILE ".supabase\access-token"
if (Test-Path $tokenPath) {
    Write-Output "TOKEN FILE EXISTS"
} else {
    Write-Output "NO TOKEN FILE"
}
$cliToken = $env:SUPABASE_ACCESS_TOKEN
if ($cliToken) { Write-Output "ENV TOKEN SET" } else { Write-Output "NO ENV TOKEN" }
