param([string]$QqApp, [switch]$NoOpenBrowser)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Local-Environment.ps1')
if (!$QqApp) { $QqApp = Join-Path $env:ProgramFiles 'Tencent\QQNT\versions\9.9.35-52892\resources\app' }
if (!(Test-Path -LiteralPath (Join-Path $QqApp 'wrapper.node') -PathType Leaf)) {
    throw '未找到受支持的 QQ 9.9.35-52892。请确认安装版本，或通过 -QqApp 指定该版本 resources/app 目录。'
}
$env:QQ_GATEWAY_APP = $QqApp
& $BridgeNode (Join-Path $BridgeWork 'integration\prepare.mjs')
if ($LASTEXITCODE -ne 0) { throw '独立环境准备失败，已保留现有数据。' }
$startOutput = & $BridgeNode (Join-Path $BridgeWork 'integration\control.mjs') Start
if ($LASTEXITCODE -ne 0) { throw '启动未完成，请运行 Status-QQ.cmd 查看状态。不要清空账号或对话目录。' }
$state = $startOutput | ConvertFrom-Json
if ($state.portalUrl -notmatch '^http://127\.0\.0\.1:\d+$') { throw '启动入口校验失败。' }
Write-Output $startOutput
Write-Host '请在本机页面配置模型、确认 QQ 范围，并手动开始扫码。'
if (!$NoOpenBrowser) { Start-Process -FilePath $state.portalUrl }
