param(
  [switch]$Kill,
  [int]$MinAgeMinutes = 60,
  [string]$WorkspaceRoot = "",
  [string]$LogPath = ""
)

$ErrorActionPreference = "SilentlyContinue"

if (-not $WorkspaceRoot) {
  $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not $LogPath) {
  $LogPath = Join-Path $WorkspaceRoot ".tmp\node-cleanup.log"
}

$logDir = Split-Path $LogPath -Parent
if ($logDir -and -not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$now = Get-Date
$allProcesses = @(Get-CimInstance Win32_Process)
$processById = @{}
foreach ($process in $allProcesses) {
  $processById[[int]$process.ProcessId] = $process
}

function Get-CreatedAt {
  param($Process)

  if ($Process.CreationDate -is [datetime]) {
    return $Process.CreationDate
  }

  try {
    return [Management.ManagementDateTimeConverter]::ToDateTime($Process.CreationDate)
  } catch {
    return $now
  }
}

function Get-AgeMinutes {
  param($Process)

  return [math]::Round(($now - (Get-CreatedAt $Process)).TotalMinutes, 1)
}

function Sanitize-CommandLine {
  param([string]$CommandLine)

  if (-not $CommandLine) { return "" }

  $safe = $CommandLine
  $safe = $safe -replace '(--access-token\s+)[^\s"]+', '$1[REDACTED]'
  $safe = $safe -replace '(--token\s+)[^\s"]+', '$1[REDACTED]'
  $safe = $safe -replace '(SUPABASE_[A-Z_]*KEY=)[^\s"]+', '$1[REDACTED]'
  return $safe
}

function Has-LiveAncestorNamed {
  param(
    $Process,
    [string[]]$Names
  )

  $parentId = [int]$Process.ParentProcessId
  $guard = 0

  while ($parentId -gt 0 -and $guard -lt 20) {
    if (-not $processById.ContainsKey($parentId)) {
      return $false
    }

    $parent = $processById[$parentId]
    if ($Names -contains $parent.Name) {
      return $true
    }

    $parentId = [int]$parent.ParentProcessId
    $guard += 1
  }

  return $false
}

function Is-ParentMissing {
  param($Process)

  $parentId = [int]$Process.ParentProcessId
  return ($parentId -gt 0 -and -not $processById.ContainsKey($parentId))
}

function Is-ProtectedNode {
  param($Process)

  $cmd = [string]$Process.CommandLine
  $inWorkspace = $cmd -like "*$WorkspaceRoot*"

  if ($Process.ProcessId -eq $PID) { return $true }
  if (Has-LiveAncestorNamed $Process @("codex.exe", "node_repl.exe", "Code.exe", "Cursor.exe")) { return $true }

  if ($inWorkspace -and (
    $cmd -like "*next*dev*" -or
    $cmd -like "*next*build*" -or
    $cmd -like "*npm*run*dev*" -or
    $cmd -like "*npm*run*build*" -or
    $cmd -like "*cross-env*next*" -or
    $cmd -like "*jest-worker*processChild.js*"
  )) {
    return $true
  }

  return $false
}

function Get-CleanupReason {
  param($Process)

  $cmd = [string]$Process.CommandLine
  $ageMinutes = Get-AgeMinutes $Process
  $parentMissing = Is-ParentMissing $Process
  $inWorkspace = $cmd -like "*$WorkspaceRoot*"

  if (Is-ProtectedNode $Process) {
    return $null
  }

  if ($ageMinutes -lt $MinAgeMinutes) {
    return $null
  }

  if ($parentMissing -and $cmd -like "*@supabase*mcp-server-supabase*") {
    return "orphaned Supabase MCP node"
  }

  if ($parentMissing) {
    return "orphaned node process"
  }

  return $null
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  Get-CimInstance Win32_Process |
    Where-Object { $_.ParentProcessId -eq $ProcessId } |
    ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

  Stop-Process -Id $ProcessId -Force
}

$targets = @(
  $allProcesses |
    Where-Object { $_.Name -eq "node.exe" } |
    ForEach-Object {
      $reason = Get-CleanupReason $_
      if ($reason) {
        $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        [pscustomobject]@{
          ProcessId = [int]$_.ProcessId
          ParentProcessId = [int]$_.ParentProcessId
          AgeMinutes = Get-AgeMinutes $_
          RAM_MB = if ($process) { [math]::Round($process.WorkingSet64 / 1MB, 1) } else { 0 }
          Reason = $reason
          CommandLine = Sanitize-CommandLine $_.CommandLine
        }
      }
    }
)

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if ($targets.Count -eq 0) {
  "[$stamp] No safe node cleanup targets found." | Add-Content -Path $LogPath
  Write-Host "No safe node cleanup targets found."
  exit 0
}

"[$stamp] Found $($targets.Count) safe node cleanup target(s). Kill=$($Kill.IsPresent)" | Add-Content -Path $LogPath
$targets |
  Sort-Object RAM_MB -Descending |
  ForEach-Object {
    "  PID=$($_.ProcessId) PPID=$($_.ParentProcessId) Age=$($_.AgeMinutes)m RAM=$($_.RAM_MB)MB Reason=$($_.Reason) Cmd=$($_.CommandLine)" |
      Add-Content -Path $LogPath
  }

$targets | Sort-Object RAM_MB -Descending | Format-Table -AutoSize -Wrap

if (-not $Kill) {
  Write-Host "Dry run only. Re-run with -Kill to stop these processes."
  exit 0
}

$targets |
  Sort-Object ProcessId -Descending |
  ForEach-Object {
    Stop-ProcessTree -ProcessId $_.ProcessId
  }

Write-Host "Stopped $($targets.Count) safe node cleanup target(s)."
