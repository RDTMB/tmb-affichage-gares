// Priorité entre grilles enregistrées : quelles grilles une nouvelle rend
// inutiles, et qui reprend la main quand on en désactive une.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import {
  datesDesPeriodes,
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
