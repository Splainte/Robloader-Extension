## Bug « dossier accentué » trouvé côté Robloader V2 (Tauri) — Extension NON concernée

Contexte : le 2026-07-10, tous les téléchargements de Robloader V2 (Tauri/Rust)
échouaient avec `OSError: [Errno 22] Invalid argument` dès que le dossier de
destination contenait un accent (ex. `C:\Users\...\Téléchargements`). Cause :
sous Windows sans console, yt-dlp (Python) écrit sa sortie en **cp1252** ; le
lecteur Rust de stdout (`BufReader::lines()`, UTF-8 strict) tombait sur
l'octet accentué invalide, s'arrêtait et fermait le tuyau — yt-dlp mourait en
écrivant dedans. Détails : PR Splainte/Robloader#22.

**Vérifié : l'Extension n'a pas ce bug.** `runProcess()` dans `js/main.js`
(~ligne 246-270) lit stdout/stderr via `proc.stdout.setEncoding("utf8")`.
Le décodeur Node (`StringDecoder`) est **tolérant par construction** : un
octet invalide devient le caractère de remplacement `�`, il ne lève jamais
d'exception et ne ferme jamais le flux. Rien à corriger ici — ne pas
« réparer » ce qui n'est pas cassé si ce ticket ressurgit dans un rapport de
bug pointant vers l'Extension.

Si un jour un comportement similaire est rapporté sur l'Extension (échec
uniquement sur des chemins/noms accentués), la cause sera ailleurs — vérifier
plutôt les longueurs de chemin Windows (260 caractères), des soucis de
verrouillage réseau/OneDrive, ou une éventuelle réécriture de `runProcess`
qui aurait perdu la tolérance de `setEncoding("utf8")`.

Ce fichier peut être supprimé une fois lu — il documente un point ponctuel,
pas une convention durable du projet.
