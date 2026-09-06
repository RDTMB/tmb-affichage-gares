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

// ---------------------------------------------------------------------------
// Canevas 1b — barre de navigation à deux groupes.
//
// Verrouillage du CÂBLAGE : supervision.ts n'est pas importable ici (elle
// accède au DOM dès le chargement), on teste donc son TEXTE, comme le fait
// déjà ce fichier pour les pages d'affichage.
// ---------------------------------------------------------------------------

describe('supervision — la barre à deux groupes reste câblée', () => {
  const html = source('supervision.html');
  const code = codeSeul('src/pages/supervision.ts');
  const css = source('src/styles/supervision.css');

  it('les deux groupes existent, séparés par un écart ÉLASTIQUE', () => {
    // `flex: 1` et non une largeur : à deux onglets visibles comme à huit, la
    // barre reste ancrée à gauche et le groupe droit collé à droite.
    expect(html).toContain('id="groupe-exploitation"');
    expect(html).toContain('id="groupe-administration"');
    expect(html).toContain('class="ecart-onglets"');
    expect(css).toMatch(/\.ecart-onglets\s*\{[^}]*flex:\s*1/);
  });

  it('un groupe VIDE n’est pas rendu — intitulé et filet compris', () => {
    // Sans cela, « Administration » suivi de rien flotterait à droite d'une
    // barre de quatre onglets.
    expect(code).toMatch(/groupesNavigation\(/);
    expect(code).toMatch(/montreSi\('groupe-exploitation'/);
    expect(code).toMatch(/montreSi\('groupe-administration'/);
  });

  it('le seul groupe restant s’ancre à GAUCHE', () => {
    // Constaté à l'écran en réglant un rôle sur « Journal » seul : le groupe
    // partait à droite d'une barre vide, avec un intitulé qui ne distinguait
    // plus rien.
    expect(code).toContain('sans-exploitation');
    expect(css).toMatch(/nav\.tabs\.sans-exploitation \.ecart-onglets\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/nav\.tabs\.sans-exploitation \.intitule-groupe\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(
      /nav\.tabs\.sans-exploitation \.groupe-administration\s*\{[^}]*border-left:\s*0/,
    );
  });

  it('UNE SEULE RANGÉE : aucun retour à la ligne dans la barre', () => {
    // Toute la différence avec la proposition écartée (deux rangs) : aucune
    // profondeur ajoutée, tout reste à un clic.
    expect(css).not.toMatch(/nav\.tabs\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/nav\.tabs\s*\{[^}]*display:\s*flex/);
  });

  it('l’administration se distingue par le POIDS, pas par la couleur d’alerte', () => {
    // Plus petits, sans soulignement rouge : le rouge reste le signal de
    // l'exploitation.
    expect(css).toMatch(/\.groupe-administration button\s*\{[^}]*font-size:\s*13\.5px/);
    expect(css).toMatch(
      /\.groupe-administration button\.on\s*\{[^}]*border-bottom-color:\s*transparent/,
    );
  });

  it('les huit onglets sont TOUS répartis, aucun oublié en chemin', () => {
    const groupes = html.slice(html.indexOf('id="groupe-exploitation"'), html.indexOf('</nav>'));
    for (const onglet of [
      'circulations',
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'parametres',
      'utilisateurs',
      'journal',
    ]) {
      expect(groupes, `${onglet} absent de la barre`).toContain(`data-t="${onglet}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Canevas 1d — barre Publier, trois états.
// ---------------------------------------------------------------------------

describe('supervision — la barre Publier porte ses trois signaux', () => {
  const html = source('supervision.html');
  const code = codeSeul('src/pages/supervision.ts');
  const css = source('src/styles/supervision.css');

  it('l’état est porté par UNE classe, pas par trois réglages à tenir d’accord', () => {
    expect(code).toMatch(/barrePublication\(/);
    expect(code).toMatch(/pub-\$\{vue\.etat\}/);
    for (const classe of ['pub-publie', 'pub-en-cours', 'pub-echec']) {
      expect(css, `${classe} absente de la feuille`).toContain(`.publier.${classe}`);
    }
  });

  it('TROIS SIGNAUX REDONDANTS : liseré, hauteur, contenu de pastille', () => {
    // Valeurs RELEVÉES DANS LE SOURCE du canevas, pas lues sur une capture :
    // liseré de 4 px, `--bleu` (#2E74B5) en travail, `--alerte` (#C1281E) à
    // l'échec. La première transposition disait 3 px et #2B7AB5.
    expect(css).toMatch(/\.publier\.pub-en-cours\s*\{[^}]*border-top:\s*4px solid var\(--bleu\)/);
    expect(css).toMatch(/\.publier\.pub-echec\s*\{[^}]*border-top:\s*4px solid var\(--alerte\)/);
    // L'échec est le seul plus haut : padding-bottom augmenté.
    expect(css).toMatch(/\.publier\.pub-echec\s*\{[^}]*padding-bottom/);
    // Trois pastilles distinctes : ✓ vert au repos (le seul vert de la
    // barre), compte bleu en travail, « ! » rouge à l'échec.
    expect(css).toMatch(/\.pub-publie \.pastille-pub\s*\{[^}]*background:\s*var\(--ok-bg\)/);
    expect(css).toMatch(/\.pastille-pub\s*\{[^}]*background:\s*var\(--bleu\)/);
    expect(css).toMatch(/\.pub-echec \.pastille-pub\s*\{[^}]*background:\s*var\(--alerte\)/);
  });

  it('l’onglet d’administration actif prend le bleu du canevas', () => {
    // #EAF2FA, que le projet possédait déjà sous `--bleu-bg`. J'avais lu
    // #EAF2F6 sur une capture — deux caractères de trop.
    expect(css).toMatch(
      /\.groupe-administration button\.on\s*\{[^}]*background:\s*var\(--bleu-bg\)/,
    );
    expect(css).not.toContain('#eaf2f6');
  });

  it('la couleur n’est JAMAIS dans le fond entier de la barre', () => {
    // Une barre rouge en permanence cesse d'alerter au bout d'une heure.
    for (const etat of ['pub-en-cours', 'pub-echec']) {
      const bloc = css.match(new RegExp(`\.publier\.${etat}\s*\{[^}]*\}`))?.[0] ?? '';
      expect(bloc, `${etat} teinte le fond`).not.toMatch(/[^-]background:/);
    }
  });

  it('la phrase périmée ne peut pas revenir', () => {
    // « Les modifications s'appliquent immédiatement » était faux depuis
    // l'introduction du brouillon : c'est la ligne qui mentait, pas le code.
    expect(html).not.toMatch(/s.appliquent imm[ée]diatement/i);
    expect(code).not.toMatch(/s.appliquent imm[ée]diatement/i);
  });

  it('la cause d’un échec reste affichée jusqu’à la publication suivante', () => {
    // Contrainte métier : un diagnostic qui s'efface avant d'être lu ne sert
    // à personne. Le compteur d'échec n'est remis à zéro qu'en même temps que
    // le bandeau, et par rien d'autre.
    expect(html).toContain('id="echec-publication"');
    // Une seule REMISE À ZÉRO dans tout le fichier — la déclaration
    // `let echecsEnAttente = 0` n'en est pas une, d'où la négation.
    const remises = code.match(/(?<!let )echecsEnAttente = 0/g) ?? [];
    expect(remises).toHaveLength(1);
    const fonction = code.match(/function afficheEchecPublication[\s\S]*?\n}/)?.[0] ?? '';
    expect(fonction).toContain('echecsEnAttente = 0');
    expect(fonction).toContain('echecPublicationISO = null');
  });

  it('l’échec est armé par le COMPTE réel des modifications restées en attente', () => {
    expect(code).toMatch(/echecsEnAttente = echecs\.length/);
    expect(code).toMatch(/echecPublicationISO = new Date\(\)\.toISOString\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Canevas 1e / 1g — en-tête : badges de rôle et pastilles de sécurité.
// ---------------------------------------------------------------------------

describe('supervision — l’en-tête ne comprime ni ne tronque jamais', () => {
  const html = source('supervision.html');
  const css = source('src/styles/supervision.css');

  it('l’en-tête SE REPLIE plutôt que d’écraser son contenu', () => {
    // Mesuré à 1280 px avant correction : « TECHNIQUE » et « ADMIN » se
    // chevauchaient, « SUPERVISION » passait sous le bouton « Quitter ».
    // Un badge de rôle illisible est pire qu'un badge absent : on croit lire
    // le sien.
    expect(css).toMatch(/^header \{[^}]*flex-wrap:\s*wrap/m);
  });

  it('les pastilles et l’identité NE SE COMPRIMENT PAS', () => {
    // Ce sont elles qui disent qui on est et sur quelle base on travaille.
    // C'est le titre qui cède la place — lui se relit.
    expect(css).toMatch(/header \.pill,\s*\nheader \.user \{[^}]*flex:\s*none/);
  });

  it('les pastilles de SÉCURITÉ précèdent celles d’information', () => {
    // C'est cet ordre — et non un seuil en pixels — qui garantit qu'elles
    // sont les dernières à descendre d'un rang.
    const base = html.indexOf('id="pill-base"');
    const simule = html.indexOf('id="pill-simule"');
    const ecrans = html.indexOf('id="pill-ecrans"');
    const service = html.indexOf('id="pill-service"');
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(simule);
    expect(simule).toBeLessThan(ecrans);
    expect(ecrans).toBeLessThan(service);
  });

  it('AUCUN seuil en pixels ne décide du repli de l’en-tête', () => {
    // Un `@media` à seuil fixe repliait aussi un compte de caisse en
    // démonstration — un badge, aucune pastille de sécurité — qui tient
    // pourtant largement, et lui coûtait un rang pour rien.
    expect(css).not.toContain('.saut-entete');
    expect(html).not.toContain('saut-entete');
  });

  it('l’identité reste à DROITE, sur quelque rang qu’elle tombe', () => {
    expect(css).toMatch(/header \.user \{[^}]*margin-left:\s*auto/);
  });

  it('dans l’en-tête, les badges tiennent sur UNE ligne', () => {
    // Le conteneur portait `.role-tag`, donc sa largeur fixe de 108 px : trois
    // rôles cumulés s'empilaient verticalement et l'en-tête passait de 92 à
    // 157 px de haut. La largeur fixe sert à aligner les LIGNES utilisateur,
    // pas une identité unique.
    expect(html).toContain('class="badges-entete" id="user-role"');
    expect(html).not.toMatch(/class="role-tag" id="user-role"/);
    expect(css).toMatch(/\.badges-entete \{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.badges-entete \.role-tag \{[^}]*width:\s*auto/);
  });

  it('…mais les lignes utilisateur GARDENT leur largeur fixe', () => {
    // Sans elle, les commandes des lignes se décalaient les unes par rapport
    // aux autres selon la longueur du rôle affiché.
    expect(css).toMatch(/^\.role-tag \{[^}]*width:\s*108px/m);
  });

  it('les deux pastilles de sécurité restent DISTINCTES de l’état courant', () => {
    // Elles doivent se voir : on ne doit jamais croire tester alors qu'on
    // publie en gare, ni prendre un poste à l'heure simulée pour un poste
    // normal.
    expect(css).toContain('.pill.base-prod');
    expect(css).toContain('.pill.base-test');
    expect(css).toContain('.pill.simule');
  });
});

// ---------------------------------------------------------------------------
// Canevas 1f — vue caisse.
//
// Rien à recoder ici : le comportement voulu découle déjà de la structure.
// Ces tests le VERROUILLENT, pour qu'une session future ne réintroduise pas
// une variante de barre « allégée » par rôle.
// ---------------------------------------------------------------------------

describe('supervision — la vue caisse n’est pas un cas particulier', () => {
  const code = codeSeul('src/pages/supervision.ts');

  it('la caisse PUBLIE : aucune variante de barre par rôle', () => {
    // La barre de publication est la barre de TRAVAIL de l'agent de caisse —
    // un message de bandeau qu'elle saisit sans le publier n'atteint aucun
    // écran. Elle est donc affichée sans condition de rôle.
    expect(code).toMatch(/\$\('barre-publier'\)\.style\.display = '';/);
    // Aucun droit ne la conditionne, ni ne la remplace par une variante.
    expect(code).not.toMatch(/peut\('publier'\)/);
    expect(code).not.toMatch(/barre-publier[^\n]*peut\(/);
    // …et un seul bouton « Publier » existe dans toute la page.
    expect((code.match(/\$\('btn-publier'\)/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('l’onglet d’arrivée est le PREMIER onglet visible, quel que soit le rôle', () => {
    // C'est ce qui fait arriver la caisse sur Bandeau une fois Horaires
    // masqué — par construction, et non par une liste en dur qu'il faudrait
    // corriger au prochain changement de configuration.
    expect(code).toMatch(/visibles\[0\]/);
    expect(code).not.toMatch(/=== 'caisse'/);
    expect(code).not.toMatch(/roles\.includes\('caisse'\)/);
  });

  it('aucune liste d’onglets n’est codée en dur pour un rôle', () => {
    // Les vues par profil sont des CONFIGURATIONS PAR DÉFAUT, pas des
    // vérités : l'exploitant peut les changer sans livraison.
    expect(code).toMatch(/ongletsVisibles\(roles, visibiliteOnglets\)/);
  });
});
