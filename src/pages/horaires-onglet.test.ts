// Logique de l'onglet Horaires : on ne peut valider qu'un import complet et
// compris ; la validation annonce ce qu'elle remplace ; les confirmations
// disent qui reprend la main.
import { describe, expect, it } from 'vitest';

import cellulesJson from '../core/__fixtures__/2026-ete-exploit-v1.cellules.json';
import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { effetChangementPeriodes } from '../core/grilles-periodes';
import { parseClasseur, type FeuilleCellules } from '../core/import-grille';
import type { Grille } from '../core/types';
import {
  dateCourte,
  dateLongue,
  datesGagnees,
  ecartsFeuille,
  grillePrecedentePour,
  lignesEffetPeriodes,
  nouvelleEdition,
  nouvelleFeuilleImport,
  periodesValides,
  planValidation,
  raisonsBlocage,
  raisonsBlocageEdition,
  resumeEdition,
  resumePlan,
  texteActivation,
  texteDesactivation,
  type FeuilleImport,
} from './horaires-onglet';

const GRAND: Grille = {
  ...(grandServiceJson as unknown as Grille),
  actif: true,
  cree_le: '2026-06-05T00:00:00Z',
};
const PETIT: Grille = {
  ...(petitServiceJson as unknown as Grille),
  actif: true,
  cree_le: '2026-06-05T00:00:00Z',
};
const ACTIVES = [GRAND, PETIT];
const FICHIER = '2026-ete-exploit-v1.xlsx';

function feuilles(): FeuilleImport[] {
  const r = parseClasseur(cellulesJson.feuilles as FeuilleCellules[]);
  return r.feuilles.map((f) => nouvelleFeuilleImport(f, ACTIVES));
}

describe('nouvelleFeuilleImport et écarts', () => {
  it('pré-remplit libellé et périodes depuis le fichier, sans avertissement sur le document officiel', () => {
    const [petit, grand] = feuilles();
    expect(grand?.libelle).toBe('Grand service — été 2026');
    expect(grand?.periodes).toEqual(GRAND.periodes);
    expect(petit?.periodes).toEqual(PETIT.periodes);
    expect(grand?.avertissements).toEqual([]);
    expect(grand?.inclure).toBe(true);
  });

  it('retrouve la grille active couvrant les mêmes dates et ne voit aucun écart avec elle', () => {
    const [, grand] = feuilles();
    if (!grand) throw new Error('feuille absente');
    expect(grillePrecedentePour(ACTIVES, grand.periodes)?.version).toBe('2026-ete-grand-service');
    const e = ecartsFeuille(grand, ACTIVES);
    expect(e?.precedente.version).toBe('2026-ete-grand-service');
    expect(e?.ecarts.aucun).toBe(true);
    expect(e?.ecarts.periodes.identiques).toBe(true);
  });

  it('sans grille active sur ces dates (hiver) : pas de comparaison', () => {
    const [, grand] = feuilles();
    if (!grand) throw new Error('feuille absente');
    grand.periodes = [{ du: '2026-12-19', au: '2027-04-11' }];
    expect(ecartsFeuille(grand, ACTIVES)).toBeNull();
    expect(grillePrecedentePour(ACTIVES, grand.periodes)).toBeNull();
  });

  it('un indicateur différent de la grille précédente devient un avertissement à acquitter', () => {
    const r = parseClasseur(cellulesJson.feuilles as FeuilleCellules[]);
    const grand = r.feuilles[1];
    if (!grand?.grille) throw new Error('feuille absente');
    const precedente: Grille = {
      ...GRAND,
      montees: GRAND.montees.map((m) => (m.numero === 1 ? { ...m, velos: false } : m)),
    };
    const f = nouvelleFeuilleImport(grand, [precedente, PETIT]);
    expect(f.avertissements.map((a) => a.message)).toEqual([
      'TRAIN 1 : velos non → oui dans le fichier (le fichier fait foi)',
    ]);
  });
});

