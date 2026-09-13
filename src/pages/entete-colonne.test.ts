// L'en-tête de colonne de la grille du jour annonce un TRAIN, plus une heure.
//
// LE DÉFAUT, relevé par l'exploitant le 13/09/2026 juste après la correction de
// la colonne éclairée (PR #35) : l'en-tête portait encore l'heure d'ORIGINE. Sur
// l'écran de Saint-Gervais, la colonne mise en avant affichait
// « TRAIN 14 · 13:13 » pour un train qui part d'ici à 14:13. Le surlignage
// désignait le bon train ; son titre parlait depuis une autre gare.
//
// CE QUE CE LOT AJOUTE : « Privé » et le remplissage, que la grille ne lisait
// pas. Les règles et les MOTS sont ceux de l'écran de gare, partagés par
// `mentionCourse` / `LIBELLE_MENTION` — deux écrans qui diraient deux choses du
// même train est le défaut à éviter.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LIBELLE_MENTION, mentionCourse } from './affichage-commun';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const grille = source('src/pages/grille.ts');
const css = source('src/styles/grille.css');

/** Le bloc qui construit un `<th>` de colonne, en-tête comprise. */
function blocEntete(): string {
  const debut = grille.indexOf("let html = '<thead>");
  const fin = grille.indexOf("html += '</tr></thead><tbody>'");
  expect(debut, 'le bloc d’en-tête est introuvable').toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(debut);
  return grille.slice(debut, fin);
}

// ---------------------------------------------------------------------------
// 5.1 — plus aucune heure dans l'en-tête
// ---------------------------------------------------------------------------

describe('5.1 — l’en-tête ne porte plus aucune heure', () => {
  it('`formatHeure` n’est plus appelée dans la construction de l’en-tête', () => {
    // L'heure d'origine ne faisait que répéter la PREMIÈRE ligne du tableau,
    // juste en dessous, et mentait à toutes les autres.
    expect(blocEntete(), 'une heure est revenue dans l’en-tête').not.toContain('formatHeure(');
  });

  it('…et `departTheorique_s` n’est plus affichée nulle part', () => {
    // Le champ SERT toujours — il ordonne les colonnes et calcule
    // `departReel_s` — mais il ne doit plus atteindre le rendu.
    expect(blocEntete()).not.toContain('departTheorique_s');
  });

  it('le retrait ne dépend PAS de `?gare=` : il vaut partout', () => {
    // Avec ou sans gare, l'heure d'origine n'était juste que pour la première
    // ligne. Une règle conditionnelle aurait laissé la moitié du défaut.
    const bloc = blocEntete();
    expect(bloc).not.toContain('gare ===');
    expect(bloc).not.toContain('gare !==');
    expect(bloc).not.toContain('gare ?');
  });

  it('l’heure de chaque gare reste dans la cellule de sa ligne', () => {
    // C'est le seul endroit où elle est vraie — et c'est ce qui rend le
    // retrait acceptable.
    expect(grille).toContain('formatHeure(heureCellule)');
  });
});

// ---------------------------------------------------------------------------
// 5.2 à 5.4 — les trois règles de l'écran de gare, à la lettre
// ---------------------------------------------------------------------------

describe('5.2 — un train privé porte « Privé », et aucune pastille de remplissage', () => {
  it('la course fermée l’emporte sur le remplissage, quel que soit celui-ci', () => {
    // Un train affrété ne vend pas ses places au comptoir ; et les deux
    // pastilles ne tiennent pas ensemble (mesuré sur l'écran de gare le
    // 11/09/2026).
    expect(mentionCourse({ supprime: false, acces: 'prive' })).toBe('prive');
    expect(mentionCourse({ supprime: false, acces: 'prive', affluence: 'complet' })).toBe('prive');
    expect(mentionCourse({ supprime: false, acces: 'prive', affluence: 'limite' })).toBe('prive');
  });
});

describe('5.3 — un train mixte porte son remplissage, et PAS « Privé »', () => {
  it('mixte n’est pas fermé : le voyageur peut monter', () => {
    expect(mentionCourse({ supprime: false, acces: 'mixte', affluence: 'complet' })).toBe(
      'complet',
    );
    expect(mentionCourse({ supprime: false, acces: 'mixte', affluence: 'limite' })).toBe('limite');
    expect(mentionCourse({ supprime: false, acces: 'mixte' })).toBeNull();
  });

  it('les deux mentions ne peuvent donc JAMAIS se rencontrer', () => {
    // C'est ce qui tient la mesure de non-collision : la fonction rend UNE
    // mention, jamais deux. Le type l'interdit, l'exécution le confirme.
    for (const acces of ['public', 'prive', 'mixte'] as const) {
      for (const affluence of [null, 'complet', 'limite'] as const) {
        const m = mentionCourse({ supprime: false, acces, affluence });
        expect(m === 'prive' ? affluence !== undefined : true).toBe(true);
        expect(['prive', 'complet', 'limite', null]).toContain(m);
      }
    }
  });
});

