// §A — le service worker : plus de réponse opaque en cache, et une version
// qui change à chaque déploiement.
//
// CE QUE CE TEST PROUVE, ET COMMENT. `public/sw.js` n'est traité par personne :
// Vite le recopie tel quel, il n'entre dans aucun bundle, et il tourne dans un
// contexte de service worker que Node n'a pas. On applique donc le procédé des
// lots précédents — le fichier est COMPILÉ par `transformWithEsbuild` et
// EXÉCUTÉ contre de faux `caches`, `fetch` et `self`. Ce n'est pas une
// réécriture du cache qui est éprouvée, c'est le fichier livré.
//
// NON prouvé : le démarrage hors ligne réel. Le faux cache imite l'API, pas le
// navigateur. La mesure au navigateur, réseau coupé, reste dans la recette —
// c'est la raison d'être de ce fichier.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';

const MAINTENANT = 1_780_000_000_000;
const HEURE_MS = 60 * 60 * 1000;

function sourceSw(): string {
  const url = new URL('../../public/sw.js', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Faux CacheStorage, réduit à ce dont sw.js a besoin
// ---------------------------------------------------------------------------

interface ReponseFactice {
  ok: boolean;
  status: number;
  statusText: string;
  type: string;
  headers: Headers;
  clone(): ReponseFactice;
  blob(): Promise<string>;
  corps: string;
}

function reponse(complement: Partial<ReponseFactice> & { corps?: string } = {}): ReponseFactice {
  const status = complement.status ?? 200;
  const r: ReponseFactice = {
    ok: complement.ok ?? (status >= 200 && status < 300),
    status,
    statusText: complement.statusText ?? '',
    type: complement.type ?? 'basic',
    headers: complement.headers ?? new Headers(),
    corps: complement.corps ?? 'octets',
    clone: () => r,
    blob: () => Promise.resolve(r.corps),
  };
  return r;
}

class CacheFactice {
  readonly entrees = new Map<string, ReponseFactice>();
  readonly misesEnCache: string[] = [];
  readonly suppressions: string[] = [];

  match(requete: { url: string }): Promise<ReponseFactice | undefined> {
    return Promise.resolve(this.entrees.get(requete.url));
  }

  put(requete: { url: string }, r: ReponseFactice): Promise<void> {
    this.misesEnCache.push(requete.url);
    this.entrees.set(requete.url, r);
    return Promise.resolve();
  }

  delete(requete: { url: string }): Promise<boolean> {
    this.suppressions.push(requete.url);
    return Promise.resolve(this.entrees.delete(requete.url));
  }

  addAll(): Promise<void> {
    return Promise.resolve();
  }
}

interface Banc {
  cacheDabord(requete: unknown, peremptionMs: number | null): Promise<ReponseFactice>;
  reseauDabord(requete: unknown): Promise<ReponseFactice>;
  version: string;
  cache: CacheFactice;
  /** URLs réellement demandées au réseau. */
  reseau: string[];
}

/**
 * Compile `public/sw.js` et l'exécute.
 *
 * `urlDuScript` est l'URL sous laquelle le service worker se croit enregistré :
 * c'est par sa query string que la version du cache arrive, `public/` ne
 * transportant rien d'autre.
 */
async function banc(options: {
  urlDuScript: string;
  reseau?: (url: string) => ReponseFactice | Error;
}): Promise<Banc> {
  const { code } = await transformWithEsbuild(sourceSw(), 'sw.js', {
    loader: 'js',
    target: 'es2022',
  });

  const cache = new CacheFactice();
  const demandees: string[] = [];
  const ecouteurs = new Map<string, unknown>();

  const faussSelf = {
    location: { href: options.urlDuScript, origin: 'https://rdtmb.github.io' },
    addEventListener: (nom: string, fn: unknown) => void ecouteurs.set(nom, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };

  const faussFetch = (requete: { url: string }): Promise<ReponseFactice> => {
    demandees.push(requete.url);
    const r = options.reseau?.(requete.url) ?? reponse();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };

  const fabrique = new Function(
    'self',
    'caches',
    'fetch',
    'Response',
    'Headers',
    'URL',
    'Date',
    `${code}\nreturn { cacheDabord, reseauDabord, VERSION };`,
  ) as (...args: unknown[]) => {
    cacheDabord: Banc['cacheDabord'];
    reseauDabord: Banc['reseauDabord'];
    VERSION: string;
  };

  const api = fabrique(
    faussSelf,
    {
      open: () => Promise.resolve(cache),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    faussFetch,
    // `new Response(corps, { status, headers })` : on garde ce qui compte.
    class {
      constructor(
        public corps: string,
        init: { status?: number; statusText?: string; headers?: Headers } = {},
      ) {
        Object.assign(this, {
          ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
          status: init.status ?? 200,
          statusText: init.statusText ?? '',
          type: 'basic',
          headers: init.headers ?? new Headers(),
          clone: () => this,
          blob: () => Promise.resolve(corps),
        });
      }
    },
    Headers,
    URL,
    { ...Date, now: () => MAINTENANT },
  );

  return {
    cacheDabord: api.cacheDabord,
    reseauDabord: api.reseauDabord,
    version: api.VERSION,
    cache,
    reseau: demandees,
  };
}

/** Une requête, telle que `fetch` la reçoit. */
function requete(url: string) {
  return { url, method: 'GET', destination: 'image', mode: 'no-cors', cache: 'default' };
}

const MEDIA = 'https://exemple.supabase.co/storage/v1/object/public/medias/affiche.png';

describe('§A.2 — la VERSION vient de l’URL d’enregistrement', () => {
  it('la query string `v` devient le nom du cache', async () => {
    // `public/sw.js` n'est pas traité par Vite : aucun `define` ne l'atteint.
    // La query string est le seul canal qui traverse la frontière.
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=tmb-2026-09-08-08-01-51',
    });
    expect(b.version).toBe('tmb-2026-09-08-08-01-51');
  });

  it('sans query string, le repli littéral s’applique', async () => {
    // Ouverture directe de `sw.js`, ou enregistrement d'une version
    // antérieure du code : le cache doit tout de même avoir un nom.
    const b = await banc({ urlDuScript: 'https://rdtmb.github.io/sw.js' });
    expect(b.version).toBe('tmb-v3');
  });

  it('le repli a QUITTÉ tmb-v2 : ce seul changement purge les caches empoisonnés', async () => {
    // La version figée à `tmb-v2` ne purgeait jamais rien. Passer à v3 vide
    // une fois pour toutes les entrées entrées par erreur avant ce correctif.
    expect(sourceSw()).not.toContain("'tmb-v2'");
    expect(sourceSw()).toContain("'tmb-v3'");
  });

  it('l’enregistrement, côté application, porte bien la version de build', () => {
    const url = new URL('../../src/pages/resilience.ts', import.meta.url);
    const src = readFileSync(fileURLToPath(url), 'utf-8');
    expect(src).toContain('sw.js?v=${encodeURIComponent(__VERSION_CACHE__)}');
    // Et la version est bien définie par le build, pas écrite à la main.
    const config = readFileSync(
      fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      'utf-8',
    );
    expect(config).toContain('__VERSION_CACHE__: JSON.stringify(VERSION_CACHE)');
    expect(config).toMatch(/const VERSION_CACHE = `tmb-\$\{new Date\(\)/);
  });
});

describe('§A.1 — les réponses OPAQUES ne sont plus mises en cache', () => {
  let b: Banc;

  beforeEach(async () => {
    b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => reponse({ type: 'opaque', ok: false, status: 0 }),
    });
  });

  it('une réponse opaque traverse SANS entrer dans le cache', async () => {
    // Le défaut : `if (reponse.ok || reponse.type === 'opaque')` faisait
    // entrer un 404 ou un 502 comme un succès, et le cache étant « cache
    // d'abord » sans revalidation, l'échec était rejoué indéfiniment.
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.type).toBe('opaque');
    expect(b.cache.misesEnCache).toEqual([]);
    expect(b.cache.entrees.size).toBe(0);
  });

  it('le mot « opaque » a disparu du code : plus de condition à réintroduire', () => {
    expect(sourceSw()).not.toContain("=== 'opaque'");
  });

  it('un 404 lisible n’entre pas non plus', async () => {
    const c = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => reponse({ ok: false, status: 404 }),
    });
    const r = await c.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.status).toBe(404);
    expect(c.cache.misesEnCache).toEqual([]);
  });

  it('une réponse valide, elle, entre bien — et DATÉE', async () => {
    const c = await banc({ urlDuScript: 'https://rdtmb.github.io/sw.js?v=test' });
    await c.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(c.cache.misesEnCache).toEqual([MEDIA]);
    const entree = c.cache.entrees.get(MEDIA);
    expect(entree?.headers.get('x-tmb-cache-le')).toBe(String(MAINTENANT));
  });
});

describe('§A.1 — les médias en cache PÉRIMENT', () => {
  /** Une entrée déjà en cache, datée de `ageMs` millisecondes. */
  function dejaEnCache(b: Banc, ageMs: number, corps = 'ancien') {
    const entetes = new Headers();
    entetes.set('x-tmb-cache-le', String(MAINTENANT - ageMs));
    b.cache.entrees.set(MEDIA, reponse({ headers: entetes, corps }));
  }

  it('encore fraîche : servie depuis le cache, aucune requête réseau', async () => {
    const b = await banc({ urlDuScript: 'https://rdtmb.github.io/sw.js?v=test' });
    dejaEnCache(b, 1 * HEURE_MS);
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.corps).toBe('ancien');
    expect(b.reseau).toEqual([]);
  });

  it('périmée : revalidée, et la nouvelle version remplace l’ancienne', async () => {
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => reponse({ corps: 'neuf' }),
    });
    dejaEnCache(b, 7 * HEURE_MS);
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(b.reseau).toEqual([MEDIA]);
    expect(r.corps).toBe('neuf');
    expect(b.cache.entrees.get(MEDIA)?.corps).toBe('neuf');
  });

  it('périmée et le fichier a DISPARU : l’entrée est retirée du cache', async () => {
    // C'est M-02 vu du cache. Sans cette suppression, un média supprimé du
    // bucket continuerait de s'afficher jusqu'à la prochaine péremption, puis
    // à chaque péremption suivante.
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => reponse({ ok: false, status: 404 }),
    });
    dejaEnCache(b, 7 * HEURE_MS);
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.status).toBe(404);
    expect(b.cache.suppressions).toEqual([MEDIA]);
    expect(b.cache.entrees.has(MEDIA)).toBe(false);
  });

  it('périmée mais HORS LIGNE : l’ancienne est servie quand même', async () => {
    // Périmé vaut mieux qu'un trou : le cycle de l'écran continue, et c'est
    // tout l'objet du service worker.
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => new Error('réseau coupé'),
    });
    dejaEnCache(b, 48 * HEURE_MS);
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.corps).toBe('ancien');
    expect(b.cache.entrees.has(MEDIA)).toBe(true);
  });

  it('une entrée NON datée n’est jamais périmée de force', async () => {
    // Elle vient d'une version antérieure du service worker. La périmer
    // d'office ferait perdre tout le cache au premier démarrage hors ligne
    // après mise à jour — exactement ce qu'il ne faut pas.
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => new Error('réseau coupé'),
    });
    b.cache.entrees.set(MEDIA, reponse({ corps: 'sans date' }));
    const r = await b.cacheDabord(requete(MEDIA), 6 * HEURE_MS);
    expect(r.corps).toBe('sans date');
    expect(b.reseau).toEqual([]);
  });

  it('la péremption vaut SIX heures, et seulement pour les médias', () => {
    const src = sourceSw();
    expect(src).toContain('const PEREMPTION_MEDIA_MS = 6 * 60 * 60 * 1000;');
    // Les ressources locales passent `null` : polices et JS/CSS hachés gardent
    // le régime « cache d'abord » sans péremption, c'est lui qui permet le
    // démarrage hors ligne.
    expect(src).toContain('cacheDabord(requete, null)');
    expect(src).toContain('cacheDabord(requete, PEREMPTION_MEDIA_MS)');
  });
});

describe('ce qui ne change pas — le démarrage hors ligne', () => {
  it('une ressource LOCALE en cache est servie sans péremption ni réseau', async () => {
    // Polices, JS et CSS hachés : c'est ce régime qui fait démarrer un Pi
    // sans réseau, et il ne bouge pas.
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => new Error('réseau coupé'),
    });
    const police = 'https://rdtmb.github.io/assets/lato-latin-400.woff2';
    const entetes = new Headers();
    entetes.set('x-tmb-cache-le', String(MAINTENANT - 365 * 24 * HEURE_MS));
    b.cache.entrees.set(police, reponse({ headers: entetes, corps: 'police' }));
    const r = await b.cacheDabord(requete(police), null);
    expect(r.corps).toBe('police');
    expect(b.reseau).toEqual([]);
  });

  it('le précache garde les quatre pages et les quatre logos', () => {
    const src = sourceSw();
    for (const chemin of [
      './index.html',
      './ecran.html',
      './grille.html',
      './supervision.html',
      './logos/logo-rond.svg',
      './logos/logo-rond-blanc.svg',
    ]) {
      expect(src, chemin).toContain(`'${chemin}'`);
    }
  });

  it('réseau d’abord : hors ligne, le cache prend le relais', async () => {
    const b = await banc({
      urlDuScript: 'https://rdtmb.github.io/sw.js?v=test',
      reseau: () => new Error('réseau coupé'),
    });
    const page = 'https://rdtmb.github.io/ecran.html';
    b.cache.entrees.set(page, reponse({ corps: 'page en cache' }));
    const r = await b.reseauDabord(requete(page));
    expect(r.corps).toBe('page en cache');
  });

  it('les sondes de synchronisation ne sont jamais interceptées', () => {
    // Ce sont elles qui détectent la coupure : les servir depuis le cache
    // ferait croire le réseau présent.
    expect(sourceSw()).toContain("if (requete.cache === 'no-store') return;");
  });
});
