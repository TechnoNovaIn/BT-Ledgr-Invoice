Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 1. Start WSL backend services
WshShell.Run "wsl.exe -d Ubuntu -- bash /opt/ledgr/start.sh", 0, False

' 2. Wait 3 seconds for WSL socket to initialize, then start Windows LAN relay
WScript.Sleep 3000

relayScript = "C:\BT Ledgr — Invoice Intelligence\network_relay.cjs"
If Not fso.FileExists(relayScript) Then
  relayScript = "C:\BT Ledgr Invoice Intelligence\network_relay.cjs"
End If
If Not fso.FileExists(relayScript) Then
  relayScript = "C:\Bills---statements-master\network_relay.cjs"
End If

WshShell.Run "cmd.exe /c pm2 resurrect || pm2 start """ & relayScript & """ --name ledgr-network-relay", 0, False
