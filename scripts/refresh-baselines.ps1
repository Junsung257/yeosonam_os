# Windows PowerShell: baseline 큐 처리 (refresh-baselines.js 래퍼)
# 사용:
#   PowerShell -File scripts\refresh-baselines.ps1
#   PowerShell -File scripts\refresh-baselines.ps1 -DryRun
#   PowerShell -File scripts\refresh-baselines.ps1 -Production
param(
  [switch]$DryRun,
  [switch]$Production
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if ($Production) { $env:BASE_URL = 'https://yeosonam.com' }
$env:UPDATE_BASELINE = '1'

$args = @()
if ($DryRun) { $args += '--dry-run' }

Write-Host "🔄 Baseline Queue Processor 시작 (BASE_URL=$env:BASE_URL)..." -ForegroundColor Cyan
node scripts/refresh-baselines.js @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "`n✅ 완료" -ForegroundColor Green
