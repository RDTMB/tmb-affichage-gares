// Service worker des écrans TMB (étape 4) — démarrage hors ligne.
// - précache : coquille de l'application + logos ;
// - navigations et config.js : réseau d'abord, repli cache (les mises à jour
//   déployées arrivent dès que le réseau revient) ;
// - reste (polices, JS/CSS hachés, médias) : cache d'abord, alimenté au fil
//   de l'eau ;
// - les sondes de synchronisation (cache: 'no-store') ne sont JAMAIS servies
//   depuis le cache : ce sont elles qui détectent la coupure réseau.
// Les grilles horaires ne sont plus des fichiers : elles viennent de la base
// avec le reste des données et vivent dans l'instantané localStorage de
// l'écran (src/pages/resilience.ts) — même règle des 15 minutes.
const VERSION = 'tmb-v2';
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
    // Médias distants (Supabase Storage) : rejouables hors ligne après première lecture
    if (requete.destination === 'image' || requete.destination === 'video') {
      evenement.respondWith(cacheDabord(requete));
    }
    return;
  }
  if (requete.mode === 'navigate' || url.pathname.endsWith('/config.js')) {
    evenement.respondWith(reseauDabord(requete));
    return;
  }
  evenement.respondWith(cacheDabord(requete));
});

async function cacheDabord(requete) {
  const cache = await caches.open(VERSION);
  const trouve = await cache.match(requete);
  if (trouve) return trouve;
  const reponse = await fetch(requete);
  if (reponse.ok || reponse.type === 'opaque') cache.put(requete, reponse.clone());
  return reponse;
}

async function reseauDabord(requete) {
  const cache = await caches.open(VERSION);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) cache.put(requete, reponse.clone());
    return reponse;
  } catch {
    const secours = await cache.match(requete);
    return secours ?? Response.error();
  }
}
