param([Parameter(Mandatory=$true)][string]$ProcessIdsCsv)
$ErrorActionPreference = 'Stop'
if ($ProcessIdsCsv -notmatch '^[1-9][0-9]*(,[1-9][0-9]*){0,15}$') { throw 'PROCESS_IDS_REFUSED' }
$processIds = @($ProcessIdsCsv.Split(',') | ForEach-Object { [int]$_ } | Select-Object -Unique)
$processFilter = ($processIds | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR '
$callerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$observedProcesses = @(Get-CimInstance Win32_Process -Filter $processFilter | ForEach-Object {
    $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid
    [ordered]@{
        pid = [int]$_.ProcessId
        parentPid = [int]$_.ParentProcessId
        executable = [string]$_.ExecutablePath
        createdAt = $_.CreationDate.ToUniversalTime().ToString('o')
        ownerMatchesCaller = ($owner.ReturnValue -eq 0 -and $owner.Sid -eq $callerSid)
    }
})
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $processIds } | ForEach-Object {
    [ordered]@{ address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
})
[ordered]@{ observedAt = [datetime]::UtcNow.ToString('o'); processes = $observedProcesses; listeners = $listeners } | ConvertTo-Json -Depth 5 -Compress
