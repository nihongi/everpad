# Windows 版の起動の確認(GitHub Actions の build.yml から呼ぶ)。
#  1. portable 版: 別のフォルダにコピーして起動し、落ちないことと、隣に「EverPad Data」ができることを確かめる
#  2. インストーラー(-SkipInstaller を付けなければ): 画面を出さずにインストール(/S)して起動し、
#     画面を出さずにアンインストール(/S)したあと、設定(%APPDATA%\EverPad)とメモ(ドキュメント\EverPad)が残っていることを確かめる
# 止めるのは、自分が起動したプロセスとその子だけ(手元で試しても、ほかの EverPad には触れない)。
# 結果は GitHub Actions の注釈(::notice / ::error)として書く。
param(
  [string]$Dist = 'dist',
  [string]$Out = 'smoke',
  [switch]$SkipInstaller
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$work = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }) ('everpad-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null

function Note([string]$level, [string]$title, [string]$msg) {
  $m = ($msg -replace '%', '%25') -replace "`r?`n", '%0A'
  Write-Output "::${level} title=${title}::$m"
}
function Fail([string]$title, [string]$msg) { Note 'error' $title $msg; exit 1 }

# 起動したプロセスと、その子・孫(portable 版は一時フォルダに展開した EverPad.exe を子として起動する)。
# portable 版の起動役はすぐ終わることがあり、Windows はそのプロセス番号を別のプロセスに使い回す。
# 番号だけで親子をたどると無関係のプロセスまで止めてしまうので、名前が EverPad で、起動したあとに始まったものだけを対象にする
# 起動して、プロセス番号と起動した時刻を返す(時刻は起動の直前に取る。起動役が先に終わっても読めるように)
function Start-App([string]$file, [string]$dir) {
  $t = Get-Date
  $proc = Start-Process -FilePath $file -WorkingDirectory $dir -PassThru
  [pscustomobject]@{ Id = $proc.Id; StartTime = $t }
}
function Get-Tree($root) {
  $since = $root.StartTime.AddSeconds(-2)
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'EverPad*' -and $_.CreationDate -ge $since } | Select-Object ProcessId, ParentProcessId, Name)
  $ids = @($root.Id); $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added = $true } }
  }
  @($all | Where-Object { $ids -contains $_.ProcessId })
}
function Test-AppRunning($root) { @(Get-Tree $root | Where-Object { $_.Name -eq 'EverPad.exe' }).Count -gt 0 }
# ウィンドウを閉じて(書きかけを保存して終わる)、終わるまで待つ。終わらなければ強制終了
function Stop-Tree($root) {
  foreach ($p in Get-Tree $root) { $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($proc -and $proc.MainWindowHandle -ne 0) { [void]$proc.CloseMainWindow() } }
  for ($i = 0; $i -lt 20 -and (Test-AppRunning $root); $i++) { Start-Sleep 1 }
  foreach ($p in Get-Tree $root) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
}
function Save-Screenshot([string]$path) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } catch { Note 'warning' 'Screenshot' "screenshot failed: $_" }
}

$settingsDir = Join-Path $env:APPDATA 'EverPad'
$hadSettings = Test-Path $settingsDir

