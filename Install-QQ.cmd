@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-QQ.ps1" -InstallOnly
if errorlevel 1 pause
