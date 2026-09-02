import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import { decritEcarts, ecarts, libellePeriodes } from './ecarts-grille';
import type { Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;

describe('ecarts entre deux grilles', () => {
  it('une grille comparée à elle-même : aucun écart', () => {
    const e = ecarts(GRAND, structuredClone(GRAND));
    expect(e.aucun).toBe(true);
    expect(e.trainsAjoutes).toEqual([]);
    expect(e.trainsRetires).toEqual([]);
    expect(e.heures).toEqual([]);
    expect(e.indicateurs).toEqual([]);
    expect(e.periodes.identiques).toBe(true);
    expect(decritEcarts(e)).toEqual([]);
  });

  it('heure modifiée : par train, gare et champ, avec avant/après', () => {
    const nouvelle = structuredClone(GRAND);
    const motivon = nouvelle.montees[0]?.passages.find((p) => p.gare === 'motivon');
    if (!motivon) throw new Error('passage absent');
    motivon.a = '07:26:00';
    const e = ecarts(GRAND, nouvelle);
    expect(e.aucun).toBe(false);
    expect(e.heures).toEqual([
      {
        numero: 1,
        sens: 'montee',
        gare: 'motivon',
        champ: 'a',
        avant: '07:26:30',
        apres: '07:26:00',
      },
    ]);
    expect(decritEcarts(e)).toEqual(['TRAIN 1 — Motivon : arrivée 07:26 → 07:26']);
  });

  it('trains ajoutés et retirés, indicateurs modifiés', () => {
    const nouvelle: Grille = {
      ...GRAND,
      montees: [
        ...GRAND.montees.filter((m) => m.numero !== 25),
        { ...GRAND.montees[0]!, numero: 27 },
      ].map((m) => (m.numero === 3 ? { ...m, facultatif: false } : m)),
    };
    const e = ecarts(GRAND, nouvelle);
    expect(e.trainsAjoutes).toEqual([{ numero: 27, sens: 'montee' }]);
    expect(e.trainsRetires).toEqual([{ numero: 25, sens: 'montee' }]);
    expect(e.indicateurs).toEqual([
      { numero: 3, sens: 'montee', champ: 'facultatif', avant: true, apres: false },
    ]);
    expect(e.heures).toEqual([]);
    const lignes = decritEcarts(e);
    expect(lignes).toContain('TRAIN 27 ajouté (montée)');
    expect(lignes).toContain('TRAIN 25 retiré (montée)');
    expect(lignes).toContain('TRAIN 3 : facultatif oui → non');
  });

  it('un passage qui apparaît ou disparaît compte comme un écart d’heure', () => {
    const nouvelle = structuredClone(GRAND);
    const t9 = nouvelle.montees.find((m) => m.numero === 9);
    if (!t9) throw new Error('TRAIN 9 absent');
    t9.passages.splice(3, 0, { gare: 'col-de-voza', a: '11:10:30', d: '11:12:30' });
    const e = ecarts(GRAND, nouvelle);
    expect(e.heures).toEqual([
      {
        numero: 9,
        sens: 'montee',
        gare: 'col-de-voza',
        champ: 'a',
        avant: null,
        apres: '11:10:30',
      },
      {
        numero: 9,
        sens: 'montee',
        gare: 'col-de-voza',
        champ: 'd',
        avant: null,
        apres: '11:12:30',
      },
    ]);
    expect(decritEcarts(e)[0]).toBe('TRAIN 9 — Col de Voza : arrivée — → 11:10');
  });

  it('périodes différentes : signalées à part, sans rendre « aucun » faux', () => {
    const e = ecarts(GRAND, {
      ...structuredClone(GRAND),
      periodes: [{ du: '2026-07-01', au: '2026-08-31' }],
    });
    expect(e.aucun).toBe(true);
    expect(e.periodes.identiques).toBe(false);
    expect(decritEcarts(e)).toEqual([
      'Dates de validité : 04/07/2026 → 30/08/2026 → 01/07/2026 → 31/08/2026',
    ]);
    expect(libellePeriodes(PETIT.periodes)).toBe(
      '13/06/2026 → 03/07/2026 et 31/08/2026 → 27/09/2026',
    );
    expect(libellePeriodes([])).toBe('aucune période');
  });

  it('petit service contre grand service : les trains propres à chaque grille ressortent', () => {
    const e = ecarts(PETIT, GRAND);
    expect(e.trainsAjoutes.map((t) => t.numero)).toEqual([3, 9, 17, 23, 25, 4, 10, 18, 24, 26]);
    expect(e.trainsRetires).toEqual([]);
  });
});
