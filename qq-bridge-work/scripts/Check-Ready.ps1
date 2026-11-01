$ErrorActionPreference = 'Stop'
$result = [ordered]@{ dshHttp = 'unreachable'; bridgeHttp = 'unreachable'; onebotHttpPort = $false; onebotWsPort = $false; qqLogin = 'not_checked'; messagesSent = 0 }
foreach ($entry in @(@('dshHttp','http://127.0.0.1:3080/'), @('bridgeHttp','http://127.0.0.1:3100/api/status'))) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri $entry[1] -TimeoutSec 3; $result[$entry[0]] = [int]$r.StatusCode }
    catch { if ($_.Exception.Response) { $result[$entry[0]] = [int]$_.Exception.Response.StatusCode } }
}
foreach ($entry in @(@('onebotHttpPort',3000), @('onebotWsPort',3001))) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $task = $client.ConnectAsync('127.0.0.1', $entry[1]); if ($task.Wait(1000)) { $result[$entry[0]] = $client.Connected } } catch {} finally { $client.Dispose() }
}
$result | ConvertTo-Json
Write-Host 'HTTP 401 means the authenticated HTTP service is reachable; it does not prove QQ login or model readiness.'
