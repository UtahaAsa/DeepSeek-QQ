Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'manage.ps1') -Action Install
if ($LASTEXITCODE -ne 0) { Read-Host '部署失败，按回车关闭'; exit 1 }
$config = Get-Content -LiteralPath (Join-Path $root 'config\launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nodeDir = Join-Path $root ('runtime\node-v' + $config.nodeVersion + '-win-x64')
$env:DSH_HOME = Join-Path $root 'data\dsh'
$env:npm_config_cache = Join-Path $root 'cache\npm'
$env:npm_config_registry = 'https://registry.npmjs.org/'
$env:npm_config_userconfig = Join-Path $root 'config\npmrc'
$env:npm_config_globalconfig = Join-Path $root 'config\npmrc-global'
$env:TEMP = Join-Path $root 'cache\temp'
$env:TMP = $env:TEMP
foreach ($pair in @(@('HF_HOME','huggingface'),@('TORCH_HOME','torch'),@('PIP_CACHE_DIR','pip'),@('PLAYWRIGHT_BROWSERS_PATH','playwright'),@('UV_CACHE_DIR','uv'),@('COREPACK_HOME','corepack'),@('XDG_CACHE_HOME','xdg'))) {
    [Environment]::SetEnvironmentVariable($pair[0], (Join-Path $root ('cache\' + $pair[1])), 'Process')
}
$env:PNPM_HOME = Join-Path $root 'runtime\pnpm'
foreach ($name in @('DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','OPENAI_API_KEY','OPENAI_BASE_URL','ANTHROPIC_API_KEY')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
$env:Path = $nodeDir + ';' + (Join-Path $root 'engine\node_modules\.bin') + ';' + $env:Path
Set-Location -LiteralPath (Join-Path $root 'workspace')
Write-Host 'DSH 调试终端已就绪。输入 dsh --help 查看命令。手动启动的进程需自行退出。'
Write-Host ('独立数据目录：' + $env:DSH_HOME)
& powershell.exe -NoProfile -NoExit
