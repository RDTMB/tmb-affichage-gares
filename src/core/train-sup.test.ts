// Train supplémentaire : calcul des horaires depuis la grille en vigueur.
//
// Les temps de parcours ne sont JAMAIS codés en dur ici non plus : les
// attentes chiffrées viennent du document d'exploitation (grille été 2026),
// et le dernier bloc rejoue le tout sur une grille hiver fictive pour
// démontrer que le calcul suit la grille et rien d'autre.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { heureVersSecondes } from './horaires';
import {
  calculePassagesSup,
  construitRotationSup,
  controleDepartSup,
  garesSautees,
  NUMERO_SUP_MIN,
  prepareDepartSup,
  prochainNumeroSup,
  recalculeDescenteSup,
  tempsDeGrille,
} from './train-sup';
import type { GareId, Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const h = heureVersSecondes;

/** « HH:MM:SS » depuis des secondes — miroir local du format des grilles. */
function formatHmsTest(s: number): string {
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

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

// ---------------------------------------------------------------------------
// DÉPART RÉEL depuis le terminus
//
// Le battement choisi à la création n'est qu'une ESTIMATION : le temps de
// stationnement en haut change, et les heures affichées en gare deviennent
// fausses. L'agent constate l'heure réelle, la descente est recalculée.
// ---------------------------------------------------------------------------

/** Rotation de renfort, telle que la supervision la crée. */
function rotation(garesMontee: GareId[] = ['le-fayet', 'col-de-voza'], depart = '15:00') {
  const r = construitRotationSup(GRAND, {
    heureDepart_s: h(depart),
    garesMontee,
    garesDescente: [...garesMontee].reverse(),
  });
  return { montee: { passages: r.montee }, descente: { passages: r.descente } };
}

describe('Recalcul d’une descente sur son départ réel', () => {
  it('un départ 12 min plus tard décale TOUTES les heures de 12 min', () => {
    const { descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const recalcule = recalculeDescenteSup(GRAND, descente, h(estime) + 12 * 60);
    expect(recalcule).toHaveLength(descente.passages.length);
    recalcule.forEach((p, i) => {
      const avant = descente.passages[i];
      expect(p.gare).toBe(avant?.gare);
      if (avant?.d !== undefined) expect(h(p.d ?? '')).toBe(h(avant.d) + 12 * 60);
      if (avant?.a !== undefined) expect(h(p.a ?? '')).toBe(h(avant.a) + 12 * 60);
    });
  });

  it('exemple de l’exploitant : estimée à 16:30, partie à 16:42', () => {
    const { descente } = rotation();
    // On repositionne l'estimation à 16:30 pile pour lire les heures en clair.
    const base = recalculeDescenteSup(GRAND, descente, h('16:30'));
    const reel = recalculeDescenteSup(GRAND, { passages: base }, h('16:42'));
    expect(base[0]?.d).toBe('16:30:00');
    expect(reel[0]?.d).toBe('16:42:00');
    const arriveeBase = base[base.length - 1]?.a ?? '';
    const arriveeReel = reel[reel.length - 1]?.a ?? '';
    expect(h(arriveeReel) - h(arriveeBase)).toBe(12 * 60);
  });

  it('la DESSERTE choisie à la création est conservée, jamais réinventée', () => {
    // Un renfort qui dessert Motivon et Saint-Gervais garde exactement ces
    // deux arrêts : le recalcul ne décide pas à la place de l'agent.
    const { descente } = rotation(['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza']);
    const recalcule = recalculeDescenteSup(GRAND, descente, h('17:00'));
    expect(recalcule.map((p) => p.gare)).toEqual([
      'col-de-voza',
      'motivon',
      'saint-gervais',
      'le-fayet',
    ]);
  });

  it('une desserte RÉDUITE le reste : Voza → Le Fayet sans arrêt intermédiaire', () => {
    const { descente } = rotation(['le-fayet', 'col-de-voza']);
    const recalcule = recalculeDescenteSup(GRAND, descente, h('17:00'));
    expect(recalcule.map((p) => p.gare)).toEqual(['col-de-voza', 'le-fayet']);
  });

  it('deux corrections successives : la seconde part de l’heure RÉELLE', () => {
    const { descente } = rotation();
    const premiere = recalculeDescenteSup(GRAND, descente, h('16:42'));
    const seconde = recalculeDescenteSup(GRAND, { passages: premiere }, h('16:50'));
    expect(seconde[0]?.d).toBe('16:50:00');
    // Le décalage se compte depuis 16:42, pas depuis l'estimation d'origine.
    const arr = (ps: typeof premiere): number => h(ps[ps.length - 1]?.a ?? '');
    expect(arr(seconde) - arr(premiere)).toBe(8 * 60);
  });

  it('sans desserte enregistrée, on refuse plutôt que d’inventer', () => {
    expect(() => recalculeDescenteSup(GRAND, { passages: [] }, h('16:42'))).toThrow(
      /sans desserte enregistrée/,
    );
    expect(() => recalculeDescenteSup(GRAND, { passages: null }, h('16:42'))).toThrow();
  });
});

describe('Garde-fous du départ constaté', () => {
  const controle = (departReel: string, maintenant: number) => {
    const { montee, descente } = rotation();
    return controleDepartSup({
      montee,
      descente,
      departReel_s: h(departReel),
      maintenant_s: maintenant,
    });
  };

  it('une heure normale passe, sans avertissement', () => {
    const { montee, descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const r = controleDepartSup({
      montee,
      descente,
      departReel_s: h(estime) + 5 * 60,
      maintenant_s: h(estime) + 5 * 60,
    });
    expect(r.refus).toBeNull();
    expect(r.avertissement).toBeNull();
    expect(r.ecart_s).toBe(5 * 60);
  });

  it('ANTÉRIEURE à l’arrivée de la montée : refus, avec les DEUX heures', () => {
    const { montee, descente } = rotation();
    const arrivee = montee.passages[montee.passages.length - 1]?.a ?? '';
    const r = controleDepartSup({
      montee,
      descente,
      departReel_s: h(arrivee) - 60,
      maintenant_s: h('23:00'),
    });
    expect(r.refus).toContain('ne peut pas repartir');
    // Les DEUX heures doivent figurer : sinon l'agent ignore son écart.
    expect(r.refus).toContain(arrivee.slice(0, 5));
  });

  it('dans le FUTUR de plus de 2 min : refus — on constate, on ne programme pas', () => {
    const r = controle('17:10', h('17:00'));
    expect(r.refus).toContain('constate un départ');
    expect(r.refus).toContain('10 min');
  });

  it('2 min d’avance ou moins : toléré (l’agent clique juste avant le départ)', () => {
    expect(controle('17:02', h('17:00')).refus).toBeNull();
    expect(controle('17:03', h('17:00')).refus).toContain('constate un départ');
  });

  it('écart de 45 min : ACCEPTÉ, mais averti — c’est le profil d’une faute de frappe', () => {
    const { montee, descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const r = controleDepartSup({
      montee,
      descente,
      departReel_s: h(estime) + 45 * 60,
      maintenant_s: h(estime) + 45 * 60,
    });
    expect(r.refus).toBeNull();
    expect(r.avertissement).toContain('45 min');
    expect(r.avertissement).toContain(estime.slice(0, 5));
  });

  it('30 min pile ne déclenche pas encore l’avertissement', () => {
    const { montee, descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const aEcart = (minutes: number) =>
      controleDepartSup({
        montee,
        descente,
        departReel_s: h(estime) + minutes * 60,
        maintenant_s: h(estime) + minutes * 60,
      }).avertissement;
    expect(aEcart(30)).toBeNull();
    expect(aEcart(31)).not.toBeNull();
  });

  it('le REFUS prime sur l’avertissement', () => {
    // Reparti 40 min avant l'estimation, donc avant d'être arrivé : c'est le
    // refus qui doit sortir, pas un simple avertissement.
    const { montee, descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const r = controleDepartSup({
      montee,
      descente,
      departReel_s: h(estime) - 40 * 60,
      maintenant_s: h('23:00'),
    });
    expect(r.refus).not.toBeNull();
    expect(r.avertissement).toBeNull();
  });
});

describe('prepareDepartSup : ce que la confirmation affiche', () => {
  it('heure recevable : contrôle vert ET passages recalculés', () => {
    const { montee, descente } = rotation();
    const estime = descente.passages[0]?.d ?? '';
    const p = prepareDepartSup(GRAND, {
      montee,
      descente,
      departReel_s: h(estime) + 12 * 60,
      maintenant_s: h(estime) + 12 * 60,
    });
    expect(p.controle.refus).toBeNull();
    expect(p.passages?.[0]?.d).toBe(formatHmsTest(h(estime) + 12 * 60));
  });

  it('heure refusée : AUCUN passage recalculé — rien à confirmer', () => {
    const { montee, descente } = rotation();
    const p = prepareDepartSup(GRAND, {
      montee,
      descente,
      departReel_s: h('17:10'),
      maintenant_s: h('17:00'),
    });
    expect(p.controle.refus).not.toBeNull();
    expect(p.passages).toBeNull();
  });
});
