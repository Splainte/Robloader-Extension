/*
 * Robloader — côté panneau CEP (Node.js)
 * Télécharge une vidéo (YouTube, TikTok, Instagram, X, Weibo) avec yt-dlp,
 * la prépare pour Premiere (transcodage H.265 seulement si nécessaire) et
 * l'importe dans le chutier miroir ELEMENTS/Robloader du projet ouvert.
 *
 * Différences avec l'app desktop Robloader :
 *  - destination AUTOMATIQUE, aucun choix de dossier : ELEMENTS/Robloader si le
 *    .prproj vit dans PROJETS/ (archi standard), sinon Robloader/ à côté du
 *    .prproj (archi libre) — voir resolveDestination ;
 *  - import automatique dans Premiere (chutier miroir du dossier disque) ;
 *  - transcodage simplifié et automatique (voir decideTranscode) ;
 *  - un seul thème, pas de couleur par source, pas de sous-titres/miniature.
 *
 * Le pipeline yt-dlp/ffmpeg (cookies en cascade, nsig via Deno, tri des
 * formats, découpe d'extrait, repli 1080p) reprend la logique éprouvée du
 * desktop — portée d'appels Python à des appels de binaires.
 */

/* global CSInterface, SystemPath, cep_node */

window.onerror = function (msg, src, line) {
  var st = document.getElementById("status");
  if (st) { st.textContent = "Erreur (voir log)"; st.className = "status err"; }
  log(msg + " (" + String(src || "?").split("/").pop() + ":" + line + ")", "err");
};

var nodeRequire =
  (typeof require !== "undefined") ? require :
  (typeof cep_node !== "undefined") ? cep_node.require : null;
if (!nodeRequire) {
  throw new Error("Node.js indisponible dans ce panneau CEP (require/cep_node absents)");
}

var fs = nodeRequire("fs");
var path = nodeRequire("path");
var os = nodeRequire("os");
var https = nodeRequire("https");
var urlMod = nodeRequire("url");
var spawn = nodeRequire("child_process").spawn;

var cs = new CSInterface();
var extDir = cs.getSystemPath(SystemPath.EXTENSION);

var IS_WINDOWS = navigator.platform.indexOf("Win") === 0;
var IS_MAC = navigator.platform.indexOf("Mac") === 0;

// Chutier miroir + sous-dossier de destination relatifs à la racine projet.
var BIN_SEGMENTS = "ELEMENTS/Robloader";

// Codecs déjà confortables pour Premiere Pro (pas besoin de transcoder).
var PREMIERE_READY_CODECS = ["h264", "avc1", "avc", "hevc", "h265", "hev1", "hvc1"];

// Tri des formats : piste audio originale d'abord (sinon doublage auto), puis
// meilleure résolution, puis on PRÉFÈRE le H.264 + AAC → en 1080p et moins on
// obtient du MP4/H.264 prêt pour Premiere (pas de transcodage).
var FORMAT_SORT = "lang,res,fps,vcodec:h264,acodec:aac,br";

// Client par défaut + android_vr + web_embedded : combo qui passe le PO Token
// 2026 sans garder de formats audio morts (cf yt-dlp #12563 / PoT).
var YT_EXTRACTOR_ARGS = "youtube:player_client=default,android_vr,web_embedded";

// ---------- Résolution des binaires ----------
// Bundle dans bin/win|mac ; repli sur le PATH système si absent (mode dev).

function platDir() {
  return path.join(extDir, "bin", IS_WINDOWS ? "win" : "mac");
}

function resolveBinary(name) {
  var exe = IS_WINDOWS ? name + ".exe" : name;
  var bundled = path.join(platDir(), exe);
  if (fs.existsSync(bundled)) {
    try { if (!IS_WINDOWS) { fs.chmodSync(bundled, 0o755); } } catch (e) { /* ok */ }
    return bundled;
  }
  return exe; // sur le PATH (mode dev)
}

var YTDLP = resolveBinary("yt-dlp");
var FFMPEG = resolveBinary("ffmpeg");
var FFPROBE = resolveBinary("ffprobe");

// Deno présent → nsig résolu → 4K/1440p possibles. Sinon plafond 1080p.
// (Deno n'est jamais appelé directement : yt-dlp le trouve via le PATH enrichi.)
var HAS_JS = fs.existsSync(path.join(platDir(), IS_WINDOWS ? "deno.exe" : "deno"));

// PATH enrichi du dossier des binaires pour que yt-dlp trouve ffmpeg/deno.
// NB : sous Windows la variable s'appelle souvent « Path » — on retrouve la clé
// existante sans tenir compte de la casse, sinon on créerait un doublon
// PATH/Path et l'enfant pourrait ne jamais voir le dossier des binaires.
function childEnv() {
  var env = {};
  var pathKey = "PATH";
  for (var k in process.env) {
    env[k] = process.env[k];
    if (k.toUpperCase() === "PATH") { pathKey = k; }
  }
  env[pathKey] = platDir() + (IS_WINDOWS ? ";" : ":") + (env[pathKey] || "");
  return env;
}

// cookies.txt déposé à côté du panneau = prioritaire sur les cookies navigateur.
var COOKIE_FILE = path.join(extDir, "cookies.txt");

