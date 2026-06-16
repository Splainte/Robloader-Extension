#!/bin/bash
# Récupère les binaires macOS (yt-dlp, ffmpeg, ffprobe, deno) dans bin/mac.
# Appelé par install/install-macos.sh à l'installation, et utilisable à la main.
# Les binaires sont universels (arm64 + Intel) quand la source le permet.
set -e

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/mac"
mkdir -p "$DEST"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  DENO_TARGET="aarch64-apple-darwin"; FF_ARCH="arm64" ;;
  *)      DENO_TARGET="x86_64-apple-darwin";  FF_ARCH="amd64" ;;
esac

# yt-dlp (binaire universel).
if [ ! -x "$DEST/yt-dlp" ]; then
  echo "-> yt-dlp..."
  curl -fsSL -o "$DEST/yt-dlp" \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
  chmod +x "$DEST/yt-dlp"
fi

# Deno (moteur JS pour le nsig / 4K).
if [ ! -x "$DEST/deno" ]; then
  echo "-> Deno ($DENO_TARGET)..."
  curl -fsSL -o "/tmp/deno.zip" \
    "https://github.com/denoland/deno/releases/latest/download/deno-$DENO_TARGET.zip"
  unzip -oq "/tmp/deno.zip" -d "$DEST"; rm -f "/tmp/deno.zip"
  chmod +x "$DEST/deno"
fi

# ffmpeg + ffprobe statiques (autonomes -> tournent sur n'importe quel Mac).
fetch_ff () {  # $1=ffmpeg|ffprobe
  echo "-> $1 ($FF_ARCH)..."
  curl -fsSL -o "/tmp/$1.zip" \
    "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$FF_ARCH/release/$1.zip"
  unzip -oq "/tmp/$1.zip" -d "$DEST"; rm -f "/tmp/$1.zip"
  chmod +x "$DEST/$1"
}
[ -x "$DEST/ffmpeg" ]  || fetch_ff ffmpeg
[ -x "$DEST/ffprobe" ] || fetch_ff ffprobe

echo "Binaires macOS prêts dans $DEST"
