param([switch]$Check, [switch]$ValidateWindow)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = Join-Path (Split-Path -Parent $taskRoot) 'deployment\DeepSeek-Harness-Windows\runtime\node-v24.15.0-win-x64\node.exe'
$taskController = Join-Path $taskRoot 'integration\service-recovery.mjs'
if ($Check) { $env:NODE_DISABLE_COMPILE_CACHE = '1'; & $taskNode $taskController Status; exit $LASTEXITCODE }
Add-Type -AssemblyName PresentationFramework
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="大肥鱼 · 服务救援" Width="620" Height="410" MinWidth="460" MinHeight="350" WindowStartupLocation="CenterScreen" Background="#F1F5FB" FontFamily="Microsoft YaHei UI" FontSize="16">
 <Grid Margin="30"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
 <TextBlock FontSize="15" Foreground="#52698E" Text="大肥鱼的小急救站"/>
 <TextBlock Name="TitleText" Grid.Row="1" Margin="0,14,0,12" FontSize="25" FontWeight="SemiBold" TextWrapping="Wrap" Foreground="#253856" Text="正在检查服务…"/>
 <TextBlock Name="DetailText" Grid.Row="2" Foreground="#4B5D77" TextWrapping="Wrap" LineHeight="28" Text="这个窗口独立运行，即使管理页面打不开，也可以从这里恢复。"/>
 <WrapPanel Grid.Row="3" Margin="0,18,0,16"><Button Name="ActionButton" Padding="22,12" MinHeight="48" Background="#365889" Foreground="White" BorderThickness="0" IsEnabled="False" Content="正在检查"/><Button Name="RefreshButton" Padding="18,12" Margin="12,0,0,0" MinHeight="48" Content="重新检查"/><Button Name="RestartButton" Padding="16,12" Margin="12,0,0,0" MinHeight="48" Visibility="Collapsed" Content="重启服务…"/></WrapPanel>
 <TextBlock Name="CodeText" Grid.Row="4" FontSize="12" TextWrapping="Wrap" Foreground="#596B83" Text="模型、声音、角色和会话会保留。QQ验证始终由本人完成。"/>
 </Grid>
</Window>
'@
$reader = [System.Xml.XmlNodeReader]::new($markup)
$window = [Windows.Markup.XamlReader]::Load($reader)
if ($ValidateWindow) { [pscustomobject]@{WindowLoaded=$true;ControlsFound=(@('TitleText','DetailText','ActionButton','RefreshButton','CodeText') | Where-Object {$null -ne $window.FindName($_)}).Count} | ConvertTo-Json -Compress; return }
$titleText = $window.FindName('TitleText'); $detailText = $window.FindName('DetailText')
$actionButton = $window.FindName('ActionButton'); $refreshButton = $window.FindName('RefreshButton'); $codeText = $window.FindName('CodeText'); $restartButton = $window.FindName('RestartButton')
$script:recoveryProcess = $null; $script:recoveryView = $null; $script:lastCheck = [DateTime]::MinValue
function Start-RecoveryOperation([string]$operation) {
    if ($script:recoveryProcess) { return }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $taskNode
    $info.Arguments = '"' + $taskController + '" ' + $operation
    if ($operation -eq 'Restart') { $info.Arguments += ' --confirm-restart' }
    $info.WorkingDirectory = $taskRoot; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.EnvironmentVariables['TEMP'] = Join-Path $taskRoot 'temp'
    $info.EnvironmentVariables['TMP'] = Join-Path $taskRoot 'temp'
    $info.EnvironmentVariables['NODE_DISABLE_COMPILE_CACHE'] = '1'
    $script:recoveryProcess = [Diagnostics.Process]::Start($info)
    $script:lastCheck = [DateTime]::UtcNow
    $actionButton.IsEnabled = $false; $refreshButton.IsEnabled = $false
    $restartButton.IsEnabled = $false
    if ($operation -ne 'Status') { $titleText.Text = '正在处理，请稍等…' }
}
$timer = [Windows.Threading.DispatcherTimer]::new(); $timer.Interval = [TimeSpan]::FromMilliseconds(350)
$timer.Add_Tick({
    if ($script:recoveryProcess -and $script:recoveryProcess.HasExited) {
        try {
            $raw = $script:recoveryProcess.StandardOutput.ReadToEnd()
            $script:recoveryView = $raw | ConvertFrom-Json
            $titleText.Text = $script:recoveryView.title; $detailText.Text = $script:recoveryView.detail
            $actionButton.Content = $script:recoveryView.actionLabel
            $actionButton.IsEnabled = $script:recoveryView.action -in @('open','start','reconnect')
            $restartButton.Visibility = if ($script:recoveryView.canRestart) { 'Visible' } else { 'Collapsed' }
            $restartButton.IsEnabled = [bool]$script:recoveryView.canRestart
            $codeText.Text = if ($script:recoveryView.error) { '诊断编号：' + $script:recoveryView.error } else { '模型、声音、角色和会话会保留。QQ验证始终由本人完成。' }
            if ($script:recoveryView.openUrl -match '^http://127\.0\.0\.1:\d{1,5}$') { Start-Process -FilePath $script:recoveryView.openUrl }
        } catch { $titleText.Text = '暂时未能完成检查'; $detailText.Text = '请稍后点击重新检查。当前服务没有被强制结束。'; $actionButton.IsEnabled = $false }
        $script:recoveryProcess.Dispose(); $script:recoveryProcess = $null; $refreshButton.IsEnabled = $true
    }
    if (-not $script:recoveryProcess -and ([DateTime]::UtcNow - $script:lastCheck).TotalSeconds -gt 10) { Start-RecoveryOperation 'Status' }
})
$refreshButton.Add_Click({ Start-RecoveryOperation 'Status' })
$restartButton.Add_Click({
    $answer = [Windows.MessageBox]::Show($window, '重启会暂时断开QQ与语音服务，原模型、声音、角色和会话会保留。绘图密钥只在内存中，重启后需要在本机重新设置。需要QQ验证时请由本人完成。现在重启吗？', '确认重启大肥鱼服务', [Windows.MessageBoxButton]::YesNo, [Windows.MessageBoxImage]::Question, [Windows.MessageBoxResult]::No)
    if ($answer -eq [Windows.MessageBoxResult]::Yes) { Start-RecoveryOperation 'Restart' }
})
$actionButton.Add_Click({
    if ($script:recoveryView.action -eq 'open') {
        # 重新查询当前状态文件，仅使用无凭据本机入口；不沿用过期端口。
        try { $current = Get-Content -LiteralPath (Join-Path $taskRoot 'integration\data\status.json') -Raw | ConvertFrom-Json
            if ($current.controlUrl -match '^http://127\.0\.0\.1:\d{1,5}$') { Start-Process -FilePath $current.controlUrl }
        } catch { Start-RecoveryOperation 'Status' }
    } elseif ($script:recoveryView.action -eq 'start') { Start-RecoveryOperation 'Start' }
    elseif ($script:recoveryView.action -eq 'reconnect') { Start-RecoveryOperation 'Reconnect' }
})
$window.Add_Closed({ $timer.Stop(); if ($script:recoveryProcess) { $script:recoveryProcess.Dispose() } })
$timer.Start(); Start-RecoveryOperation 'Status'
[void]$window.ShowDialog()
