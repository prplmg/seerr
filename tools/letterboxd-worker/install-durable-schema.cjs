const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict');
const root='C:/ProgramData/Seerr',live=root+'/app/seerr-api.yml',staged=root+'/durable-delivery-api.yml',backup=root+'/catalogue-20261028000636651-90188-release/schema-before.yml';
const old=fs.readFileSync(live,'utf8').replace(/\r\n/g,'\n'),next=fs.readFileSync(staged,'utf8').replace(/\r\n/g,'\n');
const addition='                durableDelivery:\n                  description: Worker durably deduplicates replayed delivery IDs.\n                  type: integer\n                  enum: [1]\n';
assert(old===next || next.replace(addition,'')===old,'Unexpected schema changes');
const b=JSON.parse(fs.readFileSync(root+'/data/letterboxd-browser.json')).bindings.find(b=>b.userId===14);assert.notEqual(b.job?.state,'running','Let current reconciliation finish first');
if(!fs.existsSync(backup))fs.copyFileSync(live,backup);
const ps=cmd=>cp.execFileSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';"+cmd],{stdio:'inherit'});
ps("Stop-ScheduledTask -TaskName Seerr; Start-Sleep -Seconds 2; Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.ExecutablePath -eq 'C:\\ProgramData\\Seerr\\node\\node.exe' -and $_.CommandLine -like '*dist*index.js*'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}");
try{fs.copyFileSync(staged,live);}finally{ps('Start-ScheduledTask -TaskName Seerr');}
console.log(JSON.stringify({schemaInstalled:true,backup,sha256:crypto.createHash('sha256').update(next).digest('hex')}));
