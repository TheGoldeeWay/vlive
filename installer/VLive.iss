; =====================================================================
; VLive — Ultra-Low-Latency Stage MIDI Controller & Studio
; Turnkey Windows x64 Inno Setup Distribution Configuration
; =====================================================================

#define MyAppName "VLive MIDI Controller"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Goldee"
#define MyAppURL "https://github.com/goldee/vlive"
#define MyAppExeName "VLive.exe"

[Setup]
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
OutputDir=..\dist
OutputBaseFilename=VLive_Setup_x64
SetupIconFile=..\resources\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UsedUserAreasWarning=no
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName},0
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main Executable & Resources (Statically linked /MT zero-dependency binary with embedded PWA)
Source: "..\build\Release\VLive.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\resources\icon.ico"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "..\resources\vlive.manifest"; DestDir: "{app}\resources"; Flags: ignoreversion

; Web Application & PWA Assets
Source: "..\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs

; Bundled Signed Virtual MIDI Driver and WebView2 Evergreen Bootstrapper for Fresh OS installs
Source: "..\drivers\teVirtualMIDI64.msi"; DestDir: "{app}\drivers"; Flags: ignoreversion
Source: "..\drivers\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{app}\drivers"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; IconIndex: 0
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; IconIndex: 0; Tasks: desktopicon

[Code]
// Helper: Check if teVirtualMIDI driver service is registered in Windows registry
function NeedsVirtualMidiDriver(): Boolean;
begin
  Result := not RegKeyExists(HKEY_LOCAL_MACHINE, 'SYSTEM\CurrentControlSet\Services\teVirtualMIDI64');
end;

// Helper: Check if Microsoft Edge WebView2 runtime is installed on machine
function NeedsWebView2Runtime(): Boolean;
var
  VersionStr: String;
begin
  Result := True;
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-2347-4E59-86A2-EB64334E9004}', 'pv', VersionStr) then
  begin
    if (VersionStr <> '') and (VersionStr <> '0.0.0.0') then
      Result := False;
  end;
  if Result and RegQueryStringValue(HKEY_CURRENT_USER, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-2347-4E59-86A2-EB64334E9004}', 'pv', VersionStr) then
  begin
    if (VersionStr <> '') and (VersionStr <> '0.0.0.0') then
      Result := False;
  end;
  if Result and RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-2347-4E59-86A2-EB64334E9004}', 'pv', VersionStr) then
  begin
    if (VersionStr <> '') and (VersionStr <> '0.0.0.0') then
      Result := False;
  end;
end;

[Run]
; 1. Silently install signed teVirtualMIDI driver if not already present
Filename: "msiexec.exe"; Parameters: "/i ""{app}\drivers\teVirtualMIDI64.msi"" /qn /norestart"; Check: NeedsVirtualMidiDriver; Flags: runhidden; StatusMsg: "Configuring Virtual MIDI Subsystem (teVirtualMIDI)..."

; 2. Configure teVirtualMIDI service to auto-start on boot and start it now
Filename: "sc.exe"; Parameters: "config teVirtualMIDI64 start= auto"; Flags: runhidden; StatusMsg: "Configuring Virtual MIDI Service (Auto-Start on Boot)..."
Filename: "net.exe"; Parameters: "start teVirtualMIDI64"; Flags: runhidden; StatusMsg: "Starting Virtual MIDI Driver..."

; 3. Silently install Microsoft Edge WebView2 Evergreen Runtime if missing on fresh OS
Filename: "{app}\drivers\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; Check: NeedsWebView2Runtime; Flags: runhidden; StatusMsg: "Installing Microsoft Edge WebView2 Runtime for UI Engine..."

; 4. Add Windows Defender Firewall rules for TCP and UDP across all profiles (Private & Public)
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""VLive MIDI Controller (TCP)"" dir=in action=allow program=""{app}\{#MyAppExeName}"" enable=yes profile=any protocol=TCP"; Flags: runhidden; StatusMsg: "Registering Windows Defender Firewall Rules (TCP)..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""VLive MIDI Controller (UDP)"" dir=in action=allow program=""{app}\{#MyAppExeName}"" enable=yes profile=any protocol=UDP"; Flags: runhidden; StatusMsg: "Registering Windows Defender Firewall Rules (UDP)..."

; 5. Launch Application option
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Clean up firewall rules on uninstall
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VLive MIDI Controller (TCP)"""; Flags: runhidden; RunOnceId: "DelVLiveFwTcp"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""VLive MIDI Controller (UDP)"""; Flags: runhidden; RunOnceId: "DelVLiveFwUdp"

[UninstallDelete]
; Clean up user cache and logs in %LOCALAPPDATA%\VLive
Type: filesandordirs; Name: "{localappdata}\VLive"
