// Service worker des écrans TMB (étape 4) — démarrage hors ligne.
// - précache : coquille de l'application + logos ;
// - navigations et config.js : réseau d'abord, repli cache (les mises à jour
//   déployées arrivent dès que le réseau revient) ;
// - polices et JS/CSS hachés : cache d'abord, alimenté au fil de l'eau — c'est
//   CE régime qui permet le démarrage hors ligne, il ne change pas ;
// - médias : cache d'abord AVEC péremption (voir PEREMPTION_MEDIA_MS) ;
// - les sondes de synchronisation (cache: 'no-store') ne sont JAMAIS servies
//   depuis le cache : ce sont elles qui détectent la coupure réseau.
// Les grilles horaires ne sont plus des fichiers : elles viennent de la base
// avec le reste des données et vivent dans l'instantané localStorage de
// l'écran (src/pages/resilience.ts) — même règle des 15 minutes.
//
// ⚠ CE FICHIER N'EST PAS TRAITÉ PAR VITE. Il vit dans `public/`, que Vite
// recopie tel quel : aucune substitution de variable n'y a lieu, `define` n'y
// arrive pas, `import.meta.env` n'y existe pas. C'est le piège de ce fichier,
// et c'est ce qui explique la forme de VERSION ci-dessous.

/**
 * Nom du cache, DÉRIVÉ DE L'URL D'ENREGISTREMENT.
 *
 * `enregistreServiceWorker()` (src/pages/resilience.ts) enregistre
 * `sw.js?v=<version de build>`. Ce fichier-ci n'est pas traité par Vite, mais
 * le code QUI L'ENREGISTRE l'est : la version traverse donc la frontière par
 * la seule chose que `public/` transporte, la query string, que le service
 * worker relit dans sa propre URL (`self.location`).
 *
 * Pourquoi pas une version dérivée du contenu livré. Il aurait fallu soit
 * sortir ce fichier de `public/` et le faire produire par Vite — le chemin
 * servi change alors, et avec lui l'enregistrement —, soit réécrire
 * `dist/sw.js` après le build : une étape qui, oubliée ou en échec, laisse
 * passer le gabarit littéral et rétablit EXACTEMENT le défaut qu'on corrige,
 * en silence. Le démarrage hors ligne est la raison d'être de ce fichier :
 * une solution vérifiable vaut mieux qu'une solution élégante.
 *
 * Le repli `tmb-v3` couvre l'ouverture directe de `sw.js` sans query string.
 * Il est passé de v2 à v3 exprès : ce seul changement purge une fois tous les
 * caches empoisonnés existants, ce que la version figée ne faisait jamais.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'tmb-v3';

/**
 * Au-delà, un média en cache est revalidé auprès du réseau.
 *
 * Six heures. Les métadonnées des médias (actif, expiration, gares) viennent
 * de la base et sont relues à chaque synchronisation, donc au plus 15 minutes
 * — seuls les OCTETS du fichier sont ici en cause. Et un média remplacé reçoit
 * une URL neuve (`uploadMedia` préfixe le chemin d'un horodatage), donc il
 * n'est jamais servi depuis l'entrée de l'ancien. Le seul cas qui reste est le
 * fichier SUPPRIMÉ du bucket sans que sa ligne soit désactivée : c'est M-02, et
 * six heures veut dire qu'il cesse d'être affiché dans le quart d'une journée
 * de service (18 h), au prix de trois revalidations par média et par jour —
 * négligeable, même sur la 5G du Nid d'Aigle.
 *
 * La revalidation qui ÉCHOUE rend l'entrée en cache : hors ligne, un média
 * périmé vaut mieux qu'un trou, et le cycle de l'écran continue.
 */
const PEREMPTION_MEDIA_MS = 6 * 60 * 60 * 1000;

/** En-tête posé à la mise en cache : c'est lui qui date l'entrée. */
const ENTETE_DATE = 'x-tmb-cache-le';

