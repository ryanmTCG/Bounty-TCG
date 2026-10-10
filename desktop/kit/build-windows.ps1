# Builds the Bounty TCG desktop app for Windows.
# Downloads the Electron runtime, adds the game and your card images, and puts the
# finished app in the "Bounty TCG" folder next to this script: "Play Bounty TCG.exe"
# on top, with everything else in "Game files". Bounty TCG.zip is that folder, ready to share.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Root "Bounty TCG"
$Game = Join-Path $Out "Game files"
$ZipOut = Join-Path $Root "Bounty TCG.zip"
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
New-Item -ItemType Directory -Force -Path $Game | Out-Null
Write-Host "Unpacking Electron ..."
& tar.exe -xf $zip -C $Game
if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $zip -DestinationPath $Game -Force }
Rename-Item (Join-Path $Game "electron.exe") "Bounty TCG.exe"
Remove-Item (Join-Path $Game "resources\default_app.asar") -Force -ErrorAction SilentlyContinue

# 2. The game
$AppDest = Join-Path $Game "resources\app"
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
  & $rcedit (Join-Path $Game "Bounty TCG.exe") --set-icon (Join-Path $Root "icon.ico") `
    --set-version-string "ProductName" "Bounty TCG" --set-version-string "FileDescription" "Bounty TCG" `
    --set-version-string "CompanyName" "Bounty TCG" --set-version-string "OriginalFilename" "Bounty TCG.exe" `
    --set-file-version "1.0.0" --set-product-version "1.0.0"
} catch { Write-Warning "Couldn't set the app icon: $($_.Exception.Message). The app still works." }

# 5. "Play Bounty TCG" on top of the folder, built with the C# compiler that comes with Windows
try {
  $csc = @("Framework64", "Framework") | ForEach-Object { Join-Path $env:WINDIR "Microsoft.NET\$_\v4.0.30319\csc.exe" } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $csc) { throw "the C# compiler that comes with Windows wasn't found" }
  Write-Host "Making Play Bounty TCG ..."
  & $csc /nologo /target:winexe /optimize /r:System.Windows.Forms.dll "/win32icon:$(Join-Path $Root 'icon.ico')" `
    "/out:$(Join-Path $Out 'Play Bounty TCG.exe')" (Join-Path $Root "launcher.cs") | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "the compiler stopped with code $LASTEXITCODE" }
} catch { Write-Warning "Couldn't make Play Bounty TCG: $($_.Exception.Message). Players can open 'Game files\Bounty TCG.exe' instead." }

# 6. Desktop shortcut
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Bounty TCG.lnk"))
  $lnk.TargetPath = Join-Path $Game "Bounty TCG.exe"
  $lnk.WorkingDirectory = $Game
  $lnk.Save()
} catch { Write-Warning "Couldn't make a desktop shortcut." }

# 7. Bounty TCG.zip to share. It holds the folder's contents, so Extract All gives one
#    "Bounty TCG" folder with Play Bounty TCG right inside.
try {
  Write-Host "Zipping it for sharing ..."
  if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
  [AppContext]::SetSwitch("Switch.System.IO.Compression.ZipFile.UseBackslash", $false)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($Out, $ZipOut, [IO.Compression.CompressionLevel]::Optimal, $false)
} catch { Write-Warning "Couldn't make Bounty TCG.zip: $($_.Exception.Message)" }

Write-Host ""
Write-Host "Done. The app is in: $Out"
if (Test-Path $ZipOut) { Write-Host "To share it, send: $ZipOut" }
Write-Host "Starting Bounty TCG ..."
Start-Process (Join-Path $Game "Bounty TCG.exe")
