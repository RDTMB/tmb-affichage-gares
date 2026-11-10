// Régénère les trois maquettes de `maquettes/` À PARTIR DU RENDU RÉEL.
//
// POURQUOI. Les maquettes font foi pour le visuel (.claude/charte-graphique.md).
// Écrites à la main, elles divergent du code dès qu'un lot touche une feuille
// de style — et une maquette qui ne ressemble plus à l'écran ne fait plus foi
// de rien. Depuis la refonte du 10/11/2026, une maquette est une PHOTOGRAPHIE
// du rendu : le DOM de la page en démonstration, à un instant choisi, avec ses
// feuilles de style recopiées dedans. Un seul fichier, ouvrable d'un
// double-clic, sans serveur ni script de l'application.
//
// CE QUE ÇA NE FAIT PAS. Une maquette est FIGÉE : l'horloge ne tourne pas, la
// supervision n'enregistre rien (seuls ses onglets se changent). Pour essayer
// un comportement, ouvrir la vraie page en `?demo=1`.
//
// UTILISATION (poste de développement ou session cloud, Playwright présent) :
//   1. `npx vite --port 5199` dans un terminal ;
//   2. `node outils/regenerer-maquettes.cjs` dans un autre ;
//   3. relire les trois fichiers au navigateur AVANT de les committer.
// Playwright n'est pas une dépendance du dépôt : il ne sert qu'ici.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:5199/';
const SORTIE = path.join(__dirname, '..', 'maquettes');
/** Journée et heure figées : un grand service d'été, états variés à l'écran. */
const JOUR = '2026-07-15';
const POLICES =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Amaranth:wght@400;700&family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">';

/**
 * Les logos sont inlinés en base64 dans les pages (démarrage hors ligne) : la
 * motrice express, 125 Ko, se retrouvait recopiée à chaque colonne — 860 Ko de
 * maquette pour la grille. Chaque image inlinée est donc remplacée par le
 * chemin du fichier officiel de `public/logos/`, relatif à `maquettes/`.
 */
function logosEnFichiers(html) {
  const dossier = path.join(__dirname, '..', 'public', 'logos');
  for (const nom of fs.readdirSync(dossier)) {
    const type = nom.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    const uri = `data:${type};base64,${fs.readFileSync(path.join(dossier, nom)).toString('base64')}`;
    html = html.split(uri).join(`../public/logos/${nom}`);
  }
  return html;
}

/** DOM + feuilles de style de la page courante, en un seul document. */
async function photographie(page, titre, note, scriptFinal = '') {
  const { css, corps } = await page.evaluate(() => {
    // Les @font-face pointent vers le serveur de développement : on les
    // retire, les polices viennent du lien posé dans l'en-tête.
    const css = [...document.styleSheets]
      .map((feuille) =>
        [...feuille.cssRules]
          .filter((regle) => !(regle instanceof CSSFontFaceRule))
          .map((regle) => regle.cssText)
          .join('\n'),
      )
      .join('\n');
    document.querySelectorAll('script, style, link[rel="stylesheet"]').forEach((e) => e.remove());
    return { css, corps: document.body.outerHTML };
  });
  return logosEnFichiers(
    `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
      `<title>${titre}</title>\n<!-- ${note}\n     Régénérée par outils/regenerer-maquettes.cjs — ne pas retoucher à la main. -->\n` +
      `${POLICES}\n<style>\n${css}\n</style>\n</head>\n${corps}\n${scriptFinal}</html>\n`,
  );
}

(async () => {
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
  });

  // Écran de gare et grille du jour : la démonstration, SANS ses bandeaux de
  // test — une maquette montre l'écran tel qu'il est en gare.
  for (const [fichier, url, titre, note] of [
    [
      'ecran-gare.html',
      `ecran.html?demo=1&gare=col-de-voza&jour=${JOUR}&simule=13:38`,
      'TMB — Écran de gare (maquette)',
      `Écran de gare, Col de Voza, ${JOUR} à 13:38 : départs à moins de cinq minutes, train supprimé, trains en ligne sur le profil.`,
    ],
    [
      'grille-horaire.html',
      `grille.html?demo=1&jour=${JOUR}&simule=10:45`,
      'TMB — Grille du jour (maquette)',
      `Grille du jour, ${JOUR} à 10:45 : grand service, express, retard, train supprimé, complet, dernières places.`,
    ],
  ]) {
    const page = await contexte.newPage();
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.body.classList.remove('mode-demo', 'mode-simule', 'mode-degrade');
      // L'anti-burn-in décale `body` d'un pixel de temps en temps : pas ici.
      document.body.style.transform = '';
    });
    fs.writeFileSync(path.join(SORTIE, fichier), await photographie(page, titre, note));
    console.log(fichier);
    await page.close();
  }

  // Supervision : compte de démonstration technique + admin, tous les onglets
  // rendus. Un script de dix lignes change d'onglet, rien d'autre.
  const page = await contexte.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + 'supervision.html?demo=1', { waitUntil: 'networkidle' });
  await page.fill('#login-email', 'technique+admin@demo');
  await page.fill('#login-mdp', 'demo');
  await page.click('#form-connexion button[type=submit]');
  await page.waitForTimeout(1500);
  await page.fill('#date-picker', JOUR);
  await page.dispatchEvent('#date-picker', 'change');
  await page.waitForTimeout(1500);
  for (const onglet of await page.$$eval('#tabs button[data-t]', (bs) =>
    bs.map((b) => b.dataset.t),
  )) {
    await page.click(`#tabs button[data-t="${onglet}"]`);
    await page.waitForTimeout(500);
  }
  await page.click('#tabs button[data-t="circulations"]');
  await page.waitForTimeout(500);
  const onglets = `<script>
document.querySelectorAll('#tabs button[data-t]').forEach(function (bouton) {
  bouton.addEventListener('click', function () {
    document.querySelectorAll('#tabs button[data-t]').forEach(function (b) { b.classList.toggle('on', b === bouton); });
    document.querySelectorAll('section.onglet').forEach(function (s) { s.classList.toggle('on', s.id === 't-' + bouton.dataset.t); });
  });
});
</script>\n`;
  fs.writeFileSync(
    path.join(SORTIE, 'supervision.html'),
    await photographie(
      page,
      'TMB — Supervision (maquette)',
      `Supervision, compte de démonstration technique + admin, journée du ${JOUR}. Figée : seuls les onglets se changent.`,
      onglets,
    ),
  );
  console.log('supervision.html');
  await navigateur.close();
})();
