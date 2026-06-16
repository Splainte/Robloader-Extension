/*
 * Robloader — côté ExtendScript (Premiere Pro)
 * Reçoit les ordres du panneau CEP : donner le chemin du projet ouvert et
 * importer un fichier téléchargé dans le chutier miroir ELEMENTS/Robloader.
 * Toute la logique de chemins vit côté JS : on recalcule tout depuis
 * app.project.path à chaque téléchargement, on ne stocke jamais de chemin absolu.
 */

var ROBLOADER = (function () {

  var BIN_TYPE = 2; // ProjectItemType.BIN

  function getProjectPath() {
    if (!app.project || !app.project.path) {
      return "";
    }
    return app.project.path; // chemin du .prproj
  }

  // Trouve un chutier enfant par nom, ou le crée.
  function findOrCreateChildBin(parentBin, name) {
    for (var i = 0; i < parentBin.children.numItems; i++) {
      var child = parentBin.children[i];
      if (child.type === BIN_TYPE && child.name === name) {
        return child;
      }
    }
    return parentBin.createBin(name);
  }

  // segments : tableau de noms de chutiers depuis la racine du projet,
  // ex. ["ELEMENTS", "Robloader"] → chutier Robloader DANS le chutier ELEMENTS.
  function findOrCreateBinPath(segments) {
    var bin = app.project.rootItem;
    for (var i = 0; i < segments.length; i++) {
      bin = findOrCreateChildBin(bin, segments[i]);
    }
    return bin;
  }

  return {

    getProjectPath: getProjectPath,

    // Importe un fichier dans le chutier miroir (segmentsJoined = "ELEMENTS/Robloader").
    // filePath = chemin absolu, recalculé par le panneau à chaque session.
    importFile: function (filePath, segmentsJoined) {
      try {
        if (!app.project) { return "ERR:no-project"; }
        var bin = segmentsJoined
          ? findOrCreateBinPath(segmentsJoined.split("/"))
          : app.project.rootItem;
        var ok = app.project.importFiles([filePath], true, bin, false);
        return ok ? "OK" : "ERR:import-failed";
      } catch (e) {
        return "ERR:" + e.toString();
      }
    }
  };
})();
