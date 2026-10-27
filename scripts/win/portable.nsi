Unicode true
!include "FileFunc.nsh"
; build: makensis -DAPPDIR=<win-unpacked> -DOUT=<exe> -DVER=1.0.0 -DICON=<ico> portable.nsi
; One self-contained exe: unpacks once to %TEMP%, runs Kitsune with its profile in KitsuneData beside this file.
Name "Kitsune Lite"
OutFile "${OUT}"
Icon "${ICON}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
VIProductVersion "${VER}.0"
VIAddVersionKey "ProductName" "Kitsune Lite"
VIAddVersionKey "FileDescription" "Kitsune Lite (portable)"
VIAddVersionKey "FileVersion" "${VER}"
Section
  StrCpy $0 "$TEMP\KitsuneLite-${VER}"
  IfFileExists "$0\Kitsune.exe" run
  SetOutPath "$0"
  File /r "${APPDIR}\*"
run:
  System::Call 'Kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR")'
  ${GetParameters} $1
  SetOutPath "$EXEDIR"
  Exec '"$0\Kitsune.exe" $1'
SectionEnd
