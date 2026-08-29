// Train supplémentaire : calcul des horaires depuis la grille en vigueur.
//
// Les temps de parcours ne sont JAMAIS codés en dur ici non plus : les
// attentes chiffrées viennent du document d'exploitation (grille été 2026),
// et le dernier bloc rejoue le tout sur une grille hiver fictive pour
// démontrer que le calcul suit la grille et rien d'autre.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import { heureVersSecondes } from './horaires';
import {
  calculePassagesSup,
  construitRotationSup,
  garesSautees,
  NUMERO_SUP_MIN,
  prochainNumeroSup,
  tempsDeGrille,
} from './train-sup';
import type { GareId, Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const h = heureVersSecondes;

/** Heure d'arrivée (ou de départ à l'origine) à une gare donnée. */
function heureA(passages: { gare: GareId; a?: string; d?: string }[], gare: GareId): string {
  const p = passages.find((x) => x.gare === gare);
  if (!p) throw new Error(`${gare} absente des passages`);
  return p.a ?? p.d ?? '';
}

describe('Les temps sont LUS dans la grille, pas codés en dur', () => {
  it('montée : chaque segment et chaque arrêt vient du document d’exploitation', () => {
    const t = tempsDeGrille(GRAND, 'montee');
    expect(t.ordre).toEqual([
      'le-fayet',
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
      'nid-daigle',
    ]);
    expect(t.interGares.get('le-fayet|saint-gervais')).toBe(10 * 60);
    expect(t.interGares.get('saint-gervais|motivon')).toBe(11 * 60 + 30);
    expect(t.interGares.get('motivon|col-de-voza')).toBe(13 * 60);
    expect(t.arrets.get('saint-gervais')).toBe(5 * 60);
    expect(t.arrets.get('motivon')).toBe(60);
    // L'origine n'a pas d'arrêt : elle n'a qu'un départ
    expect(t.arrets.has('le-fayet')).toBe(false);
  });

  it('descente : l’ordre des gares est inversé', () => {
    const t = tempsDeGrille(GRAND, 'descente');
    expect(t.ordre[0]).toBe('nid-daigle');
    expect(t.ordre[t.ordre.length - 1]).toBe('le-fayet');
    expect(t.interGares.get('col-de-voza|motivon')).toBe(15 * 60);
    expect(t.interGares.get('motivon|saint-gervais')).toBe(14 * 60);
    expect(t.interGares.get('saint-gervais|le-fayet')).toBe(11 * 60);
    expect(t.arrets.get('saint-gervais')).toBe(2 * 60);
  });
});

describe('Calcul des passages — cas de l’exploitant', () => {
  it('montée Le Fayet → Col de Voza, départ 17:00:00 → arrivée 17:34:30', () => {
    // 10:00 + 11:30 + 13:00, sans les arrêts de Saint-Gervais ni Motivon :
    // c'est ce que le train de renfort gagne en ne s'y arrêtant pas.
    const passages = calculePassagesSup(
      GRAND,
      'montee',
      ['le-fayet', 'col-de-voza'],
      h('17:00:00'),
    );
    expect(passages).toEqual([
      { gare: 'le-fayet', d: '17:00:00' },
      { gare: 'col-de-voza', a: '17:34:30' },
    ]);
  });

  it('descente Col de Voza → Le Fayet, départ 17:39:30 → arrivée 18:19:30', () => {
    // 15:00 + 14:00 + 11:00 = 40:00
    const passages = calculePassagesSup(
      GRAND,
      'descente',
      ['col-de-voza', 'le-fayet'],
      h('17:39:30'),
    );
    expect(passages).toEqual([
      { gare: 'col-de-voza', d: '17:39:30' },
      { gare: 'le-fayet', a: '18:19:30' },
    ]);
  });

  it('la même descente desservant Saint-Gervais arrive 2 min plus tard', () => {
    const passages = calculePassagesSup(
      GRAND,
      'descente',
      ['col-de-voza', 'saint-gervais', 'le-fayet'],
      h('17:39:30'),
    );
    expect(heureA(passages, 'saint-gervais')).toBe('18:08:30'); // 15:00 + 14:00
    expect(heureA(passages, 'le-fayet')).toBe('18:21:30'); // +2 min d'arrêt
    // La gare intermédiaire porte bien une arrivée ET un départ
    expect(passages[1]).toEqual({ gare: 'saint-gervais', a: '18:08:30', d: '18:10:30' });
  });

  it('l’origine n’a qu’un départ, le terminus qu’une arrivée', () => {
    const passages = calculePassagesSup(
      GRAND,
      'montee',
      ['le-fayet', 'col-de-voza', 'nid-daigle'],
      h('17:00:00'),
    );
    expect(passages[0]?.a).toBeUndefined();
    expect(passages[passages.length - 1]?.d).toBeUndefined();
  });
});

describe('Rotation complète', () => {
  it('la descente repart du terminus après le battement', () => {
    const rotation = construitRotationSup(GRAND, {
      heureDepart_s: h('17:00:00'),
      garesMontee: ['le-fayet', 'col-de-voza'],
      garesDescente: ['col-de-voza', 'le-fayet'],
      battement_s: 5 * 60,
    });
    expect(heureA(rotation.montee, 'col-de-voza')).toBe('17:34:30');
    expect(rotation.descente[0]).toEqual({ gare: 'col-de-voza', d: '17:39:30' });
    expect(heureA(rotation.descente, 'le-fayet')).toBe('18:19:30');
  });

  it('le battement est réglable', () => {
    const rotation = construitRotationSup(GRAND, {
      heureDepart_s: h('17:00:00'),
      garesMontee: ['le-fayet', 'col-de-voza'],
      garesDescente: ['col-de-voza', 'le-fayet'],
      battement_s: 15 * 60,
    });
    expect(rotation.descente[0]?.d).toBe('17:49:30');
  });

  it('une descente qui ne repart pas du terminus est refusée', () => {
    expect(() =>
      construitRotationSup(GRAND, {
        heureDepart_s: h('17:00:00'),
        garesMontee: ['le-fayet', 'col-de-voza'],
        garesDescente: ['bellevue', 'le-fayet'],
      }),
    ).toThrow(/doit repartir du terminus/);
  });
});

describe('Garde-fous : aucune heure inventée', () => {
  it('des gares hors ordre sont refusées', () => {
    expect(() =>
      calculePassagesSup(GRAND, 'montee', ['col-de-voza', 'le-fayet'], h('17:00:00')),
    ).toThrow(/hors ordre/);
  });

  it('une gare inconnue est refusée', () => {
    expect(() =>
      calculePassagesSup(GRAND, 'montee', ['le-fayet', 'chamonix' as GareId], h('17:00:00')),
    ).toThrow(/hors ordre/);
  });

  it('moins de deux gares n’est pas un trajet', () => {
    expect(() => calculePassagesSup(GRAND, 'montee', ['le-fayet'], h('17:00:00'))).toThrow(
      /au moins deux gares/,
    );
  });

  it('une grille sans train non express ne permet aucun calcul', () => {
    const sansReference: Grille = {
      ...GRAND,
      montees: GRAND.montees.filter((t) => t.express),
    };
    expect(() => tempsDeGrille(sansReference, 'montee')).toThrow(/aucun train non express/);
  });
});

describe('Numérotation : impair = montée, à partir de 101', () => {
  it('le premier train sup prend 101', () => {
    expect(prochainNumeroSup([1, 2, 3, 25, 26])).toBe(NUMERO_SUP_MIN);
    expect(NUMERO_SUP_MIN).toBe(101);
  });

  it('le suivant prend 103, la parité étant conservée', () => {
    expect(prochainNumeroSup([1, 2, 101, 102])).toBe(103);
    expect(prochainNumeroSup([101, 102, 103, 104])).toBe(105);
  });

  it('une descente déjà prise suffit à écarter le numéro impair', () => {
    // 102 pris sans 101 : la rotation 101/102 n'est pas disponible
    expect(prochainNumeroSup([102])).toBe(103);
  });
});

describe('Gares sautées — mention « SANS ARRÊT » de l’écran', () => {
  it('liste les gares non desservies entre l’origine et le terminus', () => {
    expect(garesSautees(GRAND, 'montee', ['le-fayet', 'col-de-voza'])).toEqual([
      'saint-gervais',
      'motivon',
    ]);
  });

  it('rien à signaler quand le train dessert tout', () => {
    expect(
      garesSautees(GRAND, 'montee', ['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza']),
    ).toEqual([]);
  });

  it('les gares AU-DELÀ du terminus ne sont pas « sautées »', () => {
    // Un train limité au Col de Voza n'omet pas Bellevue : il n'y va pas.
    expect(garesSautees(GRAND, 'montee', ['le-fayet', 'col-de-voza'])).not.toContain('bellevue');
  });
});

describe('Grille hiver fictive : le calcul suit la grille', () => {
  // Mêmes gares, temps DIFFÉRENTS : si une valeur était codée en dur, ce bloc
  // échouerait.
  const HIVER: Grille = {
    ...GRAND,
    version: '2026-hiver-fictif',
    montees: [
      {
        numero: 1,
        express: false,
        facultatif: false,
        velos: false,
        passages: [
          { gare: 'le-fayet', d: '09:00:00' },
          { gare: 'saint-gervais', a: '09:20:00', d: '09:23:00' },
          { gare: 'motivon', a: '09:40:00', d: '09:42:00' },
          { gare: 'col-de-voza', a: '10:00:00' },
        ],
      },
    ],
    descentes: GRAND.descentes,
  };

  it('les temps lus sont ceux de la grille hiver', () => {
    const t = tempsDeGrille(HIVER, 'montee');
    expect(t.interGares.get('le-fayet|saint-gervais')).toBe(20 * 60);
    expect(t.interGares.get('saint-gervais|motivon')).toBe(17 * 60);
    expect(t.interGares.get('motivon|col-de-voza')).toBe(18 * 60);
  });

  it('un train sup hiver Le Fayet → Col de Voza met 55 min, pas 34:30', () => {
    // 20 + 17 + 18 = 55 min, sans les arrêts intermédiaires
    const passages = calculePassagesSup(
      HIVER,
      'montee',
      ['le-fayet', 'col-de-voza'],
      h('17:00:00'),
    );
    expect(heureA(passages, 'col-de-voza')).toBe('17:55:00');
  });

  it('avec arrêt à Saint-Gervais, les 3 min d’arrêt hiver s’ajoutent', () => {
    const passages = calculePassagesSup(
      HIVER,
      'montee',
      ['le-fayet', 'saint-gervais', 'col-de-voza'],
      h('17:00:00'),
    );
    expect(heureA(passages, 'saint-gervais')).toBe('17:20:00');
    expect(heureA(passages, 'col-de-voza')).toBe('17:58:00'); // +3 min d'arrêt
  });
});
