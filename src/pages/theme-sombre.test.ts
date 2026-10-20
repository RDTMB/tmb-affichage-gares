// Thème sombre (20/10/2026) — ce que ces tests tiennent :
//
//  1. L'ÉCRAN DE GARE EN EST EXCLU. Il importe tokens.css comme les autres :
//     un navigateur kiosque réglé en sombre ne doit RIEN changer sur un quai.
//     D'où une palette `--sombre-*` qui ne s'applique à rien par elle-même, et
//     aucune requête média dans tokens.css ni dans ecran.css.
//  2. LES CONTRASTES SONT MESURÉS, PAS AFFIRMÉS. Le test relit les valeurs de
//     tokens.css et recalcule chaque ratio WCAG : une teinte retouchée qui
//     ferait passer un texte sous 4,5:1 fait tomber la suite.
//  3. On REMAPPE des alias, on ne duplique pas les règles : le bloc sombre de
//     l'embed ne déclare que des variables.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const source = (chemin: string): string =>
  readFileSync(join(RACINE, chemin), 'utf-8').replace(/\r\n/g, '\n');
const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TOKENS = sansCommentaires(source('src/styles/tokens.css'));

/** Valeur d'un jeton de tokens.css, `var(--x)` résolu. */
function jeton(nom: string): string {
  const m = new RegExp(`${nom}:\\s*([^;]+);`).exec(TOKENS);
  if (!m?.[1]) throw new Error(`jeton ${nom} absent de tokens.css`);
  const valeur = m[1].trim();
  const alias = /^var\((--[\w-]+)\)$/.exec(valeur);
  return alias?.[1] ? jeton(alias[1]) : valeur;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const canaux = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = canaux.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (clair + 0.05) / (fonce + 0.05);
}

/** Bloc `@media (prefers-color-scheme: dark) { … }` d'une feuille, accolades équilibrées. */
function blocSombre(css: string): string | null {
  const debut = css.indexOf('@media (prefers-color-scheme: dark)');
  if (debut < 0) return null;
  let profondeur = 0;
  for (let i = css.indexOf('{', debut); i < css.length; i++) {
    if (css[i] === '{') profondeur++;
    if (css[i] === '}' && --profondeur === 0) return css.slice(debut, i + 1);
  }
  return null;
}

