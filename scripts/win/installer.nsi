Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
; build: makensis -DAPPDIR=<win-unpacked> -DOUT=<exe> -DVER=1.0.0 -DICON=<ico> installer.nsi
Name "Kitsune"
BrandingText "Kitsune"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Kitsune"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Kitsune"
!define MUI_WELCOMEPAGE_TEXT "A light, animated, anime-themed browser.$\r$\n$\r$\nThis installs Kitsune just for you. It doesn't need administrator access and only takes a few seconds."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Kitsune.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Kitsune now"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "${VER}.0"
VIAddVersionKey "ProductName" "Kitsune"
VIAddVersionKey "FileDescription" "Kitsune browser installer"
VIAddVersionKey "FileVersion" "${VER}"
VIAddVersionKey "LegalCopyright" "Kitsune"

Section "Install"
  nsExec::Exec 'taskkill /F /IM Kitsune.exe'
  Sleep 400
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Kitsune.lnk" "$INSTDIR\Kitsune.exe"
  CreateShortcut "$SMPROGRAMS\Kitsune.lnk" "$INSTDIR\Kitsune.exe"
  ; Add/Remove Programs
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "DisplayName" "Kitsune"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "DisplayIcon" "$INSTDIR\Kitsune.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "Publisher" "Kitsune"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune" "NoModify" 1
  ; Show up in Default apps as a web browser
  WriteRegStr HKCU "Software\Classes\KitsuneURL" "" "Kitsune URL"
  WriteRegStr HKCU "Software\Classes\KitsuneURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\KitsuneURL\DefaultIcon" "" "$INSTDIR\Kitsune.exe,0"
  WriteRegStr HKCU "Software\Classes\KitsuneURL\shell\open\command" "" '"$INSTDIR\Kitsune.exe" "%1"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune" "" "Kitsune"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\DefaultIcon" "" "$INSTDIR\Kitsune.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\shell\open\command" "" '"$INSTDIR\Kitsune.exe"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\Capabilities" "ApplicationName" "Kitsune"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\Capabilities" "ApplicationDescription" "Light, animated, anime-themed browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\Capabilities\URLAssociations" "http" "KitsuneURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Kitsune\Capabilities\URLAssociations" "https" "KitsuneURL"
  WriteRegStr HKCU "Software\RegisteredApplications" "Kitsune" "Software\Clients\StartMenuInternet\Kitsune\Capabilities"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM Kitsune.exe'
  Sleep 400
  Delete "$DESKTOP\Kitsune.lnk"
  Delete "$SMPROGRAMS\Kitsune.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune"
  DeleteRegKey HKCU "Software\Classes\KitsuneURL"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Kitsune"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Kitsune"
SectionEnd