// Ordre des navigateurs : Firefox d'abord (Chrome verrouille sa base quand il
// est ouvert → on enchaîne). yt-dlp échoue silencieusement si absent.
function cookieAttempts() {
  var attempts = [];
  if (fs.existsSync(COOKIE_FILE)) { attempts.push(["--cookies", COOKIE_FILE]); }
  var browsers = IS_MAC ? ["firefox", "chrome", "edge", "brave", "safari"]
                        : ["firefox", "chrome", "edge", "brave"];
  browsers.forEach(function (b) { attempts.push(["--cookies-from-browser", b]); });
  attempts.push([]); // sans cookies, en dernier recours
  return attempts;
}

// ---------- Détection du site ----------

function detectSite(url) {
  var u = String(url).toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) { return "youtube"; }
  if (/tiktok\.com/.test(u)) { return "tiktok"; }
  if (/instagram\.com/.test(u)) { return "instagram"; }
  if (/twitter\.com|x\.com/.test(u)) { return "twitter"; }
  if (/weibo\.com|weibo\.cn/.test(u)) { return "weibo"; }
  return "autre";
}

// ---------- UI ----------

var ui = {
  status: document.getElementById("status"),
  target: document.getElementById("target"),
  url: document.getElementById("url"),
  quality: document.getElementById("quality"),
  audio: document.getElementById("audio"),
  start: document.getElementById("start"),
  end: document.getElementById("end"),
  download: document.getElementById("download"),
  clear: document.getElementById("clear"),
  queue: document.getElementById("queue"),
  log: document.getElementById("log"),
  version: document.getElementById("version"),
  update: document.getElementById("update")
};

function setStatus(text, cls) {
  ui.status.textContent = text;
  ui.status.className = "status " + (cls || "");
}

function log(msg, cls) {
  // Garde : window.onerror peut appeler log() avant que `ui` soit construit.
  if (typeof ui === "undefined" || !ui || !ui.log) { return; }
  var line = document.createElement("div");
  line.className = cls || "";
  line.textContent = new Date().toLocaleTimeString() + "  " + msg;
  ui.log.appendChild(line);
  while (ui.log.childNodes.length > 200) { ui.log.removeChild(ui.log.firstChild); }
  ui.log.scrollTop = ui.log.scrollHeight;
}

// ---------- Pont ExtendScript ----------

function escapeJsxString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function evalScript(script) {
  return new Promise(function (resolve) { cs.evalScript(script, resolve); });
}

// Normalise un nom de dossier : minuscules, sans accents, sans 's' final.
function normFolderName(name) {
  return name.toLowerCase()
    .replace(/[éèê]/g, "e").replace(/[àâ]/g, "a")
    .replace(/[îï]/g, "i").replace(/[ùûü]/g, "u").replace(/[ôö]/g, "o")
    .replace(/s$/, "");
}

// Distance de Levenshtein (petites chaînes uniquement).
function levenshtein(a, b) {
  var m = a.length, n = b.length, d = [], i, j;
  for (i = 0; i <= m; i++) { d[i] = [i]; }
  for (j = 1; j <= n; j++) { d[0][j] = j; }
  for (j = 1; j <= n; j++) {
    for (i = 1; i <= m; i++) {
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}

// Racine du projet montage depuis le .prproj ouvert, + dossier de destination.
// Deux modes (le chutier Premiere `bin` reflète le dossier disque) :
//  • Architecture standard  (<racine>/PROJETS/<projet.prproj>) → ELEMENTS/Robloader
//  • Architecture libre (tout autre organisation)              → <dossier du .prproj>/Robloader
function resolveDestination() {
  return evalScript("ROBLOADER.getProjectPath()").then(function (projPath) {
    if (projPath === "EvalScript error.") {
      throw new Error("jsx/robloader.jsx n'a pas chargé côté Premiere");
    }
    if (!projPath) {
      throw new Error("aucun projet ouvert — ouvre un .prproj puis réessaie");
    }
    var projDir = path.dirname(projPath);
    var dirName = path.basename(projDir);
    if (levenshtein(normFolderName(dirName), "projet") <= 1) {
      var root = path.resolve(projDir, "..");
      return { root: root, dest: path.join(root, "ELEMENTS", "Robloader"), bin: BIN_SEGMENTS };
    }
    // Archi libre : on pose les fichiers à côté du .prproj dans un sous-dossier
    // Robloader, et le chutier Premiere s'appelle pareil (pas ELEMENTS/…).
    log("Architecture libre (dossier « " + dirName + " ») → destination : Robloader/ à côté du .prproj", "warn");
    return { root: projDir, dest: path.join(projDir, "Robloader"), bin: "Robloader" };
  });
}

// ---------- Exécution de processus ----------

// Tue le processus ET ses enfants (yt-dlp lance souvent ffmpeg ; le tuer seul
// laisse l'enfant tourner et garder les pipes ouverts → 'close' n'arrive jamais).
function killTree(proc) {
  if (!proc) { return; }
  try {
    if (IS_WINDOWS) {
      spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { windowsHide: true });
    } else {
      try { process.kill(-proc.pid, "SIGKILL"); } // groupe entier (proc détaché)
      catch (e) { proc.kill("SIGKILL"); }
    }
  } catch (e) { /* ok */ }
}

function runProcess(bin, args, task, onLine) {
  return new Promise(function (resolve, reject) {
    // Tâche déjà annulée : ne pas lancer l'étape suivante (sinon une annulation
    // entre deux processus laissait p.ex. tout le transcodage s'exécuter).
    if (task && task.cancelled) { reject(new Error("Annulé")); return; }
    var proc;
    try {
      // detached (hors Windows) : le proc devient chef de groupe → killTree peut
      // tuer tout le groupe d'un coup via un pid négatif.
      proc = spawn(bin, args, { env: childEnv(), windowsHide: true, detached: !IS_WINDOWS });
    } catch (e) {
      reject(e);
      return;
    }
    if (task) { task.process = proc; }
    var buf = "";
    function feed(chunk) {
      buf += chunk;
      var idx;
      while ((idx = buf.search(/[\r\n]/)) !== -1) {
        var line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line && onLine) { onLine(line); }
      }
    }
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", feed);
    proc.stderr.on("data", feed);
    proc.on("error", reject);
    // 'exit' se déclenche dès que LE processus quitte, même si un enfant garde
    // un pipe ouvert (ce qui retarderait 'close'). On débloque donc la file
    // tout de suite à l'annulation, sans attendre un éventuel ffmpeg orphelin.
    proc.on("exit", function () {
      if (task && task.cancelled) { task.process = null; reject(new Error("Annulé")); }
    });
    proc.on("close", function (code) {
      // Dernière ligne sans retour chariot (ffmpeg y met parfois l'erreur finale).
      if (buf && onLine) { onLine(buf); buf = ""; }
      if (task) { task.process = null; }
      if (task && task.cancelled) { reject(new Error("Annulé")); return; }
      resolve(code);
    });
  });
}

