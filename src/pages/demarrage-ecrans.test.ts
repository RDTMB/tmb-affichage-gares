// C-02 — Verrouillage du CÂBLAGE des pages d'affichage.
//
// `ecran.ts` et `grille.ts` ne sont pas importables dans Vitest : elles
// accèdent au DOM dès le chargement du module (`$('logo')`, `document.body`)
// et s'auto-démarrent (`void demarre()`), et la suite tourne en environnement
// Node sans jsdom. On verrouille donc leur TEXTE, comme le fait déjà
// src/pages/ecran-colonnes.test.ts pour les colonnes de l'écran.
//
// Ce que ces tests protègent : le fait qu'aucune de ces deux pages ne puisse
// retomber silencieusement sur les données de démonstration, et que la branche
// « aucune source » affiche bien l'écran neutre au lieu de figer la page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8');
}

/** Code seul : un commentaire mentionnant `creeProvider` fausserait les tests. */
function codeSeul(chemin: string): string {
  return source(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
  describe(`${page} — aucune source de données implicite`, () => {
    const code = codeSeul(page);

    it('décide sa source par modeDonnees(), et non par le repli de creeProvider()', () => {
      expect(code).toContain('modeDonnees(');
      expect(code).toContain('estModeDemo(');
      // `creeProvider()` est celui qui retombe silencieusement sur le mock :
      // les pages d'affichage ne doivent JAMAIS l'appeler.
      expect(code).not.toMatch(/\bcreeProvider\s*\(/);
    });

    it('n’instancie un fournisseur de démonstration que sur le mode « demo »', () => {
      expect(code).toContain('creeProviderDemo(');
      expect(code).toContain("mode === 'demo'");
    });

    it('sans source, affiche l’écran neutre et SORT avant tout fournisseur', () => {
      const garde = code.indexOf("mode === 'aucune'");
      expect(garde).toBeGreaterThan(-1);
      expect(code).toContain('afficheNeutrePermanent()');
      // La garde précède la création du fournisseur réel.
      expect(garde).toBeLessThan(code.indexOf('creeProviderReel('));
    });

    it('l’écran neutre reste VIVANT : horloge entretenue et réessai périodique', () => {
      // Sans cela on échangerait une faute d'intégrité contre une panne : un
      // échec transitoire de config.js figerait l'écran jusqu'à un
      // déplacement en gare.
      const bloc = code.slice(code.indexOf('function afficheNeutrePermanent'));
      expect(bloc).toContain('mode-neutre');
      expect(bloc).toMatch(/setInterval\(/);
      expect(bloc).toMatch(/location\.reload\(\)/);
    });

    it('assainit aussi l’instantané relu depuis localStorage', () => {
      // Troisième entrée des paramètres, la seule qui ne passe pas par
      // getParams() — et celle du démarrage sans réseau.
      expect(code).toContain('paramsValides(');
    });
  });
}

for (const [page, css] of [
  ['ecran.html', 'src/styles/ecran.css'],
  ['grille.html', 'src/styles/grille.css'],
] as const) {
  describe(`${page} — bandeau de démonstration visible`, () => {
    it('porte le bandeau bilingue « horaires fictifs »', () => {
      const html = source(page);
      expect(html).toContain('id="bandeau-demo"');
      expect(html).toContain('horaires fictifs');
      expect(html).toContain('fictitious timetable');
    });

    it('le bandeau ne s’affiche QUE en mode démonstration', () => {
      const feuille = source(css);
      expect(feuille).toContain('.bandeau-demo');
      expect(feuille).toContain('body.mode-demo .bandeau-demo');
    });

    it('aucun padding sur `body` : l’anti-burn-in re-ancrerait les calques fixes', () => {
      // demarreAntiBurnIn() applique un `transform` à `body` ; un ancêtre
      // transformé devient le bloc conteneur des descendants `position: fixed`,
      // et l'écran neutre glisserait au bout d'une heure.
      const feuille = source(css);
      expect(feuille).not.toMatch(/body\.mode-demo\s*\{[^}]*padding/);
      expect(feuille).toContain('body.mode-demo header');
    });
  });
}

describe('portail de test — les liens demandent la démonstration explicitement', () => {
  it('index.ts ouvre les écrans avec demo=1', () => {
    const code = codeSeul('src/pages/index.ts');
    expect(code).toMatch(/ecran\.html\?gare=\$\{id\}&demo=1/);
    expect(code).toMatch(/grille\.html\?gare=\$\{id\}&demo=1/);
  });
});

describe('deploy.yml — un déploiement mal configuré doit ÉCHOUER', () => {
  const yml = source('.github/workflows/deploy.yml');

  it('ne déploie plus en mode démonstration quand les variables manquent', () => {
    expect(yml).not.toMatch(/mode mock/i);
    expect(yml).not.toMatch(/déploiement en mode/i);
  });

  it('sort en erreur et nomme les deux variables attendues', () => {
    expect(yml).toContain('exit 1');
    expect(yml).toContain('VITE_SUPABASE_URL');
    expect(yml).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });
});

// ---------------------------------------------------------------------------
// C-04 — la PREMIÈRE synchronisation ne peut plus figer la page.
// ---------------------------------------------------------------------------

for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
  describe(`${page} — un démarrage lent n’affiche jamais un tableau vide`, () => {
    const code = codeSeul(page);

    it('la première synchronisation est BORNÉE dans le temps', () => {
      // Sans borne, une requête qui ne rend jamais la main laisse la page sur
      // sa coquille HTML : un tableau VIDE, qui se lit en gare comme « plus
      // aucun train aujourd'hui » — pire qu'un écran neutre assumé.
      expect(code).toContain('DELAI_PREMIERE_SYNCHRO_MS');
      expect(code).toMatch(/avecDelai\(\s*sync\.demarre\(\)/);
    });

    it('un démarrage qui ÉCHOUE bascule sur un écran d’erreur, pas sur la coquille', () => {
      expect(code).toMatch(/void demarre\(\)\.catch\(/);
    });

    it('l’horloge tourne AVANT la première synchronisation', () => {
      // La boucle de rendu n'est armée qu'après la synchro : sans cette
      // horloge de secours, l'heure affichée restait celle du chargement,
      // figée pendant tout le temps du réseau.
      const corps = code.slice(code.indexOf('async function demarre'));
      const horloge = corps.indexOf('horlogeSecours');
      const attente = corps.indexOf('await ');
      expect(horloge).toBeGreaterThan(-1);
      expect(attente).toBeGreaterThan(-1);
      expect(horloge).toBeLessThan(attente);
    });

    it('…et elle est ARRÊTÉE sur les deux sorties (18 h d’affichage par jour)', () => {
      // Deux horloges concurrentes sur le même élément, c'est une fuite et un
      // scintillement ; l'écran neutre a déjà la sienne.
      const arrets = code.match(/clearInterval\(horlogeSecours\)/g) ?? [];
      expect(arrets.length).toBeGreaterThanOrEqual(2);
    });

    it('ne lit plus ?cache= à la main : la durée passe par une fonction bornée', () => {
      // La lecture directe acceptait 0 (écran neutre immédiat, en pleine
      // journée) comme 99999 (horaires de la veille indéfiniment).
      expect(code).toContain('dureeCacheMinutes(');
      expect(code).not.toMatch(/Number\(url\.get\('cache'\)\)/);
    });
  });
}

// ---------------------------------------------------------------------------
// C-05 — l'heure simulée doit se VOIR.
// ---------------------------------------------------------------------------

for (const [page, ts, css] of [
  ['ecran.html', 'src/pages/ecran.ts', 'src/styles/ecran.css'],
  ['grille.html', 'src/pages/grille.ts', 'src/styles/grille.css'],
] as const) {
  describe(`${page} — un affichage en heure simulée s’annonce`, () => {
    it('porte le bandeau bilingue « heure simulée »', () => {
      const html = source(page);
      expect(html).toContain('id="bandeau-simule"');
      expect(html).toContain('Heure simulée');
      expect(html).toContain('Simulated time');
    });

    it('le bandeau ne s’affiche QUE sous ?simule=', () => {
      // Un écran de gare qui afficherait une heure fictive sans le dire est le
      // scénario le plus coûteux du lot : les voyageurs y croient.
      const code = codeSeul(ts);
      expect(code).toMatch(/heure\.simulee[\s\S]{0,80}mode-simule/);
      const feuille = source(css);
      expect(feuille).toContain('body.mode-simule .bandeau-simule');
    });

    it('la classe est posée AVANT le premier await : rien ne la retarde', () => {
      const code = codeSeul(ts);
      expect(code.indexOf('mode-simule')).toBeLessThan(code.indexOf('await '));
    });

    it('démonstration ET simulation cohabitent sans se recouvrir', () => {
      // Les deux bandeaux sont fixes en haut : sans empilement explicite, l'un
      // masque l'autre et l'écran ment par omission.
      const feuille = source(css);
      expect(feuille).toContain('body.mode-simule.mode-demo');
    });

    it('aucun padding sur `body` : l’anti-burn-in re-ancrerait les calques fixes', () => {
      // demarreAntiBurnIn() applique un `transform` à `body` ; un ancêtre
      // transformé devient le bloc conteneur de ses descendants `position:
      // fixed`. La place du bandeau se prend donc sur `header`, pas sur `body`.
      const feuille = source(css);
      expect(feuille).not.toMatch(/body\.mode-simule(\.mode-demo)?\s*\{[^}]*padding/);
      expect(feuille).toContain('body.mode-simule header');
    });
  });
}

// ---------------------------------------------------------------------------
// C-01, second verrou — Content-Security-Policy sur les QUATRE pages.
// ---------------------------------------------------------------------------

describe('Content-Security-Policy — aucune page ne doit la perdre', () => {
  const PAGES = ['index.html', 'ecran.html', 'grille.html', 'supervision.html'] as const;

  /** Contenu de la balise <meta http-equiv="Content-Security-Policy">. */
  function politique(page: string): string {
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
      source(page),
    );
    expect(meta, `${page} n’a plus de balise CSP`).not.toBeNull();
    return (meta?.[1] ?? '').replace(/\s+/g, ' ').trim();
  }

  for (const page of PAGES) {
    describe(page, () => {
      it('porte une balise CSP', () => {
        expect(politique(page)).not.toBe('');
      });

      it('interdit le script INJECTÉ (ni unsafe-inline ni unsafe-eval)', () => {
        // C'est tout l'objet du verrou : l'échappement reste la première
        // défense, la CSP rattrape une injection passée par un autre chemin.
        const script = /script-src([^;]*)/.exec(politique(page))?.[1] ?? '';
        expect(script).toContain("'self'");
        expect(script).not.toContain('unsafe-inline');
        expect(script).not.toContain('unsafe-eval');
      });

      it('ferme les portes latérales (objets, base, formulaires)', () => {
        const csp = politique(page);
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'none'");
        expect(csp).toContain("form-action 'none'");
      });

      it('autorise ce dont le code a RÉELLEMENT besoin', () => {
        const csp = politique(page);
        // Logos inlinés en data: URI au build (vite.config.ts, logoDataUri).
        expect(csp).toMatch(/img-src[^;]*data:/);
        // Médias du stockage Supabase, rendus en <img> ET en <video>.
        expect(csp).toMatch(/img-src[^;]*supabase\.co/);
        expect(csp).toMatch(/media-src[^;]*supabase\.co/);
        // REST + fonctions edge en https, canal temps réel en wss.
        expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.supabase\.co/);
        expect(csp).toMatch(/connect-src[^;]*wss:\/\/\*\.supabase\.co/);
        // Polices auto-hébergées (@fontsource) : jamais de CDN. Vite émet les
        // .woff2 en fichiers mais INLINE les .woff de repli en data: URI —
        // sans `data:`, quatre erreurs CSP par page et une typographie cassée
        // sur tout navigateur sans woff2. Relevé au navigateur, pas supposé.
        expect(csp).toMatch(/font-src 'self' data:/);
        expect(csp).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
      });

      it('vise le DOMAINE Supabase, pas une référence de projet figée', () => {
        // Production et base de test n'ont pas la même référence, et config.js
        // est généré au build : une référence en dur casserait l'autre base.
        const csp = politique(page);
        expect(csp).toContain('*.supabase.co');
        expect(csp).not.toMatch(/[a-z]{20}\.supabase\.co/);
      });
    });
  }

  it('les quatre pages portent la MÊME politique', () => {
    const [reference, ...autres] = PAGES.map(politique);
    for (const p of autres) expect(p).toBe(reference);
  });
});
