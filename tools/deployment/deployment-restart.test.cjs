const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('the emitted PowerShell selector matches actual Windows and slash command paths',()=>{
 const source=fs.readFileSync(__dirname+'/ReconciliationRelease.cjs','utf8');
 const line=source.split('\n').find(l=>l.includes('const stop='));
 let command;vm.runInNewContext(line+';stop();',{ps:s=>command=s});
 const pattern=command.match(/CommandLine -match '([^']+)'/)[1];
 assert(new RegExp(pattern).test('node.exe "dist\\index.js"'));
 assert(new RegExp(pattern).test('node.exe dist/index.js'));
 assert(!new RegExp(pattern).test('node.exe watch-party-relay.js'));
 assert(command.includes('Catalogue child survived stop'));
 assert(command.indexOf('WaitForExit(15000)') < command.indexOf('$survivors ='));
 assert(command.includes('Stop-Process -InputObject $process')); 
});
