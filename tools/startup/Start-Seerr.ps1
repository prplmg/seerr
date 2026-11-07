param([switch]$Probe)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CredentialProbe {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct CRED {public UInt32 Flags;public UInt32 Type;public string TargetName;public string Comment;public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;public UInt32 CredentialBlobSize;public IntPtr CredentialBlob;public UInt32 Persist;public UInt32 AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName;}
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool Write(ref CRED c,UInt32 flags);
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool Read(string target,UInt32 type,UInt32 flags,out IntPtr ptr);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool Delete(string target,UInt32 type,UInt32 flags);
 [DllImport("advapi32.dll")]public static extern void CredFree(IntPtr ptr);
}
'@

# This runs within Seerr's own scheduled-task identity, never on the builder.
$env:OPENAI_API_KEY=$null
$ptr=[IntPtr]::Zero
try {
 if([CredentialProbe]::Read('Multimeldia/OpenAI',1,0,[ref]$ptr)) {
  try {
   $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][CredentialProbe+CRED])
   $env:OPENAI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2)
  } finally {[CredentialProbe]::CredFree($ptr)}
 } else {Write-Warning 'AI Search credential unavailable; catalogue will start with AI Search disabled.'}
} catch {Write-Warning 'AI Search credential could not be loaded; catalogue will start with AI Search disabled.'}
try {
 if($Probe) {
  & 'C:\ProgramData\Seerr\node\node.exe' -e 'console.log(JSON.stringify({credentialPresent:!!process.env.OPENAI_API_KEY,identity:process.env.USERNAME}))'
 } else {
  & 'C:\ProgramData\Seerr\node\node.exe' 'dist\index.js'
 }
 $code=$LASTEXITCODE
} finally {$env:OPENAI_API_KEY=$null}
exit $code
