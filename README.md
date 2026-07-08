# ⚙️ Robloader Extension

**Robloader au format extension, directement
dans un panneau Adobe Premiere Pro.**

Colle une URL (YouTube, TikTok, Instagram, X/Twitter, Weibo) : Robloader télécharge
la vidéo, la prépare pour Premiere et **l'importe automatiquement** dans ton projet
ouvert — dans le chutier `ELEMENTS/Robloader`, avec le fichier rangé au bon endroit
sur le disque.

C'est une variante simplifiée de l'app desktop Robloader, pensée pour le montage :
pas de choix de dossier, pas de réglages superflus, l'extension fait ce qu'il faut.

---

## ✨ Ce que fait l'extension

- **Multi-plateformes** — YouTube, TikTok, Instagram, X (Twitter), Weibo.
- **Destination automatique** — tout va dans `ELEMENTS/Robloader/` si ton projet
  suit l'arborescence standard, sinon dans un dossier `Robloader/` à côté du `.prproj`.
  Aucun dossier à choisir.
- **Import automatique dans Premiere** — le fichier apparaît dans le chutier miroir
  `ELEMENTS/Robloader` dès qu'il est prêt.
- **Transcodage intelligent et automatique** (voir ci-dessous) — H.265 seulement
  quand c'est nécessaire.
- **Extraction d'un segment** — début/fin optionnels pour ne récupérer qu'un passage.
- **Choix de la qualité** (YouTube) — Max (jusqu'à 4K), 1440p, 1080p, 720p, 480p.
- **Audio seul (WAV)** — pour récupérer juste la bande-son.
- **Cookies automatiques** — utilise ta session navigateur pour débloquer la 4K, les
  vidéos restreintes ou les contenus privés (Instagram, X).
- **File d'attente** — enchaîne plusieurs téléchargements, chacun annulable.
- **Mises à jour automatiques** — bouton dédié en bas du panneau.

### Transcodage (automatique, sans réglage)

| Source | Condition | Résultat |
|---|---|---|
| YouTube | ≤ 1080p, codec compatible Premiere (H.264…) | **aucun transcodage** (remux MP4) |
| YouTube | ≥ 1440p | **H.265** |
| Autres sites | codec compatible Premiere | **aucun transcodage** (remux MP4) |
| Autres sites | codec incompatible | **H.265** |

L'encodage H.265 est **accéléré par le GPU** (NVIDIA / Apple Silicon) quand c'est
possible, avec repli automatique sur le processeur. Pas d'option ProRes.

### Différences avec l'app desktop Robloader

- Destination **fixe** (plus de bouton « Destination »).
- **Import automatique** dans Premiere (nouveau).
- Transcodage **simplifié et automatique** (plus de cases ni de ProRes).
- Un seul thème, **pas** de couleur par source, **pas** d'option sous-titres ni
  miniature.

---

## 📁 Arborescence et destination

L'extension détecte automatiquement l'organisation de ton projet et choisit la
destination en conséquence.

### Arborescence standard (dossier PROJETS)

Si ton `.prproj` est dans un dossier dont le nom ressemble à `PROJETS` (tolérant la
casse, les accents et les petites fautes : `Projets`, `PROJET`, `PROJTS`…), l'extension
remonte d'un cran et range les fichiers dans `ELEMENTS/Robloader` :

```
📁 NOM DU PROJET/        ← dossier parent (déduit de l'emplacement du .prproj)
├── 📁 RUSHS/
├── 📁 ELEMENTS/
│   └── 📁 Robloader/    ← 📥 tous les téléchargements arrivent ici
├── 📁 PROJETS/          ← le .prproj vit ici
├── 📁 EXPORTS/
└── …
```

### Architecture libre

Si ton `.prproj` est posé ailleurs (dossier personnalisé, directement à la racine du
projet…), l'extension crée simplement un dossier `Robloader/` à côté du `.prproj` :

```
📁 MON PROJET/
├── mon-projet.prproj    ← le .prproj est directement là
└── 📁 Robloader/        ← 📥 les téléchargements arrivent ici
```

Dans les deux cas, le chutier `ELEMENTS ▸ Robloader` est créé dans Premiere et le
dossier de destination est affiché en haut du panneau.

---

## 📥 Installation

### Windows

Télécharge **[Robloader-Extension-Setup.exe](https://github.com/Splainte/Robloader-Extension/releases/latest)**,
double-clique, suis l'assistant (pas de droits administrateur nécessaires). Puis
redémarre Premiere et ouvre **Fenêtre > Extensions > Robloader**.

> À la première installation, Windows peut afficher un avertissement SmartScreen
> (l'app n'est pas signée) : clique sur « Informations complémentaires » puis
> « Exécuter quand même ».

### macOS

Ouvre le **Terminal** (Applications ▸ Utilitaires) et colle cette ligne, puis Entrée :

```bash
curl -fsSL https://raw.githubusercontent.com/Splainte/Robloader-Extension/main/install/install-macos.sh | bash
```

Ça installe l'extension et ses binaires sans aucun avertissement. Redémarre ensuite
Premiere et ouvre **Fenêtre > Extensions > Robloader**.

### Mises à jour

Sur les deux systèmes, le bouton **« Vérifier les mises à jour »** en bas du panneau
télécharge et installe la dernière version tout seul. Il suffit de redémarrer Premiere
ensuite.

Compatibilité : Premiere Pro 2020 (14.0) et versions ultérieures.

---

## ▶️ Utilisation

1. Ouvre ton projet Premiere (peu importe où est rangé le `.prproj`).
2. Colle l'**URL** de la vidéo dans le panneau Robloader.
3. *(Optionnel)* choisis la **qualité**, coche **Audio seul**, ou indique un
   **début/fin** pour un extrait.
4. Clique sur **Télécharger** — le fichier est téléchargé, préparé, et importé dans
   le chutier `ELEMENTS/Robloader`. 🎬

---

## ❓ Un souci ?

La plupart des problèmes (vidéo qui demande une connexion, contenu privé, 4K qui ne
passe pas) se règlent en étant **connecté au site dans ton navigateur** : Robloader
utilise alors automatiquement ta session. Tu peux aussi déposer un fichier
`cookies.txt` à la racine de l'extension (prioritaire sur les cookies navigateur).

---

> 🧑‍💻 Architecture : panneau **CEP** (Node.js) + pont ExtendScript (`jsx/robloader.jsx`).
> Le panneau pilote `yt-dlp` / `ffmpeg` (binaires dans `bin/`) puis importe le résultat
> via `app.project.importFiles`. Pipeline de téléchargement repris de l'app desktop
> [Robloader](https://github.com/Splainte/Robloader).
