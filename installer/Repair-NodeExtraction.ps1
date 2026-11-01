param([Parameter(Mandatory=$true)][string]$DistributionRoot)
<#
/**
 * 恢复固定宿主的Node解压；仅处理已校验缓存且目标运行时不存在的情况。
 * @param DistributionRoot 自有组合安装根目录；不接受单独的外部输出路径。
 * @return 0表示恢复完成；2表示不适用或未完成，失败现场保留。
 * @note 持有宿主操作锁；不联网、不删旧目录、不修改全局状态。
 */
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$operationLock = $null
try {
    $distribution = [IO.Path]::GetFullPath($DistributionRoot).TrimEnd('\')
    if (-not (Test-Path -LiteralPath (Join-Path $distribution 'INSTALLER-MANIFEST.json') -PathType Leaf)) { throw 'NOT_APPLICABLE' }
    $hostRoot = Join-Path $distribution 'deployment\DeepSeek-Harness-Windows'
    $runtime = Join-Path $hostRoot 'runtime'
    foreach ($relative in @('deployment', 'deployment\DeepSeek-Harness-Windows', 'deployment\DeepSeek-Harness-Windows\runtime',
        'deployment\DeepSeek-Harness-Windows\cache', 'deployment\DeepSeek-Harness-Windows\data')) {
        $existing = Join-Path $distribution $relative
        if ((Test-Path -LiteralPath $existing) -and (([IO.File]::GetAttributes($existing) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'NOT_APPLICABLE' }
    }
    $config = Get-Content -LiteralPath (Join-Path $hostRoot 'config\launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $archiveSha = 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62'
    $nodeSha = '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5'
    if ($config.nodeVersion -ne '24.15.0' -or $config.nodeArchiveSha256 -ne $archiveSha) { throw 'NOT_APPLICABLE' }
    $archive = Join-Path $hostRoot 'cache\node-v24.15.0-win-x64.zip'
    $nodeDir = Join-Path $runtime 'node-v24.15.0-win-x64'
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if ((Test-Path -LiteralPath $nodeDir) -or -not (Test-Path -LiteralPath $archive -PathType Leaf) -or
        -not (Test-Path -LiteralPath $tar -PathType Leaf)) { throw 'NOT_APPLICABLE' }
    if (([IO.File]::GetAttributes($archive) -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSha) { throw 'NOT_APPLICABLE' }
    New-Item -ItemType Directory -Path (Join-Path $hostRoot 'data') -Force | Out-Null
    $operationLock = [IO.File]::Open((Join-Path $hostRoot 'data\launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    if (Test-Path -LiteralPath $nodeDir) { throw 'NOT_APPLICABLE' }
    $extract = [IO.Path]::GetFullPath((Join-Path $runtime ('qq-extract-' + [Guid]::NewGuid().ToString('N'))))
    if (-not $extract.StartsWith(([IO.Path]::GetFullPath($runtime) + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'NOT_APPLICABLE' }
    New-Item -ItemType Directory -Path $extract -ErrorAction Stop | Out-Null
    Write-Host '正在使用 Windows 自带工具恢复已校验的 Node 解压……'
    & $tar -xf $archive -C $extract
    if ($LASTEXITCODE -ne 0) { throw 'EXTRACTION_FAILED' }
    $prepared = [IO.Path]::GetFullPath((Join-Path $extract 'node-v24.15.0-win-x64'))
    $destination = [IO.Path]::GetFullPath($nodeDir)
    if (-not $prepared.StartsWith(([IO.Path]::GetFullPath($runtime) + '\'), [StringComparison]::OrdinalIgnoreCase) -or
        -not $destination.StartsWith(([IO.Path]::GetFullPath($runtime) + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'NOT_APPLICABLE' }
    if ((Get-FileHash -LiteralPath (Join-Path $prepared 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeSha -or
        -not (Test-Path -LiteralPath (Join-Path $prepared 'node_modules\npm\bin\npm-cli.js') -PathType Leaf)) { throw 'EXTRACTION_FAILED' }
    if ((Test-Path -LiteralPath $destination) -or
        (([IO.File]::GetAttributes($prepared) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'NOT_APPLICABLE' }
    Move-Item -LiteralPath $prepared -Destination $destination -ErrorAction Stop
    [IO.File]::WriteAllText((Join-Path $destination '.extraction-complete'), $archiveSha, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Node 解压已恢复，继续安装固定依赖。'
    exit 0
} catch {
    Write-Host '本次未恢复 Node 解压，已保留缓存及失败现场。'
    exit 2
} finally { if ($null -ne $operationLock) { $operationLock.Dispose() } }
