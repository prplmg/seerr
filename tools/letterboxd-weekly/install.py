"""Install only a hash-checked weekly-list adapter delta; preserve bindings/settings."""
import ast, hashlib, json, shutil, sqlite3, subprocess, time
from pathlib import Path
root=Path('C:/Users/MSI/MultimeldiaLetterboxdRuntime')
extension=root.parent/'MultimeldiaLetterboxdPilot'
stage=Path(__file__).resolve().parent
manifest=json.loads((stage/'expected.json').read_text())
files={'queue_store.py':root,'catalogue_client.py':root,'bridge.py':root,'list-browser.js':extension,'automation.js':extension,'manifest.json':extension}
def digest(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def ps(code):
    return subprocess.run(['powershell.exe','-NoProfile','-Command',"$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"+code],check=True,capture_output=True,text=True)
def idle():
    with sqlite3.connect(root/'queue.sqlite') as db:
        if db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','offered','running')").fetchone():raise RuntimeError('Worker busy; installation deferred')
def stop():
    ps("Stop-ScheduledTask -TaskName Multimeldia-LetterboxdPilot; $ps=Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python' -and $_.CommandLine -like '*MultimeldiaLetterboxdRuntime*bridge.py*' }; $ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep -Milliseconds 500; if(Get-NetTCPConnection -LocalPort 18764 -State Listen -ErrorAction SilentlyContinue){throw 'Bridge listener still active'}")
def start():ps('Start-ScheduledTask -TaskName Multimeldia-LetterboxdPilot')
for name,target in files.items():
    if digest(target/name)!=manifest[name]:raise RuntimeError('Live source drift: '+name)
    if name.endswith('.py'):ast.parse((stage/name).read_text())
if json.loads((stage/'manifest.json').read_text())['version']!='0.2.49':raise RuntimeError('Wrong extension version')
protected={str(p):digest(p) for p in [root/'catalogue.json',extension/'config.js']}
idle()
backup=root/('weekly-lists-backup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir()
for name,target in files.items():shutil.copy2(target/name,backup/name)
try:
    stop();idle()
    for name,target in files.items():shutil.copy2(stage/name,target/name)
    for p,h in protected.items():
        if digest(Path(p))!=h:raise RuntimeError('Protected settings changed')
    start()
except Exception:
    stop()
    for name,target in files.items():shutil.copy2(backup/name,target/name)
    start();raise
print(json.dumps({'installed':'0.2.49','backup':str(backup),'settingsUnchanged':True,'files':list(files)}))