describe('raisonsBlocage', () => {
  it('le document officiel, périodes confirmées : rien ne bloque', () => {
    expect(raisonsBlocage(feuilles())).toEqual([]);
  });

  it('aucune feuille cochée', () => {
    const fs = feuilles().map((f) => ({ ...f, inclure: false }));
    expect(raisonsBlocage(fs)).toEqual(['Aucune feuille à charger : cochez au moins une feuille.']);
  });

  it('périodes absentes, nom vide, période à l’envers', () => {
    const fs = feuilles();
    fs[0]!.periodes = [];
    fs[1]!.libelle = '  ';
    expect(raisonsBlocage(fs)).toEqual([
      '« Petit service » : indiquez au moins une période de validité (du… au…).',
      '« Grand service » : donnez un nom à la grille.',
    ]);
    fs[0]!.periodes = [{ du: '2026-07-10', au: '2026-07-01' }];
    expect(raisonsBlocage(fs)[0]).toBe(
      '« Petit service » : la fin (01/07/2026) est avant le début (10/07/2026).',
    );
    // Deux périodes de la même feuille ne peuvent pas se chevaucher non plus
    fs[0]!.periodes = [
      { du: '2026-06-13', au: '2026-07-03' },
      { du: '2026-06-20', au: '2026-06-25' },
    ];
    expect(raisonsBlocage(fs)[0]).toMatch(/« Petit service » : les périodes .* se chevauchent/);
  });

  it('erreurs du fichier et avertissements non acquittés bloquent ; l’acquittement libère', () => {
    const fs = feuilles();
    fs[1]!.avertissements = [{ niveau: 'avertissement', message: 'x' }];
    expect(raisonsBlocage(fs)).toEqual([
      "« Grand service » : lisez les avertissements et cochez « J'ai lu ces avertissements ».",
    ]);
    fs[1]!.avertissementsAcquittes = true;
    expect(raisonsBlocage(fs)).toEqual([]);
    fs[1]!.resultat = {
      ...fs[1]!.resultat,
      erreurs: [
        { niveau: 'erreur', message: 'a' },
        { niveau: 'erreur', message: 'b' },
      ],
    };
    expect(raisonsBlocage(fs)).toEqual([
      '« Grand service » : 2 erreur(s) à corriger dans le fichier Excel, puis recharger le fichier.',
    ]);
  });

  it('deux feuilles incluses ne peuvent pas se chevaucher ; une feuille exclue ne compte pas', () => {
    const fs = feuilles();
    fs[0]!.periodes = [{ du: '2026-06-13', au: '2026-07-10' }];
    expect(raisonsBlocage(fs)).toHaveLength(1);
    expect(raisonsBlocage(fs)[0]).toMatch(/se chevauchent : une seule grille par jour/);
    fs[0]!.inclure = false;
    expect(raisonsBlocage(fs)).toEqual([]);
  });
});

describe('planValidation et résumé', () => {
  it('réimporter le document été 2026 crée des versions -v2 qui remplacent les grilles actives', () => {
    const plans = planValidation(
      feuilles(),
      FICHIER,
      ACTIVES,
      ACTIVES.map((g) => g.version),
    );
    expect(plans.map((p) => p.grille.version)).toEqual([
      '2026-ete-petit-service-v2',
      '2026-ete-grand-service-v2',
    ]);
    expect(plans[1]?.aDesactiver.map((g) => g.version)).toEqual(['2026-ete-grand-service']);
    expect(plans[0]?.aDesactiver.map((g) => g.version)).toEqual(['2026-ete-petit-service']);
    expect(plans[1]?.grille.source).toBe('2026-ete-exploit-v1.xlsx — mise à jour du 05/06/2026');
    expect(plans[1]?.grille.actif).toBeUndefined(); // les métadonnées sont posées par la base
    expect(resumePlan(plans[1]!)).toBe(
      'Grille « Grand service — été 2026 » chargée (référence 2026-ete-grand-service-v2) : 04/07/2026 → 30/08/2026 ; 13 montées + 13 descentes — remplace « Grand service — été 2026 » (désactivée, réactivable)',
    );
  });

  it('une seule feuille cochée, journées à réinitialiser, commentaire', () => {
    const fs = feuilles();
    fs[0]!.inclure = false;
    fs[1]!.commentaire = '  heures corrigées  ';
    fs[1]!.joursAReinitialiser = new Set(['2026-07-20', '2026-07-15']);
    const plans = planValidation(fs, FICHIER, [], []);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.grille.version).toBe('2026-ete-grand-service');
    expect(plans[0]?.commentaire).toBe('heures corrigées');
    expect(plans[0]?.aDesactiver).toEqual([]);
    expect(resumePlan(plans[0]!)).toMatch(/journées réinitialisées : 15\/07\/2026, 20\/07\/2026$/);
  });

  it('deux versions attribuées dans le même lot ne se télescopent pas', () => {
    const fs = feuilles();
    fs[0]!.resultat = { ...fs[0]!.resultat, nom: 'Service' };
    fs[1]!.resultat = { ...fs[1]!.resultat, nom: 'Service' };
    fs[1]!.periodes = [{ du: '2026-10-01', au: '2026-10-10' }]; // pas de chevauchement
    const plans = planValidation(fs, FICHIER, [], []);
    expect(plans.map((p) => p.grille.version)).toEqual(['2026-ete-service', '2026-ete-service-v2']);
  });
});

