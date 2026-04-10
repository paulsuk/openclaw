@echo off
echo Restarting gdrive sync...
powershell.exe -NoProfile -Command "Stop-ScheduledTask -TaskName 'DUM-E gdrive sync' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Start-ScheduledTask -TaskName 'DUM-E gdrive sync'"
echo Done. Sync is running in the background.
pause
