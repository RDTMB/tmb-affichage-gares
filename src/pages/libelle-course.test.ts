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
};
const mesure = (t: string): number => {
  const l = LARGEURS_MESUREES[t];
  if (l === undefined) throw new Error(`largeur non mesurée pour « ${t} » — mesurer au navigateur`);
  return l;
};

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
    { numero: 201, nature: 'special' as const },
    { numero: 203, nature: 'special' as const },
  ];

  it('SANS libellé, le comportement d’hier ne bouge pas', () => {
    expect(libelleTrainCourt(deuxSpeciaux[0]!, deuxSpeciaux)).toBe('SPÉ 1');
    expect(libelleTrain(deuxSpeciaux[1]!, deuxSpeciaux)).toBe('SPÉCIAL 2');
    const renfort = [{ numero: 101, nature: 'supplementaire' as const }];
    expect(libelleTrainCourt(renfort[0]!, renfort)).toBe('SUP');
    expect(libelleTrain({ numero: 9, nature: 'grille' }, [])).toBe('TRAIN 9');
  });

  it('AVEC libellé, il s’affiche VERBATIM — long comme court', () => {
    // Pas de préfixe ajouté, pas de reformatage : l'agent a écrit « T17 », on
    // affiche « T17 ». Sinon le nom qu'il a choisi n'est pas celui qu'il lit.
    const nomme = [
      { numero: 201, nature: 'special' as const, libelle: 'T17' },
      { numero: 203, nature: 'special' as const },
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
    for (const libelle of ['', '   ', null, undefined]) {
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
      libelleTrainCourt({ numero: 201, nature: p?.nature ?? 'grille', libelle: p?.libelle }, []),
    ).toBe('SCOLAIRE');
  });

  it('sans libellé, le passage n’en invente pas', () => {
    const p = passagesPourGare(GRAND, jourNomme(null), 'saint-gervais').find(
      (x) => x.numero === 201,
    );
    expect((p?.libelle ?? null) === null, 'un libellé est apparu').toBe(true);
    expect(
      libelleTrainCourt({ numero: 201, nature: 'special', libelle: p?.libelle }, [
        { numero: 201, nature: 'special' },
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
