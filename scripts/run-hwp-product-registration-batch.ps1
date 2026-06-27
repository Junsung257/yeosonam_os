param(
  [string]$RawDir = "data/product-registration/hwp-inbox/raw",
  [string]$ReportPath = "",
  [int]$Limit = 2000,
  [switch]$SkipExtract,
  [switch]$Register,
  [switch]$Visible,
  [switch]$Force,
  [string]$BaseUrl = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-WorkspacePath {
  param([string]$Path)
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Host ""
  Write-Host "[$Name] starting"
  & $Body
  if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
    throw "Step failed: $Name (exit $LASTEXITCODE)"
  }
  Write-Host "[$Name] done"
}

$reportRoot = Resolve-WorkspacePath "data/product-registration/hwp-inbox/reports"
$extractScript = Resolve-WorkspacePath "scripts/extract-hwp-inbox.ps1"

if (-not $SkipExtract) {
  Invoke-Step "extract-hwp" {
    $args = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $extractScript,
      "-RawDir", $RawDir,
      "-Limit", [string]$Limit
    )
    if ($Visible) { $args += "-Visible" }
    if ($Force) { $args += "-Force" }
    & powershell @args
  }
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $latestPath = Join-Path $reportRoot "latest-report.txt"
  if (-not (Test-Path -LiteralPath $latestPath)) {
    throw "No extraction report was found. Run extraction first or pass -ReportPath."
  }
  $ReportPath = [System.IO.File]::ReadAllText($latestPath).Trim()
}

$ReportPath = Resolve-WorkspacePath $ReportPath
if (-not (Test-Path -LiteralPath $ReportPath)) {
  throw "Report not found: $ReportPath"
}

Invoke-Step "offline-source-audit" {
  & npx tsx scripts/audit-upload-inbox-extracted-sources.ts "--report=$ReportPath" --no-parser
}

if ($Register) {
  $report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
  $preparedDir = [string]$report.preparedDir
  if ([string]::IsNullOrWhiteSpace($preparedDir)) {
    throw "This report has no preparedDir. Re-run extraction without -NoPrepared."
  }
  $registerArgs = @(
    "tsx",
    "scripts/register-upload-inbox.ts",
    "--dir=$preparedDir",
    "--register",
    "--fill-attraction-photos",
    "--audit-mobile",
    "--force"
  )
  if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
    $registerArgs += "--base-url=$BaseUrl"
  }
  Invoke-Step "register-and-mobile-audit" {
    & npx @registerArgs
  }
} else {
  Write-Host ""
  Write-Host "[hwp-batch] Registration was not requested. Review the offline audit first, then rerun with -Register."
}
