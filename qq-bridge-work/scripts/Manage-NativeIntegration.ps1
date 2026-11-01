param(
    [ValidateSet('Prepare', 'Start', 'Stop', 'Status')][string]$Action = 'Status',
    [string]$QqApp
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Local-Environment.ps1')
if ($QqApp) { $env:QQ_GATEWAY_APP = $QqApp }
if ($Action -eq 'Prepare') {
    & $BridgeNode (Join-Path $BridgeWork 'integration\prepare.mjs')
} else {
    & $BridgeNode (Join-Path $BridgeWork 'integration\control.mjs') $Action
}
exit $LASTEXITCODE
