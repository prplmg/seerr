const {test}=require('node:test'),assert=require('node:assert/strict');
const {launcherChange}=require('./runtime-policy.cjs');
test('launcher changes only two executable literals, preserving credential loading and line endings',()=>{
 const old='C:\\ProgramData\\Seerr\\node\\node.exe';
 const before="$env:OPENAI_API_KEY = 'fixture'\r\nif($Probe){\r\n & '"+old+"' -e 'probe'\r\n}else{ & '"+old+"' 'dist\\index.js' }\r\n";
 const result=launcherChange(before);
 assert.equal(result.oldExe,old);
 assert.equal(result.after.replaceAll(result.newExe,old),before);
 assert.ok(result.after.includes('node-v22.23.5'));
 assert.throws(()=>launcherChange(before.replace("' -e", "-changed' -e")),/Unexpected startup/);
});
