param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$entry = Join-Path $PSScriptRoot 'entry.cjs'
$node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (!(Test-Path -LiteralPath $node)) { throw 'Node 24 runtime is missing. No fallback runtime or database will be used.' }
$profile = (& $node $entry profile) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read local test profile.' }
$runtimeDir = Join-Path $root '.logs\local-test'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$mutex = New-Object System.Threading.Mutex($false, 'Local\AI-Novel-Legacy-Test-3000-5190')
if (!$mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Another startup is in progress. Please wait.' }
try {
  $recordPath = Join-Path $runtimeDir 'processes.json'
  $record = if (Test-Path -LiteralPath $recordPath) { Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json } else { $null }
  $listeners = @{}
  foreach ($port in @(3000,5190)) {
    $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -gt 1) { throw "Multiple services on port $port. No process was stopped." }
    $listeners[$port] = if ($owners.Count) { $owners[0] } else { $null }
    if ($owners.Count) {
      $role = if ($port -eq 3000) { 'server' } else { 'client' }
      $expectedPid = if ($role -eq 'server') { $record.serverPid } else { $record.clientPid }
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
      if (!$record -or $record.database -ne $profile.database -or $record.fingerprint -ne $profile.fingerprint -or
          $expectedPid -ne $owners[0] -or $proc.ExecutablePath -ne $node -or
          !$proc.CommandLine.Contains($entry) -or !$proc.CommandLine.EndsWith(" $role")) {
        throw "Port $port belongs to an unverified or older service. No process was stopped and no alternate port was selected."
      }
    }
  }
  if ($listeners[3000]) {
    $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 10
    if ($health.data.runtime.pid -ne $listeners[3000] -or $health.data.runtime.stale) { throw 'Backend needs a controlled reload; startup will not interrupt it.' }
  } else {
    $check = & $node $entry check
    if ($LASTEXITCODE -ne 0) { throw 'Database identity, runtime, or idle-state check failed.' }
    $check | Set-Content -LiteralPath (Join-Path $runtimeDir 'pre-start.json') -Encoding UTF8
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $serverPid = $listeners[3000]
  $clientPid = $listeners[5190]
  function Save-ProcessRecord {
    @{ database=$profile.database; fingerprint=$profile.fingerprint; serverPid=$serverPid; clientPid=$clientPid; updatedAt=(Get-Date).ToString('o') } |
      ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
  }
  if (!$serverPid) {
    $env:RUN_WITH_LOG_PATH = Join-Path $runtimeDir "$stamp-server.log"
    $env:RUN_WITH_LOG_LLM_PATH = Join-Path $runtimeDir "$stamp-server.llm.jsonl"
    $env:RUN_WITH_LOG_LLM_REPAIR_PATH = Join-Path $runtimeDir "$stamp-server.llm-repair.jsonl"
    $server = Start-Process -FilePath $node -ArgumentList @(('"'+$entry+'"'), 'server') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $env:RUN_WITH_LOG_PATH -RedirectStandardError (Join-Path $runtimeDir "$stamp-server.err.log")
    $serverPid = $server.Id
    Save-ProcessRecord
  }
  $ready = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    if (!(Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { throw "Backend exited. See $runtimeDir" }
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
      if ($health.data.runtime.pid -eq $serverPid -and !$health.data.runtime.stale) { $ready=$true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw "Backend is not ready. See $runtimeDir; no task was resumed." }
  if (!$clientPid) {
    $client = Start-Process -FilePath $node -ArgumentList @(('"'+$entry+'"'), 'client') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "$stamp-client.log") -RedirectStandardError (Join-Path $runtimeDir "$stamp-client.err.log")
    $clientPid = $client.Id
    Save-ProcessRecord
  }
  $ready = $false
  for ($attempt=0; $attempt -lt 40; $attempt++) {
    if (!(Get-Process -Id $clientPid -ErrorAction SilentlyContinue)) { throw "Frontend exited. See $runtimeDir" }
    try {
      $proxy = Invoke-RestMethod 'http://127.0.0.1:5190/api/health' -TimeoutSec 2
      if ($proxy.data.runtime.pid -eq $serverPid) { $ready=$true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Frontend proxy did not reach the verified backend.' }
  Write-Host "Ready: $($profile.url)"
  Write-Host "Database: $($profile.database)"
  Write-Host 'Starting the workspace does not resume the paused director.'
  if (!$NoBrowser) { Start-Process $profile.url }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