describe('confirmations', () => {
  const grandV2: Grille = {
    ...GRAND,
    version: 'grand-v2',
    libelle: 'Grand service — été 2026 (v2)',
    cree_le: '2026-09-01T00:00:00Z',
  };

  it('désactivation : qui reprend la main, ou hors saison', () => {
    expect(texteDesactivation([GRAND, PETIT, grandV2], 'grand-v2')).toBe(
      [
        'Désactiver la grille « Grand service — été 2026 (v2) » ?',
        '',
        'Du 04/07/2026 au 30/08/2026 : la grille « Grand service — été 2026 » reprend la main.',
        '',
        'Les écrans suivent en quelques secondes. Elle pourra être réactivée à tout moment.',
      ].join('\n'),
    );
    expect(texteDesactivation([GRAND, PETIT], '2026-ete-petit-service')).toContain(
      'Du 13/06/2026 au 03/07/2026 : plus aucun service ne sera affiché (hors saison).',
    );
  });

  it('désactivation après un import : rappelle quelle grille réactiver pour revenir en arrière', () => {
    // À l'import, la v1 a été désactivée automatiquement ; désactiver la v2
    // laisserait les dates sans service — le message dit quoi réactiver.
    const texte = texteDesactivation([{ ...GRAND, actif: false }, PETIT, grandV2], 'grand-v2');
    expect(texte).toContain(
      'Du 04/07/2026 au 30/08/2026 : plus aucun service ne sera affiché (hors saison).',
    );
    expect(texte).toContain(
      'Pour revenir en arrière sur ces dates, réactivez ensuite « Grand service — été 2026 » (chargée le 05/06/2026).',
    );
  });

  it('activation : ce qu’elle remplace, ou ce qui reste prioritaire', () => {
    const inactive = { ...grandV2, actif: false };
    expect(texteActivation([GRAND, PETIT, inactive], 'grand-v2')).toContain(
      "Du 04/07/2026 au 30/08/2026 : elle s'applique et remplace « Grand service — été 2026 » (plus ancienne).",
    );
    const v1Inactive = { ...GRAND, actif: false };
    expect(texteActivation([v1Inactive, PETIT, grandV2], '2026-ete-grand-service')).toContain(
      'ATTENTION, la grille « Grand service — été 2026 (v2) », plus récente, reste prioritaire.',
    );
  });

  it('dates lisibles', () => {
    expect(dateCourte('2026-07-04')).toBe('04/07/2026');
    expect(dateLongue('2026-07-04')).toMatch(/sam\. 4 juil\. 2026/);
  });
});

