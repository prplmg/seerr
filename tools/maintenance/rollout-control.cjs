// The build-host wrapper ships this beside each release engine.
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function stopCommand({ task = 'Seerr', executable = 'C:\\ProgramData\\Seerr\\node\\node.exe', entryPattern = 'dist[\\\\/]index[.]js', port = 5055 } = {}) {
 if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
 return String.raw`
$ErrorActionPreference='Stop'
${task ? `Stop-ScheduledTask -TaskName ${quote(task)}` : ''}
$audit = @()
function Get-CatalogueCandidates {
 @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq ${quote(executable)} -and $_.CommandLine -match ${quote(entryPattern)}})
}
function Get-LiveCandidate($candidate) {
 $handle=Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
 if (!$handle) {return $null}
 try {
  if ($handle.HasExited -or $handle.Path -ne ${quote(executable)} -or [Math]::Abs(($handle.StartTime.ToUniversalTime() - $candidate.CreationDate.ToUniversalTime()).TotalSeconds) -gt 1) {
   $handle.Dispose(); return $null
  }
  return $handle
 } catch {$handle.Dispose(); throw}
}
for ($attempt=1; $attempt -le 3; $attempt++) {
 foreach ($candidate in (Get-CatalogueCandidates)) {
  $handle=Get-LiveCandidate $candidate
  if (!$handle) {continue}
  try {
   Stop-Process -InputObject $handle -Force
   $exited=$handle.WaitForExit(15000)
   $audit+=@{attempt=$attempt;pid=$candidate.ProcessId;created=$candidate.CreationDate.ToUniversalTime().ToString('o');exited=$exited}
  } catch {$audit+=@{attempt=$attempt;pid=$candidate.ProcessId;error=$_.Exception.Message}}
  finally {$handle.Dispose()}
 }
 $remaining=@()
 foreach ($candidate in (Get-CatalogueCandidates)) {
  $handle=Get-LiveCandidate $candidate
  if ($handle) {try {$remaining+=@{pid=$candidate.ProcessId;created=$candidate.CreationDate.ToUniversalTime().ToString('o')}} finally {$handle.Dispose()}}
 }
 $listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)
 if (!$remaining.Count -and !$listeners.Count) {
  Write-Output ('Catalogue stop verified: '+(@{attempts=$attempt;processes=$audit}|ConvertTo-Json -Compress -Depth 5)); return
 }
 if ($attempt -lt 3) {Start-Sleep -Milliseconds 500}
}
throw ('Catalogue stop failed: '+(@{processes=$audit;remaining=$remaining;listenerOwners=@($listeners.OwningProcess)}|ConvertTo-Json -Compress -Depth 5))
`;
}
// Before a swap, do not repeat the failing stop: old files are still intact.
async function recoverRelease({ changed, stop, restore, startReady, nativeHealth, finishMaintenance, publicHealth, cleanup }) {
 if (changed) { await stop(); await restore(); }
 await startReady();
 await nativeHealth();
 await finishMaintenance();
 await publicHealth();
 if (!changed) await cleanup();
}
module.exports={stopCommand,recoverRelease};
