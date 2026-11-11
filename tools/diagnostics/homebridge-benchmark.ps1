param([ValidateSet('idle','one-camera','all-cameras','recovery')][string]$Phase='idle',[ValidateRange(10,900)][int]$Seconds=120)
$ErrorActionPreference='Stop'
$out="C:/ProgramData/Seerr/homebridge-benchmark-$Phase-$(Get-Date -Format yyyyMMdd-HHmmss).json"
$rows=@()
for($i=0;$i -lt [math]::Ceiling($Seconds/5);$i++){
 $os=Get-CimInstance Win32_OperatingSystem
 $memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
 $vm=Get-VM Homebridge
 $rows += [pscustomobject]@{time=(Get-Date).ToUniversalTime().ToString('o');phase=$Phase;hostFreeMB=[math]::Round($os.FreePhysicalMemory/1024);hostCpu=(Get-CimInstance Win32_Processor).LoadPercentage;pagesPerSec=$memory.PagesPersec;vmAssignedMB=$vm.MemoryAssigned/1MB;vmDemandMB=$vm.MemoryDemand/1MB;vmCpu=$vm.CPUUsage}
 Start-Sleep -Seconds 5
}
$rows | ConvertTo-Json | Set-Content $out
[pscustomobject]@{file=$out;samples=$rows.Count;minHostFreeMB=($rows.hostFreeMB|Measure-Object -Minimum).Minimum;maxHostCpu=($rows.hostCpu|Measure-Object -Maximum).Maximum;maxVmCpu=($rows.vmCpu|Measure-Object -Maximum).Maximum;maxPagesPerSec=($rows.pagesPerSec|Measure-Object -Maximum).Maximum} | ConvertTo-Json -Compress
