// Priorité entre grilles enregistrées : quelles grilles une nouvelle rend
// inutiles, et qui reprend la main quand on en désactive une.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import {
  datesDesPeriodes,
  effetChangementPeriodes,
  grillesEntierementCouvertes,
  reprisesApresDesactivation,
} from './grilles-periodes';
import type { Grille } from './types';

const GRAND: Grille = {
  ...(grandServiceJson as unknown as Grille),
  cree_le: '2026-06-05T00:00:00Z',
};
const PETIT: Grille = {
  ...(petitServiceJson as unknown as Grille),
  cree_le: '2026-06-05T00:00:00Z',
};

describe('datesDesPeriodes', () => {
  it('énumère les dates, bornes incluses, triées et sans doublon', () => {
    expect(datesDesPeriodes([{ du: '2026-08-30', au: '2026-09-02' }])).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(datesDesPeriodes(PETIT.periodes)).toHaveLength(21 + 28);
    expect(
      datesDesPeriodes([
        { du: '2026-07-02', au: '2026-07-03' },
        { du: '2026-07-01', au: '2026-07-02' },
      ]),
    ).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });
});

describe('grillesEntierementCouvertes', () => {
  const grandV2: Grille = { ...GRAND, version: 'grand-v2', cree_le: '2026-09-01T00:00:00Z' };

  it('une réimportation aux mêmes dates recouvre entièrement l’ancienne version', () => {
    expect(grillesEntierementCouvertes([GRAND, PETIT], grandV2).map((g) => g.version)).toEqual([
      '2026-ete-grand-service',
    ]);
  });

  it('une grille partiellement recouverte reste active (elle sert encore ailleurs)', () => {
    const aout: Grille = { ...grandV2, periodes: [{ du: '2026-08-01', au: '2026-08-30' }] };
    expect(grillesEntierementCouvertes([GRAND, PETIT], aout)).toEqual([]);
  });

  it('ignore les grilles déjà inactives et la nouvelle elle-même', () => {
    expect(grillesEntierementCouvertes([{ ...GRAND, actif: false }, grandV2], grandV2)).toEqual([]);
  });
});

describe('reprisesApresDesactivation', () => {
  const grandV2: Grille = { ...GRAND, version: 'grand-v2', cree_le: '2026-09-01T00:00:00Z' };

  it('désactiver la v2 rend la main à la v1 sur toutes ses dates', () => {
    expect(reprisesApresDesactivation([GRAND, PETIT, grandV2], 'grand-v2')).toEqual([
      {
        du: '2026-07-04',
        au: '2026-08-30',
        version: '2026-ete-grand-service',
        libelle: 'Grand service — été 2026',
      },
    ]);
  });

  it('sans remplaçante : plus aucun service sur ces dates', () => {
    expect(reprisesApresDesactivation([GRAND, PETIT], '2026-ete-grand-service')).toEqual([
      { du: '2026-07-04', au: '2026-08-30', version: null, libelle: null },
    ]);
  });

  it('découpe en plages quand la reprise change en cours de route', () => {
    const aoutV2: Grille = {
      ...grandV2,
      periodes: [{ du: '2026-08-01', au: '2026-09-05' }],
      libelle: 'Août v2',
    };
    expect(reprisesApresDesactivation([GRAND, PETIT, aoutV2], 'grand-v2')).toEqual([
      {
        du: '2026-08-01',
        au: '2026-08-30',
        version: '2026-ete-grand-service',
        libelle: 'Grand service — été 2026',
      },
      {
        du: '2026-08-31',
        au: '2026-09-05',
        version: '2026-ete-petit-service',
        libelle: 'Petit service — été 2026',
      },
    ]);
  });

  it('une version inconnue ne renvoie rien', () => {
    expect(reprisesApresDesactivation([GRAND], 'inconnue')).toEqual([]);
  });
});

describe('effetChangementPeriodes (modifier les dates d’une grille)', () => {
  const petitRecent: Grille = { ...PETIT, cree_le: '2026-06-06T00:00:00Z' };
  const prolongees = [PETIT.periodes[0]!, { du: '2026-08-24', au: '2026-09-27' }];

  it('prolonger le petit service d’une semaine sur le grand : dates gagnées, grille remplacée, jours conservés', () => {
    const effet = effetChangementPeriodes([GRAND, petitRecent], PETIT.version, prolongees);
    expect(effet.gagnees).toHaveLength(1);
    expect(effet.gagnees[0]).toMatchObject({ du: '2026-08-24', au: '2026-08-30', sApplique: true });
    expect(effet.gagnees[0]?.avant?.version).toBe(GRAND.version);
    expect(effet.gagnees[0]?.gagnante?.version).toBe(PETIT.version);
    expect(effet.perdues).toEqual([]);
    expect(effet.conservees).toBe(49); // 21 jours en juin-juillet + 28 en septembre
    expect(effet.chevauchements).toHaveLength(1);
    expect(effet.chevauchements[0]).toMatchObject({ du: '2026-08-24', au: '2026-08-30' });
    expect(effet.chevauchements[0]?.autre.version).toBe(GRAND.version);
    expect(effet.chevauchements[0]?.prioritaire.version).toBe(PETIT.version);
  });

  it('si l’autre grille est aussi récente ou plus, la grille modifiée ne s’applique pas sur les dates gagnées', () => {
    // Même date de chargement : la première de la liste (GRAND) garde la main.
    const effet = effetChangementPeriodes([GRAND, PETIT], PETIT.version, prolongees);
    expect(effet.gagnees[0]).toMatchObject({ sApplique: false });
    expect(effet.gagnees[0]?.gagnante?.version).toBe(GRAND.version);
  });

  it('raccourcir : dates perdues avec reprise ou hors saison, dates gagnées non prioritaires', () => {
    const effet = effetChangementPeriodes([GRAND, PETIT], PETIT.version, [
      { du: '2026-06-20', au: '2026-07-05' },
    ]);
    expect(effet.perdues.map((p) => [p.du, p.au, p.reprise?.version ?? null])).toEqual([
      ['2026-06-13', '2026-06-19', null],
      ['2026-08-31', '2026-09-27', null],
    ]);
    expect(effet.gagnees.map((p) => [p.du, p.au, p.sApplique])).toEqual([
      ['2026-07-04', '2026-07-05', false],
    ]);
    expect(effet.conservees).toBe(14); // 20 juin → 3 juillet
  });

  it('grille désactivée : elle ne gagne rien tant qu’elle n’est pas réactivée', () => {
    const inactive: Grille = { ...petitRecent, actif: false };
    const effet = effetChangementPeriodes([GRAND, inactive], PETIT.version, prolongees);
    expect(effet.gagnees[0]).toMatchObject({ sApplique: false });
    expect(effet.gagnees[0]?.gagnante?.version).toBe(GRAND.version);
  });

  it('dates inchangées : rien de gagné ni de perdu ; version inconnue : effet vide', () => {
    const rien = effetChangementPeriodes([GRAND, PETIT], PETIT.version, PETIT.periodes);
    expect(rien.gagnees).toEqual([]);
    expect(rien.perdues).toEqual([]);
    expect(rien.conservees).toBe(49);
    expect(effetChangementPeriodes([GRAND], 'inconnue', PETIT.periodes)).toEqual({
      gagnees: [],
      perdues: [],
      conservees: 0,
      chevauchements: [],
    });
  });
});