const PRECACHE = [
  './',
  './index.html',
  './ecran.html',
  './grille.html',
  './supervision.html',
  './logos/logo-rond.svg',
  './logos/logo-rond-blanc.svg',
  './logos/motrice-direct_blanc_FFFFFF.svg',
  './logos/motrice-direct_marine_213B57.svg',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  if (requete.cache === 'no-store') return; // sonde réseau : passage direct
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) {
    // Médias distants (Supabase Storage) : rejouables hors ligne après première
    // lecture, mais PÉRIMABLES — un fichier supprimé ne doit pas s'afficher
    // indéfiniment.
    if (requete.destination === 'image' || requete.destination === 'video') {
      evenement.respondWith(cacheDabord(requete, PEREMPTION_MEDIA_MS));
    }
    return;
  }
  if (requete.mode === 'navigate' || url.pathname.endsWith('/config.js')) {
    evenement.respondWith(reseauDabord(requete));
    return;
  }
  evenement.respondWith(cacheDabord(requete, null));
});

/** Âge d'une entrée en cache, en millisecondes, ou null si elle n'est pas datée. */
function ageEntree(reponse) {
  const pose = reponse.headers.get(ENTETE_DATE);
  const quand = pose ? Number(pose) : NaN;
  return Number.isFinite(quand) ? Date.now() - quand : null;
}

/**
 * Met en cache une réponse en la DATANT.
 *
 * Une réponse ne peut pas recevoir d'en-tête sans être reconstruite : on la
 * recopie corps et en-têtes, en ajoutant le nôtre. Le corps est lu une seule
 * fois ici, l'appelant garde la réponse d'origine.
 */
async function mettEnCache(cache, requete, reponse) {
  const entetes = new Headers(reponse.headers);
  entetes.set(ENTETE_DATE, String(Date.now()));
  const datee = new Response(await reponse.clone().blob(), {
    status: reponse.status,
    statusText: reponse.statusText,
    headers: entetes,
  });
  await cache.put(requete, datee);
}

/**
 * Cache d'abord. `peremptionMs` non nul : au-delà de cet âge, l'entrée est
 * revalidée auprès du réseau, et conservée si le réseau ne répond pas.
 *
 * ⚠ Les réponses OPAQUES ne sont plus mises en cache. Une réponse opaque a un
 * statut illisible : un 404 ou un 502 y entrait comme un succès, et le cache
 * étant « cache d'abord » sans revalidation, l'échec était rejoué
 * indéfiniment. Le lot 6 a rendu ces réponses LISIBLES en posant
 * `crossorigin="anonymous"` sur les médias, Supabase Storage renvoyant
 * `Access-Control-Allow-Origin: *` sur les objets publics : il n'y a donc plus
 * de raison d'accepter l'opaque, et en accepter une reviendrait à remettre un
 * échec en cache pour toujours.
 */
async function cacheDabord(requete, peremptionMs) {
  const cache = await caches.open(VERSION);
  const trouve = await cache.match(requete);
  if (trouve) {
    const age = peremptionMs === null ? null : ageEntree(trouve);
    // Entrée non datée (mise en cache par une version antérieure) ou encore
    // fraîche : on la sert. Une entrée sans date n'est jamais périmée de force,
    // sinon le premier démarrage hors ligne après mise à jour perdrait tout.
    if (age === null || age <= peremptionMs) return trouve;
    try {
      const rafraichie = await fetch(requete);
      if (rafraichie.ok) {
        await mettEnCache(cache, requete, rafraichie);
        return rafraichie;
      }
      // Le fichier a disparu (404) ou le serveur refuse : l'entrée périmée n'a
      // plus de raison d'être servie, et l'écran sait rendre la main (M-02).
      await cache.delete(requete);
      return rafraichie;
    } catch {
      return trouve; // hors ligne : périmé vaut mieux qu'un trou
    }
  }
  const reponse = await fetch(requete);
  if (reponse.ok) await mettEnCache(cache, requete, reponse);
  return reponse;
}

async function reseauDabord(requete) {
  const cache = await caches.open(VERSION);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) await mettEnCache(cache, requete, reponse);
    return reponse;
  } catch {
    const secours = await cache.match(requete);
    return secours ?? Response.error();
  }
}