// yt-dlp -J : métadonnées JSON (une ligne). Renvoie l'objet info ou null.
function probeInfo(url, baseArgs, cookieArgs, task) {
  var jsonLine = "";
  var args = ["-J", "--no-warnings", "--no-playlist"]
    .concat(baseArgs).concat(cookieArgs).concat([url]);
  return runProcess(YTDLP, args, task, function (line) {
    var t = line.trim();
    if (t.charAt(0) === "{") { jsonLine = t; }
  }).then(function (code) {
    if (code !== 0 || !jsonLine) { return null; }
    try { return JSON.parse(jsonLine); } catch (e) { return null; }
  });
}

function ffprobeVideo(file) {
  return runProcess(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height",
    "-of", "default=nw=1", file
  ], null, function (line) { ffprobeVideo._buf += line + "\n"; }).then(function () {
    var out = ffprobeVideo._buf; ffprobeVideo._buf = "";
    var codec = (out.match(/codec_name=(\S+)/) || [, ""])[1].toLowerCase();
    var width = parseInt((out.match(/width=(\d+)/) || [, "0"])[1], 10) || 0;
    var height = parseInt((out.match(/height=(\d+)/) || [, "0"])[1], 10) || 0;
    return { codec: codec, width: width, height: height };
  });
}
ffprobeVideo._buf = "";

// Étiquette de résolution = PETIT côté de la vidéo (la « petite largeur »),
// ramené au palier standard le plus proche. Une verticale 1080×1920 donne ainsi
// 1080p (et non 1920p). Les hauteurs YouTube tombent pile sur ces paliers ;
// le snap rattrape juste les sources non standard (TikTok/Insta).
var RES_LADDER = [480, 720, 1080, 1440, 2160];
function resolutionLabel(width, height) {
  var shortSide = Math.min(width || 0, height || 0);
  if (!shortSide) { return ""; }
  var best = RES_LADDER[0];
  for (var i = 1; i < RES_LADDER.length; i++) {
    if (Math.abs(RES_LADDER[i] - shortSide) < Math.abs(best - shortSide)) {
      best = RES_LADDER[i];
    }
  }
  return best + "p";
}

// Évite d'écraser un fichier identique déjà présent : un re-téléchargement qui
// remplace le .mp4 sur disque casse le lien média dans Premiere. On suffixe donc
// « (1) », « (2) »… La résolution étant déjà dans le nom, deux résolutions
// différentes ne collisionnent pas → pas de suffixe parasite dans ce cas.
function uniqueOutPath(dest, base, ext) {
  var p = path.join(dest, base + ext);
  var n = 1;
  while (fs.existsSync(p)) {
    p = path.join(dest, base + " (" + n + ")" + ext);
    n++;
  }
  return p;
}

// ---------- Décision de transcodage ----------
// YouTube ≤1080p compatible → natif (remux mp4) ; YouTube ≥1440p → H.265 ;
// autres sites → natif si codec compatible, sinon H.265.
function decideTranscode(site, codec, height) {
  var compatible = PREMIERE_READY_CODECS.indexOf(codec) !== -1;
  if (!compatible) { return true; }
  if (site === "youtube" && height >= 1440) { return true; }
  return false;
}

// ---------- Encodeur H.265 ----------
// `ffmpeg -encoders` liste TOUJOURS nvenc/qsv/amf (build BtbN) et un test sur
// mire synthétique n'est pas représentatif : on encode donc directement le VRAI
// fichier en essayant les encodeurs dans l'ordre (NVIDIA → Intel QSV → AMD ; Mac
// : videotoolbox ; sinon CPU libx265). Le premier qui réussit est mémorisé pour
// la session — les fichiers suivants vont droit au bon encodeur. Si un GPU cale,
// on logue la vraie erreur ffmpeg avant de passer au suivant.

