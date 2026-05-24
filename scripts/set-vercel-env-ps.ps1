# PowerShell script to set Vercel environment variable
param(
    [string]$EnvName = "GOOGLE_SERVICE_ACCOUNT_JSON",
    [string]$EnvValue = "",
    [string]$EnvFile = ""
)

if (-not $EnvValue -and $EnvFile -and (Test-Path $EnvFile)) {
    $EnvValue = Get-Content -Path $EnvFile -Raw -Encoding UTF8
}

# Write value to temp file (Vercel CLI reads from stdin)
$tempFile = [System.IO.Path]::GetTempFileName()
$EnvValue | Out-File -FilePath $tempFile -Encoding UTF8 -NoNewline

# Add to all environments
Write-Host "Adding $EnvName to Vercel..."
$jsonValueObject = $EnvValue | ConvertFrom-Json -ErrorAction SilentlyContinue
if (-not $jsonValueObject) {
    Write-Host "Warning: Value is not valid JSON"
}

# Use heredoc approach
$result = & npx vercel env add $EnvName production $tempFile 2>&1
Write-Host "Result: $result"

$result = & npx vercel env add $EnvName preview $tempFile 2>&1
Write-Host "Result: $result"

$result = & npx vercel env add $EnvName development $tempFile 2>&1
Write-Host "Result: $result"

Remove-Item $tempFile -Force
Write-Host "Done!"