# ---------- 1. portable 版 ----------
$portable = Get-ChildItem $Dist -Filter 'EverPad *.exe' | Where-Object { $_.Name -notlike 'EverPad Setup*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $portable) { Fail 'Smoke test (Windows portable)' "portable exe not found in $Dist" }
$pdir = Join-Path $work 'portable'
New-Item -ItemType Directory -Force $pdir | Out-Null
Copy-Item $portable.FullName $pdir
$pexe = Join-Path $pdir $portable.Name
Write-Output "Portable: $pexe"
$p = Start-App $pexe $pdir
Start-Sleep 35   # 初回は一時フォルダへの展開に時間がかかる
Save-Screenshot (Join-Path $Out 'screenshot-windows-portable.png')
if (-not (Test-AppRunning $p)) { Fail 'Smoke test (Windows portable)' 'EverPad exited (or did not start) within 35 seconds' }
Note 'notice' 'Smoke test (Windows portable)' 'EverPad was running after 35 seconds'
Stop-Tree $p
if (-not (Test-Path (Join-Path $pdir 'EverPad Data\notes'))) { Fail 'Smoke test (Windows portable)' "EverPad Data was not created next to the exe:`n$((Get-ChildItem $pdir -Recurse -Depth 2 | ForEach-Object FullName) -join "`n")" }
Note 'notice' 'Smoke test (Windows portable)' 'EverPad Data was created next to the exe'
if (Test-Path (Join-Path $pdir 'EverPad Data\notes\.everpad-lock')) { Fail 'Smoke test (Windows portable)' 'the data folder lock was not removed after closing' }
if (-not $hadSettings -and (Test-Path $settingsDir)) { Fail 'Smoke test (Windows portable)' "the portable version wrote to $settingsDir" }

if ($SkipInstaller) { Write-Output 'Installer test skipped'; exit 0 }

# ---------- 2. インストーラー ----------
$setup = Get-ChildItem $Dist -Filter 'EverPad Setup *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Fail 'Smoke test (Windows installer)' "installer not found in $Dist" }
$ins = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
if ($ins.ExitCode -ne 0) { Fail 'Smoke test (Windows installer)' "silent install failed (exit code $($ins.ExitCode))" }
# 今のユーザー向け(%LOCALAPPDATA%\Programs)が既定。全ユーザー向け(Program Files)になった場合も探す
$exe = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles) | ForEach-Object { Get-ChildItem $_ -Filter 'EverPad.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $exe) { Fail 'Smoke test (Windows installer)' 'EverPad.exe was not found under %LOCALAPPDATA%\Programs or Program Files after a silent install' }
Note 'notice' 'Smoke test (Windows installer)' "Installed: $($exe.FullName)"
$a = Start-App $exe.FullName $exe.DirectoryName
Start-Sleep 25
Save-Screenshot (Join-Path $Out 'screenshot-windows-installed.png')
if (-not (Test-AppRunning $a)) { Fail 'Smoke test (Windows installer)' 'the installed EverPad exited (or did not start) within 25 seconds' }
Note 'notice' 'Smoke test (Windows installer)' 'The installed EverPad was running after 25 seconds'
Stop-Tree $a
if (-not (Test-Path (Join-Path $settingsDir 'config.json'))) { Fail 'Smoke test (Windows installer)' "settings were not saved in $settingsDir" }
$notesDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'EverPad'
# アンインストーラーは自分を一時フォルダにコピーして動くので、終わるまで EverPad.exe が消えるのを待つ
$un = Join-Path $exe.DirectoryName 'Uninstall EverPad.exe'
if (-not (Test-Path $un)) { Fail 'Smoke test (Windows installer)' "uninstaller not found: $un" }
Start-Process -FilePath $un -ArgumentList '/S' -Wait | Out-Null
for ($i = 0; $i -lt 60 -and (Test-Path $exe.FullName); $i++) { Start-Sleep 1 }
if (Test-Path $exe.FullName) { Fail 'Smoke test (Windows installer)' 'EverPad.exe was still there 60 seconds after a silent uninstall' }
Note 'notice' 'Smoke test (Windows installer)' 'Silent uninstall removed the app'
if (-not (Test-Path (Join-Path $settingsDir 'config.json'))) { Fail 'Smoke test (Windows installer)' 'a silent uninstall deleted the settings (they should be kept)' }
if (-not (Test-Path $notesDir)) { Fail 'Smoke test (Windows installer)' "a silent uninstall deleted the data folder $notesDir (it should be kept)" }
Note 'notice' 'Smoke test (Windows installer)' 'After a silent uninstall, the settings and the data folder were kept'
