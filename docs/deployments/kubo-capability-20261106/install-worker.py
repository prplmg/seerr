import ast,hashlib,json,shutil,sqlite3,subprocess,time
from pathlib import Path
root=Path('C:/Users/MSI/MultimeldiaLetterboxdRuntime')
staged=root/'catalogue_client.kubo.py'
expected=Path(__file__).with_name('expected-worker-sha.txt').read_text().strip()
assert hashlib.sha256((root/'catalogue_client.py').read_bytes()).hexdigest()==expected,'Live worker changed'
ast.parse(staged.read_text())
ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
def task(action):
 subprocess.run([ps,'-NoProfile','-Command',f"$ErrorActionPreference='Stop'; {action}-ScheduledTask -TaskName Multimeldia-LetterboxdPilot"],check=True,capture_output=True)
def accounts():
 with sqlite3.connect(f'file:{root / "queue.sqlite"}?mode=ro',uri=True) as db:return db.execute('SELECT instance,username,paused FROM accounts ORDER BY instance').fetchall()
def idle():
 with sqlite3.connect(f'file:{root / "queue.sqlite"}?mode=ro',uri=True) as db:
  rows=db.execute("SELECT action,state,count(*) FROM jobs WHERE state IN ('queued','offered','running') GROUP BY action,state").fetchall()
  if rows:raise RuntimeError('Worker busy; no change: '+str(rows))
idle();before=accounts();config=(root/'catalogue.json').read_bytes()
backup=root/('kubo-capability-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir()
shutil.copy2(root/'catalogue_client.py',backup/'catalogue_client.py')
try:
 task('Stop')
 command="$ErrorActionPreference='Stop'; $workers=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^python(w)?[.]exe$' -and $_.CommandLine -match 'MultimeldiaLetterboxdRuntime' -and $_.CommandLine -match 'bridge[.]py'}); $workers | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}; Start-Sleep -Seconds 1; if(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in @($workers.ProcessId)}) {throw 'Old bridge still running'}"
 subprocess.run([ps,'-NoProfile','-Command',command],check=True,capture_output=True)
 idle();assert accounts()==before
 shutil.copy2(staged,root/'catalogue_client.py')
 assert accounts()==before and (root/'catalogue.json').read_bytes()==config
 task('Start')
 print(json.dumps({'installed':True,'backup':str(backup),'accountTogglesUnchanged':True,'configUnchanged':True,'sha256':hashlib.sha256((root/'catalogue_client.py').read_bytes()).hexdigest()}))
except Exception:
 shutil.copy2(backup/'catalogue_client.py',root/'catalogue_client.py');task('Start');raise
