# Builds the Bounty TCG desktop app for Windows.
# Downloads the Electron runtime, adds the game and your card images,
# and puts the finished app in the "Bounty TCG" folder next to this script.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Root "Bounty TCG"
$Cache = Join-Path $Root "_downloads"
$ElectronVersion = "44.6.0"
$ElectronZip = "electron-v$ElectronVersion-win32-x64.zip"
$ElectronSha = "04d6071f8deca081044e1398f96f65e4c1550ffdb3f882504cd78528d821d422"
$RceditSha = "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a"

function Get-Verified($Url, $File, $Sha) {
  $path = Join-Path $Cache $File
  if (Test-Path $path) {
    if ((Get-FileHash $path -Algorithm SHA256).Hash -eq $Sha) { return $path }
    Remove-Item $path -Force
  }
  Write-Host "Downloading $File ..."
  Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
  $hash = (Get-FileHash $path -Algorithm SHA256).Hash
  if ($hash -ne $Sha) { Remove-Item $path -Force; throw "$File didn't match its expected checksum, so it wasn't used." }
  return $path
}

New-Item -ItemType Directory -Force -Path $Cache | Out-Null

# 1. Electron runtime
$zip = Get-Verified "https://github.com/electron/electron/releases/download/v$ElectronVersion/$ElectronZip" $ElectronZip $ElectronSha
if (Test-Path $Out) { Write-Host "Removing the old build ..."; Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Write-Host "Unpacking Electron ..."
& tar.exe -xf $zip -C $Out
if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $zip -DestinationPath $Out -Force }
Rename-Item (Join-Path $Out "electron.exe") "Bounty TCG.exe"
Remove-Item (Join-Path $Out "resources\default_app.asar") -Force -ErrorAction SilentlyContinue

# 2. The game
$AppDest = Join-Path $Out "resources\app"
Write-Host "Adding the game ..."
Copy-Item (Join-Path $Root "app") $AppDest -Recurse -Force

# 3. Card images from your existing Bounty TCG site folder
$cardSources = @(
  (Join-Path $Root "cards"),
  (Join-Path (Split-Path -Parent $Root) "cards"),
  (Join-Path (Split-Path -Parent $Root) "bounty-tcg\cards"),
  (Join-Path $env:USERPROFILE "Downloads\bounty-tcg\cards")
)
$cards = $cardSources | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($cards) {
  Write-Host "Copying card images from $cards ..."
  & robocopy.exe $cards (Join-Path $AppDest "cards") *.webp /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the card images failed (robocopy code $LASTEXITCODE)." }
  $n = (Get-ChildItem (Join-Path $AppDest "cards") -Filter *.webp).Count
  Write-Host "  $n card images added."
} else {
  Write-Warning "No card image folder found. Cards will show as text tiles. Put the images in a 'cards' folder next to this script and run it again."
}

# 4. Icon and name on the .exe
try {
  $rcedit = Get-Verified "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe" "rcedit-x64.exe" $RceditSha
  & $rcedit (Join-Path $Out "Bounty TCG.exe") --set-icon (Join-Path $Root "icon.ico") `
    --set-version-string "ProductName" "Bounty TCG" --set-version-string "FileDescription" "Bounty TCG" `
    --set-version-string "CompanyName" "Bounty TCG" --set-version-string "OriginalFilename" "Bounty TCG.exe" `
    --set-file-version "1.0.0" --set-product-version "1.0.0"
} catch { Write-Warning "Couldn't set the app icon: $($_.Exception.Message). The app still works." }

# 5. Desktop shortcut
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Bounty TCG.lnk"))
  $lnk.TargetPath = Join-Path $Out "Bounty TCG.exe"
  $lnk.WorkingDirectory = $Out
  $lnk.Save()
} catch { Write-Warning "Couldn't make a desktop shortcut." }

Write-Host ""
Write-Host "Done. The app is in: $Out"
Write-Host "Starting Bounty TCG ..."
Start-Process (Join-Path $Out "Bounty TCG.exe")
