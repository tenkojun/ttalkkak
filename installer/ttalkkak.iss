; 딸깍 설치 파일 (Inno Setup 6). 만들기: npm run setup  →  dist\ttalkkak-setup.exe
; 관리자 권한 없이 사용자 폴더에 설치 (PC방에서도 됨)
#define AppVer "0.1.0"

[Setup]
AppId={{6D1B6B8E-7A33-4C1F-9C5E-7A7A1D5E0B11}
AppName=딸깍
AppVersion={#AppVer}
AppPublisher=tenkojun
AppPublisherURL=https://github.com/tenkojun/ttalkkak
DefaultDirName={localappdata}\Programs\ttalkkak
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ttalkkak-setup
SetupIconFile=..\scripts\ttalkkak.ico
UninstallDisplayIcon={app}\딸깍.exe
UninstallDisplayName=딸깍
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"

[Files]
Source: "..\dist\딸깍.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\딸깍"; Filename: "{app}\딸깍.exe"
Name: "{userdesktop}\딸깍"; Filename: "{app}\딸깍.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\딸깍.exe"; Description: "딸깍 실행"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; 설치된 폴더의 딸깍만 끔 (다른 곳에서 켠 딸깍은 그대로)
Filename: "{sysnative}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -Command ""Get-Process | Where-Object {{ $_.Path -like '{app}\*' } | Stop-Process -Force"""; Flags: runhidden; RunOnceId: "KillApp"
