import ast,json,shutil,sqlite3,subprocess,time
from pathlib import Path
root=Path('C:/Users/MSI/MultimeldiaLetterboxdRuntime')
staged=root/'catalogue_client.pending.py'
ast.parse(staged.read_text())
ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
def task(action):
 subprocess.run([ps,'-NoProfile','-Command',f"$ErrorActionPreference='Stop'; {action}-ScheduledTask -TaskName Multimeldia-LetterboxdPilot"],check=True,capture_output=True)
def accounts():
 with sqlite3.connect(root/'queue.sqlite') as db:return db.execute('SELECT instance,username,paused FROM accounts ORDER BY instance').fetchall()
def idle():
 with sqlite3.connect(root/'queue.sqlite') as db:
  if db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','offered','running')").fetchone():raise RuntimeError('Worker busy; active operations left untouched')
idle();before=accounts();config=(root/'catalogue.json').read_bytes()
backup=root/('health-client-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir()
shutil.copy2(root/'catalogue_client.py',backup/'catalogue_client.py')
task('Stop')
# Verify that stopping the task stopped its actual runtime process too.
# Restrict cleanup to the Letterboxd bridge in this runtime, not Edge or playback.
command="$workers=Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^python(w)?[.]exe$' -and $_.CommandLine -match 'MultimeldiaLetterboxdRuntime' -and $_.CommandLine -match 'bridge[.]py'}; $workers | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}"
subprocess.run([ps,'-NoProfile','-Command',command],check=True,capture_output=True)
try:
 idle();shutil.copy2(staged,root/'catalogue_client.py')
 assert accounts()==before and (root/'catalogue.json').read_bytes()==config
 task('Start')
 print(json.dumps({'installed':True,'backup':str(backup),'accountTogglesUnchanged':True}))
except Exception:
 shutil.copy2(backup/'catalogue_client.py',root/'catalogue_client.py');task('Start');raise
