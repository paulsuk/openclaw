Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\sukpa\Documents\projects\openclaw\docker\dume\sync-gdrive.ps1""", 0, False
