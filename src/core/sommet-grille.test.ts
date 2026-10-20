// En hiver, Bellevue est le SOMMET — la plus haute gare desservie par une
// montée de la grille du jour (défaut mesuré en production le 16/10/2026 :
// l'embed et la grille du jour parlaient encore du Nid d'Aigle). La règle se
// lit sur la GRILLE seule ; la bascule « terminus Bellevue » et la section
// exploitée restent des fermetures temporaires, qu'elle ne remplace pas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import {
  bornesAffichees,
  gareNonDesservie,
  generationJour,
  sectionDuJour,
  sommetDeLaGrille,
} from './horaires';
import { parseFeuille } from './import-grille';
import { lireClasseur } from './lecture-xlsx';
import type { Grille, Jour, TrainGrille } from './types';

const ETE = grandServiceJson as unknown as Grille;

/** La grille d'hiver 2026-2027 telle que l'exploitation l'importe. */
function grilleHiverReelle(): Grille {
  const fichier = fileURLToPath(
    new URL('./__fixtures__/2026-2027-hiver-service-unique.xlsx', import.meta.url),
  );
  const f = lireClasseur(new Uint8Array(readFileSync(fichier))).find((x) => x.nom === 'Hiver');
  if (!f) throw new Error('feuille « Hiver » absente du fichier de référence');
  const r = parseFeuille(f);
  if (!r.grille || r.erreurs.length > 0)
    throw new Error(r.erreurs.map((e) => e.message).join('\n'));
  return { ...r.grille, periodes: r.periodesProposees };
}

let HIVER: Grille;
beforeAll(() => {
  HIVER = grilleHiverReelle();
});

/** Un TRAIN 99 qui monte au Nid d'Aigle, à verser dans une grille d'hiver. */
function monteeAuNidDAigle(extra: Partial<TrainGrille> = {}): TrainGrille {
  return {
    numero: 99,
    express: false,
    facultatif: false,
    velos: false,
    passages: [
      { gare: 'le-fayet', d: '12:00:00' },
      { gare: 'bellevue', a: '12:40:00', d: '12:41:00' },
      { gare: 'nid-daigle', a: '12:55:00' },
    ],
    ...extra,
  };
}

describe('sommetDeLaGrille', () => {
  it('été : le Nid d’Aigle', () => {
    expect(sommetDeLaGrille(ETE, '2026-08-15')).toBe('nid-daigle');
    expect(gareNonDesservie(ETE, '2026-08-15', 'nid-daigle')).toBe(false);
  });

  it('hiver (grille réelle 2026-2027) : Bellevue, un samedi comme un lundi', () => {
    for (const date of ['2026-12-12', '2026-12-14', '2027-03-29']) {
      expect(sommetDeLaGrille(HIVER, date)).toBe('bellevue');
      expect(gareNonDesservie(HIVER, date, 'nid-daigle')).toBe(true);
      expect(gareNonDesservie(HIVER, date, 'bellevue')).toBe(false);
      expect(gareNonDesservie(HIVER, date, 'le-fayet')).toBe(false);
    }
  });

  it('un tiret n’est pas une desserte', () => {
    const tirets: Grille = {
      ...HIVER,
      montees: [
        ...HIVER.montees,
        monteeAuNidDAigle({
          passages: [
            { gare: 'le-fayet', d: '12:00:00' },
            { gare: 'bellevue', a: '12:40:00' },
            { gare: 'nid-daigle', a: '-', d: '-' },
          ],
        }),
      ],
    };
    expect(sommetDeLaGrille(tirets, '2026-12-14')).toBe('bellevue');
    const sansHeure: Grille = {
      ...HIVER,
      montees: [
        ...HIVER.montees,
        monteeAuNidDAigle({
          passages: [
            { gare: 'le-fayet', d: '12:00:00' },
            { gare: 'bellevue', a: '12:40:00' },
            { gare: 'nid-daigle' },
          ],
        }),
      ],
    };
    expect(sommetDeLaGrille(sansHeure, '2026-12-14')).toBe('bellevue');
  });

  it('une heure réelle au Nid d’Aigle en fait le sommet', () => {
    const g: Grille = { ...HIVER, montees: [...HIVER.montees, monteeAuNidDAigle()] };
    expect(sommetDeLaGrille(g, '2026-12-14')).toBe('nid-daigle');
  });

  it('les jours de circulation filtrent : un train du samedi ne compte que le samedi', () => {
    const g: Grille = {
      ...HIVER,
      montees: [...HIVER.montees, monteeAuNidDAigle({ jours: [6] })],
    };
    expect(sommetDeLaGrille(g, '2026-12-12')).toBe('nid-daigle'); // samedi
    expect(sommetDeLaGrille(g, '2026-12-14')).toBe('bellevue'); // lundi
  });

  it('aucune montée exploitable : la ligne complète, on ne retire rien', () => {
    expect(sommetDeLaGrille({ montees: [] }, '2026-12-14')).toBe('nid-daigle');
    expect(gareNonDesservie({ montees: [] }, '2026-12-14', 'nid-daigle')).toBe(false);
  });
});

describe('bornesAffichees — titres de la grille du jour', () => {
  it('hiver, ligne complète : Le Fayet → Bellevue', () => {
    const jour = generationJour(HIVER, '2026-12-12');
    expect(bornesAffichees(HIVER, jour)).toEqual({ debut: 'le-fayet', fin: 'bellevue' });
  });

  it('été : la section du jour, inchangée', () => {
    const jour = generationJour(ETE, '2026-08-15');
    expect(bornesAffichees(ETE, jour)).toEqual(sectionDuJour(jour));
    expect(bornesAffichees(ETE, jour).fin).toBe('nid-daigle');
  });

  it('été, bascule terminus Bellevue : une fermeture, pas une saison — titres inchangés', () => {
    const jour: Jour = {
      ...generationJour(ETE, '2026-08-15'),
      terminus_bellevue: { a_partir_du_train: 1 },
    };
    expect(bornesAffichees(ETE, jour)).toEqual({ debut: 'le-fayet', fin: 'nid-daigle' });
  });

  it('la plus basse des deux fins : une section plus courte que la grille l’emporte', () => {
    const ete: Jour = { ...generationJour(ETE, '2026-08-15'), gare_fin: 'motivon' };
    expect(bornesAffichees(ETE, ete)).toEqual({ debut: 'le-fayet', fin: 'motivon' });
    const hiver: Jour = { ...generationJour(HIVER, '2026-12-12'), gare_fin: 'motivon' };
    expect(bornesAffichees(HIVER, hiver)).toEqual({ debut: 'le-fayet', fin: 'motivon' });
  });

  it('un sommet sous le début de section ne fait pas de titre à l’envers', () => {
    const jour: Jour = {
      ...generationJour(HIVER, '2026-12-12'),
      gare_debut: 'bellevue',
      gare_fin: 'nid-daigle',
    };
    expect(bornesAffichees(HIVER, jour)).toEqual({ debut: 'bellevue', fin: 'nid-daigle' });
  });
});
