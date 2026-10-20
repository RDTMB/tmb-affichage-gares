import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

import { lireNouveautes } from './src/core/nouveautes';

// Logos officiels de public/logos/ inlinés au build en data URI base64
// (docs/02 §4) : l'affichage ne dépend d'aucune requête, même hors ligne.
function fichierDataUri(nom: string, type: string): string {
  const chemin = fileURLToPath(new URL(`public/logos/${nom}`, import.meta.url));
  return JSON.stringify(`data:${type};base64,${readFileSync(chemin).toString('base64')}`);
}

function logoDataUri(nom: string): string {
  return fichierDataUri(nom, 'image/svg+xml');
}

// Version du cache du service worker. Elle ne peut PAS être substituée dans
// `public/sw.js`, que Vite recopie sans le traiter : elle voyage donc par la
// query string de l'enregistrement (src/pages/resilience.ts), que le service
// worker relit dans sa propre URL. Un horodatage de build plutôt qu'une
// empreinte du contenu livré : l'empreinte n'existe pas encore au moment où
// cette configuration est évaluée, et réécrire `dist/sw.js` après le build
// ajouterait une étape qui, oubliée, laisserait passer un gabarit littéral —
// c'est-à-dire le défaut qu'on corrige, en silence.
const VERSION_CACHE = `tmb-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

// Version du code en ligne (src/core/version.ts). Les variables sont posées
// par le déploiement (deploy.yml, job `site`) juste avant CHAQUE `vite build` :
// date et heure du commit de tête à l'heure de Paris, sha court, n° de PR lu
// dans le sujet du commit, branche construite. Sans elles — build local,
// `npm run dev`, mode démo, job `build` des PR — la version est « locale » :
// on ne fabrique JAMAIS une date. `VERSION_CACHE` ci-dessus, elle, reste un
// horodatage de build : elle sert au cache, pas à l'affichage.
function versionApp(): string {
  const env = process.env;
  if (!env.VERSION_SHA || !env.VERSION_BRANCHE) {
    return JSON.stringify({ date: null, heure: null, sha: null, pr: null, branche: 'local' });
  }
  return JSON.stringify({
    date: env.VERSION_DATE || null,
    heure: env.VERSION_HEURE || null,
    sha: env.VERSION_SHA,
    pr: env.VERSION_PR || null,
    branche: env.VERSION_BRANCHE,
  });
}

// Nouveautés (docs/nouveautes.md) : un fichier par PR dans `nouveautes/`, lus
// ET VALIDÉS ici, au build, par le parseur pur de src/core/nouveautes.ts. Un
// fichier mal formé lève une erreur qui le nomme : le build échoue, plutôt que
// l'onglet Version se vide en silence. Module VIRTUEL plutôt
// qu'`import.meta.glob` : avec le glob, le parseur ne tournerait que dans le
// navigateur, c'est-à-dire après la mise en ligne.
function nouveautes(): Plugin {
  const ID = 'virtual:nouveautes';
  const RESOLU = '\0' + ID;
  const dossier = fileURLToPath(new URL('nouveautes/', import.meta.url));
  return {
    name: 'tmb-nouveautes',
    resolveId: (id) => (id === ID ? RESOLU : undefined),
    load(id) {
      if (id !== RESOLU) return undefined;
      const fichiers: Record<string, string> = {};
      for (const nom of readdirSync(dossier)) {
        if (!nom.endsWith('.md')) continue;
        const chemin = dossier + nom;
        this.addWatchFile(chemin);
        fichiers[nom] = readFileSync(chemin, 'utf8');
      }
      return `export default ${JSON.stringify(lireNouveautes(fichiers))};`;
    },
  };
}

// Multi-pages : quatre entrées HTML indépendantes (portail de test, écran de
// gare, grille du jour, supervision). Les écrans tournent sur Raspberry Pi en
// kiosque : tout est auto-hébergé, aucune ressource externe.
export default defineConfig(({ mode }) => ({
  // Mode « demo » (`vite --mode demo`, lanceur « dev-demo ») : le dossier
  // public/ n'est pas servi, donc pas de config.js → toutes les pages tournent
  // sur le fournisseur de DÉMONSTRATION (mock), même quand un config.js local
  // pointe sur un projet Supabase. Les logos sont inlinés au build (define),
  // les grilles de référence viennent de docs/ : rien ne manque en démo.
  publicDir: mode === 'demo' ? false : 'public',
  // fflate n'est importé que dynamiquement (lecteur Excel de la supervision) :
  // sans cette pré-optimisation, le premier clic sur « Charger un fichier
  // Excel… » en `npm run dev` déclenchait un rechargement complet de la page
  // (découverte tardive de la dépendance). Sans effet sur le build.
  optimizeDeps: { include: ['fflate'] },
  plugins: [nouveautes()],
  define: {
    __VERSION_CACHE__: JSON.stringify(VERSION_CACHE),
    __VERSION_APP__: versionApp(),
    __LOGO_ROND__: logoDataUri('logo-rond.svg'),
    __LOGO_ROND_BLANC__: logoDataUri('logo-rond-blanc.svg'),
    __LOGO_LONG__: logoDataUri('logo-long.svg'),
    __MOTRICE_BLANC__: logoDataUri('motrice-direct_blanc_FFFFFF.svg'),
    __MOTRICE_MARINE__: logoDataUri('motrice-direct_marine_213B57.svg'),
    // Icône d'onglet. Le logo officiel porte quatre lignes de texte : illisible
    // dans 16 px. Monogramme dédié, tracé dans l'Amaranth du projet (les
    // lettres sont des CONTOURS, pas du texte : une icône ne charge pas les
    // polices de la page). Le PNG est le repli des navigateurs qui refusent
    // une icône SVG ; le 180 sert l'ajout à l'écran d'accueil d'un téléphone.
    __FAVICON_SVG__: logoDataUri('favicon-tmb.svg'),
    __FAVICON_PNG__: fichierDataUri('favicon-tmb-64.png', 'image/png'),
    __FAVICON_TACTILE__: fichierDataUri('favicon-tmb-180.png', 'image/png'),
  },
  build: {
    // Les logos officiels sont inlinés en base64 dans le JS (démarrage hors
    // ligne) : le budget du projet est en GZIPPÉ (< 400 Ko, largement tenu),
    // le seuil d'avertissement Vite (500 Ko bruts) est donc relevé.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        ecran: fileURLToPath(new URL('ecran.html', import.meta.url)),
        grille: fileURLToPath(new URL('grille.html', import.meta.url)),
        supervision: fileURLToPath(new URL('supervision.html', import.meta.url)),
        // Horaires pour le site web, en iframe : SANS temps réel ni service
        // worker (src/pages/embed.ts, docs/integration-site-web.md).
        embed: fileURLToPath(new URL('embed.html', import.meta.url)),
      },
      output: {
        // supabase-js partagé entre les trois pages (cache commun des écrans)
        manualChunks: { supabase: ['@supabase/supabase-js'] },
      },
    },
  },
}));
