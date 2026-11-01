param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Status',
    [string]$QqApp,
    [switch]$Fixture
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Local-Environment.ps1')
$GatewayRoot = Join-Path $BridgeWork 'native-research\native-adapter'
if ($QqApp) { $env:QQ_GATEWAY_APP = $QqApp }
$GatewayArgs = @((Join-Path $GatewayRoot 'gateway-control.mjs'), $Action)
if ($Fixture) { $GatewayArgs += '--fixture' }
& $BridgeNode @GatewayArgs
exit $LASTEXITCODE
