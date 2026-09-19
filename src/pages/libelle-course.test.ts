// LIBELLÉ LIBRE d'une course hors grille (docs/01 §2.10).
//
// CE QUE CES TESTS PROTÈGENT. Deux bornes encadrent le même badge, et c'est
// leur RELATION qui se casse en silence :
//
//   • la saisie refuse au-delà de 4,9 em (`LARGEUR_BADGE_MAX_EM`) ;
//   • la CSS plafonne le texte à 5 em et l'ellipse.
//
// Tant que la première reste sous la seconde, ce que la saisie accepte
// s'affiche ENTIER, et l'ellipse ne sert que de filet pour ce que la
// validation n'a pas vu. Qu'on retouche la police, le plafond ou la borne, et
// les deux dérivent — sans qu'aucun rendu ne change avant le jour où un
// libellé se trouve tronqué en gare.
//
// Les largeurs sont des MESURES, relevées au navigateur le 12/09/2026 sur la
// ligne la plus chargée qui existe (« Nid d'Aigle » + pastille « Privé » +
// picto express), à 1280×720 et 1920×1080. Elles sont en em, donc invariantes
// par résolution : « WWWWII » vaut 4,924 em aux deux tailles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { libelleTrain, libelleTrainCourt, passagesPourGare, trainsDuJour } from '../core/horaires';
import {
  controleLibelle,
  formeComparable,
  garesPrecochees,
  LARGEUR_BADGE_MAX_EM,
  POLICE_BADGE,
  POLICE_BADGE_CHARGEMENT,
  propositionsLibelle,
  REFUS_POLICE,
  REFUS_TROP_LARGE,
} from './supervision-logique';
import type { GareId, Grille, Jour } from '../core/types';

const GRAND = grandServiceJson as unknown as Grille;

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/**
 * Largeurs MESURÉES au navigateur, en em de la police du badge. Ce sont des
 * relevés, pas des estimations : le canevas et le rendu concordent à 0,05 %
 * près, `font-variant-numeric: tabular-nums` compris.
 */
const LARGEURS_MESUREES: Record<string, number> = {
  T9: 1.179,
  'SPÉ 1': 2.518,
  NAVETTE: 4.458,
  MARIAGE: 4.645,
  '12345678': 4.64,
  SCOLAIRE: 4.805,
  WWWWII: 4.924,
  'Navette scolaire': 7.461,
  MMMMMMMM: 7.513,
  'MARIAGE MARTIN': 8.824,
  // Relevés le 19/09/2026, au même canevas et dans la même police, pour les
  // formes RACCOURCIES et ce dont elles partent. Les quatre valeurs communes
  // avec le relevé du 12/09 sont retombées au millième près.
  CE: 1.222,
  CAF: 1.951,
  CMD: 2.338,
  CLUB: 2.558,
  Navette: 3.696,
  'CE M. D.': 3.736,
  'Navette s.': 4.565,
  'CLUB A. F.': 4.62,
  GROUPE: 4.081,
  // Au-dessus de 4,9 em : ces formes-là sont des candidats REFUSÉS, et c'est
  // tout l'intérêt de les avoir mesurées. « MARIAGE M. » — la forme que le
  // prompt de ce lot donnait en exemple — ne tient PAS.
  'GROUPE A.': 5.247,
  'MARIAGE M.': 6.013,
  'GROUPE ALPINA': 7.981,
  'MARIAGE - MARTIN': 9.387,
  'CE MARTIN DUPONT': 9.855,
  'CE (MARTIN) DUPONT': 10.455,
  'CAF A. F.': 4.013,
  'CAF a. f.': 3.65,
  Caf: 1.558,
  'SCOLAIRE !': 5.374,
  // Avec son espace finale, « SCOLAIRE » NE tient plus : 4,998 em. C'est ce
  // que proposerait une règle qui accepterait un seul mot.
  'SCOLAIRE ': 4.998,
  'CAF albertville fondation': 11.536,
  'CAF ALBERTVILLE FONDATION': 14.665,
  'CLUB ALPIN FRANCAIS': 10.885,
  ANNIVERSAIREDUPRESIDENT: 14.225,
};
const mesure = (t: string): number => {
  const l = LARGEURS_MESUREES[t];
  if (l === undefined) throw new Error(`largeur non mesurée pour « ${t} » — mesurer au navigateur`);
  return l;
};

/**
 * L'oracle tel que le reçoit la règle : la MÊME mesure, avec `null` pour
 * « police absente ». Une largeur manquante lève — c'est voulu : une
 * proposition estimée plutôt que mesurée est exactement ce que ce lot
 * interdit, et le test doit s'arrêter plutôt que d'inventer un nombre.
 */
const oracle = (texte: string): number | null => mesure(texte);

/**
 * Corps d'une fonction, extrait par COMPTAGE D'ACCOLADES depuis son en-tête.
 *
 * Chercher une chaîne dans les cinq mille lignes de `supervision.ts` répond
 * « elle y est », pas « elle est DANS la bonne fonction » : un test de câblage
 * qui se contente de la présence passe encore quand le code a migré ailleurs.
 */
function corpsDe(source: string, entete: string): string {
  const debut = source.indexOf(entete);
  if (debut === -1) return '';
  const ouvrante = source.indexOf('{', debut);
  if (ouvrante === -1) return '';
  let profondeur = 0;
  for (let i = ouvrante; i < source.length; i++) {
    if (source[i] === '{') profondeur++;
    else if (source[i] === '}' && --profondeur === 0) return source.slice(debut, i + 1);
  }
  return '';
}

