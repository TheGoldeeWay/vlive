; =====================================================================
; VLive — Stage MIDI Controller & Studio Installer Script
; Professional Windows Setup Bundling teVirtualMIDI Driver & Goldee Branding
; =====================================================================

#define MyAppName "VLive MIDI Controller"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Goldee"
#define MyAppURL "https://github.com/goldee/vlive"
#define MyAppExeName "VLive.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
AppId={{D37F8E80-87D9-4B52-BF01-8314B157D001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion} (Made by Goldee)
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\VLive
DefaultGroupName=VLive
DisableProgramGroupPage=yes
LicenseFile=
OutputDir=..\dist
OutputBaseFilename=VLive_Setup_v2.0
SetupIconFile=..\resources\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName},0
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main Executable & Resources (Statically linked /MT zero-dependency)
Source: "..\VLive.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\resources\icon.ico"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "..\resources\vlive.rc"; DestDir: "{app}\resources"; Flags: ignoreversion

; Embedded Web Application & PWA Assets
Source: "..\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs

; Bundled Signed Virtual MIDI Driver for Fresh Machines
Source: "..\drivers\teVirtualMIDI64.msi"; DestDir: "{app}\drivers"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; IconIndex: 0
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; IconIndex: 0; Tasks: desktopicon

[Run]
; 1. Silently install signed teVirtualMIDI driver if not already present
Filename: "msiexec.exe"; Parameters: "/i ""{app}\drivers\teVirtualMIDI64.msi"" /qn /norestart"; Flags: runhidden; StatusMsg: "Configuring Virtual MIDI Subsystem (teVirtualMIDI)..."

; 2. Enable teVirtualMIDI service to auto-start on boot and start it now
Filename: "sc.exe"; Parameters: "config teVirtualMIDI64 start= auto"; Flags: runhidden; StatusMsg: "Configuring Virtual MIDI Service (Auto-Start on Boot)..."
Filename: "net.exe"; Parameters: "start teVirtualMIDI64"; Flags: runhidden; StatusMsg: "Starting Virtual MIDI Driver..."

; 3. Add Windows Firewall rule to allow phone/tablet Wi-Fi connection
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""VLive MIDI Server"" dir=in action=allow protocol=TCP localport=8088"; Flags: runhidden; StatusMsg: "Configuring Windows Firewall..."

; 4. Launch Application option
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Remove firewall rule on uninstall
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VLive MIDI Server"""; Flags: runhidden
