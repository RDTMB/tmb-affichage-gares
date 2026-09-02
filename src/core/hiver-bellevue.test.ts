// Grille d'HIVER : le Nid d'Aigle est fermé, Bellevue est le terminus NORMAL
// (docs/01 §2.1). La grille n'a aucun passage au Nid d'Aigle — ce n'est pas
// la bascule « Terminus Bellevue à partir du TRAIN 1 » qui fait le régime
// hiver. Le moteur doit l'accepter tel quel : destination « Bellevue » sans
// mention exceptionnelle, rotations depuis Bellevue, écran de Bellevue avec
// les départs vers la vallée, et aucune régression sur l'été.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { valideTrains } from './import-grille';
import {
  etatTronconFerme,
  finDeService,
  generationJour,
  heureVersSecondes,
  monteesSansRetour,
  passagesPourGare,
  positionsTrains,
  prochaineArrivee,
  trainsDuJour,
} from './horaires';
import type { Grille, PassageGrille, TrainGrille } from './types';

const ETE = grandServiceJson as unknown as Grille;
const h = heureVersSecondes;

/**
 * Grille d'hiver construite depuis l'été : mêmes heures jusqu'à Bellevue,
 * plus rien au-dessus. Montées : Bellevue devient l'arrivée (sans départ) ;
 * descentes : Bellevue devient le départ (sans arrivée). Les express, qui ne
 * desservent pas Bellevue, n'existent pas en hiver.
 */
function grilleHiver(): Grille {
  const tronqueMontee = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(0, index + 1).map((p, i, liste) => {
      if (i !== liste.length - 1) return { ...p };
      const { d: _d, ...sansDepart } = p;
      return sansDepart;
    });
    return { ...t, passages };
  };
  const tronqueDescente = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(index).map((p, i) => {
      if (i !== 0) return { ...p };
      const { a: _a, ...sansArrivee } = p;
      return sansArrivee;
    });
    return { ...t, passages };
  };
  return {
    ...ETE,
    version: '2026-2027-hiver',
    libelle: 'Hiver 2026-2027',
    periodes: [{ du: '2026-12-19', au: '2027-04-11' }],
    // Sans les express ni leurs descentes appariées (TRAIN 24 suit le 23 express).
    montees: ETE.montees.filter((t) => !t.express).map(tronqueMontee),
    descentes: ETE.descentes
      .filter((t) => !t.express && ETE.montees.some((m) => m.numero === t.numero - 1 && !m.express))
      .map(tronqueDescente),
  };
}

const HIVER = grilleHiver();
const DATE = '2027-01-15';

