param(
  [int]$Port = 3000,
  [int]$Minutes = 60,
  [switch]$UseAsciiJunction = $true
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workingDir = $repoRoot

function Stop-ProcessTree {
  param([int]$ProcessId)

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ParentProcessId -eq $ProcessId } |
    ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Test-HasNonAscii {
  param([string]$Value)

  return $Value -match "[^\u0000-\u007F]"
}

function Ensure-AsciiJunction {
  param(
    [string]$TargetPath
  )

  $linkPath = Join-Path ([System.IO.Path]::GetTempPath()) "yeosonam-os-dev-link"

  if (Test-Path -LiteralPath $linkPath) {
    $item = Get-Item -LiteralPath $linkPath -Force
    if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw "Cannot create dev junction because $linkPath already exists and is not a junction."
    }

    $targetMatches = $false
    if ($item.Target) {
      $targetMatches = @($item.Target) -contains $TargetPath
    }

    if (-not $targetMatches) {
      Remove-Item -LiteralPath $linkPath -Force
      New-Item -ItemType Junction -Path $linkPath -Target $TargetPath | Out-Null
    }
  } else {
    New-Item -ItemType Junction -Path $linkPath -Target $TargetPath | Out-Null
  }

  return (Resolve-Path -LiteralPath $linkPath).Path
}

if ($UseAsciiJunction -and (Test-HasNonAscii -Value $repoRoot)) {
  $workingDir = Ensure-AsciiJunction -TargetPath $repoRoot
  Write-Host "Repo path contains non-ASCII characters; using ASCII junction: $workingDir"
}

$argsList = @("run", "dev", "--", "--port", "$Port")
$process = Start-Process -FilePath "npm.cmd" -ArgumentList $argsList -WorkingDirectory $workingDir -PassThru

Write-Host "Started dev server on port $Port with PID $($process.Id)."
Write-Host "It will stop automatically after $Minutes minute(s). Press Ctrl+C to stop earlier."

try {
  Wait-Process -Id $process.Id -Timeout ($Minutes * 60) -ErrorAction SilentlyContinue
} finally {
  if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
    Write-Host "Stopping dev server process tree..."
    Stop-ProcessTree -ProcessId $process.Id
  }
}
