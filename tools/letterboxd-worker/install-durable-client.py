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
backup=root/('durable-client-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir()
shutil.copy2(root/'catalogue_client.py',backup/'catalogue_client.py')
task('Stop')
try:
 idle();shutil.copy2(staged,root/'catalogue_client.py')
 assert accounts()==before and (root/'catalogue.json').read_bytes()==config
 task('Start')
 print(json.dumps({'installed':True,'backup':str(backup),'accountTogglesUnchanged':True}))
except Exception:
 shutil.copy2(backup/'catalogue_client.py',root/'catalogue_client.py');task('Start');raise
