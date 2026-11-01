param([string]$DshHome = '')
. (Join-Path $PSScriptRoot 'Local-Environment.ps1')
if (!$DshHome) { $DshHome = Join-Path $DeploymentRoot 'data\dsh' }
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$LabRoot = (Split-Path -Parent $BridgeWork) + '\'
if (!$DshHome.StartsWith($LabRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'DSH_HOME must stay inside this D-drive lab.' }
if (!(Test-Path -LiteralPath (Join-Path $DshHome 'profiles\web\package.json'))) { throw 'DSH web profile not ready. Follow qq-bridge-handoff.md first.' }
$cfg = Get-Content -LiteralPath (Join-Path $BridgeRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($cfg.allowAllWhenEmpty -or $cfg.snowluma.autoDiscover -ne $false -or $cfg.snowluma.followDiscoveredEndpoint -ne $false) { throw 'Local isolation settings changed; review config before starting.' }
foreach ($endpoint in @($cfg.dsh.baseUrl, $cfg.snowluma.httpUrl, $cfg.snowluma.wsUrl)) {
    $uri = [uri]$endpoint
    if ($uri.Host -ne '127.0.0.1' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Only explicit loopback endpoints without embedded credentials are allowed by this launcher.' }
}
$env:DSH_HOME = $DshHome
Write-Host 'QQ bridge: foreground mode. Ctrl+C stops this bridge only.'
Write-Host 'Console: http://127.0.0.1:3100 (local authentication required)'
Push-Location $BridgeRoot
try { & $BridgeNode 'src/bridge.js'; $bridgeExit = $LASTEXITCODE }
finally { Pop-Location }
exit $bridgeExit