/**
 * Le CODE sans ses commentaires.
 *
 * Un test qui interdit un motif (`innerHTML`, « aucune proposition ») le
 * trouverait dans le commentaire qui EXPLIQUE pourquoi il est interdit, et
 * passerait au rouge sur la bonne intention. Le retrait est grossier — il
 * frapperait un `//` dans une chaîne — et c'est assumé : ce fichier lit du
 * code, pas des URL.
 */
function sansCommentaires(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Plafond `max-width` de `.badge-txt`, lu dans la feuille de style. */
function plafondCssEm(): number {
  const css = source('src/styles/ecran.css');
  const regle = /\.badge-train > \.badge-txt \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const max = /max-width:\s*([\d.]+)em/.exec(regle)?.[1];
  return max === undefined ? Number.NaN : Number(max);
}

// ============================================================================
// 4.4 — l'invariant : ce que la saisie accepte s'affiche ENTIER
// ============================================================================
describe('les deux bornes ne peuvent pas dériver l’une de l’autre', () => {
  it('la borne de SAISIE est strictement sous le plafond CSS', () => {
    // C'est LE test du lot. Sans lui, une retouche de la police ou du plafond
    // laisserait la saisie accepter un libellé que le badge tronque — et
    // personne ne le verrait avant la gare.
    const plafond = plafondCssEm();
    expect(plafond, 'plafond `max-width` introuvable dans .badge-txt').not.toBeNaN();
    expect(LARGEUR_BADGE_MAX_EM).toBeLessThan(plafond);
    // …et pas collée au plafond : l'écart absorbe l'arrondi sous-pixel de la
    // mise en page. 0,1 em, soit ~20 fois l'écart canevas/rendu mesuré.
    expect(plafond - LARGEUR_BADGE_MAX_EM).toBeGreaterThanOrEqual(0.05);
  });

  it('AUCUN libellé accepté ne dépasse le plafond CSS', () => {
    // L'ellipse ne doit JAMAIS se déclencher sur un libellé que la validation
    // a laissé passer : c'est un identifiant à moitié affiché, et deux
    // « MARIAGE … » différents deviendraient indiscernables.
    const plafond = plafondCssEm();
    for (const [texte, largeur] of Object.entries(LARGEURS_MESUREES)) {
      const controle = controleLibelle({ saisi: texte, largeurEm: largeur, dejaPris: [] });
      if (controle.refus === null && controle.valeur !== null) {
        expect(largeur, `« ${texte} » est accepté mais serait tronqué`).toBeLessThan(plafond);
      }
    }
  });

  it('la police déclarée est celle du BADGE, au mot près', () => {
    // Mesurer avec une autre police n'est pas approximatif : Arial rend
    // « WWWWII » plus ÉTROIT que Lato (4,778 contre 4,924), donc un repli
    // accepterait un libellé que Lato déborde.
    const css = source('src/styles/ecran.css');
    const regle = /^\.badge-train \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(regle, 'règle .badge-train introuvable').not.toBe('');
    const famille = /font-family:\s*([^;]+);/.exec(regle)?.[1]?.trim() ?? '';
    const graisse = /font-weight:\s*(\d+);/.exec(regle)?.[1] ?? '';
    // Les guillemets diffèrent par convention — la CSS écrit 'Lato', le
    // canevas "Lato" : on compare les NOMS, pas la ponctuation.
    const sansGuillemets = (t: string): string => t.replace(/['"]/g, '');
    expect(sansGuillemets(POLICE_BADGE)).toContain(sansGuillemets(famille));
    expect(POLICE_BADGE.startsWith(`${graisse} `), `graisse ${graisse} attendue`).toBe(true);
    expect(POLICE_BADGE_CHARGEMENT).toContain(graisse);
    expect(POLICE_BADGE_CHARGEMENT).toContain('Lato');
  });
});

// ============================================================================
// 4.1 et 4.2 — sans libellé rien ne bouge ; avec, il s'affiche verbatim
// ============================================================================
describe('le libellé remplace le nom, et rien d’autre', () => {
  const deuxSpeciaux = [
    { numero: 201, nature: 'special' as const, libelle: null },
    { numero: 203, nature: 'special' as const, libelle: null },
  ];

  it('SANS libellé, le comportement d’hier ne bouge pas', () => {
    expect(libelleTrainCourt(deuxSpeciaux[0]!, deuxSpeciaux)).toBe('SPÉ 1');
    expect(libelleTrain(deuxSpeciaux[1]!, deuxSpeciaux)).toBe('SPÉCIAL 2');
    const renfort = [{ numero: 101, nature: 'supplementaire' as const, libelle: null }];
    expect(libelleTrainCourt(renfort[0]!, renfort)).toBe('SUP');
    expect(libelleTrain({ numero: 9, nature: 'grille', libelle: null }, [])).toBe('TRAIN 9');
  });

  it('AVEC libellé, il s’affiche VERBATIM — long comme court', () => {
    // Pas de préfixe ajouté, pas de reformatage : l'agent a écrit « T17 », on
    // affiche « T17 ». Sinon le nom qu'il a choisi n'est pas celui qu'il lit.
    const nomme = [
      { numero: 201, nature: 'special' as const, libelle: 'T17' },
      { numero: 203, nature: 'special' as const, libelle: null },
    ];
    expect(libelleTrainCourt(nomme[0]!, nomme)).toBe('T17');
    expect(libelleTrain(nomme[0]!, nomme)).toBe('T17');
    // Le train SANS libellé garde son rang dans la série : le libellé masque
    // le numéro, il ne le retire pas.
    expect(libelleTrain(nomme[1]!, nomme)).toBe('SPÉCIAL 2');
  });

  it('un libellé VIDE ou blanc vaut ABSENCE', () => {
    // La base accepte `''` comme elle accepte `null` ; « un train nommé rien »
    // ne serait ni lisible ni identifiable.
    // `undefined` a QUITTÉ cette liste le 13/09/2026, et c'est un gain : le
    // type ne l'admet plus (`libelle: string | null`), donc le cas ne se
    // construit plus. Une absence de CLÉ et une absence de VALEUR étaient
    // confondues, et cette confusion a coûté un défaut de recette ailleurs —
    // sur `commanditaire`, où un consommateur les distinguait.
    for (const libelle of ['', '   ', null]) {
      const t = { numero: 201, nature: 'special' as const, libelle };
      expect(libelleTrainCourt(t, [t]), String(libelle)).toBe('SPÉ');
    }
  });

  it('un train de GRILLE peut aussi porter un libellé, et il gagne', () => {
    // Rien ne l'interdit en base, et la règle « verbatim » ne souffre pas
    // d'exception selon la nature — sinon il y aurait deux règles à retenir.
    const t = { numero: 9, nature: 'grille' as const, libelle: 'NAVETTE' };
    expect(libelleTrain(t, [t])).toBe('NAVETTE');
  });

  it('il n’existe pas de TROISIÈME chemin de nommage', () => {
    // Les deux fonctions passent par le même `libelleLibre()` : un troisième
    // endroit qui lirait `libelle` finirait par diverger des deux autres.
    const horaires = source('src/core/horaires.ts');
    expect(
      [...horaires.matchAll(/libelleLibre\(/g)].length,
      'attendu 1 définition + 2 appels',
    ).toBe(3);
    // Et la supervision ne recompose pas un libellé à la main.
    const sup = source('src/pages/supervision.ts');
    expect(sup).not.toMatch(/['"`]SPÉ ['"`]\s*\+/);
  });
});

// ============================================================================
// 4.3 et 4.4 — ce que la saisie refuse
// ============================================================================
describe('la saisie refuse, et dit pourquoi', () => {
  it('un libellé TROP LARGE est refusé, avec un exemple de ce qui tient', () => {
    const controle = controleLibelle({
      saisi: 'MARIAGE MARTIN',
      largeurEm: mesure('MARIAGE MARTIN'),
      dejaPris: [],
    });
    expect(controle.valeur).toBeNull();
    expect(controle.refus).toBe(REFUS_TROP_LARGE);
    // Le message donne un exemple VRAI : un compteur de caractères mentirait,
    // « SCOLAIRE » et « MMMMMMMM » en ont huit et pas la même largeur.
    expect(REFUS_TROP_LARGE).toContain('SCOLAIRE');
    expect(mesure('SCOLAIRE')).toBeLessThanOrEqual(LARGEUR_BADGE_MAX_EM);
    expect(mesure('MMMMMMMM')).toBeGreaterThan(LARGEUR_BADGE_MAX_EM);
  });

  it('à nombre de caractères ÉGAL, la largeur décide', () => {
    // C'est la raison d'être de la borne en largeur.
    for (const t of ['SCOLAIRE', '12345678', 'MMMMMMMM']) expect(t).toHaveLength(8);
    expect(
      controleLibelle({ saisi: 'SCOLAIRE', largeurEm: mesure('SCOLAIRE'), dejaPris: [] }).refus,
    ).toBeNull();
    expect(
      controleLibelle({ saisi: '12345678', largeurEm: mesure('12345678'), dejaPris: [] }).refus,
    ).toBeNull();
    expect(
      controleLibelle({ saisi: 'MMMMMMMM', largeurEm: mesure('MMMMMMMM'), dejaPris: [] }).refus,
    ).toBe(REFUS_TROP_LARGE);
  });

  it('un libellé DÉJÀ PORTÉ est refusé — casse et espaces de bord compris', () => {
    for (const saisi of ['T11', 't11', '  T11  ', 'T11 ']) {
      const controle = controleLibelle({ saisi, largeurEm: 2, dejaPris: ['T9', 'T11', 'SUP 1'] });
      expect(controle.valeur, saisi).toBeNull();
      expect(controle.refus, saisi).toContain('déjà porté');
    }
    // …et un nom libre passe.
    expect(controleLibelle({ saisi: 'T13', largeurEm: 2, dejaPris: ['T11'] }).refus).toBeNull();
  });

  it('la forme comparable réduit casse, espaces de bord ET espaces internes', () => {
    expect(formeComparable('  T11  ')).toBe('t11');
    expect(formeComparable('GROUPE  ALPINA')).toBe('groupe alpina');
  });

  it('POLICE ABSENTE : le LIBELLÉ est refusé, jamais la création du train', () => {
    // Le libellé est facultatif (décision du 12/09) : bloquer une course
    // d'exploitation pour une police qui n'a pas chargé ferait payer un souci
    // d'affichage à un matin de perturbation.
    const controle = controleLibelle({ saisi: 'SCOLAIRE', largeurEm: null, dejaPris: [] });
    expect(controle.valeur).toBeNull();
    expect(controle.refus).toBe(REFUS_POLICE);
    expect(REFUS_POLICE, 'le message ne dit pas ce que le train deviendra').toContain('SPÉ');

    // Le formulaire DÉSACTIVE le champ et laisse le reste marcher : la garde
    // de création ne regarde jamais le libellé.
    const sup = source('src/pages/supervision.ts');
    expect(sup).toContain('champ.disabled = !document.fonts.check(POLICE_BADGE_CHARGEMENT)');
    const valider =
      /\$\('btn-sup-valider'\)\.addEventListener[\s\S]*?\n  \}\);/.exec(sup)?.[0] ?? '';
    expect(valider, 'gestionnaire de création introuvable').not.toBe('');
    expect(valider, 'la création dépend de la police').not.toContain('fonts.check');
  });

  it('un libellé VIDE passe : il est FACULTATIF', () => {
    const controle = controleLibelle({ saisi: '   ', largeurEm: 0, dejaPris: ['T11'] });
    expect(controle.refus).toBeNull();
    expect(controle.valeur).toBeNull();
  });

  it('la mesure est demandée AVANT de comparer l’unicité', () => {
    // Un libellé trop large ET déjà pris doit se voir reprocher la largeur :
    // c'est ce que l'agent peut corriger tout de suite.
    const controle = controleLibelle({
      saisi: 'MARIAGE MARTIN',
      largeurEm: mesure('MARIAGE MARTIN'),
      dejaPris: ['MARIAGE MARTIN'],
    });
    expect(controle.refus).toBe(REFUS_TROP_LARGE);
  });
});

// ============================================================================
// 19/09/2026 — le refus de largeur PROPOSE des formes qui tiennent
// ============================================================================
//
// CE QUE CETTE SECTION PROTÈGE. Une proposition n'est pas une idée de forme
// courte : c’est une forme MESURÉE. Le lot entier tient à cet invariant —
// « toute proposition passe `controleLibelle` » —, parce qu’une proposition
// que le champ refuserait à son tour serait pire que pas de proposition :
// elle enverrait l’agent au mur avec l’air de l’en sortir.
//
// Le relevé du 19/09 l’a montré aussitôt : « MARIAGE M. » vaut 6,013 em,
// donc NE TIENT PAS, alors que c’était l’exemple du prompt de ce lot. Une
// règle qui aurait « su » que premier mot + initiale rentre aurait proposé à
// l’agent exactement ce que le champ lui refuse.
describe('le refus de largeur propose des formes MESURÉES', () => {
  /** Libellés d’essai, tous plus larges que le badge. */
  const TROP_LARGES = [
    'MARIAGE MARTIN',
    'GROUPE ALPINA',
    'CE MARTIN DUPONT',
    'CLUB ALPIN FRANCAIS',
    'Navette scolaire',
    'MARIAGE - MARTIN',
    'ANNIVERSAIREDUPRESIDENT',
    'CAF ALBERTVILLE FONDATION',
    'CAF albertville fondation',
    'CE (MARTIN) DUPONT',
  ];

  it('L’INVARIANT : toute proposition rendue est acceptée par le champ', () => {
    // C'est LE test du lot. S'il tombe, une proposition est refusée à l'agent
    // au moment même où il l'accepte.
    let vues = 0;
    for (const saisi of TROP_LARGES) {
      expect(mesure(saisi), `« ${saisi} » n’est pas trop large`).toBeGreaterThan(
        LARGEUR_BADGE_MAX_EM,
      );
      for (const proposition of propositionsLibelle(saisi, oracle)) {
        vues++;
        const controle = controleLibelle({
          saisi: proposition,
          largeurEm: mesure(proposition),
          dejaPris: [],
          mesure: oracle,
        });
        expect(
          controle.refus,
          `« ${proposition} » (proposé pour « ${saisi} ») est refusé par le champ`,
        ).toBeNull();
        // …et le champ garde EXACTEMENT ce qui a été proposé : verbatim.
        expect(controle.valeur).toBe(proposition);
      }
    }
    // Un invariant éprouvé sur zéro proposition ne prouve rien.
    expect(vues, 'aucune proposition n’a été éprouvée').toBeGreaterThan(5);
  });

  it('DEUX MOTS : le premier mot entier, quand l’initiale ne tient pas', () => {
    // « MARIAGE M. » = 6,013 em : la forme la plus informative est CALCULÉE
    // puis écartée par la MESURE, pas par une règle de longueur.
    expect(mesure('MARIAGE M.')).toBeGreaterThan(LARGEUR_BADGE_MAX_EM);
    expect(propositionsLibelle('MARIAGE MARTIN', oracle)).toEqual(['MARIAGE']);
    expect(mesure('GROUPE A.')).toBeGreaterThan(LARGEUR_BADGE_MAX_EM);
    expect(propositionsLibelle('GROUPE ALPINA', oracle)).toEqual(['GROUPE']);
  });

  it('DEUX MOTS : l’initiale passe devant dès qu’elle tient', () => {
    // « Navette s. » = 4,565 em : elle tient, et elle garde du second mot une
    // trace que « Navette » seul perd. Elle passe donc en tête.
    expect(propositionsLibelle('Navette scolaire', oracle)).toEqual(['Navette s.', 'Navette']);
  });

  it('TROIS MOTS : les initiales de tous entrent au milieu du classement', () => {
    // « CE » seul confondrait « CE MARTIN » et « CE DUPONT » ; « CMD » garde
    // une trace de chaque mot. Il passe donc devant le premier mot seul.
    expect(propositionsLibelle('CE MARTIN DUPONT', oracle)).toEqual(['CE M. D.', 'CMD', 'CE']);
    expect(propositionsLibelle('CLUB ALPIN FRANCAIS', oracle)).toEqual([
      'CLUB A. F.',
      'CAF',
      'CLUB',
    ]);
  });

  it('UN SEUL MOT, trop long : la liste est VIDE — et c’est une réponse', () => {
    // Il n'existe pas de raccourci honnête : « ANNIVERSAIREDUPRE… » n'apprend
    // rien et se lit comme un défaut d’affichage. Le dire vaut mieux que
    // l’inventer.
    expect(propositionsLibelle('ANNIVERSAIREDUPRESIDENT', oracle)).toEqual([]);
    // Même chose pour un mot unique qui, lui, tient déjà.
    expect(propositionsLibelle('SCOLAIRE', oracle)).toEqual([]);
  });

  it('un libellé qui TIENT n’est pas refusé, donc rien ne lui est proposé', () => {
    const controle = controleLibelle({
      saisi: 'SCOLAIRE',
      largeurEm: mesure('SCOLAIRE'),
      dejaPris: [],
      mesure: oracle,
    });
    expect(controle.refus).toBeNull();
    expect(controle.propositions).toEqual([]);
  });

  it('AUCUNE proposition n’est une coupe en plein mot', () => {
    // « MARIAGE MAR… » sur un écran de gare n’apprend rien et fait croire à un
    // défaut d’affichage. Chaque morceau rendu est donc soit un MOT ENTIER du
    // libellé saisi, soit une initiale suivie d’un point, soit la suite des
    // initiales.
    for (const saisi of TROP_LARGES) {
      const mots = saisi.trim().split(/\s+/);
      const alphanum = /[\p{L}\p{N}]/u;
      const initiales = mots
        .filter((m) => alphanum.test(m))
        .map((m) => alphanum.exec(m)?.[0] ?? '')
        .join('');
      for (const proposition of propositionsLibelle(saisi, oracle)) {
        expect(proposition, `« ${proposition} » est tronqué`).not.toMatch(/…|\.\.\./);
        for (const morceau of proposition.split(/\s+/)) {
          expect(
            mots.includes(morceau) || /^.\.$/u.test(morceau) || morceau === initiales,
            `« ${morceau} » (de « ${proposition} ») n’est ni un mot entier, ni une initiale`,
          ).toBe(true);
        }
      }
    }
  });

  it('aucun DOUBLON, et jamais le libellé saisi lui-même', () => {
    // Le saisi ne tient pas — le reproposer renverrait l’agent au mur.
    // « MARIAGE M. » produit « MARIAGE M. » par la première stratégie : c’est
    // le cas qui se présente quand l’agent a DÉJÀ abrégé lui-même.
    expect(propositionsLibelle('MARIAGE M.', oracle)).toEqual(['MARIAGE']);
    // Un séparateur sans lettre ni chiffre n’est pas un mot : « - » ne devient
    // pas une initiale, et les deux écritures proposent la même chose.
    expect(propositionsLibelle('MARIAGE - MARTIN', oracle)).toEqual(
      propositionsLibelle('MARIAGE MARTIN', oracle),
    );
    for (const saisi of TROP_LARGES) {
      const liste = propositionsLibelle(saisi, oracle);
      expect(new Set(liste).size, `doublon dans « ${saisi} »`).toBe(liste.length);
      expect(liste, `« ${saisi} » se propose lui-même`).not.toContain(saisi.trim());
    }
  });

  it('POLICE ABSENTE : aucune proposition, et le refus reste celui de la police', () => {
    // Un oracle muet ne rend pas « ça tient » : il ne rend rien.
    expect(propositionsLibelle('CE MARTIN DUPONT', () => null)).toEqual([]);
    const controle = controleLibelle({
      saisi: 'CE MARTIN DUPONT',
      largeurEm: null,
      dejaPris: [],
      mesure: () => null,
    });
    expect(controle.refus).toBe(REFUS_POLICE);
    expect(controle.propositions).toEqual([]);
  });

  it('un libellé DÉJÀ PORTÉ ne se répare pas en le raccourcissant', () => {
    // Raccourcir « SCOLAIRE » ne règle pas une collision de noms : le seul
    // refus qui propose est celui de la LARGEUR.
    const controle = controleLibelle({
      saisi: 'SCOLAIRE',
      largeurEm: mesure('SCOLAIRE'),
      dejaPris: ['SCOLAIRE'],
      mesure: oracle,
    });
    expect(controle.refus).toContain('déjà porté');
    expect(controle.propositions).toEqual([]);
  });

  it('le REFUS DE LARGEUR porte bien la liste de la règle', () => {
    // Mutation survivante du premier tour : remplacer la liste par `[]` dans
    // `controleLibelle` laissait tous les tests verts — ils interrogeaient la
    // règle en direct, aucun ne regardait ce que le REFUS emporte.
    const controle = controleLibelle({
      saisi: 'CE MARTIN DUPONT',
      largeurEm: mesure('CE MARTIN DUPONT'),
      dejaPris: [],
      mesure: oracle,
    });
    expect(controle.refus).toBe(REFUS_TROP_LARGE);
    expect(controle.propositions).toEqual(propositionsLibelle('CE MARTIN DUPONT', oracle));
    expect(controle.propositions, 'le refus ne propose rien').not.toHaveLength(0);
  });

  it('la borne de la proposition est CELLE du champ, à l’em près', () => {
    // Mutation survivante : passer `>` à `>=` ne changeait rien sur les
    // largeurs relevées — aucune ne tombe pile sur la borne. Un oracle qui
    // répond EXACTEMENT 4,9 em tranche : le champ accepte cette largeur, la
    // proposition doit donc la retenir, sinon les deux bornes divergent.
    const aLaBorne = (t: string): number | null =>
      t === 'MARIAGE' ? LARGEUR_BADGE_MAX_EM : mesure(t);
    expect(propositionsLibelle('MARIAGE MARTIN', aLaBorne)).toEqual(['MARIAGE']);
    expect(
      controleLibelle({ saisi: 'MARIAGE', largeurEm: LARGEUR_BADGE_MAX_EM, dejaPris: [] }).refus,
    ).toBeNull();
  });

  it('UN SEUL MOT suivi d’un signe reste un seul mot', () => {
    // Mutation survivante : abaisser la garde à « un mot » proposait
    // « SCOLAIRE » pour « SCOLAIRE ! » — un nom que l’agent n’a pas écrit, et
    // dont le point d’exclamation a disparu sans qu’on le lui dise.
    expect(propositionsLibelle('SCOLAIRE !', oracle)).toEqual([]);
  });

  it('une PARENTHÈSE n’est pas une initiale', () => {
    // Mutation survivante : prendre le premier caractère au lieu du premier
    // caractère alphanumérique donnait « CE (. D. » — illisible en gare.
    expect(propositionsLibelle('CE (MARTIN) DUPONT', oracle)).toEqual(['CE M. D.', 'CMD', 'CE']);
  });

  it('DOUBLON RÉEL : un sigle déjà écrit ne revient pas deux fois', () => {
    // Mutation survivante : sans dédoublonnage, « CAF ALBERTVILLE FONDATION »
    // proposait « CAF » DEUX FOIS — une fois comme suite des initiales, une
    // fois comme premier mot. Deux boutons identiques côte à côte.
    expect(propositionsLibelle('CAF ALBERTVILLE FONDATION', oracle)).toEqual(['CAF A. F.', 'CAF']);
    // …et le dédoublonnage compare des formes COMPARABLES, pas des chaînes :
    // « Caf » et « CAF » sont le même nom en gare, et deux boutons qui ne
    // diffèrent que par la casse ne proposent pas deux choses.
    expect(propositionsLibelle('CAF albertville fondation', oracle)).toEqual(['CAF a. f.', 'Caf']);
  });

  it('un libellé multi-mots DÉJÀ PORTÉ ne reçoit rien non plus', () => {
    // Mutation survivante : brancher les propositions sur le refus d’unicité
    // passait, faute d’un cas d’essai où la règle avait quelque chose à dire.
    // Raccourcir « CE MARTIN DUPONT » ne règle pas une collision de noms.
    expect(propositionsLibelle('CE MARTIN DUPONT', oracle)).not.toHaveLength(0);
    const controle = controleLibelle({
      saisi: 'CE MARTIN DUPONT',
      largeurEm: 2,
      dejaPris: ['CE MARTIN DUPONT'],
      mesure: oracle,
    });
    expect(controle.refus).toContain('déjà porté');
    expect(controle.propositions).toEqual([]);
  });

  it('sans oracle, le refus est EXACTEMENT celui d’hier', () => {
    // Les appelants qui ne mesurent pas (tests, futurs porteurs de la règle)
    // ne reçoivent pas une liste inventée : ils reçoivent une liste vide.
    const controle = controleLibelle({
      saisi: 'MARIAGE MARTIN',
      largeurEm: mesure('MARIAGE MARTIN'),
      dejaPris: [],
    });
    expect(controle.refus).toBe(REFUS_TROP_LARGE);
    expect(controle.propositions).toEqual([]);
  });
});

// ============================================================================
// Le câblage : ce que la supervision fait de ces propositions
// ============================================================================
describe('la supervision propose, et n’applique jamais d’office', () => {
  const corps = (): string =>
    corpsDe(source('src/pages/supervision.ts'), 'const controleLibelleSaisi = (');

  it('les DEUX formulaires passent par le même contrôle', () => {
    // Création (`sup-libelle`) et renommage (`renom-libelle`) partagent
    // `controleLibelleSaisi` : les propositions s’y branchent une seule fois.
    const sup = source('src/pages/supervision.ts');
    expect(corps(), 'controleLibelleSaisi introuvable').not.toBe('');
    expect(sup).toContain("controleLibelleSaisi('renom-libelle', 'renom-refus', numero)");
    expect(corps()).toContain("refusId = 'sup-refus-libelle'");
  });

  it('l’oracle passé à la règle est CELUI qui mesure le libellé', () => {
    // Deux mesures différentes, et une proposition « qui tient » pourrait ne
    // pas tenir. Le champ mesure par `largeurEnEm` : la règle aussi.
    expect(corps()).toContain("largeurEm: saisi.trim() === '' ? 0 : largeurEnEm(saisi.trim())");
    expect(corps()).toContain('mesure: largeurEnEm');
  });

  it('les boutons viennent de la RÈGLE, et un clic écrit dans le champ', () => {
    const c = corps();
    expect(c).toContain('controle.propositions');
    expect(c, 'le clic n’écrit pas la proposition dans le champ').toContain(
      'champ.value = proposition',
    );
    // …puis le contrôle est RELANCÉ : c’est lui qui fait tomber le refus, et
    // non une supposition sur ce que la mesure aurait dit.
    expect(c).toContain('controleLibelleSaisi(champId, refusId, saufNumero)');
    // Le texte du bouton est posé en `textContent` : le libellé vient de la
    // frappe de l’agent, et l’échappement reste la première défense.
    expect(c).toContain('bouton.textContent = proposition');
    expect(sansCommentaires(c), 'du HTML est assemblé avec la saisie de l’agent').not.toContain(
      'innerHTML',
    );
  });

  it('LISTE VIDE : rien de plus que le refus', () => {
    // Pas de « aucune proposition disponible » : une phrase qui dit qu’il n’y
    // a rien à dire encombre l’écran d’un agent pressé.
    const c = corps();
    expect(c).toContain('if (controle.propositions.length > 0)');
    expect(sansCommentaires(c).toLowerCase()).not.toContain('aucune proposition');
  });

  it('le libellé n’est JAMAIS raccourci d’office', () => {
    // La supervision n’appelle pas la règle pour s’en servir toute seule : le
    // seul chemin qui écrit une forme courte dans le champ est le CLIC.
    const sup = sansCommentaires(source('src/pages/supervision.ts'));
    expect(
      [...sup.matchAll(/propositionsLibelle\(/g)],
      'la supervision applique une proposition sans passer par l’agent',
    ).toHaveLength(0);
    // Dans le contrôle lui-même, une SEULE écriture du champ — celle du clic.
    expect(
      [...sansCommentaires(corps()).matchAll(/champ\.value = /g)],
      'une autre écriture du champ de libellé est apparue',
    ).toHaveLength(1);
  });
});

// ============================================================================
// L'unicité se compare sur la BONNE liste
// ============================================================================
describe('l’unicité couvre la journée ENTIÈRE', () => {
  it('la comparaison part de `jour.circulations`, pas de `trainsDuJour()`', () => {
    // `trainsDuJour()` écarte les facultatifs non activés et les courses à
    // vide : un libellé jugé unique contre lui entrerait en collision le jour
    // où l'exploitant active le facultatif.
    const sup = source('src/pages/supervision.ts');
    const corps = /function libellesDuJour\([\s\S]*?\n}/.exec(sup)?.[0] ?? '';
    expect(corps, 'libellesDuJour introuvable').not.toBe('');
    expect(corps).toContain('trainsPourLibelle()');
    expect(corps, 'la liste partielle de trainsDuJour() est utilisée').not.toContain(
      'trainsDuJour(',
    );
    // `\n}\n` et non `\n}` : le type de retour de la fonction est lui-même un
    // objet sur plusieurs lignes, et une capture paresseuse s'arrêtait sur son
    // accolade fermante — le corps ne commençait même pas.
    const source_ = /function trainsPourLibelle\([\s\S]*?\n}\n/.exec(sup)?.[0] ?? '';
    expect(source_).toContain('jour?.circulations');
  });

  it('elle compare des libellés COURTS', () => {
    // C'est la forme du badge : « T9 » entre en collision avec le train 9 de
    // la grille, ce qu'une comparaison sur « TRAIN 9 » raterait.
    const sup = source('src/pages/supervision.ts');
    const corps = /function libellesDuJour\([\s\S]*?\n}/.exec(sup)?.[0] ?? '';
    expect(corps).toContain('libelleTrainCourt(');
  });

  it('renommer un train ne bute pas sur son propre nom', () => {
    const sup = source('src/pages/supervision.ts');
    expect(sup).toContain('function libellesDuJour(saufNumero?: number)');
    expect(sup).toContain("controleLibelleSaisi('renom-libelle', 'renom-refus', numero)");
  });
});

// ============================================================================
// 4.5 et 4.6 — les dessertes suivent « express », sans être verrouillées
// ============================================================================
describe('les dessertes suivent « express »', () => {
  const MONTEE: GareId[] = [
    'le-fayet',
    'saint-gervais',
    'motivon',
    'col-de-voza',
    'bellevue',
    'nid-daigle',
  ];

  it('express COCHÉ décoche Col de Voza et Bellevue', () => {
    expect(
      garesPrecochees({ ordre: MONTEE, obligatoires: ['le-fayet', 'nid-daigle'], express: true }),
    ).toEqual(['le-fayet', 'saint-gervais', 'motivon', 'nid-daigle']);
  });

  it('express DÉCOCHÉ les recoche', () => {
    expect(
      garesPrecochees({ ordre: MONTEE, obligatoires: ['le-fayet', 'nid-daigle'], express: false }),
    ).toEqual(MONTEE);
  });

  it('la DESCENTE suit la même règle', () => {
    const descente = [...MONTEE].reverse();
    expect(
      garesPrecochees({ ordre: descente, obligatoires: ['nid-daigle', 'le-fayet'], express: true }),
    ).toEqual(['nid-daigle', 'motivon', 'saint-gervais', 'le-fayet']);
  });

  it('une gare OBLIGATOIRE l’emporte : un terminus à Bellevue y va', () => {
    // Sinon la desserte n'atteindrait pas son propre terminus. Ce n'est PAS le
    // garde-fou « un express n'est jamais tronqué à Bellevue » (docs/01), qui
    // est une autre règle et n'est pas touché ici.
    const jusquBellevue: GareId[] = [
      'le-fayet',
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
    ];
    expect(
      garesPrecochees({
        ordre: jusquBellevue,
        obligatoires: ['le-fayet', 'bellevue'],
        express: true,
      }),
    ).toEqual(['le-fayet', 'saint-gervais', 'motivon', 'bellevue']);
  });

  it('les cases restent MODIFIABLES : c’est une aide, pas une barrière', () => {
    // Seules les gares obligatoires sont verrouillées ; Voza et Bellevue
    // décochées par le réglage automatique doivent rester recochables.
    const sup = source('src/pages/supervision.ts');
    const corps = /const rendCasesGaresSup = \([\s\S]*?\n  \};/.exec(sup)?.[0] ?? '';
    expect(corps, 'rendCasesGaresSup introuvable').not.toBe('');
    expect(corps).toContain("impose ? ' disabled' : ''");
    // Le verrou suit `impose`, jamais `cochee`.
    expect(corps).not.toMatch(/cochee\s*\?\s*' disabled'/);
  });

  it('le réglage s’applique là où la case EXISTE, et nulle part ailleurs', () => {
    // La case express n'existe que pour le spécial (décision du 10/09) : pour
    // un renfort, rien ne bouge — il double une rotation de la grille et la
    // dessert comme elle.
    const sup = source('src/pages/supervision.ts');
    expect(sup).toContain(
      "natureChoisie() === 'special' && ($('sup-express') as HTMLInputElement)",
    );
    expect(sup).toContain("$('sup-express').addEventListener('change', rendFormulaireSup)");
  });
});

// ============================================================================
// §3 — les secondes de l'aperçu ne sont pas arrondies
// ============================================================================
describe('les secondes de l’aperçu restent', () => {
  it('les champs d’heure gardent leur pas d’une seconde', () => {
    // Le trajet Saint-Gervais → Motivon dure 11 min 30 s pour les treize
    // montées de la grille été 2026 : ces secondes sont VRAIES, elles viennent
    // du document d'exploitation. Les arrondir inventerait des horaires.
    const html = source('supervision.html');
    expect(html).toContain('id="sup-depart" step="30"');
    const sup = source('src/pages/supervision.ts');
    expect(sup).toContain('type="time" step="1"');
  });
});

// ============================================================================
// Ce qui a survécu à la première campagne
// ============================================================================
describe('le libellé traverse le moteur jusqu’à l’écran', () => {
  // Mutation survivante : retirer `libelle: train.libelle` de
  // `passagesPourGare()` laissait la supervision et la grille du jour afficher
  // le nom, et l'écran de gare seul revenir à « SPÉ n » — sans qu'un test ne
  // tombe, tous regardant la Circulation et non le PassageGare.
  const jourNomme = (libelle: string | null): Jour => ({
    date: '2026-07-15',
    grille_version: GRAND.version,
    terminus_bellevue: false,
    gare_debut: 'le-fayet',
    gare_fin: 'nid-daigle',
    message_troncon_fr: null,
    message_troncon_en: null,
    enregistre: true,
    circulations: [
      {
        date: '2026-07-15',
        numero: 201,
        sens: 'montee',
        express: false,
        facultatif: false,
        facultatif_actif: false,
        velos: false,
        rame: 'Marie',
        terminus: 'nid-daigle',
        statut: 'ok',
        retard_min: 0,
        motif: null,
        sans_voyageurs: false,
        depart_reel: null,
        commanditaire: null,
        acces: 'public' as const,
        nature: 'special',
        libelle,
        passages: [
          { gare: 'le-fayet', d: '09:00:00' },
          { gare: 'saint-gervais', a: '09:12:00', d: '09:13:00' },
          { gare: 'nid-daigle', a: '10:03:30' },
        ],
      },
    ],
  });

  it('il survit à `trainsDuJour()` PUIS à `passagesPourGare()`', () => {
    const train = trainsDuJour(GRAND, jourNomme('SCOLAIRE')).find((t) => t.numero === 201);
    expect(train?.libelle, 'le libellé se perd dans trainsDuJour()').toBe('SCOLAIRE');

    const p = passagesPourGare(GRAND, jourNomme('SCOLAIRE'), 'saint-gervais').find(
      (x) => x.numero === 201,
    );
    expect(p, 'le spécial ne passe pas à Saint-Gervais').toBeDefined();
    expect(p?.libelle, 'le libellé se perd entre le train et le passage').toBe('SCOLAIRE');
    // C'est cette valeur-là que le badge de l'écran de gare rend.
    expect(
      libelleTrainCourt(
        { numero: 201, nature: p?.nature ?? 'grille', libelle: p?.libelle ?? null },
        [],
      ),
    ).toBe('SCOLAIRE');
  });

  it('sans libellé, le passage n’en invente pas', () => {
    const p = passagesPourGare(GRAND, jourNomme(null), 'saint-gervais').find(
      (x) => x.numero === 201,
    );
    expect((p?.libelle ?? null) === null, 'un libellé est apparu').toBe(true);
    expect(
      libelleTrainCourt({ numero: 201, nature: 'special', libelle: p?.libelle ?? null }, [
        { numero: 201, nature: 'special', libelle: null },
      ]),
    ).toBe('SPÉ');
  });
});

describe('la mesure REFUSE de mesurer sans la police', () => {
  it('le contrôle de chargement est DANS la mesure, pas seulement sur le champ', () => {
    // Mutation survivante : retirer le `fonts.check` de `largeurEnEm` laissait
    // le champ se désactiver correctement, mais toute mesure faite malgré tout
    // (au collage, au chargement d'un libellé existant) retombait sur le repli
    // — plus étroit que Lato, donc acceptant ce que Lato déborde.
    const sup = source('src/pages/supervision.ts');
    const corps = /function largeurEnEm\([\s\S]*?\n}\n/.exec(sup)?.[0] ?? '';
    expect(corps, 'largeurEnEm introuvable').not.toBe('');
    expect(corps, 'la mesure ne contrôle pas le chargement de la police').toContain(
      'document.fonts.check(POLICE_BADGE_CHARGEMENT)',
    );
    // Le contrôle passe AVANT la mesure : mesurer puis jeter serait déjà faux
    // si quelqu'un réutilisait la valeur.
    expect(corps.indexOf('fonts.check')).toBeLessThan(corps.indexOf('measureText'));
    expect(corps).toContain('return null');
  });
});

describe('renommer ne bute pas sur son propre nom', () => {
  it('les DEUX chemins du renommage s’excluent eux-mêmes', () => {
    // Mutation survivante : retirer `numero` d'UN des deux appels laissait
    // l'autre satisfaire le test. L'ouverture du panneau affiche le refus,
    // la validation le prononce — les deux doivent exclure la course.
    const sup = source('src/pages/supervision.ts');
    expect(
      [...sup.matchAll(/controleLibelleSaisi\('renom-libelle', 'renom-refus', numero\)/g)],
      'un des deux chemins de renommage ne s’exclut plus lui-même',
    ).toHaveLength(2);
  });
});
