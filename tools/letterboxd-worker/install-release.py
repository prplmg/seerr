"""Install the canonical bridge/queue pair only while idle; preserve configuration."""
import ast,hashlib,json,shutil,sqlite3,subprocess,time
from pathlib import Path
root=Path('C:/Users/MSI/MultimeldiaLetterboxdRuntime');stage=Path(__file__).resolve().parent
files=('catalogue_client.py','queue_store.py')
expected=json.loads((stage/'expected.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def ps(s):subprocess.run(['powershell.exe','-NoProfile','-Command',"$ErrorActionPreference='Stop';"+s],check=True,capture_output=True)
def idle():
 with sqlite3.connect(root/'queue.sqlite') as d:
  if d.execute("SELECT 1 FROM jobs WHERE state IN ('queued','offered','running')").fetchone():raise RuntimeError('Worker active; retry installation after work completes')
def accounts():
 with sqlite3.connect(root/'queue.sqlite') as d:return d.execute('SELECT instance,username,paused FROM accounts ORDER BY instance').fetchall()
def stop():
 ps("Stop-ScheduledTask -TaskName Multimeldia-LetterboxdPilot; Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^python(w)?[.]exe$' -and $_.CommandLine -match 'MultimeldiaLetterboxdRuntime' -and $_.CommandLine -match 'bridge[.]py'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}")
def start():ps('Start-ScheduledTask -TaskName Multimeldia-LetterboxdPilot')
for n in files:
 if digest(root/n)!=expected[n]:raise RuntimeError('Live source drift: '+n)
 ast.parse((stage/n).read_text())
idle();before=accounts();config=digest(root/'catalogue.json');backup=root/('compatibility-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir()
for n in files:shutil.copy2(root/n,backup/n)
stop()
try:
 idle()
 for n in files:shutil.copy2(stage/n,root/n)
 assert accounts()==before and digest(root/'catalogue.json')==config
 start()
except Exception:
 for n in files:shutil.copy2(backup/n,root/n)
 start();raise
print(json.dumps({'installed':True,'backup':str(backup),'togglesUnchanged':True,'hashes':{n:digest(root/n) for n in files}}))
