// Thème de la Supervision posé AVANT le premier rendu (20/10/2026).
//
// Script CLASSIQUE chargé dans le <head> de supervision.html : il bloque
// l'analyse le temps de s'exécuter, donc <html data-theme> est en place avant
// que le moindre pixel soit peint — un poste réglé sur Sombre ne voit jamais
// d'écran clair. Un module (`type="module"`, toujours différé) ne le
// garantirait pas, et la CSP (`script-src 'self'`, sans 'unsafe-inline')
// interdit le script en ligne : d'où ce fichier servi depuis la même origine.
//
// COPIE de `lireChoixTheme` + `appliqueChoixTheme` (src/pages/theme-
// supervision.ts) : theme-supervision.test.ts l'exécute et compare.
(function () {
  try {
    var choix = window.localStorage.getItem('tmb-theme-supervision');
    if (choix === 'clair' || choix === 'sombre') {
      document.documentElement.setAttribute('data-theme', choix);
    }
  } catch (e) {
    // stockage indisponible : Auto
  }
})();
