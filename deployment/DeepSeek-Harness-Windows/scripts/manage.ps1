param(
    [ValidateSet('Install','Start','Stop','Status')][string]$Action = 'Start',
    [switch]$NoOpen,
    [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$operationLock = $null
$phase = '读取配置'
function Say([string]$Message) { if (-not $Json) { Write-Host $Message } }
function Write-JsonFile([string]$Path, $Value) {
    [IO.File]::WriteAllText(($Path + '.tmp'), ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath ($Path + '.tmp') -Destination $Path -Force
}
function Set-LocalEnvironment {
    $env:DSH_HOME = Join-Path $root 'data\dsh'
    $env:npm_config_cache = Join-Path $root 'cache\npm'
    $env:npm_config_registry = 'https://registry.npmjs.org/'
    $env:npm_config_userconfig = Join-Path $root 'config\npmrc'
    $env:npm_config_globalconfig = Join-Path $root 'config\npmrc-global'
    $env:TEMP = Join-Path $root 'cache\temp'
    $env:TMP = $env:TEMP
    $env:XDG_CACHE_HOME = Join-Path $root 'cache\xdg'
    $env:HF_HOME = Join-Path $root 'cache\huggingface'
    $env:TORCH_HOME = Join-Path $root 'cache\torch'
    $env:PIP_CACHE_DIR = Join-Path $root 'cache\pip'
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $root 'cache\playwright'
    $env:UV_CACHE_DIR = Join-Path $root 'cache\uv'
    $env:COREPACK_HOME = Join-Path $root 'cache\corepack'
    $env:PNPM_HOME = Join-Path $root 'runtime\pnpm'
    $env:Path = $nodeDir + ';' + $env:Path
    # Avoid inheriting model credentials from unrelated shells; the user configures DSH itself.
    foreach ($name in @('DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','OPENAI_API_KEY','OPENAI_BASE_URL','ANTHROPIC_API_KEY')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
}
function Get-OwnedProcess {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $process = Get-Process -Id $state.processId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    $info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $state.processId)
    if ($process.Path -ne $psExe -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startTicks -or
        $null -eq $info -or -not $info.CommandLine.Contains('"' + $supervisor + '"') -or $state.root -ne $root) {
        throw '记录的进程身份不匹配；未停止任何进程。请检查 data\launcher-state.json，确认旧实例退出后再重试。'
    }
    return $process
}
function Get-ActivePort {
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    return [int]$state.port
}
function Get-LaunchUrl([int]$Port) {
    if (-not ('DshSupervisor' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'supervisor.cs') -ReferencedAssemblies System.Security }
    $value = [DshSupervisor]::ReadLaunchUrl((Join-Path $root 'data\browser-auth.bin'))
    $uri = [Uri]$value
    if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -ne $Port -or $uri.AbsolutePath -ne '/' -or $uri.Query -notmatch '^\?token=[A-Za-z0-9_-]+$') {
        throw '本地启动凭据无效，请停止后重新启动。'
    }
    return $value
}
function Test-Ready([int]$SupervisorId, [int]$Port) {
    try {
        $child = Get-Content -LiteralPath (Join-Path $root 'data\server-process.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $process = Get-Process -Id $child.processId -ErrorAction Stop
        $info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.processId)
        if ($process.Path -ne $nodeExe -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $child.startTicks -or $info.ParentProcessId -ne $SupervisorId) { return $false }
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        # The listener can belong to DSH's worker. Follow only this live supervisor's descendants.
        $ids = @([int]$child.processId)
        $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
        do { $oldCount = $ids.Count; $ids = @($ids + @($all | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -gt $oldCount)
        if (-not ($listeners | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $ids -contains [int]$_.OwningProcess })) { return $false }
        # Do not mistake a normal unauthenticated 401 for failure. Verify the real exchange and HTML.
        $request = [Net.HttpWebRequest]::Create((Get-LaunchUrl $Port))
        $request.Proxy = $null; $request.Timeout = 3000; $request.AllowAutoRedirect = $true
        $request.CookieContainer = New-Object Net.CookieContainer
        $response = $request.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($response.GetResponseStream())
            try { $html = $reader.ReadToEnd() } finally { $reader.Dispose() }
            return ([int]$response.StatusCode -eq 200 -and $response.ResponseUri.Query -eq '' -and $html -match '<html')
        } finally { $response.Dispose() }
    } catch { return $false } # Readiness retry handles files/HTTP not ready; never echo URLs or cookies.
}
function Open-Ui([int]$Port) {
    if (-not $NoOpen) {
        try { Start-Process (Get-LaunchUrl $Port) } catch { throw '浏览器未能打开。服务仍在运行；请再次双击 start.cmd。' }
    }
}
function Wait-Ready($Process, [int]$Port) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $nextNotice = 0
    while ($timer.Elapsed.TotalSeconds -lt $config.startupTimeoutSeconds) {
        $Process.Refresh()
        if ($Process.HasExited) { throw '后台启动失败。查看 logs\supervisor-error.log 和最新 server 日志；修复后可再次双击。' }
        if (Test-Ready $Process.Id $Port) { return }
        if ($timer.Elapsed.TotalSeconds -ge $nextNotice) {
            Say ('正在加载官方组件，已等待 ' + [int]$timer.Elapsed.TotalSeconds + ' 秒；首次启动或移动硬盘可能较慢……')
            $nextNotice += 30
        }
        Start-Sleep -Seconds 2
    }
    throw '启动检查超时，已保留现场。请查看 logs 和 status.cmd；再次启动会继续等待同一实例，也可先 stop.cmd 再重试。'
}
function Install-Runtime {
    if (-not [Environment]::Is64BitOperatingSystem -or ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64')) { throw '此包仅支持 Windows x64。' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $archiveName = 'node-v' + $config.nodeVersion + '-win-x64.zip'
    $archivePath = Join-Path $root ('cache\' + $archiveName)
    $runtimeStamp = Join-Path $nodeDir '.extraction-complete'
    if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $runtimeStamp)) {
        Say '正在准备独立 Node.js（官方来源，首次下载约几十 MB）……'
        if (Test-Path -LiteralPath $archivePath) {
            if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.nodeArchiveSha256) {
                Move-Item -LiteralPath $archivePath -Destination ($archivePath + '.invalid-' + (Get-Date -Format 'yyyyMMddHHmmss'))
            }
        }
        if (-not (Test-Path -LiteralPath $archivePath)) {
            $downloaded = $false
            for ($retry = 1; $retry -le 3; $retry++) {
                try {
                    Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v' + $config.nodeVersion + '/' + $archiveName) -OutFile ($archivePath + '.part') -TimeoutSec 180
                    if ((Get-FileHash -LiteralPath ($archivePath + '.part') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.nodeArchiveSha256) { throw '下载校验失败。' }
                    Move-Item -LiteralPath ($archivePath + '.part') -Destination $archivePath -Force
                    $downloaded = $true; break
                } catch { Say ('下载尚未成功，重试 ' + $retry + '/3。') }
            }
            if (-not $downloaded) { throw 'Node.js 官方下载失败或校验不符。检查网络与磁盘空间后重新双击；不会执行未校验文件。' }
        }
        Say '下载校验完成，正在解压 Node.js……'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $extract = Join-Path $root ('runtime\extract-' + [Guid]::NewGuid().ToString('N'))
        [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extract)
        $prepared = Join-Path $extract ('node-v' + $config.nodeVersion + '-win-x64')
        if (-not (Test-Path -LiteralPath (Join-Path $prepared 'node_modules\npm\bin\npm-cli.js'))) { throw 'Node.js 解压结果不完整，请重试。' }
        if (Test-Path -LiteralPath $nodeDir) {
            Move-Item -LiteralPath $nodeDir -Destination ($nodeDir + '.previous-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
        }
        Move-Item -LiteralPath $prepared -Destination $nodeDir
        Remove-Item -LiteralPath $extract
        [IO.File]::WriteAllText($runtimeStamp, $config.nodeArchiveSha256, (New-Object Text.UTF8Encoding($false)))
    }
    if ((& $nodeExe --version) -ne ('v' + $config.nodeVersion)) { throw 'Node.js 版本不符。停止实例，将 runtime 内对应 Node 目录重命名后重试。' }
    $manifestPath = Join-Path $root 'engine\node_modules\@deepseek-ai\dsh\package.json'
    $stampPath = Join-Path $root 'engine\installed-lock.sha256'
    $lockPath = Join-Path $root 'engine\package-lock.json'
    $lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
    # Windows PowerShell 5.1 ConvertFrom-Json cannot represent npm's empty root package key.
    Add-Type -AssemblyName System.Web.Extensions
    $jsonReader = New-Object Web.Script.Serialization.JavaScriptSerializer
    $jsonReader.MaxJsonLength = 16777216
    $lock = $jsonReader.DeserializeObject([IO.File]::ReadAllText($lockPath))
    if ($lock['packages']['']['dependencies']['@deepseek-ai/dsh'] -ne $config.dshVersion) { throw '配置与锁文件的 DSH 版本不一致，请恢复完整发布包。' }
    foreach ($entry in $lock['packages'].Values) {
        if ($entry.ContainsKey('resolved')) {
            if (-not $entry['resolved'].StartsWith('https://registry.npmjs.org/')) { throw '锁文件包含非 npm 官方来源，已拒绝安装。' }
        }
    }
    $installed = (Test-Path -LiteralPath $cliPath) -and (Test-Path -LiteralPath $stampPath) -and (Test-Path -LiteralPath $manifestPath)
    if ($installed) { $installed = (Get-Content -LiteralPath $stampPath -Raw).Trim() -eq $lockHash -and (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version -eq $config.dshVersion }
    if (-not $installed) {
        Say '正在安装锁定依赖，可能需要几分钟。进度保存在 logs\install.log……'
        $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
        $argsText = '"' + $npmCli + '" ci --cache "' + $env:npm_config_cache + '" --registry https://registry.npmjs.org/ --no-audit --no-fund'
        if (-not ('DshSupervisor' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'supervisor.cs') -ReferencedAssemblies System.Security }
        $installExit = [DshSupervisor]::Install($nodeExe, $argsText, $root)
        if ($installExit -ne 0) { throw '依赖安装失败。检查网络与空间；日志见 logs\install.err.log，修复后再次双击即可重试。' }
        if ((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version -ne $config.dshVersion) { throw '安装结果版本不符。' }
        [IO.File]::WriteAllText($stampPath, $lockHash, (New-Object Text.UTF8Encoding($false)))
    }
    Say ('运行环境就绪：DSH ' + $config.dshVersion + ' / Node.js ' + $config.nodeVersion)
}
try {
    $config = Get-Content -LiteralPath (Join-Path $root 'config\launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or $config.nodeArchiveSha256 -notmatch '^[a-f0-9]{64}$' -or $config.dshVersion -notmatch '^\d+\.\d+\.\d+[-.a-z0-9]*$') { throw '版本或校验配置格式无效。' }
    if ($config.port -isnot [int] -or $config.port -lt 1024 -or $config.port -gt 65535) { throw '端口必须是 1024 到 65535 的整数。' }
    if ($config.portSearchCount -isnot [int] -or $config.portSearchCount -lt 1 -or $config.portSearchCount -gt 100) { throw '候选端口数量必须在 1 到 100 之间。' }
    if ($config.startupTimeoutSeconds -isnot [int] -or $config.startupTimeoutSeconds -lt 30 -or $config.startupTimeoutSeconds -gt 1800) { throw '启动等待时间必须在 30 到 1800 秒之间。' }
    $nodeDir = Join-Path $root ('runtime\node-v' + $config.nodeVersion + '-win-x64')
    $nodeExe = Join-Path $nodeDir 'node.exe'
    $cliPath = Join-Path $root 'engine\node_modules\@deepseek-ai\dsh\lib\bin.js'
    $statePath = Join-Path $root 'data\launcher-state.json'
    $supervisor = Join-Path $PSScriptRoot 'supervise.ps1'
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Set-LocalEnvironment
    if ($Action -eq 'Status') {
        $owned = Get-OwnedProcess
        $status = @{ schemaVersion = 1; status = 'stopped'; url = $null; port = $null; supervisorPid = $null; qqBridge = 'not-integrated'; dshVersion = $config.dshVersion }
        if ($null -ne $owned) {
            $port = Get-ActivePort; $status.port = $port; $status.url = 'http://127.0.0.1:' + $port; $status.supervisorPid = $owned.Id
            $status.status = 'starting-or-unhealthy'
            if (Test-Ready $owned.Id $port) { $status.status = 'ready' }
        }
        if ($Json) { $status | ConvertTo-Json -Compress } elseif ($status.status -eq 'stopped') { Say '当前实例已停止。' } elseif ($status.status -eq 'ready') { Say ('运行正常：' + $status.url + '；打开界面请双击 start.cmd。QQ 桥接尚未接入。') } else { Say '进程存在，但界面尚未就绪。请查看 logs，或停止后重试。' }
        if ($status.status -eq 'starting-or-unhealthy') { exit 2 }; exit 0
    }
    foreach ($folder in @('runtime','cache','cache\temp','logs','data','workspace','plugins','personas')) { New-Item -ItemType Directory -Path (Join-Path $root $folder) -Force | Out-Null }
    $phase = '取得操作锁'
    try { $operationLock = [IO.File]::Open((Join-Path $root 'data\launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None') } catch { throw '另一个安装、启动或停止操作正在进行，请等窗口结束后重试。' }
    $owned = Get-OwnedProcess
    if ($Action -eq 'Stop') {
        if ($null -ne $owned) {
            Stop-Process -Id $owned.Id
            if (-not $owned.WaitForExit(15000)) { throw '后台进程尚未退出，请稍后重试。' }
        }
        foreach ($name in @('launcher-state.json','server-process.json','browser-auth.bin','browser-auth.bin.tmp')) {
            $path = Join-Path $root ('data\' + $name); if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        Say '本包进程组已停止，数据已保留。'; exit 0
    }
    if ($null -ne $owned) {
        $port = Get-ActivePort
        if (-not (Test-Ready $owned.Id $port)) {
            if ($Action -eq 'Start') { Wait-Ready $owned $port }
            else { throw '已有实例尚未就绪。查看 logs；需要重新启动时先双击 stop.cmd。' }
        }
        Say ('复用已运行实例：http://127.0.0.1:' + $port)
        if ($Action -eq 'Start') { Open-Ui $port }; exit 0
    }
    $phase = '安装运行环境'
    Install-Runtime
    if ($Action -eq 'Install') { exit 0 }
    $phase = '选择端口'
    $port = 0
    for ($candidate = $config.port; $candidate -lt [Math]::Min(65536, $config.port + $config.portSearchCount); $candidate++) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue).Count -eq 0) { $port = $candidate; break }
    }
    if ($port -eq 0) { throw '候选端口全部被占用。请修改 config\launcher.json 的 port；未停止其他程序。' }
    if ($port -ne $config.port) { Say ('默认端口被占用，改用 ' + $port + '，其他程序保持运行。') }
    foreach ($name in @('server-process.json','browser-auth.bin','browser-auth.bin.tmp')) { $path = Join-Path $root ('data\' + $name); if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path } }
    $phase = '启动本机界面'
    $argsText = '-NoProfile -ExecutionPolicy Bypass -File "' + $supervisor + '" -Root "' + $root + '" -Port ' + $port
    $process = Start-Process -FilePath $psExe -ArgumentList $argsText -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'logs\supervisor.out.log') -RedirectStandardError (Join-Path $root 'logs\supervisor.err.log') -PassThru
    Write-JsonFile $statePath @{ processId = $process.Id; startTicks = $process.StartTime.ToUniversalTime().Ticks.ToString(); port = $port; root = $root }
    Say '正在启动本机界面并检查浏览器鉴权……'
    Wait-Ready $process $port
    Say ('已启动：http://127.0.0.1:' + $port)
    Open-Ui $port
} catch {
    # Exceptions from networking may embed an authenticated URL; redact before presenting.
    $message = [regex]::Replace($_.Exception.Message, '(?i)([?&]token=)[^\s&]+', '$1[已隐藏]')
    if ($Json) { @{ status = 'error'; phase = $phase; message = $message } | ConvertTo-Json -Compress }
    else { Write-Host ('操作未完成（' + $phase + '）：' + $message) -ForegroundColor Red }
    exit 1
} finally { if ($null -ne $operationLock) { $operationLock.Dispose() } }
