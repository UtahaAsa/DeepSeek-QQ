param([switch]$InstallOnly, [switch]$VerifyOnly, [switch]$NoOpenBrowser, [string]$QqApp)
<#
/**
 * 核验公开安装清单，准备固定宿主，再启动独立QQ组合。
 * @param InstallOnly 仅安装依赖，不启动DSH或QQ组合。
 * @param VerifyOnly 只读校验，不创建数据目录或执行子入口。
 * @param NoOpenBrowser 启动后不自动打开本机页面。
 * @param QqApp 已安装的受支持QQ resources/app目录；缺省使用固定官方版本路径。
 * @return 0表示所选操作完成，1表示失败且现场保留。
 * @note 安装恢复仅处理固定Node缓存一次，不登录或发送QQ消息。
 */
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# 本入口固定由Windows PowerShell运行，避免继承PowerShell 7的模块搜索路径。
# 仅修改本安装器及其子进程环境，不修改用户或系统环境变量。
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$distributionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$manifestPath = Join-Path $distributionRoot 'INSTALLER-MANIFEST.json'
try {
    # 仅使用本包公开清单；每次先核验，再执行任何安装或启动。
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.kind -ne 'internal_review_installer_candidate_not_release' -or $manifest.productionReady -ne $false) {
        throw 'INSTALLER_MANIFEST_INVALID'
    }
    $entries = @($manifest.files)
    if ($entries.Count -lt 1 -or $entries.Count -gt 10000) { throw 'INSTALLER_FILE_LIMIT' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $checked = 0
    foreach ($entry in $entries) {
        $relative = [string]$entry.path
        if ($relative -match '[\\:]' -or $relative -match '(^|/)(\.|\.\.|)(/|$)' -or
            $relative -match '^(?i:qq-bridge-work/(integration/data/|bridge/state/|bridge/config\.json$|native-research/native-adapter/service-data/)|deployment/DeepSeek-Harness-Windows/(data/|cache/|logs/|runtime/))' -or
            $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or -not $seen.Add($relative)) { throw 'INSTALLER_PATH_REFUSED' }
        $file = [IO.Path]::GetFullPath((Join-Path $distributionRoot $relative))
        if (-not $file.StartsWith($distributionRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'INSTALLER_FILE_MISSING' }
        $ancestor = $file
        while ($ancestor -ne $distributionRoot) {
            if (([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALLER_LINK_REFUSED' }
            $ancestor = Split-Path -Parent $ancestor
        }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'INSTALLER_FILE_CHANGED' }
        $checked++
        if (-not $VerifyOnly -and $checked % 1000 -eq 0) { Write-Host ('正在核验安装文件：' + $checked + '/' + $entries.Count) }
    }
    if ($VerifyOnly) {
        @{ status = 'verified'; verifiedFiles = $checked; installed = $false; started = $false; productionReady = $false } | ConvertTo-Json -Compress
        exit 0
    }
    $hostRoot = Join-Path $distributionRoot 'deployment\DeepSeek-Harness-Windows'
    $bridgeRoot = Join-Path $distributionRoot 'qq-bridge-work'
    $hostInstall = Join-Path $hostRoot 'scripts\manage.ps1'
    $bridgeStart = Join-Path $bridgeRoot 'scripts\Start-NativeIntegration.ps1'
    if (-not $seen.Contains('deployment/DeepSeek-Harness-Windows/scripts/manage.ps1') -or
        -not $seen.Contains('qq-bridge-work/scripts/Start-NativeIntegration.ps1')) { throw 'INSTALLER_ENTRY_MISSING' }
    if (-not $InstallOnly) {
        $qqCheck = $QqApp
        if (-not $qqCheck) { $qqCheck = Join-Path $env:ProgramFiles 'Tencent\QQNT\versions\9.9.35-52892\resources\app' }
        if (-not (Test-Path -LiteralPath (Join-Path $qqCheck 'wrapper.node') -PathType Leaf)) { throw 'INSTALLER_QQ_VERSION_MISSING' }
    }
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Write-Host '正在准备独立运行环境。首次从 Node.js 官方和 npm 官方下载固定依赖，移动硬盘可能较慢。'
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $hostInstall -Action Install -NoOpen
    if ($LASTEXITCODE -ne 0) {
        # 仅恢复已校验的Node缓存；最多一次，不重放模型或QQ操作。
        if (-not $seen.Contains('installer/Repair-NodeExtraction.ps1')) { throw 'HOST_INSTALL_FAILED' }
        & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Repair-NodeExtraction.ps1') -DistributionRoot $distributionRoot
        if ($LASTEXITCODE -ne 0) { throw 'HOST_INSTALL_FAILED' }
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $hostInstall -Action Install -NoOpen
        if ($LASTEXITCODE -ne 0) { throw 'HOST_INSTALL_FAILED' }
    }
    if ($InstallOnly) { Write-Host '运行环境准备完成。双击 Start-QQ.cmd 后，在本机页面配置模型并手动扫码。'; exit 0 }
    $startArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $bridgeStart)
    if ($NoOpenBrowser) { $startArguments += '-NoOpenBrowser' }
    if ($QqApp) { $startArguments += @('-QqApp', $QqApp) }
    & $psExe @startArguments
    if ($LASTEXITCODE -ne 0) { throw 'COMBINED_START_FAILED' }
    exit 0
} catch {
    # 不展示第三方原始异常，避免其中含启动凭据或用户配置内容。
    $code = $_.Exception.Message
    if ($code -notmatch '^(?:INSTALLER_[A-Z_]+|HOST_INSTALL_FAILED|COMBINED_START_FAILED)$') { $code = 'INSTALLER_OPERATION_FAILED' }
    Write-Host ('准备未完成（' + $code + '）。现有数据已保留，请查看所属目录日志；不要清空账号或对话。') -ForegroundColor Red
    exit 1
}
