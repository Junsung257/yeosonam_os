param(
  [string]$RawDir = "data/product-registration/hwp-inbox/raw",
  [string]$ExtractedDir = "data/product-registration/hwp-inbox/extracted",
  [string]$PreparedDir = "data/product-registration/hwp-inbox/prepared",
  [string]$ReportRoot = "data/product-registration/hwp-inbox/reports",
  [int]$Limit = 2000,
  [switch]$NoPrepared,
  [switch]$Visible,
  [switch]$Force
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

function New-SafeFileStem {
  param([string]$Value)
  $invalid = [System.IO.Path]::GetInvalidFileNameChars()
  $chars = $Value.ToCharArray() | ForEach-Object {
    if ($invalid -contains $_) { "_" } else { $_ }
  }
  $stem = (-join $chars) -replace "\s+", "_"
  $stem = $stem.Trim("._ ")
  if ([string]::IsNullOrWhiteSpace($stem)) { return "hwp-source" }
  if ($stem.Length -gt 90) { return $stem.Substring(0, 90) }
  return $stem
}

function Get-FileSha256 {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-TextSha256 {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Normalize-ExtractedText {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return "" }
  $normalized = $Text -replace "`r", ""
  $normalized = $normalized -replace "[ `t]+`n", "`n"
  $normalized = $normalized -replace "`n{4,}", "`n`n`n"
  return $normalized.Trim()
}

function Get-HwpInstallInfo {
  $known = @(
    "C:\Program Files\Hnc",
    "C:\Program Files (x86)\Hnc"
  )
  foreach ($root in $known) {
    if (Test-Path -LiteralPath $root) {
      $exe = Get-ChildItem -LiteralPath $root -Recurse -Filter Hwp.exe -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        Select-Object -First 1
      if ($exe) {
        return @{
          exe = $exe.FullName
          found = $true
        }
      }
    }
  }
  return @{
    exe = $null
    found = $false
  }
}

function Get-ClipboardTextSafe {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    return [System.Windows.Forms.Clipboard]::GetText()
  } catch {
    return ""
  }
}

function Test-UsableText {
  param([string]$Text)
  $compact = ($Text -replace "\s+", "")
  $lines = @($Text -split "`n" | Where-Object { $_.Trim().Length -ge 8 })
  $prices = [regex]::Matches($Text, "\d{1,3}(,\d{3})+").Count
  $dates = [regex]::Matches($Text, "\d{1,2}\s*[./-]\s*\d{1,2}").Count
  $dayTokens = [regex]::Matches($Text, "(DAY|Day|day)\s*\d+").Count
  $hangul = [regex]::Matches($Text, "\p{IsHangulSyllables}").Count
  return ($compact.Length -ge 500 -and $lines.Count -ge 8 -and ($prices -ge 2 -or $dates -ge 3 -or $dayTokens -ge 2 -or $hangul -ge 300))
}

function Score-DecodedText {
  param([string]$Text)
  $hangul = [regex]::Matches($Text, "\p{IsHangulSyllables}").Count
  $readableAscii = [regex]::Matches($Text, "[A-Za-z0-9]").Count
  $replacement = [regex]::Matches($Text, [char]0xFFFD).Count
  $nulls = [regex]::Matches($Text, [char]0x0000).Count
  return $hangul * 4 + $readableAscii - $replacement * 200 - $nulls * 200
}

function Read-GeneratedTextFile {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $encodings = @(
    [System.Text.Encoding]::UTF8,
    [System.Text.Encoding]::Unicode,
    [System.Text.Encoding]::BigEndianUnicode,
    [System.Text.Encoding]::Default
  )
  $bestText = ""
  $bestScore = [int]::MinValue
  foreach ($encoding in $encodings) {
    try {
      $candidate = $encoding.GetString($bytes)
      $score = Score-DecodedText $candidate
      if ($score -gt $bestScore) {
        $bestText = $candidate
        $bestScore = $score
      }
    } catch {
      # try the next encoding
    }
  }
  return $bestText
}

function Measure-SourceQuality {
  param([string]$Text)
  $nonEmptyLines = @($Text -split "`n" | Where-Object { $_.Trim().Length -gt 0 })
  $priceCount = [regex]::Matches($Text, "\d{1,3}(,\d{3})+").Count
  $dateCount = [regex]::Matches($Text, "\d{1,2}\s*[./-]\s*\d{1,2}").Count
  $dayCount = [regex]::Matches($Text, "(DAY|Day|day)\s*\d+").Count
  $flightCount = [regex]::Matches($Text, "\b[A-Z]{2}\s?\d{2,4}\b").Count
  $hangulCount = [regex]::Matches($Text, "\p{IsHangulSyllables}").Count
  $tabCount = [regex]::Matches($Text, "`t").Count
  $signals = [ordered]@{
    hasHangul = $hangulCount -gt 0
    hasPriceTokens = $priceCount -gt 0
    hasDateTokens = $dateCount -gt 0
    hasDayTokens = $dayCount -gt 0
    hasFlightTokens = $flightCount -gt 0
    hasTabularText = $tabCount -gt 0
  }
  return [ordered]@{
    charCount = $Text.Length
    lineCount = $nonEmptyLines.Count
    hangulCount = $hangulCount
    priceTokenCount = $priceCount
    dateTokenCount = $dateCount
    dayTokenCount = $dayCount
    flightTokenCount = $flightCount
    tabCount = $tabCount
    signals = $signals
    usable = (Test-UsableText $Text)
  }
}

function Open-HwpDocument {
  param(
    [object]$Hwp,
    [string]$Path
  )
  $attempts = @(
    @("", "forceopen:true"),
    @("HWP", "forceopen:true"),
    @("", "")
  )
  foreach ($attempt in $attempts) {
    try {
      $result = $Hwp.Open($Path, $attempt[0], $attempt[1])
      if ($false -ne $result) { return $true }
    } catch {
      # try the next shape
    }
  }
  return $false
}

function Close-HwpDocument {
  param([object]$Hwp)
  foreach ($action in @("FileClose", "Cancel")) {
    try { $Hwp.HAction.Run($action) | Out-Null } catch {}
  }
  try { $Hwp.Clear(1) | Out-Null } catch {}
}

function Save-HwpAsText {
  param(
    [object]$Hwp,
    [string]$TempPath
  )
  $formats = @("TEXT", "Text", "TXT")
  foreach ($format in $formats) {
    try {
      if (Test-Path -LiteralPath $TempPath) {
        Remove-Item -LiteralPath $TempPath -Force
      }
      $saved = $Hwp.SaveAs($TempPath, $format, "")
      if (($false -ne $saved) -and (Test-Path -LiteralPath $TempPath)) {
        $text = Normalize-ExtractedText (Read-GeneratedTextFile $TempPath)
        if (Test-UsableText $text) {
          return @{
            text = $text
            method = "hancom-saveas-$format"
          }
        }
      }
    } catch {
      # Some Hancom builds disable SaveAs text through COM; clipboard fallback handles that.
    }
  }
  return $null
}

function Copy-HwpAllText {
  param([object]$Hwp)
  try {
    [System.Windows.Forms.Clipboard]::Clear()
  } catch {}

  foreach ($action in @("SelectAll", "Copy")) {
    try {
      $Hwp.HAction.Run($action) | Out-Null
    } catch {
      try { $Hwp.Run($action) | Out-Null } catch {}
    }
    Start-Sleep -Milliseconds 250
  }

  for ($i = 0; $i -lt 12; $i++) {
    $text = Normalize-ExtractedText (Get-ClipboardTextSafe)
    if (Test-UsableText $text) {
      return @{
        text = $text
        method = "hancom-selectall-copy"
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Extract-HwpText {
  param(
    [object]$Hwp,
    [string]$Path
  )
  $opened = Open-HwpDocument -Hwp $Hwp -Path $Path
  if (-not $opened) {
    throw "Hancom could not open this HWP file."
  }

  $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("ysn-hwp-" + [System.Guid]::NewGuid().ToString("N") + ".txt")
  try {
    $saved = Save-HwpAsText -Hwp $Hwp -TempPath $tempPath
    if ($saved) { return $saved }

    $copied = Copy-HwpAllText -Hwp $Hwp
    if ($copied) { return $copied }

    throw "Hancom opened the file, but extracted text was empty or too weak."
  } finally {
    if (Test-Path -LiteralPath $tempPath) {
      Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    }
    Close-HwpDocument -Hwp $Hwp
  }
}

$rawFull = Resolve-WorkspacePath $RawDir
$extractedFull = Resolve-WorkspacePath $ExtractedDir
$preparedFull = Resolve-WorkspacePath $PreparedDir
$reportRootFull = Resolve-WorkspacePath $ReportRoot
$runId = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
$reportDir = Join-Path $reportRootFull $runId

New-Item -ItemType Directory -Force -Path $rawFull, $extractedFull, $reportDir | Out-Null
if (-not $NoPrepared) {
  New-Item -ItemType Directory -Force -Path $preparedFull | Out-Null
}

$hwpInstall = Get-HwpInstallInfo
$files = @()
if (Test-Path -LiteralPath $rawFull) {
  $files = @(Get-ChildItem -LiteralPath $rawFull -Recurse -File -Filter *.hwp | Sort-Object FullName | Select-Object -First $Limit)
}

$report = [ordered]@{
  version = 1
  source = "hancom-hwp-inbox"
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  finishedAt = $null
  inputDir = $rawFull
  outputDir = $reportDir
  extractedDir = $extractedFull
  preparedDir = if ($NoPrepared) { $null } else { $preparedFull }
  hancom = $hwpInstall
  mode = [ordered]@{
    preparedCopy = -not $NoPrepared
    visible = [bool]$Visible
    force = [bool]$Force
  }
  dbPreflight = [ordered]@{
    status = "skipped"
    reason = "HWP extraction only"
  }
  rows = @()
  summary = [ordered]@{
    totalFiles = $files.Count
    extracted = 0
    extractionFailed = 0
    duplicateSkipped = 0
    prepared = 0
    registered = 0
    registrationFailed = 0
    savedPackageIds = 0
    mobileLandingVerified = $false
    mobileLandingVerificationReason = "Extraction report only; run offline audit and registration separately."
  }
}

$hwp = $null
try {
  if ($files.Count -gt 0) {
    $hwp = New-Object -ComObject HWPFrame.HwpObject
    try { $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") | Out-Null } catch {}
    try { $hwp.XHwpWindows.Item(0).Visible = [bool]$Visible } catch {}
  }

  $seenText = @{}
  foreach ($file in $files) {
    $row = [ordered]@{
      filePath = $file.FullName
      fileName = $file.Name
      status = "extraction_failed"
      fileHash = $null
      rawTextHash = $null
      extractedTextPath = $null
      preparedTextPath = $null
      charCount = 0
      lineCount = 0
      method = $null
      quality = $null
      error = $null
      savedIds = @()
    }

    try {
      $row.fileHash = Get-FileSha256 $file.FullName
      $result = Extract-HwpText -Hwp $hwp -Path $file.FullName
      $text = Normalize-ExtractedText $result.text
      $hash = Get-TextSha256 $text
      $row.rawTextHash = $hash
      $row.charCount = $text.Length
      $row.lineCount = @($text -split "`n" | Where-Object { $_.Trim().Length -gt 0 }).Count
      $row.method = $result.method
      $row.quality = Measure-SourceQuality $text

      if ($seenText.ContainsKey($hash)) {
        $row.status = "duplicate_skipped"
        $row.error = "duplicate raw text; first file: " + $seenText[$hash]
        $report.summary.duplicateSkipped++
        $report.rows += $row
        continue
      }
      $seenText[$hash] = $file.Name

      $safeStem = New-SafeFileStem ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
      $textFileName = ($hash.Substring(0, 12) + "-" + $safeStem + ".txt")
      $extractedPath = Join-Path $extractedFull $textFileName
      if ((Test-Path -LiteralPath $extractedPath) -and (-not $Force)) {
        $textFileName = ($hash.Substring(0, 12) + "-" + $safeStem + "-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8) + ".txt")
        $extractedPath = Join-Path $extractedFull $textFileName
      }
      [System.IO.File]::WriteAllText($extractedPath, $text, [System.Text.UTF8Encoding]::new($false))
      $row.extractedTextPath = $extractedPath

      if (-not $NoPrepared) {
        $preparedPath = Join-Path $preparedFull $textFileName
        [System.IO.File]::WriteAllText($preparedPath, $text, [System.Text.UTF8Encoding]::new($false))
        $row.preparedTextPath = $preparedPath
        $report.summary.prepared++
      }

      $row.status = "extracted"
      $report.summary.extracted++
    } catch {
      $row.error = $_.Exception.Message
      $report.summary.extractionFailed++
    }

    $report.rows += $row
  }
} finally {
  if ($hwp -ne $null) {
    try { $hwp.Quit() | Out-Null } catch {}
    try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) | Out-Null } catch {}
  }
}

$report.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
$reportPath = Join-Path $reportDir "report.json"
$summaryPath = Join-Path $reportDir "summary.md"
$latestPath = Join-Path $reportRootFull "latest-report.txt"

$json = $report | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($reportPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($latestPath, $reportPath, [System.Text.UTF8Encoding]::new($false))

$summaryLines = @(
  "# HWP Inbox Extraction Report",
  "",
  "- Run: $runId",
  "- Input: $rawFull",
  "- Extracted: $($report.summary.extracted) / $($report.summary.totalFiles)",
  "- Duplicates: $($report.summary.duplicateSkipped)",
  "- Failed: $($report.summary.extractionFailed)",
  "- Report JSON: $reportPath",
  "",
  "| Status | File | Chars | Method | Error |",
  "|---|---:|---:|---|---|"
)
foreach ($row in $report.rows) {
  $err = ""
  if ($row.error) {
    $err = $row.error -replace "\|", "/"
    if ($err.Length -gt 120) { $err = $err.Substring(0, 120) }
  }
  $summaryLines += "| $($row.status) | $($row.fileName) | $($row.charCount) | $($row.method) | $err |"
}
[System.IO.File]::WriteAllText($summaryPath, ($summaryLines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "[hwp-inbox] report: $reportPath"
Write-Host "[hwp-inbox] extracted=$($report.summary.extracted)/$($report.summary.totalFiles) duplicateSkipped=$($report.summary.duplicateSkipped) failed=$($report.summary.extractionFailed)"
if (-not $hwpInstall.found) {
  Write-Warning "Hwp.exe was not found in the known install folders, but COM extraction may still work if Hancom is registered."
}
