param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'release' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$allowed = @(
    'start.cmd','stop.cmd','status.cmd','install.cmd','dsh.cmd','.gitignore','README.md','INTEGRATION.md',
    'config\launcher.json','config\npmrc','config\npmrc-global',
    'engine\package.json','engine\package-lock.json',
    'scripts\manage.ps1','scripts\console.ps1','scripts\supervise.ps1','scripts\supervisor.cs','scripts\package.ps1'
)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = Join-Path $output 'DeepSeek-Harness-Windows-0.2.0.zip'
$manifest = @()
$stream = [IO.File]::Open($archivePath + '.partial', 'Create', 'ReadWrite', 'None')
$zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
    foreach ($relative in $allowed) {
        $source = Join-Path $root $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('白名单文件缺失：' + $relative) }
        if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '白名单不得包含符号链接。' }
        $name = 'DeepSeek-Harness-Windows/' + $relative.Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $manifest += @{ path = $name; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $source).Length }
    }
} finally { $zip.Dispose(); $stream.Dispose() }
Move-Item -LiteralPath ($archivePath + '.partial') -Destination $archivePath -Force
[IO.File]::WriteAllText((Join-Path $output 'public-files.json'), ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), ($hash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
Write-Host ('公开包已生成：' + $archivePath + '；文件数：' + $allowed.Count)
