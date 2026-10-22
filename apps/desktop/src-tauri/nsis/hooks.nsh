; Installer hooks for Ordo (included by Tauri's NSIS template).

; Ordo was called "Summa" until version 0.2.x. Both share the identifier at.summa.app, so the data
; (%APPDATA%\at.summa.app) is the same; only the old program entry, its folder and shortcuts would remain.
; Before installing, remove the old "Summa" installation silently – its uninstaller keeps the user data
; (data is only deleted when the user ticks the box in an interactive uninstall).
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Summa" "InstallLocation"
  ${If} $R1 != ""
    StrCpy $R2 $R1 1
    ${If} $R2 == '"'
      StrCpy $R1 $R1 -1 1
    ${EndIf}
    ${If} ${FileExists} "$R1\uninstall.exe"
      ExecWait '"$R1\uninstall.exe" /S _?=$R1'
      Delete "$R1\uninstall.exe"
      RMDir "$R1"
    ${EndIf}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Summa"
  ${EndIf}
!macroend
