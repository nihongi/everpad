# Microsoft Store 版(MSIX)の確認(GitHub Actions の build.yml から呼ぶ。手元の PC では動かさない)。
#  1. Store に出すパッケージは署名しないので、確認用に、写しへ一時的な証明書で署名し、その証明書をこの PC で信頼させる
#  2. インストールして起動し、落ちないことと、パッケージのアプリとして動いている(設定が Windows の振り分け先にできる)ことを確かめる
#  3. ウィンドウを閉じて、保存先のロックが外れることを確かめ、アンインストールしてもメモが残ることを確かめる
#  4. -Wack を付けたとき: Windows App Certification Kit(Store の提出前の検査)を動かし、結果を注釈と smoke/wack-report.xml に残す
#     (WACK の不合格は警告にとどめ、ビルドは失敗にしない)
# 証明書をこの PC の信頼する場所に入れるので、GitHub Actions の中でしか動かない。
# 結果は GitHub Actions の注釈(::notice / ::warning / ::error)として書く。
param(
  [string]$Dist = 'dist',
  [string]$Out = 'smoke',
  [switch]$Wack
)
$ErrorActionPreference = 'Stop'
function Note([string]$level, [string]$title, [string]$msg) {
  $m = ($msg -replace '%', '%25') -replace "`r?`n", '%0A'
  Write-Output "::${level} title=${title}::$m"
}
function Fail([string]$msg) { Note 'error' 'Smoke test (Microsoft Store)' $msg; exit 1 }
if ($env:GITHUB_ACTIONS -ne 'true') { Write-Output 'This script changes the trusted certificates of the PC, so it only runs on GitHub Actions.'; exit 1 }

New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$work = Join-Path $env:RUNNER_TEMP ('everpad-store-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null

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

# ---------- 1. 確認用の署名 ----------
$pkg = Get-ChildItem $Dist -Filter '*.appx' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $pkg) { Fail "appx not found in $Dist" }
$appx = (Get-Content package.json -Raw -Encoding utf8 | ConvertFrom-Json).build.appx
Write-Output "Package: $($pkg.FullName)  Identity: $($appx.identityName)  Publisher: $($appx.publisher)"
$test = Join-Path $work $pkg.Name
Copy-Item $pkg.FullName $test   # Store に出すもの(dist の中)は署名しないまま残す

# 証明書の Subject は、パッケージの Publisher と同じでなければならない
$cert = New-SelfSignedCertificate -Type Custom -Subject $appx.publisher -KeyUsage DigitalSignature -FriendlyName 'EverPad CI test (not for distribution)' `
  -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $work 'test.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { Fail 'signtool.exe was not found' }
& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My $test
if ($LASTEXITCODE -ne 0) { Fail "signtool failed (exit code $LASTEXITCODE)" }

# ---------- 2. インストールと起動 ----------
$notesDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'EverPad'
try { Add-AppxPackage -Path $test } catch { Fail "Add-AppxPackage failed: $_" }
$inst = Get-AppxPackage -Name $appx.identityName
if (-not $inst) { Fail 'the package was not found after Add-AppxPackage' }
Note 'notice' 'Smoke test (Microsoft Store)' "Installed: $($inst.PackageFullName)`n$($inst.InstallLocation)"
$started = Get-Date
Start-Process "shell:AppsFolder\$($inst.PackageFamilyName)!$($appx.applicationId)"
function Get-StoreApp { @(Get-Process -Name 'EverPad' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($inst.InstallLocation, [StringComparison]::OrdinalIgnoreCase) }) }
Start-Sleep 25
Save-Screenshot (Join-Path $Out 'screenshot-windows-store.png')
if ((Get-StoreApp).Count -eq 0) { Fail 'EverPad (Microsoft Store) exited (or did not start) within 25 seconds' }
Note 'notice' 'Smoke test (Microsoft Store)' 'EverPad (Microsoft Store) was running after 25 seconds'
# パッケージのアプリとして動いていれば、%APPDATA% への新しい書き込みは、パッケージ専用の場所に振り分けられる
$redirected = Join-Path $env:LOCALAPPDATA "Packages\$($inst.PackageFamilyName)\LocalCache\Roaming\EverPad"
if (-not (Test-Path $redirected)) { Fail "the settings were not redirected to $redirected (is the app running with its package identity?)" }
Note 'notice' 'Smoke test (Microsoft Store)' "Settings were redirected to the package folder:`n$((Get-ChildItem $redirected | ForEach-Object Name) -join ', ')"

# ---------- 3. 終了とアンインストール ----------
foreach ($p in Get-StoreApp) { if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }
for ($i = 0; $i -lt 20 -and (Get-StoreApp).Count -gt 0; $i++) { Start-Sleep 1 }
if ((Get-StoreApp).Count -gt 0) { Get-StoreApp | Stop-Process -Force; Fail 'EverPad (Microsoft Store) did not exit within 20 seconds after closing its window' }
if (-not (Test-Path $notesDir)) { Fail "the data folder $notesDir was not created" }
if (Test-Path (Join-Path $notesDir '.everpad-lock')) { Fail 'the data folder lock was not removed after closing' }
Remove-AppxPackage -Package $inst.PackageFullName
if (Get-AppxPackage -Name $appx.identityName) { Fail 'the package was still installed after Remove-AppxPackage' }
if (-not (Test-Path $notesDir)) { Fail "uninstalling deleted the data folder $notesDir (it should be kept)" }
Note 'notice' 'Smoke test (Microsoft Store)' 'Closed normally; after uninstalling, the data folder was kept'

# ---------- 4. Windows App Certification Kit ----------
if ($Wack) {
  $appcert = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
  if (-not (Test-Path $appcert)) { Note 'warning' 'WACK' "appcert.exe was not found: $appcert" }
  else {
    $report = Join-Path $Out 'wack-report.xml'
    & $appcert reset | Out-Null
    & $appcert test -appxpackagepath $test -reportoutputpath $report | Out-File (Join-Path $Out 'wack.log') -Encoding utf8
    if (-not (Test-Path $report)) { Note 'warning' 'WACK' "no report was written (exit code $LASTEXITCODE); see wack.log" }
    else {
      [xml]$x = Get-Content $report -Raw -Encoding utf8
      $overall = $x.REPORT.OVERALL_RESULT
      $bad = @()
      foreach ($t in $x.SelectNodes('//TEST')) {
        $r = $t.SelectSingleNode('RESULT')
        $res = if ($r) { $r.InnerText.Trim() } else { '' }
        if ($res -and $res -ne 'PASS') { $bad += "${res}: $($t.GetAttribute('NAME')) - $((@($t.SelectNodes('.//MESSAGE')) | ForEach-Object { $_.GetAttribute('TEXT') }) -join ' / ')" }
      }
      $level = if ($overall -eq 'PASS') { 'notice' } else { 'warning' }
      Note $level "WACK: $overall" $(if ($bad.Count) { $bad -join "`n" } else { 'All tests passed' })
    }
  }
}

# 確認用の証明書を消す
Remove-Item "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