describe('5.4 — un train supprimé ne porte ni l’une ni l’autre', () => {
  it('il n’existe plus pour le voyageur', () => {
    for (const acces of ['public', 'prive', 'mixte'] as const) {
      for (const affluence of [null, 'complet', 'limite'] as const) {
        expect(mentionCourse({ supprime: true, acces, affluence }), `${acces}/${affluence}`).toBe(
          null,
        );
      }
    }
  });

  it('la grille passe les TROIS données du train, aucune constante', () => {
    // SURVIVANTE DE LA CAMPAGNE DE MUTATION : remplacer `acces: c.train.acces`
    // par `acces: 'public'` ne faisait rien tomber. Un TRAIN 11 privatisé
    // aurait alors perdu « Privé » sur la grille en le gardant sur l'écran de
    // gare — très exactement la divergence que ce lot existe pour empêcher,
    // et la plus difficile à voir : il faut avoir les deux écrans sous les
    // yeux le jour d'une course affrétée.
    //
    // Les gardes éprouvées plus haut sont vraies et sans effet si l'appel ne
    // reçoit pas les vraies valeurs.
    // L'APPEL ENTIER, pas trois fragments. Deuxième survivante de la
    // campagne : `affluence: affluenceDe(c.train.numero) && null` CONTIENT le
    // fragment attendu et ne rend pourtant plus jamais de mention. Chercher un
    // morceau là où il faut vérifier une affirmation, encore une fois.
    const bloc = blocEntete();
    const appel = /const mention = mentionCourse\(\{([\s\S]*?)\}\);/.exec(bloc)?.[1] ?? '';
    expect(appel, 'l’appel à mentionCourse est introuvable').not.toBe('');
    expect(
      appel
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ).toEqual([
      'supprime: c.supprime',
      'acces: c.train.acces',
      'affluence: affluenceDe(c.train.numero)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5.5 — les deux pages disent la même chose du même train
// ---------------------------------------------------------------------------

describe('5.5 — grille et écran de gare ne peuvent pas diverger', () => {
  it('les MOTS viennent d’une seule table, employée par les deux pages', () => {
    expect(LIBELLE_MENTION).toEqual({
      prive: { fr: 'Privé', en: 'Private' },
      complet: { fr: 'Complet', en: 'Full' },
      limite: { fr: 'Dernières places', en: 'Few seats' },
    });
    for (const page of ['src/pages/grille.ts', 'src/pages/ecran.ts']) {
      expect(source(page), `${page} n’emploie pas la table des mots`).toContain('LIBELLE_MENTION');
      expect(source(page), `${page} n’emploie pas la règle partagée`).toContain('mentionCourse(');
    }
  });

  it('aucune des deux pages ne réécrit un libellé à la main', () => {
    // Le défaut à éviter : un mot recopié dans une page, modifié dans l'autre.
    for (const page of ['src/pages/grille.ts', 'src/pages/ecran.ts']) {
      const src = source(page);
      for (const mot of ['Dernières places', 'Few seats', 'Complet', 'Full', 'Private']) {
        expect(src, `${page} écrit « ${mot} » en dur`).not.toContain(`>${mot}`);
      }
    }
  });

  it('et aucune ne redéduit la règle depuis la NATURE', () => {
    // « Privé » suit `acces`, jamais `nature` : un spécial mixte vend ses
    // places restantes.
    const debut = source('src/pages/affichage-commun.ts').indexOf('export function mentionCourse(');
    const corps = source('src/pages/affichage-commun.ts').slice(
      debut,
      source('src/pages/affichage-commun.ts').indexOf('\n}\n', debut),
    );
    expect(corps).not.toContain('nature');
    expect(corps).toContain('courseFermee(');
  });
});

// ---------------------------------------------------------------------------
// 5.6 — l'affluence est secondaire : son échec n'emporte pas la grille
// ---------------------------------------------------------------------------

describe('5.6 — l’échec de l’affluence laisse la grille entière', () => {
  it('l’appel est HORS du `Promise.all` qui porte les horaires', () => {
    // Dans le `Promise.all`, un échec ferait échouer TOUT le chargement : la
    // grille tomberait sur son instantané, puis sur l'écran neutre — une page
    // d'horaires qui s'efface parce qu'une information secondaire n'a pas
    // chargé. Sur l'écran de gare le choix inverse est le bon, et il est
    // délibéré : là-bas une pastille manquante envoie vers un train plein.
    const debut = grille.indexOf('const charge = async ()');
    const corps = grille.slice(debut, grille.indexOf('  };', debut));
    const promesse = corps.slice(corps.indexOf('Promise.all(['), corps.indexOf(']);'));
    expect(promesse, 'getAffluence est dans le Promise.all').not.toContain('getAffluence');
    expect(corps).toContain('provider.getAffluence(dateJour).catch(');
  });

  it('l’échec garde le DERNIER remplissage connu, jamais un tableau vide', () => {
    // Un tableau vide voudrait dire « toutes les places sont disponibles »,
    // ce que personne n'a constaté : l'absence de ligne vaut disponibilité
    // (docs/01 §2.8). Une pastille périmée se voit et vieillit avec le badge
    // de fraîcheur ; une pastille effacée ment en silence.
    const debut = grille.indexOf('const charge = async ()');
    const corps = grille.slice(debut, grille.indexOf('  };', debut));
    expect(corps).toContain('.catch(() => affluence)');
    expect(corps, 'l’échec retombe sur un tableau vide').not.toContain('.catch(() => [])');
  });

  it('le remplissage entre dans l’INSTANTANÉ, comme sur l’écran de gare', () => {
    // Une grille qui redémarre sans réseau doit réafficher les pastilles
    // qu'elle avait, pas les oublier.
    expect(grille).toContain('affluence: Affluence[];');
    expect(grille).toContain('affluence = d.affluence ?? [];');
  });

  it('un niveau inconnu est ignoré plutôt que recopié en classe CSS', () => {
    // Base plus récente que ce déploiement : mieux vaut une pastille absente
    // qu'une classe inventée dans un `class=""`.
    const debut = grille.indexOf('function affluenceDe(');
    const corps = grille.slice(debut, grille.indexOf('\n}\n', debut));
    expect(corps).toContain("a.niveau === 'complet' || a.niveau === 'limite'");
  });
});

// ---------------------------------------------------------------------------
// La contrainte de hauteur : la mention ne doit pas ajouter de RANG
// ---------------------------------------------------------------------------

describe('la mention tient dans la ligne libérée par l’heure', () => {
  it('elle est EN LIGNE, jamais en bloc comme les badges d’aléa', () => {
    // Un rang de plus dans l'en-tête, c'est la coupe du terminus qui revient
    // (PR #34 : marge mesurée à +57 px seulement à 1920×1080).
    const debut = css.indexOf('.picto .mention {');
    expect(debut, 'la règle .picto .mention est absente').toBeGreaterThan(-1);
    const corps = css.slice(debut, css.indexOf('\n}\n', debut));
    expect(corps).toContain('display: inline-block;');
    expect(corps, 'la mention est passée en bloc').not.toMatch(/display:\s*block/);
  });

  it('elle vit DANS la ligne `.picto`, avec les pictos existants', () => {
    // Posée hors de `.picto`, elle formerait son propre rang quoi qu'en dise
    // le `display`.
    const bloc = blocEntete();
    const iPictos = bloc.indexOf('pictos.push(');
    const iMention = bloc.indexOf('class="mention');
    expect(iMention).toBeGreaterThan(iPictos);
    expect(bloc).toContain('pictos.push(');
    expect(bloc.slice(iMention - 400, iMention)).toContain('pictos.push(');
  });

  it('l’anglais passe SOUS le français : une colonne n’a pas la largeur des deux', () => {
    const debut = css.indexOf('.picto .mention small {');
    const corps = css.slice(debut, css.indexOf('\n}\n', debut));
    expect(corps).toContain('display: block;');
  });

  it('le NOM DU TRAIN a la taille d’un titre, plus celle d’une légende', () => {
    // Il est devenu la seule chose qui identifie la colonne : en 1,35 vh gris,
    // il restait illisible de loin. Il reprend la taille, la graisse et la
    // couleur qu'avait l'heure d'origine — 2,25 vh, 900, blanc (24,3 px à
    // 1920×1080, mesuré). Le débordement reste à zéro dans tous les scénarios
    // de production, mention la plus large sur TOUTES les colonnes comprise.
    const debut = css.indexOf('thead th .num {');
    const corps = css.slice(debut, css.indexOf('\n}\n', debut));
    expect(corps).toContain('font-size: 2.25vh;');
    expect(corps).toContain('font-weight: 900;');
    // Pas de couleur : il hérite du blanc de `thead th`. Le gris `--texte-ter`
    // était ce qui le faisait passer pour une légende.
    expect(corps, 'le nom du train est revenu en gris de légende').not.toContain('--texte-ter');
    // …et il garde son pendant portrait, au même coefficient.
    expect(css).toContain('font-size: calc(2.25 * var(--u));');
  });

  it('le portrait a son pendant, au MÊME coefficient', () => {
    // Règle du dépôt : toute taille en vh ajoutée hors média doit se
    // transcrire en --u (verrouillé par responsive-grille.test.ts).
    expect(css).toContain('font-size: calc(1.25 * var(--u));');
    expect(css).toContain('font-size: calc(1.05 * var(--u));');
  });
});
