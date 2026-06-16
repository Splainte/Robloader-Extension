@echo off
REM Robloader Extension — installation dev sur Windows
REM 1. Active PlayerDebugMode (panneaux CEP non signes)
REM 2. Recupere les binaires (yt-dlp, ffmpeg, deno) dans bin\win
REM 3. Copie le panneau dans le dossier extensions CEP utilisateur

for %%V in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

powershell -ExecutionPolicy Bypass -File "%~dp0..\bin\fetch-binaries.ps1"

set DEST=%APPDATA%\Adobe\CEP\extensions\com.splainte.robloader
robocopy "%~dp0.." "%DEST%" /MIR /XD .git .github install installer /XF .gitignore >nul

echo.
echo Robloader Extension installe dans %DEST%
echo Redemarre Premiere Pro puis : Fenetre ^> Extensions ^> Robloader
pause
