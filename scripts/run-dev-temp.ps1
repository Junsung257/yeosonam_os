param(
  [int]$Port = 3000,
  [int]$Minutes = 20
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Stop-ProcessTree {
  param([int]$ProcessId)

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ParentProcessId -eq $ProcessId } |
    ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$argsList = @("run", "dev", "--", "--port", "$Port")
$process = Start-Process -FilePath "npm.cmd" -ArgumentList $argsList -WorkingDirectory $repoRoot -PassThru

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
