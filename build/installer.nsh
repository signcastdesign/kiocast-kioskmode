!macro FindKioskShellProcess OUT
  nsExec::ExecToStack '%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | %SYSTEMROOT%\System32\find.exe /I "${APP_EXECUTABLE_FILENAME}"'
  Pop ${OUT}
  Pop $1
!macroend

!macro KillKioskShell
  DetailPrint "Stopping running ${PRODUCT_NAME} processes..."
  nsExec::ExecToLog '%SYSTEMROOT%\System32\cmd.exe /c taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" 2>NUL'
  Pop $0
  nsExec::ExecToLog '%SYSTEMROOT%\System32\cmd.exe /c taskkill /F /T /IM "KioskShell.exe" 2>NUL'
  Pop $0
  nsExec::ExecToLog '%SYSTEMROOT%\System32\cmd.exe /c taskkill /F /T /IM "KIOCAST KioskShell.exe" 2>NUL'
  Pop $0
  Sleep 1000
!macroend

!macro customCheckAppRunning
  !insertmacro KillKioskShell
!macroend

!macro customInit
  SetOverwrite on
  !insertmacro KillKioskShell
  DetailPrint "Bypassing old broken uninstall registration..."
  SetRegView 64
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  SetRegView 32
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
!macroend

!macro customUnInit
  !insertmacro KillKioskShell
!macroend

!macro customInstall
  SetOverwrite on
!macroend

!macro customUnInstall
  !insertmacro KillKioskShell
  DetailPrint "Removing ${PRODUCT_NAME} runtime data..."
  RMDir /r "$TEMP\kioskshell-data"
  RMDir /r "$LOCALAPPDATA\kioskshell"
  RMDir /r "$APPDATA\kioskshell"
!macroend
