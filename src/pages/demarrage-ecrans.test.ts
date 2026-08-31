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
