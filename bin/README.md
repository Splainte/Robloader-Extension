# bin/

Binaires externes utilisés par le panneau (résolus au runtime depuis
`bin/win` sur Windows, `bin/mac` sur macOS, sinon repli sur le `PATH`) :

- `yt-dlp` — téléchargement multi-sites
- `ffmpeg` / `ffprobe` — transcodage, découpe d'extrait, sonde codec
- `deno` — moteur JS pour résoudre le *nsig* YouTube (4K / 1440p)

Les binaires **ne sont pas versionnés** dans git (voir `.gitignore`). Ils sont
récupérés :

- **Windows** : par `bin/fetch-binaries.ps1` (exécuté par la CI de release, ou à
  la main : `powershell -ExecutionPolicy Bypass -File bin/fetch-binaries.ps1`).
- **macOS** : par `bin/fetch-binaries.sh`, lancé automatiquement par
  `install/install-macos.sh` au moment de l'installation.

Sans `deno`, le téléchargement YouTube est plafonné à 1080p (le *nsig* n'est pas
résolu) — le reste fonctionne normalement.
