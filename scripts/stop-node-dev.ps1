param(
  [switch]$IncludeWorktrees = $true
)

$ErrorActionPreference = "SilentlyContinue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopRoot = [Environment]::GetFolderPath("Desktop")

function Stop-ProcessTree {
  param([int]$ProcessId)

  Get-CimInstance Win32_Process |
    Where-Object { $_.ParentProcessId -eq $ProcessId } |
    ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

  Stop-Process -Id $ProcessId -Force
}

function Is-TargetProcess {
  param($Process)

  $cmd = $Process.CommandLine
  if (-not $cmd) { return $false }
  if ($cmd -like "*AppData\Local\OpenAI\Codex*") { return $false }
  if ($Process.ProcessId -eq $PID) { return $false }

  $inMainRepo = $cmd -like "*$repoRoot*"
  $inWorktree = $IncludeWorktrees -and $cmd -like "*$desktopRoot\yeosonam-*"
  if (-not ($inMainRepo -or $inWorktree)) { return $false }

  return (
    $cmd -like "*next*dev*" -or
    $cmd -like "*next*build*" -or
    $cmd -like "*run dev*" -or
    $cmd -like "*run build*" -or
    $cmd -like "*type-check*" -or
    $cmd -like "*tsc --noEmit*" -or
    $cmd -like "*typescript\bin\tsc*" -or
    $cmd -like "*cross-env*tsc*"
  )
}

$targets = @(Get-CimInstance Win32_Process | Where-Object { Is-TargetProcess $_ })

if ($targets.Count -eq 0) {
  Write-Host "No repo dev/build/type-check Node processes found."
  exit 0
}

Write-Host "Stopping $($targets.Count) repo dev/build/type-check process(es):"
$targets |
  Sort-Object ProcessId |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine |
  Format-Table -AutoSize

$targets |
  Sort-Object ProcessId -Descending |
  ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

Write-Host "Done."