describe('l’écran de gare est EXCLU du thème sombre', () => {
  it('ecran.css ne connaît ni la requête média, ni la palette sombre', () => {
    const ecran = source('src/styles/ecran.css');
    expect(ecran).not.toContain('prefers-color-scheme');
    expect(ecran).not.toContain('--sombre-');
  });

  it('tokens.css ne bascule RIEN : aucune requête média, la charte est définie une seule fois', () => {
    expect(TOKENS).not.toContain('@media');
    expect(TOKENS).not.toContain('prefers-color-scheme');
    for (const nom of ['--tmb-marine', '--tmb-rouge', '--tmb-creme', '--rame-marguerite']) {
      expect(TOKENS.split(`${nom}:`).length - 1, nom).toBe(1);
    }
  });

  it('la grille du jour et le portail, DÉJÀ sombres (maquette validée), n’ont rien à remapper', () => {
    // Le corps de la grille est marine (grille.css), celui du portail aussi
    // (base.css) : leur bandeau crème porte le logo HORIZONTAL, qui n'existe
    // pas en version claire (charte). Si l'un d'eux s'éclaircit un jour, ce
    // test rappelle qu'il faudra alors lui donner son bloc sombre.
    expect(source('src/styles/grille.css')).toMatch(/body \{\s*background: var\(--marine\);/);
    expect(source('src/styles/base.css')).toMatch(/body \{[^}]*background: var\(--tmb-marine\);/);
  });
});

describe('la palette sombre tient ses contrastes (WCAG, recalculés)', () => {
  const FONDS = ['--sombre-page', '--sombre-carte', '--sombre-doux'];
  const TEXTES = [
    '--sombre-texte',
    '--sombre-texte-sec',
    '--sombre-titre',
    '--sombre-ok',
    '--sombre-retard',
    '--sombre-alerte',
    '--sombre-bleu',
    '--sombre-accent',
  ];

  for (const fond of FONDS) {
    for (const texte of TEXTES) {
      it(`${texte} sur ${fond} ≥ 4,5:1`, () => {
        expect(contraste(jeton(texte), jeton(fond))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const etat of ['ok', 'retard', 'alerte', 'bleu']) {
    it(`--sombre-${etat} sur son propre fond d’état ≥ 4,5:1`, () => {
      expect(
        contraste(jeton(`--sombre-${etat}`), jeton(`--sombre-${etat}-bg`)),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('choix du thème : marine sur crème (choix retenu), blanc sur la pastille ≥ 4,5:1', () => {
    expect(contraste(jeton('--tmb-marine'), jeton('--tmb-creme'))).toBeGreaterThanOrEqual(4.5);
    expect(contraste('#ffffff', '#2c4a70')).toBeGreaterThanOrEqual(4.5);
    expect(contraste('#ffffff', '#3e608a')).toBeGreaterThanOrEqual(4.5); // survol
  });

  it('le texte posé sur l’accent ≥ 4,5:1', () => {
    expect(
      contraste(jeton('--sombre-sur-accent'), jeton('--sombre-accent')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('pastilles : Marie et Jeanne passent SOUS 3:1 sur la carte — d’où le liseré clair', () => {
    // Si une couleur de rame par défaut change, ce test dit s'il faut encore
    // le liseré ; il ne le retire jamais tout seul.
    const carte = jeton('--sombre-carte');
    expect(contraste(jeton('--rame-marie'), carte)).toBeLessThan(3);
    expect(contraste(jeton('--rame-jeanne'), carte)).toBeLessThan(3);
    expect(contraste(jeton('--rame-marguerite'), carte)).toBeGreaterThan(10);
    expect(jeton('--sombre-anneau')).toMatch(/^rgba\(233, 239, 245, 0\.\d+\)$/);
  });
});

// La Supervision n'a plus de bloc média depuis le choix du thème (même jour) :
// ses alias portent `light-dark(clair, sombre)` et `color-scheme` bascule —
// voir theme-supervision.test.ts. L'embed, lui, suit toujours l'appareil.
for (const feuille of ['embed']) {
  describe(`${feuille} : un bloc sombre qui REMAPPE, sans dupliquer de règle`, () => {
    const embed = sansCommentaires(source(`src/styles/${feuille}.css`));
    const bloc = blocSombre(embed);

    it('il existe, une seule fois', () => {
      expect(bloc).not.toBeNull();
      expect(embed.split('prefers-color-scheme').length - 1).toBe(1);
    });

    it('il ne contient que `:root` et des variables', () => {
      const interieur = (bloc ?? '')
        .replace(/^@media[^{]*\{/, '')
        .replace(/\}$/, '')
        .trim();
      expect(interieur.startsWith(':root {')).toBe(true);
      const corps = interieur.slice(':root {'.length, interieur.lastIndexOf('}'));
      for (const decl of corps
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)) {
        expect(decl, decl).toMatch(/^--[\w-]+:/);
      }
    });

    it('chaque alias remappé a une valeur claire dans :root — le mode clair ne change pas', () => {
      const racine = embed.slice(
        embed.indexOf(':root {'),
        embed.indexOf('}', embed.indexOf(':root {')),
      );
      for (const [, nom] of (bloc ?? '').matchAll(/(--[\w-]+):/g)) {
        expect(racine, `${nom} sans valeur claire`).toContain(`${nom}:`);
      }
    });

    it('les contrôles natifs suivent (`color-scheme`)', () => {
      expect(embed).toContain('color-scheme: light dark;');
    });
  });
}

describe('supervision : le logo des cartes de connexion suit le thème', () => {
  it('logo rond BLANC en sombre (le logo couleur a des traits noirs), suivi en direct', () => {
    // Le thème EFFECTIF (choix du poste, sinon appareil) arrive par
    // `surChangement`, appelé au montage, à chaque choix et à chaque bascule
    // de l'appareil — tenu par theme-supervision.test.ts.
    const ts = source('src/pages/supervision.ts');
    expect(ts).toContain("appareilSombre: window.matchMedia('(prefers-color-scheme: dark)')");
    expect(ts).toContain("theme === 'sombre' ? __LOGO_ROND_BLANC__ : __LOGO_ROND__");
    // Le logo couleur a bien des traits noirs : sans eux, la précaution
    // serait inutile.
    expect(source('public/logos/logo-rond.svg').toLowerCase()).toContain('#0a0b09');
  });
});
