# Récupère les binaires Windows (yt-dlp, ffmpeg, ffprobe, deno) dans bin\win.
# Appelé par .github/workflows/release.yml avant de compiler l'installeur, et
# utilisable à la main pour le développement local.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $here "win"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# yt-dlp (binaire autonome).
if (-not (Test-Path "$dest\yt-dlp.exe")) {
  Write-Host "-> yt-dlp..."
  Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "$dest\yt-dlp.exe"
}

# Deno (moteur JS pour le nsig / 4K).
if (-not (Test-Path "$dest\deno.exe")) {
  Write-Host "-> Deno..."
  Invoke-WebRequest -Uri "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile "$env:TEMP\deno.zip"
  Expand-Archive -Force "$env:TEMP\deno.zip" -DestinationPath $dest
  Remove-Item "$env:TEMP\deno.zip"
}

# ffmpeg + ffprobe statiques (BtbN). NB : "latest" est une PRE-RELEASE chez BtbN
# -> releases/latest/download renvoie 404, on vise le tag littéral releases/download/latest.
if ((-not (Test-Path "$dest\ffmpeg.exe")) -or (-not (Test-Path "$dest\ffprobe.exe"))) {
  Write-Host "-> ffmpeg/ffprobe..."
  Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "$env:TEMP\ff.zip"
  Expand-Archive -Force "$env:TEMP\ff.zip" -DestinationPath "$env:TEMP\ff"
  $ffbin = Get-ChildItem -Path "$env:TEMP\ff" -Recurse -Filter ffmpeg.exe | Select-Object -First 1
  Copy-Item $ffbin.FullName "$dest\ffmpeg.exe" -Force
  Copy-Item (Join-Path $ffbin.DirectoryName "ffprobe.exe") "$dest\ffprobe.exe" -Force
  Remove-Item "$env:TEMP\ff.zip"; Remove-Item -Recurse -Force "$env:TEMP\ff"
}

Write-Host "Binaires Windows prêts dans $dest"