describe('grille d’hiver : Bellevue terminus normal', () => {
  it('est une grille valide pour l’import (aucune erreur, aucun avertissement)', () => {
    const erreurs: ReturnType<typeof valideTrains> extends void ? never[] : never[] = [];
    const avertissements: never[] = [];
    valideTrains('Hiver', HIVER.montees, HIVER.descentes, erreurs, avertissements);
    expect(erreurs).toEqual([]);
    expect(avertissements).toEqual([]);
  });

  it('génère la journée : rotations appariées, toutes les rames attribuées', () => {
    const jour = generationJour(HIVER, DATE);
    expect(jour.circulations).toHaveLength(HIVER.montees.length * 2);
    for (const descente of jour.circulations.filter((c) => c.sens === 'descente')) {
      const montee = jour.circulations.find((c) => c.numero === descente.numero - 1);
      expect(montee?.rame).toBe(descente.rame);
    }
  });

  it('les montées ont Bellevue pour destination, SANS mention « terminus exceptionnel »', () => {
    const jour = generationJour(HIVER, DATE);
    const montees = trainsDuJour(HIVER, jour).filter((t) => t.sens === 'montee');
    expect(montees.length).toBeGreaterThan(0);
    for (const t of montees) {
      const dernier = t.passages[t.passages.length - 1];
      expect(dernier?.gare).toBe('bellevue');
      expect(dernier?.depart_s).toBeNull();
      expect(t.terminusExceptionnel).toBe(false);
      expect(t.passages.some((p) => p.gare === 'nid-daigle')).toBe(false);
    }
  });

  it('écran du Fayet : départs vers Bellevue, destination normale', () => {
    const jour = generationJour(HIVER, DATE);
    const departs = passagesPourGare(HIVER, jour, 'le-fayet', h('06:30'));
    expect(departs.length).toBeGreaterThan(0);
    for (const p of departs.filter((x) => x.sens === 'montee')) {
      expect(p.destination).toBe('bellevue');
      expect(p.terminusExceptionnel).toBe(false);
    }
  });

  it('écran de Bellevue : arrivées de la vallée puis départs vers Le Fayet, depuis Bellevue', () => {
    const jour = generationJour(HIVER, DATE);
    const passages = passagesPourGare(HIVER, jour, 'bellevue', h('07:00'));
    const arrivees = passages.filter((p) => p.sens === 'montee');
    const departs = passages.filter((p) => p.sens === 'descente');
    expect(arrivees.length).toBeGreaterThan(0);
    expect(departs.length).toBeGreaterThan(0);
    // Montée : arrivée à Bellevue, pas de départ (terminus)
    expect(arrivees[0]).toMatchObject({ numero: 1, destination: 'bellevue', depart_s: null });
    expect(arrivees[0]?.arrivee_s).toBe(h('07:47:30'));
    // Descente : part de Bellevue (origine), pas d'arrivée, vers Le Fayet
    expect(departs[0]).toMatchObject({
      numero: 2,
      origine: 'bellevue',
      destination: 'le-fayet',
      arrivee_s: null,
    });
    expect(departs[0]?.depart_s).toBe(h('08:33:30'));
    for (const p of passages) expect(p.terminusExceptionnel).toBe(false);
  });

  it('rotation depuis Bellevue : la descente repart après l’arrivée de la montée, même rame', () => {
    const jour = generationJour(HIVER, DATE);
    const trains = trainsDuJour(HIVER, jour);
    const t1 = trains.find((t) => t.numero === 1);
    const t2 = trains.find((t) => t.numero === 2);
    expect(t1 && t2).toBeTruthy();
    expect(t2?.rame).toBe(t1?.rame);
    const arrivee = t1?.passages[t1.passages.length - 1]?.arrivee_s ?? 0;
    const depart = t2?.passages[0]?.depart_s ?? 0;
    expect(depart).toBeGreaterThan(arrivee);
    expect(monteesSansRetour(HIVER, jour)).toEqual([]);
  });

  it('prochaine arrivée à Bellevue : la montée, en provenance du Fayet', () => {
    const jour = generationJour(HIVER, DATE);
    expect(prochaineArrivee(HIVER, jour, 'bellevue', h('07:30'))).toMatchObject({
      numero: 1,
      sens: 'montee',
      provenance: 'le-fayet',
      heure_s: h('07:47:30'),
    });
  });

  it('Nid d’Aigle : aucun passage, et pas d’état « tronçon fermé » (rien n’est exceptionnel)', () => {
    const jour = generationJour(HIVER, DATE);
    expect(passagesPourGare(HIVER, jour, 'nid-daigle', h('10:00'))).toEqual([]);
    expect(etatTronconFerme(HIVER, jour, 'nid-daigle', h('10:00'))).toBe(false);
  });

  it('positions et fin de service fonctionnent sur la ligne tronquée', () => {
    const jour = generationJour(HIVER, DATE);
    // 07:41 : le TRAIN 1 est à quai au Col de Voza (arrivé 07:40:30, repart 07:42:30)
    const positions = positionsTrains(HIVER, jour, h('07:41'));
    expect(positions.find((p) => p.numero === 1)?.gare).toBe('col-de-voza');
    // Après le dernier départ de Bellevue : premier départ du lendemain (même grille)
    const fin = finDeService(HIVER, jour, 'bellevue', h('18:00'), HIVER);
    expect(fin).toEqual({ premierDepart_s: h('08:33:30') });
  });

  it('aucune régression sur l’été : la même journée d’été garde le Nid d’Aigle', () => {
    const jour = generationJour(ETE, '2026-07-15');
    const montees = trainsDuJour(ETE, jour).filter((t) => t.sens === 'montee' && !t.facultatif);
    for (const t of montees) {
      expect(t.passages[t.passages.length - 1]?.gare).toBe('nid-daigle');
      expect(t.terminusExceptionnel).toBe(false);
    }
    expect(passagesPourGare(ETE, jour, 'nid-daigle', h('10:00')).length).toBeGreaterThan(0);
  });
});