function h265Candidates() {
  var aenc = ["-c:a", "aac", "-b:a", "256k"];
  var cpu = { label: "CPU", aenc: aenc,
    venc: ["-c:v", "libx265", "-crf", "18", "-preset", "fast", "-tag:v", "hvc1"] };
  if (IS_MAC) {
    return [
      { label: "GPU Apple", aenc: aenc,
        venc: ["-c:v", "hevc_videotoolbox", "-q:v", "65", "-tag:v", "hvc1"] },
      cpu
    ];
  }
  return [
    // -b:v 0 obligatoire avec -rc vbr -cq : sinon nvenc garde son bitrate cible
    // par défaut (2 Mb/s) et la qualité est plafonnée quel que soit le -cq.
    { label: "GPU NVIDIA", aenc: aenc,
      venc: ["-c:v", "hevc_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "18",
        "-b:v", "0", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
    { label: "GPU Intel", aenc: aenc,
      venc: ["-c:v", "hevc_qsv", "-global_quality", "18", "-pix_fmt", "nv12", "-tag:v", "hvc1"] },
    { label: "GPU AMD", aenc: aenc,
      venc: ["-c:v", "hevc_amf", "-rc", "cqp", "-qp_i", "18", "-qp_p", "18",
        "-quality", "quality", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
    cpu
  ];
}

// Encodeur retenu lors d'un transcodage réussi (label), pour aller droit au but.
var selectedEncoderLabel = null;

function encodeH265(task, temp, finalOut, seek, dur, segDur) {
  var all = h265Candidates();
  var list = all;
  if (selectedEncoderLabel) {
    var chosen = all.filter(function (c) { return c.label === selectedEncoderLabel; });
    var cpu = all.filter(function (c) { return c.label === "CPU"; });
    list = (selectedEncoderLabel === "CPU") ? cpu : chosen.concat(cpu);
  }

  var i = 0;
  function attempt() {
    var cand = list[i];
    var label = "Conversion H.265 (" + cand.label + ")…";
    var lastErr = "";
    setTaskState(task, label);
    setBar(task, 0);
    var cmd = ["-y", "-progress", "pipe:1"].concat(seek)
      .concat(["-i", temp]).concat(dur).concat(cand.venc).concat(cand.aenc)
      .concat(["-movflags", "+faststart", finalOut]);
    return runProcess(FFMPEG, cmd, task, function (line) {
      var m = line.match(/out_time_us=(\d+)/);
      if (m && segDur > 0) {
        var p = Math.min(parseInt(m[1], 10) / (segDur * 1000000), 1);
        setBar(task, p);
        setTaskState(task, label + " " + Math.round(p * 100) + "%");
      } else if (/error|failed|not supported|not found|cannot|unknown|no capable|unable|invalid|required|out of memory/i.test(line)) {
        // ffmpeg termine toujours par « Conversion failed! », qui masquait la vraie
        // cause nvenc/qsv/amf affichée juste avant. On retient la PREMIÈRE erreur
        // spécifique et on ne laisse le générique que faute de mieux.
        var clean = line.trim();
        if (/^conversion failed/i.test(clean)) {
          if (!lastErr) { lastErr = clean; }
        } else if (!lastErr || /^conversion failed/i.test(lastErr)) {
          lastErr = clean;
        }
      }
    }).then(function (code) {
      if (task.cancelled) { throw new Error("Annulé"); }
      if (code === 0) {
        selectedEncoderLabel = cand.label;
        log("Encodé en H.265 — " + cand.label);
        return;
      }
      if (cand.label !== "CPU") {
        log("Encodage " + cand.label + " indisponible (" +
          (lastErr || ("code " + code)) + ") → essai suivant.", "warn");
      }
      i++;
      if (i >= list.length) {
        throw new Error("Transcodage H.265 échoué" + (lastErr ? " : " + lastErr : ""));
      }
      return attempt();
    });
  }
  return attempt();
}

// ---------- File d'attente / téléchargement ----------

var taskSeq = 0;

function parseTimecode(tc) {
  tc = String(tc || "").trim();
  if (!tc) { return null; }
  var parts = tc.split(":").map(function (p) { return parseInt(p, 10) || 0; });
  var s = 0;
  for (var i = 0; i < parts.length; i++) { s = s * 60 + parts[i]; }
  return s;
}

// Translittération des accents AVANT filtrage : « Vidéo génération » doit donner
// « Video generation », pas « Vido gnration ».
var ACCENT_MAP = {
  "à": "a", "â": "a", "ä": "a", "á": "a", "ã": "a",
  "é": "e", "è": "e", "ê": "e", "ë": "e",
  "î": "i", "ï": "i", "í": "i",
  "ô": "o", "ö": "o", "ó": "o", "õ": "o",
  "ù": "u", "û": "u", "ü": "u", "ú": "u",
  "ç": "c", "ñ": "n", "œ": "oe", "æ": "ae", "ÿ": "y"
};

function safeName(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var lower = c.toLowerCase();
    if (ACCENT_MAP[lower]) {
      var t = ACCENT_MAP[lower];
      out += (c === lower) ? t : t.charAt(0).toUpperCase() + t.slice(1);
    } else if (/[a-z0-9 .\-_()']/i.test(c)) {
      out += c;
    }
  }
  return out.replace(/\s+/g, " ").replace(/\s+$/, "").replace(/^\s+/, "") || "video";
}

function addTask(url, opts) {
  var id = ++taskSeq;
  var frame = document.createElement("div");
  frame.className = "task";
  // Construction DOM (jamais innerHTML : l'URL vient de l'utilisateur et le
  // panneau a accès à Node — du HTML dans l'URL serait exécuté).
  var titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = url;
  var stateEl = document.createElement("div");
  stateEl.className = "state";
  stateEl.textContent = "En attente…";
  var barWrap = document.createElement("div");
  barWrap.className = "barwrap";
  var barEl = document.createElement("div");
  barEl.className = "bar";
  barWrap.appendChild(barEl);
  var btn = document.createElement("button");
  btn.textContent = "Annuler";
  frame.appendChild(titleEl);
  frame.appendChild(stateEl);
  frame.appendChild(barWrap);
  frame.appendChild(btn);
  ui.queue.insertBefore(frame, ui.queue.firstChild);

  var task = {
    id: id, url: url, opts: opts, cancelled: false, process: null,
    titleEl: titleEl,
    stateEl: stateEl,
    barEl: barEl,
    btn: btn
  };
  btn.addEventListener("click", function () {
    if (task.done) { return; }
    task.cancelled = true;
    killTree(task.process);
    setTaskState(task, "Annulé", "err");
  });
  return task;
}

function setTaskState(task, text, cls) {
  task.stateEl.textContent = text;
  task.stateEl.className = "state " + (cls || "");
}
function setBar(task, frac, done) {
  task.barEl.style.width = Math.round(frac * 100) + "%";
  if (done) { task.barEl.className = "bar done"; }
}

// Chaîne de téléchargements : un seul à la fois (évite de saturer le CPU/réseau).
var chain = Promise.resolve();

function enqueue(url, opts) {
  var task = addTask(url, opts);
  chain = chain.then(function () {
    if (task.cancelled) { task.done = true; task.btn.style.display = "none"; return; }
    return downloadOne(task).catch(function (e) {
      if (!task.cancelled) {
        setTaskState(task, "Échec : " + e.message, "err");
        log("Échec " + url + " : " + e.message, "err");
      }
      // Tâche finie (échec ou annulée) : le bouton Annuler n'a plus de sens
      // et un clic tardif écraserait le message « Échec : … ».
      task.done = true;
      task.btn.style.display = "none";
    });
  });
}

function downloadOne(task) {
  var site = detectSite(task.url);
  var isYoutube = site === "youtube";
  var dest, binPath;

  setTaskState(task, "Analyse du projet…");
  return resolveDestination().then(function (d) {
    dest = d.dest;
    binPath = d.bin;
    fs.mkdirSync(dest, { recursive: true });

    // Hauteur cible (YouTube seulement ; sans Deno plafond 1080p).
    var targetH = isYoutube ? (parseInt(task.opts.quality, 10) || 0) : 0;
    if (isYoutube && !HAS_JS) { targetH = Math.min(targetH || 1080, 1080); }

    var baseArgs = ["--ffmpeg-location", FFMPEG, "-S", FORMAT_SORT];
    if (isYoutube) {
      baseArgs = baseArgs.concat(["--extractor-args", YT_EXTRACTOR_ARGS]);
      if (HAS_JS) { baseArgs = baseArgs.concat(["--remote-components", "ejs:github"]); }
    }

    function fmtFor(h) {
      if (task.opts.audio) { return "bestaudio/best"; }
      if (!h) { return "bv*+ba/bv*/b"; }
      return "bv*[height<=" + h + "]+ba/bv*[height<=" + h + "]/b[height<=" + h + "]/b";
    }

    setTaskState(task, "Analyse de la vidéo…");
    // Cascade cookies : on retient la 1re source qui rend des métadonnées.
    var attempts = cookieAttempts();
    var picked = null;
    var info = null;
    var fmtArgs = ["-f", fmtFor(targetH)];
    var probeChain = Promise.resolve();
    attempts.forEach(function (attempt) {
      probeChain = probeChain.then(function () {
        if (info || task.cancelled) { return; }
        return probeInfo(task.url, baseArgs.concat(fmtArgs), attempt, task)
          .then(function (i) { if (i) { info = i; picked = attempt; } });
      });
    });

    return probeChain.then(function () {
      if (task.cancelled) { throw new Error("Annulé"); }
      if (!info) { throw new Error("Analyse impossible (vidéo privée ou indisponible ?)"); }

      var title = info.title || "video";
      var vid = info.id || ("rl" + task.id);
      var channel = info.channel || info.uploader || "";
      var duration = info.duration || 0;

      var startS = parseTimecode(task.opts.start);
      var endS = parseTimecode(task.opts.end);
      var hasRange = startS !== null || endS !== null;
      var sVal = startS !== null ? startS : 0;
      var eVal = endS !== null ? endS : duration;
      var segDur = hasRange ? Math.max(eVal - sVal, 1) : duration;

      // Ordre du nom : titre (Extrait …) - chaîne - résolution (la résolution est
      // ajoutée plus bas, une fois la vidéo sondée).
      var displayTitle = title;
      if (task.opts.start || task.opts.end) {
        displayTitle += " (Extrait " + (task.opts.start || "00:00") + " - " +
          (task.opts.end || "Fin") + ")";
      }
      if (channel) { displayTitle += " - " + channel; }
      var base = safeName(displayTitle);
      task.titleEl.textContent = base;

      var tempBase = path.join(dest, "temp_" + vid);
      var tmpGlob = function () {
        return fs.readdirSync(dest).filter(function (n) {
          return n.indexOf("temp_" + vid) === 0;
        }).map(function (n) { return path.join(dest, n); });
      };

      // ----- Téléchargement (complet, natif ; découpe locale ensuite) -----
      function ytArgs(fmt, outtmpl) {
        return ["--no-playlist", "--newline",
          "--progress-template", "download:RLPCT %(progress._percent_str)s",
          "-f", fmt, "-o", outtmpl]
          .concat(baseArgs).concat(picked).concat([task.url]);
      }

      // Lissage de la barre : yt-dlp télécharge la vidéo puis l'audio, chaque
      // flux repartant de 0 %. On suit la vraie valeur (progression OU vraie
      // chute = nouveau flux) mais on ignore les petits reculs (< 5 %, simple
      // jitter de yt-dlp). Surtout : on ne VERROUILLE jamais à 100 % (sinon un
      // flux court fini en premier figerait la barre tout le reste du temps).
      task.dlMax = 0;
      function onDlLine(line) {
        var m = line.match(/RLPCT\s+([\d.]+)%/);
        if (m) {
          var pct = parseFloat(m[1]) / 100;
          if (pct > task.dlMax || pct + 0.05 < task.dlMax) { task.dlMax = pct; }
          setBar(task, task.dlMax);
          setTaskState(task, "Téléchargement… " + Math.round(task.dlMax * 100) + "%");
        }
      }

      function cleanupTemp() {
        tmpGlob().forEach(function (p) { try { fs.unlinkSync(p); } catch (e) { /* ok */ } });
      }

      // Après échec/annulation : purge des temp_* — tout de suite, puis une 2e
      // passe différée (Windows met un instant à relâcher les verrous du
      // processus tué, le premier unlink peut échouer en silence).
      function cleanupTempLater() {
        cleanupTemp();
        setTimeout(cleanupTemp, 2000);
      }

      setTaskState(task, "Téléchargement…");
      var outtmpl = tempBase + ".%(ext)s";
      var fallbackH = targetH ? Math.min(targetH, 1080) : 1080;

      return runProcess(YTDLP, ytArgs(fmtFor(targetH), outtmpl), task, onDlLine)
        .then(function (code) {
          if (task.cancelled) { throw new Error("Annulé"); }
          if (code === 0) { return; }
          // Repli auto en 1080p si la qualité max a échoué (4K bloquée/403).
          if (!task.opts.audio && fallbackH !== targetH) {
            cleanupTemp();
            task.dlMax = 0;
            setTaskState(task, "Qualité max indisponible — repli 1080p…", "");
            return runProcess(YTDLP, ytArgs(fmtFor(fallbackH), outtmpl), task, onDlLine)
              .then(function (c2) { if (c2 !== 0) { throw new Error("Téléchargement échoué"); } });
          }
          throw new Error("Téléchargement échoué");
        })
        .then(function () {
          var temps = tmpGlob().filter(function (p) {
            return !/\.part$/.test(p);
          });
          if (!temps.length) { throw new Error("Fichier téléchargé introuvable"); }
          var temp = temps[0];
          var finalOut, mode;

          var seek = hasRange ? ["-ss", String(sVal)] : [];
          var dur = hasRange ? ["-t", String(segDur)] : [];

          // ----- Audio seul (WAV) -----
          if (task.opts.audio) {
            finalOut = uniqueOutPath(dest, base, ".wav");
            var aCmd = ["-y", "-progress", "pipe:1"].concat(seek)
              .concat(["-i", temp]).concat(dur)
              .concat(["-vn", "-c:a", "pcm_s16le", finalOut]);
            return runFfmpeg(task, aCmd, segDur, "Conversion audio…")
              .then(function () { try { fs.unlinkSync(temp); } catch (e) {} return finalOut; });
          }

          // ----- Vidéo : décision de transcodage après sonde codec/hauteur -----
          return ffprobeVideo(temp).then(function (v) {
            var needs = decideTranscode(site, v.codec, v.height);
            // Nom final : « titre - chaîne - résolution.mp4 » (+ « (n) » si doublon
            // de même résolution déjà présent — voir uniqueOutPath).
            var resLabel = resolutionLabel(v.width, v.height);
            var vbase = resLabel ? base + " - " + resLabel : base;
            finalOut = uniqueOutPath(dest, vbase, ".mp4");

            if (!needs && !hasRange) {
              // Compatible : simple remux vers MP4 (conteneur sûr pour Premiere).
              setTaskState(task, "Finalisation…");
              var tag = (v.codec === "hevc" || v.codec === "hev1" || v.codec === "hvc1")
                ? ["-tag:v", "hvc1"] : [];
              var rCmd = ["-y", "-progress", "pipe:1", "-i", temp, "-c", "copy"]
                .concat(tag).concat(["-movflags", "+faststart", finalOut]);
              return runFfmpeg(task, rCmd, segDur || 1, "Finalisation…")
                .then(function () { try { fs.unlinkSync(temp); } catch (e) {} return finalOut; });
            }

            if (!needs && hasRange) {
              // Découpe PRÉCISE en H.264 (le 'copy' s'aligne sur une keyframe et déborde).
              setTaskState(task, "Découpe de l'extrait…");
              var cCmd = ["-y", "-progress", "pipe:1"].concat(seek)
                .concat(["-i", temp]).concat(dur)
                .concat(["-c:v", "libx264", "-crf", "18", "-preset", "fast",
                  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
                  "-movflags", "+faststart", finalOut]);
              return runFfmpeg(task, cCmd, segDur, "Découpe…")
                .then(function () { try { fs.unlinkSync(temp); } catch (e) {} return finalOut; });
            }

            // ----- Transcodage H.265 (cascade GPU → CPU sur le vrai fichier) -----
            return encodeH265(task, temp, finalOut, seek, dur, segDur).then(function () {
              try { fs.unlinkSync(temp); } catch (e) {}
              return finalOut;
            });
          });
        })
        .then(function (finalOut) {
          if (task.cancelled) { throw new Error("Annulé"); }
          setBar(task, 1, true);
          setTaskState(task, "Import dans Premiere…", "");
          return evalScript(
            'ROBLOADER.importFile("' + escapeJsxString(finalOut) + '","' + binPath + '")'
          ).then(function (res) {
            task.done = true;
            task.btn.style.display = "none";
            if (res === "OK") {
              setTaskState(task, "Terminé ✓ importé dans " + binPath, "ok");
              log("Terminé : " + path.basename(finalOut));
            } else {
              setTaskState(task, "Téléchargé, import KO → " + res, "err");
              log("Import KO " + path.basename(finalOut) + " : " + res, "err");
            }
          });
        })
        .catch(function (e) {
          // Échec ou annulation : ne pas laisser traîner les temp_* (.mp4/.part)
          // dans le dossier du projet.
          cleanupTempLater();
          throw e;
        });
    });
  });
}

function runFfmpeg(task, args, duration, label) {
  return runProcess(FFMPEG, args, task, function (line) {
    var m = line.match(/out_time_us=(\d+)/);
    if (m && duration > 0) {
      var pct = Math.min(parseInt(m[1], 10) / (duration * 1000000), 1);
      setBar(task, pct);
      setTaskState(task, label + " " + Math.round(pct * 100) + "%");
    }
  }).then(function (code) {
    if (task.cancelled) { throw new Error("Annulé"); }
    if (code !== 0) { throw new Error(label + " a échoué"); }
  });
}

// ---------- Mise à jour automatique (identique à Sauron) ----------

var UPDATE_REPO = "Splainte/Robloader-Extension";

function currentVersion() {
  try {
    var m = fs.readFileSync(path.join(extDir, "CSXS", "manifest.xml"), "utf8")
      .match(/ExtensionBundleVersion="([^"]+)"/);
    return m ? m[1] : "0.0.0";
  } catch (e) { return "0.0.0"; }
}

function isNewer(a, b) {
  var pa = String(a).replace(/^v/, "").split(".");
  var pb = String(b).replace(/^v/, "").split(".");
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0;
    if (na !== nb) { return na > nb; }
  }
  return false;
}

function httpsGet(url, redirectsLeft) {
  return new Promise(function (resolve, reject) {
    var opts = urlMod.parse(url);
    opts.headers = { "User-Agent": "Robloader-panel" };
    https.get(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 &&
          res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(httpsGet(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error("HTTP " + res.statusCode)); return; }
      resolve(res);
    }).on("error", reject);
  });
}

function httpsGetText(url) {
  return httpsGet(url, 5).then(function (res) {
    return new Promise(function (resolve, reject) {
      var data = "";
      res.setEncoding("utf8");
      res.on("data", function (c) { data += c; });
      res.on("end", function () { resolve(data); });
      res.on("error", reject);
    });
  });
}

function httpsDownload(url, dest, onProgress) {
  return httpsGet(url, 5).then(function (res) {
    return new Promise(function (resolve, reject) {
      var total = parseInt(res.headers["content-length"], 10) || 0;
      var received = 0;
      var out = fs.createWriteStream(dest);
      function fail(err) {
        try { out.destroy(); } catch (e) { /* ok */ }
        try { fs.unlinkSync(dest); } catch (e) { /* ok */ }
        reject(err);
      }
      res.on("data", function (chunk) {
        received += chunk.length;
        if (onProgress) { onProgress(received, total); }
      });
      res.pipe(out);
      out.on("finish", function () { resolve(dest); });
      out.on("error", fail);
      res.on("error", fail);
    });
  });
}

function logProgress(lineRef, msg, cls) {
  if (!ui.log) { return lineRef; }
  if (!lineRef) {
    lineRef = document.createElement("div");
    ui.log.appendChild(lineRef);
  }
  lineRef.className = cls || "";
  lineRef.textContent = new Date().toLocaleTimeString() + "  " + msg;
  ui.log.scrollTop = ui.log.scrollHeight;
  return lineRef;
}

function fmtBytes(b) {
  if (b < 1024 * 1024) { return (b / 1024).toFixed(0) + " Ko"; }
  return (b / (1024 * 1024)).toFixed(1) + " Mo";
}

var updating = false;
var pendingUpdate = null; // { rel, latest } quand une MAJ a été détectée

// Bascule le bouton entre « Vérifier les mises à jour » et « Installer vX ».
function setUpdateButtonInstall(latest) {
  if (latest) {
    ui.update.textContent = "Installer v" + latest;
    ui.update.classList.add("update-available");
  } else {
    ui.update.textContent = "Vérifier les mises à jour";
    ui.update.classList.remove("update-available");
  }
}

// Détecte une MAJ (auto ou manuel). N'installe rien : prépare seulement pendingUpdate.
function checkUpdate(silent) {
  if (updating) { return; }
  updating = true;
  ui.update.disabled = true;
  if (!silent) { log("Recherche de mise à jour…"); }
  httpsGetText("https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest")
    .then(function (body) {
      var rel = JSON.parse(body);
      var latest = String(rel.tag_name || "").replace(/^v/, "");
      if (!latest) { throw new Error("release sans numéro de version"); }
      if (!isNewer(latest, currentVersion())) {
        if (!silent) { log("Robloader est à jour (v" + currentVersion() + ")."); }
        return;
      }
      pendingUpdate = { rel: rel, latest: latest };
      setUpdateButtonInstall(latest);
      log("Mise à jour v" + latest + " disponible — clique sur « Installer v" + latest + " » pour la lancer.", "warn");
    })
    .catch(function (e) { if (!silent) { log("Mise à jour impossible : " + e.message, "err"); } })
    .then(function () { updating = false; ui.update.disabled = false; });
}

// Installe la MAJ détectée. Déclenché uniquement par le clic utilisateur.
function installUpdate() {
  if (updating || !pendingUpdate) { return; }
  updating = true;
  ui.update.disabled = true;
  var rel = pendingUpdate.rel, latest = pendingUpdate.latest;
  Promise.resolve()
    .then(function () {
      log("Nouvelle version : v" + latest);
      if (!IS_WINDOWS) {
        var sh = path.join(os.tmpdir(), "robloader-install.sh");
        return httpsDownload(
          "https://raw.githubusercontent.com/" + UPDATE_REPO + "/main/install/install-macos.sh", sh
        ).then(function () {
          spawn("/bin/bash", [sh], { detached: true, stdio: "ignore" }).unref();
          log("Mise à jour v" + latest + " en cours — patiente, puis redémarre Premiere.", "warn");
        });
      }
      var asset = null;
      (rel.assets || []).forEach(function (a) { if (/setup.*\.exe$/i.test(a.name)) { asset = a; } });
      if (!asset) { throw new Error("pas d'installeur Windows dans la release"); }
      log("Téléchargement de " + asset.name + "…");
      var dest = path.join(os.tmpdir(), "Robloader-Extension-Setup-v" + latest + ".exe");
      var dlLine = null;
      var lastPct = -1;
      return httpsDownload(asset.browser_download_url, dest, function (received, total) {
        var pct = total > 0 ? Math.floor(received / total * 100) : -1;
        if (pct === lastPct) { return; }
        lastPct = pct;
        var msg = pct >= 0
          ? "Téléchargement… " + pct + " % (" + fmtBytes(received) + " / " + fmtBytes(total) + ")"
          : "Téléchargement… " + fmtBytes(received);
        dlLine = logProgress(dlLine, msg);
      }).then(function () {
        if (dlLine) { dlLine.textContent = dlLine.textContent.replace(/Téléchargement.*/, "Téléchargement terminé."); }
        spawn("cmd.exe", ["/c", "start", "", dest], {
          detached: true, stdio: "ignore", windowsHide: true
        }).unref();
        log("Installeur v" + latest + " lancé : suis l'assistant, puis redémarre Premiere.", "warn");
      });
    })
    .then(function () { pendingUpdate = null; setUpdateButtonInstall(null); })
    .catch(function (e) { log("Mise à jour impossible : " + e.message, "err"); })
    .then(function () { updating = false; ui.update.disabled = false; });
}

// Le bouton installe si une MAJ est en attente, sinon il (re)vérifie.
function onUpdateClick() {
  if (pendingUpdate) { installUpdate(); } else { checkUpdate(false); }
}

// ---------- Bindings UI ----------

function onDownloadClick() {
  var url = ui.url.value.trim();
  if (!url) { setStatus("Colle une URL", "err"); return; }
  enqueue(url, {
    quality: ui.quality.value,
    audio: ui.audio.checked,
    start: ui.start.value.trim(),
    end: ui.end.value.trim()
  });
  ui.url.value = "";
  setStatus("En file", "ok");
}

ui.download.addEventListener("click", onDownloadClick);
ui.url.addEventListener("keydown", function (e) { if (e.key === "Enter") { onDownloadClick(); } });
ui.clear.addEventListener("click", function () {
  // Retire les tâches terminées/annulées de la liste.
  Array.prototype.slice.call(ui.queue.children).forEach(function (el) {
    var st = el.querySelector(".state");
    if (st && /Terminé|Annulé|Échec|import KO/.test(st.textContent)) { ui.queue.removeChild(el); }
  });
});
ui.update.addEventListener("click", onUpdateClick);
ui.version.textContent = "v" + currentVersion();

// Affiche la destination au démarrage si un projet est ouvert.
resolveDestination().then(function (d) {
  ui.target.textContent = d.dest;
  setStatus("Prêt", "ok");
  log("Robloader prêt — colle une URL et clique sur Télécharger." +
    (HAS_JS ? "" : " (Deno absent → 1080p max)"));
}).catch(function (e) {
  ui.target.textContent = "—";
  setStatus("Ouvre un projet", "paused");
  log(e.message, "warn");
});

// Vérifie discrètement les mises à jour au lancement (notification seule, sans installer).
setTimeout(function () { checkUpdate(true); }, 2000);
