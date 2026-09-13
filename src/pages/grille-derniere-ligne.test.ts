// Grille du jour — la dernière ligne ne doit plus être coupée (13/09/2026).
//
// LE DÉFAUT, relevé par l'exploitant et mesuré au navigateur le même jour : la
// dernière ligne de chaque tableau — « Nid d'Aigle » en montée, « Le Fayet » en
// descente, donc la gare d'ARRIVÉE — était coupée dans sa hauteur. Ni ellipse,
// ni barre de défilement, ni le moindre signe : un débordement vertical avalé
// par `overflow: hidden`.
//
// L'information perdue est le TERMINUS, c'est-à-dire ce qui dit au voyageur si
// ce train va là où il veut aller. Même famille que le message important
// tronqué du 12/09 : un affichage qui a l'air de fonctionner et qui ment par
// omission.
//
// CE QUE CES TESTS TIENNENT. Le dépôt n'a pas de jsdom : on ne peut pas
// mesurer un rendu ici. On verrouille donc la CONTREPARTIE — sans elle, la
// coupe revient — et la correspondance paysage / portrait, exactement comme
// responsive-grille.test.ts. La vérification qui compte reste au navigateur,
// et ses chiffres sont écrits dans la feuille, à côté des valeurs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/** Feuille BRUTE : les commentaires portent les mesures, on en a besoin. */
const brut = source('src/styles/grille.css');
/** Feuille sans commentaires : un exemple cité en commentaire fausserait les règles. */
const css = brut.replace(/\/\*[\s\S]*?\*\//g, '');

/** Sépare les règles hors `@media` du bloc portrait (accolades appariées). */
function decoupe(feuille: string): { horsMedia: string; portrait: string } {
  let horsMedia = '';
  let portrait = '';
  let i = 0;
  while (i < feuille.length) {
    const debut = feuille.indexOf('@media', i);
    if (debut === -1) {
      horsMedia += feuille.slice(i);
      break;
    }
    horsMedia += feuille.slice(i, debut);
    const ouvre = feuille.indexOf('{', debut);
    let profondeur = 1;
    let j = ouvre + 1;
    while (j < feuille.length && profondeur > 0) {
      if (feuille[j] === '{') profondeur++;
      else if (feuille[j] === '}') profondeur--;
      j++;
    }
    const requete = feuille.slice(debut + '@media'.length, ouvre).trim();
    if (requete === '(orientation: portrait)') portrait = feuille.slice(ouvre + 1, j - 1);
    i = j;
  }
  return { horsMedia, portrait };
}

const { horsMedia, portrait } = decoupe(css);

/** Déclarations d'un sélecteur donné, dans un fragment sans `@media`. */
function bloc(fragment: string, selecteur: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let trouve: string | null = null;
  while ((m = re.exec(fragment)) !== null) {
    const selecteurs = (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (selecteurs.includes(selecteur)) trouve = m[2] ?? '';
  }
  expect(trouve, `sélecteur « ${selecteur} » introuvable`).not.toBeNull();
  return trouve ?? '';
}

function valeur(declarations: string, propriete: string): string | null {
  const m = new RegExp(`(?:^|;|\\s)${propriete.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`).exec(
    declarations,
  );
  return m ? (m[1] ?? '').trim() : null;
}

// ---------------------------------------------------------------------------
// 1 — La coupe silencieuse ne peut pas revenir sans qu'on s'en aperçoive
// ---------------------------------------------------------------------------

/**
 * Les interlignes du tableau. Ce sont EUX la contrepartie de
 * `overflow: hidden` : `line-height: normal` vaut environ 1,2, soit du BLANC
 * au-dessus et au-dessous de chaque ligne — pas du texte. Les resserrer
 * abaisse la hauteur minimale du contenu sans toucher à la taille d'un seul
 * caractère.
 */
const INTERLIGNES: ReadonlyArray<readonly [string, number]> = [
  ['thead th', 1.05],
  ['thead th .num', 1.1],
  ['thead th .picto', 1.15],
  ['tbody th', 1.05],
  ['tbody th small', 1],
  ['thead th.retard .badge', 1.1],
];

describe('la dernière ligne n’est plus coupée — et ne peut pas se remettre à l’être', () => {
  it('`.tabwrap` garde `overflow: hidden`, mais n’a plus rien à couper', () => {
    // On NE remplace PAS `hidden` par un défilement : un kiosque n'a pas de
    // souris, et laisser déborder ferait passer le tableau sous la légende.
    // Le tableau doit TENIR — d'où les interlignes ci-dessous.
    expect(valeur(bloc(horsMedia, '.tabwrap'), 'overflow')).toBe('hidden');
  });

  it('chaque interligne du tableau est RESSERRÉ, et aucun n’est revenu à `normal`', () => {
    // C'est la contrepartie. La retirer — même partiellement — fait revenir la
    // coupe : mesuré, la montée manquait de 13 px en service nominal et de
    // 51 px avec le bandeau « horloge décalée » (1920×1080, même chargement).
    for (const [selecteur, plafond] of INTERLIGNES) {
      const lh = valeur(bloc(horsMedia, selecteur), 'line-height');
      expect(lh, `${selecteur} a perdu son interligne resserré`).not.toBeNull();
      expect(lh, `${selecteur} : interligne revenu à « normal »`).not.toBe('normal');
      expect(
        Number(lh),
        `${selecteur} : interligne au-dessus du plafond mesuré`,
      ).toBeLessThanOrEqual(plafond);
    }
  });

  it('le badge d’aléa partage l’interligne : c’est LUI qui coupait le plus', () => {
    // `thead th.retard .badge` et `thead th.supp .badge` sont écrits ensemble.
    // Un retard ou une suppression annoncés ajoutent une LIGNE à l'en-tête :
    // c'est l'aléa d'exploitation qui faisait disparaître le terminus, au
    // moment précis où le voyageur avait le plus besoin de le lire.
    const regle = /thead th\.retard \.badge,\s*\n?\s*thead th\.supp \.badge\s*\{([^}]*)\}/.exec(
      css,
    );
    expect(regle, 'la règle des deux badges a été séparée').not.toBeNull();
    expect(valeur(regle?.[1] ?? '', 'line-height')).toBe('1.1');
  });

  it('la mesure est écrite À CÔTÉ des valeurs, pas seulement dans une PR', () => {
    // Règle du lot : aucune valeur en dur qui ne se relise pas. Les trois
    // nombres qui justifient le correctif doivent rester dans la feuille.
    const commentaire = brut.slice(
      brut.indexOf('LA COUPE SILENCIEUSE'),
      brut.indexOf('.tabwrap {'),
    );
    expect(commentaire).toContain('1920×1080');
    expect(commentaire).toContain('place offerte');
    // …et le renvoi vers CE fichier : sans lui, celui qui desserrera un
    // interligne verra un test rougir sans savoir lequel, ni pourquoi.
    // (Survivante de la campagne de mutation : le renvoi pouvait disparaître
    // sans que rien ne tombe.)
    expect(commentaire, 'le renvoi vers le test a disparu').toContain(
      'src/pages/grille-derniere-ligne.test.ts',
    );
    for (const nombre of ['355', '372', '359', '315', '336', '297']) {
      expect(commentaire, `la mesure ${nombre} px a disparu`).toContain(nombre);
    }
  });
});

// ---------------------------------------------------------------------------
// 2 — La dernière ligne n'est pas un cas particulier
// ---------------------------------------------------------------------------

describe('le correctif porte sur le TABLEAU, jamais sur « la ligne du terminus »', () => {
  it('aucune règle ne vise la dernière ligne ni la gare d’arrivée', () => {
    // Elle était coupée parce qu'elle est la DERNIÈRE, pas parce qu'elle est
    // le terminus. Traiter « la ligne du terminus » à part masquerait le vrai
    // défaut et laisserait la suivante se faire couper le jour où la grille
    // gagnera une gare — le Mont Lachat est une halte de service, elle
    // pourrait un jour s'afficher.
    expect(css).not.toMatch(/tbody tr:last-child/);
    expect(css).not.toMatch(/tbody tr:nth-last-child/);
    expect(css).not.toMatch(/nid-daigle|le-fayet/);
  });

  it('le correctif ne dépend d’aucun NOMBRE de gares', () => {
    // Une valeur calculée pour six lignes serait fausse à cinq (section
    // restreinte) comme à sept.
    expect(css).not.toMatch(/nth-child\(\s*[67]\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// 3 — La correspondance paysage / portrait reste vraie
// ---------------------------------------------------------------------------

describe('paysage et portrait gardent les mêmes coefficients', () => {
  it('les interlignes sont SANS UNITÉ : rien à transcrire en portrait', () => {
    // Un `line-height` sans unité se multiplie par la taille de police, qui a
    // déjà son pendant en --u. Le poser en vh obligerait à le transcrire — et
    // le premier oubli rendrait le totem illisible.
    for (const [selecteur] of INTERLIGNES) {
      const lh = valeur(bloc(horsMedia, selecteur), 'line-height');
      expect(lh, `${selecteur} : interligne exprimé en unité`).toMatch(/^[\d.]+$/);
    }
    expect(portrait, 'un interligne a été transcrit en portrait, sans raison').not.toMatch(
      /line-height:\s*calc/,
    );
  });

  it('les espacements que ce lot resserre ont leur pendant portrait, AU MÊME COEFFICIENT', () => {
    // `main` et `.sens h2` sont réglés dans les DEUX blocs : resserrer le
    // paysage sans le portrait laisserait le totem à l'ancienne valeur —
    // invisible en 16:9, et personne ne le verrait avant la mise en service.
    const attendus: ReadonlyArray<readonly [string, string, string, string]> = [
      ['main', 'padding', '0.5vh 1.2vw', 'calc(0.5 * var(--u)) 1.2vw'],
      ['main', 'gap', '0.5vh', 'calc(0.5 * var(--u))'],
      [
        '.sens h2',
        'padding',
        '0.1vh 0.2vw 0.25vh',
        'calc(0.1 * var(--u)) 0.2vw calc(0.25 * var(--u))',
      ],
    ];
    for (const [selecteur, propriete, paysage, pendant] of attendus) {
      expect(valeur(bloc(horsMedia, selecteur), propriete), `${selecteur} ${propriete}`).toBe(
        paysage,
      );
      expect(
        valeur(bloc(portrait, selecteur), propriete),
        `${selecteur} ${propriete} (portrait)`,
      ).toBe(pendant);
    }
  });

  it('la légende rend la réserve qu’elle n’utilisait pas', () => {
    // 3,8 vh réservés pour 2,6 vh de contenu mesuré à 1080 p. En portrait
    // elle se replie déjà (`flex-basis: auto`) : rien à transcrire.
    expect(valeur(bloc(horsMedia, '.legende'), 'flex')).toBe('0 0 3.2vh');
    expect(valeur(bloc(portrait, '.legende'), 'flex-basis')).toBe('auto');
  });
});
