; Robloader Extension — installeur Windows en un seul fichier, sans droits admin.
; Compilé par GitHub Actions à chaque release (version injectée via /DAppVersion).
; Il fait ce que install/install-windows.bat fait en dev :
; PlayerDebugMode (CSXS 9→12) + copie du panneau dans les extensions CEP utilisateur.
; Les binaires (bin\win) sont récupérés par la CI AVANT cette compilation.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8F3B1E2A-2C4D-4E6F-9A1B-7D5C3E9F0A12}
AppName=Robloader Extension
AppVersion={#AppVersion}
AppPublisher=Splainte
AppPublisherURL=https://github.com/Splainte/Robloader-Extension
; Tout vit dans le profil utilisateur (AppData + HKCU) → pas d'élévation.
PrivilegesRequired=lowest
DefaultDirName={userappdata}\Adobe\CEP\extensions\com.splainte.robloader
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=Robloader-Extension-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
french.FinishedLabel=Robloader Extension est installé.%n%nRedémarrez Premiere Pro puis ouvrez Fenêtre > Extensions > Robloader.
english.FinishedLabel=Robloader Extension is installed.%n%nRestart Premiere Pro, then open Window > Extensions > Robloader.

[Files]
Source: "..\*"; DestDir: "{app}"; Excludes: "\.git*,\install,\installer"; Flags: recursesubdirs ignoreversion

[Registry]
; Panneaux CEP non signés : PlayerDebugMode pour toutes les versions CSXS visées.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
