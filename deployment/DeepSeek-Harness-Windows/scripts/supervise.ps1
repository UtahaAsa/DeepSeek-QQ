param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][int]$Port)
$ErrorActionPreference = 'Stop'
try {
    $config = Get-Content -LiteralPath (Join-Path $Root 'config\launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Add-Type -Path (Join-Path $PSScriptRoot 'supervisor.cs') -ReferencedAssemblies System.Security
    $node = Join-Path $Root ('runtime\node-v' + $config.nodeVersion + '-win-x64\node.exe')
    $cli = Join-Path $Root 'engine\node_modules\@deepseek-ai\dsh\lib\bin.js'
    exit [DshSupervisor]::Run($node, $cli, $Root, $Port)
} catch {
    [IO.File]::WriteAllText((Join-Path $Root 'logs\supervisor-error.log'), '后台启动失败，请重试；若持续失败，请检查运行环境和文件权限。' + [Environment]::NewLine + $_.Exception.GetType().Name)
    exit 1
}