describe('modification d’une grille : nom, dates de validité, commentaire', () => {
  const petitRecent: Grille = { ...PETIT, cree_le: '2026-06-06T00:00:00Z' };
  const prolongees = [PETIT.periodes[0]!, { du: '2026-08-24', au: '2026-09-27' }];

  it('nouvelleEdition copie la fiche ; rien à enregistrer tant que rien ne change', () => {
    const e = nouvelleEdition(PETIT);
    expect(e.periodes).toEqual(PETIT.periodes);
    expect(e.periodes).not.toBe(PETIT.periodes);
    expect(e.commentaire).toBe('');
    expect(raisonsBlocageEdition(PETIT, e)).toEqual(['Aucune modification à enregistrer.']);
    e.commentaire = 'saison prolongée';
    expect(raisonsBlocageEdition(PETIT, e)).toEqual([]);
  });

  it('nom vide, période à l’envers, périodes qui se chevauchent : messages précis', () => {
    const e = nouvelleEdition(PETIT);
    e.libelle = '  ';
    e.periodes = [
      { du: '2026-06-13', au: '2026-06-01' },
      { du: '2026-08-31', au: '2026-09-27' },
      { du: '2026-09-20', au: '2026-10-04' },
    ];
    expect(raisonsBlocageEdition(PETIT, e)).toEqual([
      'Donnez un nom à la grille.',
      'période 1 : la fin (01/06/2026) est avant le début (13/06/2026).',
      'les périodes 31/08/2026 → 27/09/2026 et 20/09/2026 → 04/10/2026 se chevauchent : fusionnez-les ou corrigez les dates.',
    ]);
  });

  it('prolonger le petit service d’une semaine : l’effet dit qui est remplacé et ce qui est conservé', () => {
    const e = nouvelleEdition(petitRecent);
    e.periodes = prolongees;
    const effet = effetChangementPeriodes(
      [GRAND, petitRecent],
      PETIT.version,
      periodesValides(e.periodes),
    );
    expect(lignesEffetPeriodes(petitRecent, effet)).toEqual([
      {
        niveau: 'info',
        texte:
          'Dates ajoutées du 24/08/2026 au 30/08/2026 : cette grille remplacera « Grand service — été 2026 » (plus ancienne).',
      },
      { niveau: 'info', texte: '49 jour(s) conservé(s) : rien ne change pour eux.' },
    ]);
    expect(datesGagnees(effet)).toHaveLength(7);
    expect(datesGagnees(effet)[0]).toBe('2026-08-24');
    expect(resumeEdition(petitRecent, e)).toBe(
      'Grille « Petit service — été 2026 » modifiée (référence 2026-ete-petit-service) — dates 13/06/2026 → 03/07/2026 et 31/08/2026 → 27/09/2026 → 13/06/2026 → 03/07/2026 et 24/08/2026 → 27/09/2026',
    );
  });

  it('quand l’autre grille reste prioritaire, ou que la grille est désactivée, l’effet prévient', () => {
    const e = nouvelleEdition(PETIT);
    e.periodes = prolongees;
    const effet = effetChangementPeriodes([GRAND, PETIT], PETIT.version, e.periodes);
    expect(lignesEffetPeriodes(PETIT, effet)[0]).toEqual({
      niveau: 'attention',
      texte:
        'Dates ajoutées du 24/08/2026 au 30/08/2026 : ATTENTION, la grille « Grand service — été 2026 », déjà en service et chargée en même temps ou plus récemment, reste prioritaire : cette grille n’y sera pas affichée.',
    });
    const inactive: Grille = { ...PETIT, actif: false };
    const effetInactive = effetChangementPeriodes([GRAND, inactive], PETIT.version, e.periodes);
    expect(lignesEffetPeriodes(inactive, effetInactive)[0]?.texte).toMatch(
      /sans effet tant que la grille est désactivée/,
    );
  });

  it('retirer des dates : hors saison ou reprise ; dates inchangées', () => {
    const e = nouvelleEdition(PETIT);
    e.periodes = [{ du: '2026-06-20', au: '2026-07-03' }];
    const effet = effetChangementPeriodes([GRAND, PETIT], PETIT.version, e.periodes);
    expect(lignesEffetPeriodes(PETIT, effet).map((l) => l.texte)).toEqual([
      'Dates retirées du 13/06/2026 au 19/06/2026 : plus aucun service ne sera affiché (hors saison).',
      'Dates retirées du 31/08/2026 au 27/09/2026 : plus aucun service ne sera affiché (hors saison).',
      '14 jour(s) conservé(s) : rien ne change pour eux.',
    ]);
    const inchange = effetChangementPeriodes([GRAND, PETIT], PETIT.version, PETIT.periodes);
    expect(lignesEffetPeriodes(PETIT, inchange)).toEqual([
      { niveau: 'info', texte: 'Dates de validité inchangées.' },
    ]);
  });

  it('resumeEdition : nom, commentaire et journées réinitialisées', () => {
    const e = nouvelleEdition(PETIT);
    e.libelle = 'Petit service — été 2026 (prolongé)';
    e.commentaire = 'demande du chef d’exploitation';
    e.joursAReinitialiser = new Set(['2026-08-25', '2026-08-24']);
    expect(resumeEdition(PETIT, e)).toBe(
      'Grille « Petit service — été 2026 » modifiée (référence 2026-ete-petit-service) — nom « Petit service — été 2026 » → « Petit service — été 2026 (prolongé) » — commentaire : demande du chef d’exploitation — journées réinitialisées : 24/08/2026, 25/08/2026',
    );
  });
});
