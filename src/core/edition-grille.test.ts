// Édition du contenu d'une grille : chaque opération renvoie une copie, la
// grille d'origine n'est jamais touchée, et le résultat obéit aux règles de
// l'import (même validateur).
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { ecarts } from './ecarts-grille';
import {
  ajouteRotation,
  garesDansLeSens,
  numeroMonteeSuivant,
  poseHeure,
  poseIndicateur,
  retireNidDaigle,
  seTermineABellevue,
  supprimeRotation,
  validationEdition,
  versionCorrigee,
} from './edition-grille';
import type { Grille, TrainGrille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;

function montee(g: Grille, numero: number): TrainGrille {
  const t = g.montees.find((m) => m.numero === numero);
  if (!t) throw new Error(`TRAIN ${numero} absent`);
  return t;
}
function descente(g: Grille, numero: number): TrainGrille {
  const t = g.descentes.find((d) => d.numero === numero);
  if (!t) throw new Error(`TRAIN ${numero} absent`);
  return t;
}

describe('poseHeure', () => {
  it('corrige une heure sans toucher à la grille d’origine ; formats de l’import acceptés', () => {
    const r = poseHeure(GRAND, { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' }, '9h27');
    if (!r.ok) throw new Error(r.erreur);
    expect(montee(r.grille, 5).passages.find((p) => p.gare === 'motivon')?.a).toBe('09:27:00');
    expect(montee(GRAND, 5).passages.find((p) => p.gare === 'motivon')?.a).toBe('09:26:30');
    const e = ecarts(GRAND, r.grille);
    expect(e.heures).toEqual([
      {
        numero: 5,
        sens: 'montee',
        gare: 'motivon',
        champ: 'a',
        avant: '09:26:30',
        apres: '09:27:00',
      },
    ]);
    expect(validationEdition(r.grille).erreurs).toEqual([]);
  });

  it('refuse un texte qui n’est pas une heure, avec les formats acceptés', () => {
    const r = poseHeure(GRAND, { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' }, 'midi');
    expect(r).toEqual({
      ok: false,
      erreur: "« midi » n'est pas une heure — formats acceptés : 7:26, 07:26:30, 7h26",
    });
    expect(
      poseHeure(GRAND, { sens: 'montee', numero: 99, gare: 'motivon', champ: 'a' }, '9:00').ok,
    ).toBe(false);
  });

  it('crée le passage d’une gare non desservie, à sa place dans le parcours', () => {
    // TRAIN 9 est express : redonner des heures à Col de Voza crée le passage entre Motivon et le Nid d'Aigle
    let g = poseIndicateur(GRAND, 'montee', 9, 'express', false);
    let r = poseHeure(
      g,
      { sens: 'montee', numero: 9, gare: 'col-de-voza', champ: 'a' },
      '11:10:30',
    );
    if (!r.ok) throw new Error(r.erreur);
    r = poseHeure(
      r.grille,
      { sens: 'montee', numero: 9, gare: 'col-de-voza', champ: 'd' },
      '11:12:30',
    );
    if (!r.ok) throw new Error(r.erreur);
    g = r.grille;
    expect(montee(g, 9).passages.map((p) => p.gare)).toEqual([
      'le-fayet',
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'nid-daigle',
    ]);
    // Il manque encore Bellevue : le validateur le réclame
    expect(validationEdition(g).erreurs.map((p) => p.message)).toContain(
      'TRAIN 9 : passage absent à Bellevue — seul un express (ÿ) saute des gares, et il saute Col de Voza ET Bellevue',
    );
  });

  it('vider les deux heures d’une gare retire le passage et remet le terminus d’équerre', () => {
    // Montée 1 : vider l'arrivée au Nid d'Aigle → Bellevue devient terminus, sans départ
    const r = poseHeure(GRAND, { sens: 'montee', numero: 1, gare: 'nid-daigle', champ: 'a' }, '');
    if (!r.ok) throw new Error(r.erreur);
    const t1 = montee(r.grille, 1);
    expect(t1.passages[t1.passages.length - 1]).toEqual({ gare: 'bellevue', a: '07:47:30' });
    // Descente 2 : un tiret au départ du Nid d'Aigle → part de Bellevue, sans arrivée
    const r2 = poseHeure(
      GRAND,
      { sens: 'descente', numero: 2, gare: 'nid-daigle', champ: 'd' },
      '-',
    );
    if (!r2.ok) throw new Error(r2.erreur);
    expect(descente(r2.grille, 2).passages[0]).toEqual({ gare: 'bellevue', d: '08:33:30' });
  });
});

describe('poseIndicateur', () => {
  it('passer un train en express retire Col de Voza et Bellevue ; la validation reste bonne', () => {
    const g = poseIndicateur(GRAND, 'montee', 5, 'express', true);
    expect(montee(g, 5).express).toBe(true);
    expect(montee(g, 5).passages.map((p) => p.gare)).toEqual([
      'le-fayet',
      'saint-gervais',
      'motivon',
      'nid-daigle',
    ]);
    expect(montee(GRAND, 5).passages).toHaveLength(6); // l'origine n'a pas bougé
    expect(validationEdition(g).erreurs).toEqual([]);
  });

  it('retirer le symbole express laisse des cellules à remplir, signalées comme erreurs', () => {
    const g = poseIndicateur(GRAND, 'montee', 9, 'express', false);
    expect(montee(g, 9).express).toBe(false);
    expect(validationEdition(g).erreurs.map((p) => p.message)).toEqual([
      'TRAIN 9 : passages absents à Col de Voza et Bellevue sans le symbole express (ÿ)',
    ]);
  });

  it('facultatif et vélos ne touchent pas aux passages', () => {
    const g = poseIndicateur(
      poseIndicateur(GRAND, 'montee', 5, 'facultatif', true),
      'descente',
      6,
      'velos',
      true,
    );
    expect(montee(g, 5)).toMatchObject({ facultatif: true, express: false });
    expect(montee(g, 5).passages).toEqual(montee(GRAND, 5).passages);
    expect(descente(g, 6).velos).toBe(true);
    expect(ecarts(GRAND, g).indicateurs).toHaveLength(2);
  });
});

describe('ajouteRotation / supprimeRotation', () => {
  it('propose le numéro suivant et crée la rotation par décalage d’une heure depuis la dernière', () => {
    expect(numeroMonteeSuivant(GRAND)).toBe(27);
    expect(numeroMonteeSuivant(PETIT)).toBe(23); // dernière montée 21
    expect(numeroMonteeSuivant({ ...GRAND, montees: [], descentes: [] })).toBe(1);
    const r = ajouteRotation(GRAND, 27);
    if (!r.ok) throw new Error(r.erreur);
    const t27 = montee(r.grille, 27);
    const t28 = descente(r.grille, 28);
    expect(t27.passages[0]).toEqual({ gare: 'le-fayet', d: '17:00:00' }); // TRAIN 25 : 16:00 + 1 h
    expect(t27.passages[t27.passages.length - 1]).toEqual({ gare: 'nid-daigle', a: '18:05:30' });
    expect(t28.passages[0]).toEqual({ gare: 'nid-daigle', d: '18:13:30' });
    expect(t27).toMatchObject({ express: false, facultatif: false, velos: true }); // copiés du TRAIN 25
    expect(r.grille.montees.map((m) => m.numero).slice(-2)).toEqual([25, 27]);
    expect(validationEdition(r.grille).erreurs).toEqual([]);
    expect(GRAND.montees).toHaveLength(13);
  });

  it('avec une heure de départ imposée, décale toute la rotation d’autant', () => {
    const r = ajouteRotation(PETIT, 23, { departMontee: '16:30' });
    if (!r.ok) throw new Error(r.erreur);
    expect(montee(r.grille, 23).passages[0]).toEqual({ gare: 'le-fayet', d: '16:30:00' }); // TRAIN 21 : 15:00 + 1 h 30
    expect(montee(r.grille, 23).passages.find((p) => p.gare === 'motivon')).toEqual({
      gare: 'motivon',
      a: '16:56:30',
      d: '16:57:30',
    });
    expect(descente(r.grille, 24).passages[0]).toEqual({ gare: 'nid-daigle', d: '17:43:30' });
  });

  it('insérer au milieu prend la montée précédente pour modèle ; sans précédente, la suivante décalée en arrière', () => {
    // PETIT n'a pas de TRAIN 3 : modèle TRAIN 1 (+1 h)
    const r = ajouteRotation(PETIT, 3);
    if (!r.ok) throw new Error(r.erreur);
    expect(montee(r.grille, 3).passages[0]).toEqual({ gare: 'le-fayet', d: '08:00:00' });
    expect(r.grille.montees.map((m) => m.numero)).toEqual([1, 3, 5, 7, 11, 13, 15, 19, 21]);
    // Sans montée précédente : la suivante, une heure plus tôt
    const sansT1 = supprimeRotation(PETIT, 1);
    const r2 = ajouteRotation(sansT1, 1);
    if (!r2.ok) throw new Error(r2.erreur);
    expect(montee(r2.grille, 1).passages[0]).toEqual({ gare: 'le-fayet', d: '08:00:00' }); // TRAIN 5 (09:00) − 1 h
  });

  it('refuse un numéro pair, un numéro déjà pris, un décalage hors de la journée', () => {
    expect(ajouteRotation(GRAND, 28)).toMatchObject({ ok: false });
    expect(ajouteRotation(GRAND, 25)).toEqual({
      ok: false,
      erreur: 'TRAIN 25 ou TRAIN 26 existe déjà dans cette grille',
    });
    expect(ajouteRotation(GRAND, 27, { decalageMin: 8 * 60 })).toMatchObject({
      ok: false,
      erreur: expect.stringMatching(/sortirait de la journée/),
    });
    expect(ajouteRotation(GRAND, 27, { departMontee: 'tard' })).toMatchObject({ ok: false });
  });

  it('sur une grille vide, une rotation squelette sans heures', () => {
    const vide: Grille = { ...GRAND, montees: [], descentes: [] };
    const r = ajouteRotation(vide, 1);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.grille.montees).toEqual([
      { numero: 1, express: false, facultatif: false, velos: false, passages: [] },
    ]);
    expect(validationEdition(r.grille).erreurs.map((p) => p.message)).toContain(
      'TRAIN 1 : moins de deux gares desservies',
    );
  });

  it('supprimeRotation retire la montée ET sa descente', () => {
    const g = supprimeRotation(GRAND, 9);
    expect(g.montees.some((m) => m.numero === 9)).toBe(false);
    expect(g.descentes.some((d) => d.numero === 10)).toBe(false);
    expect(g.montees).toHaveLength(12);
    expect(validationEdition(g).erreurs).toEqual([]);
    expect(ecarts(GRAND, g).trainsRetires).toEqual([
      { numero: 9, sens: 'montee' },
      { numero: 10, sens: 'descente' },
    ]);
  });
});

describe('grille d’hiver : retireNidDaigle', () => {
  it('l’été ne se termine pas à Bellevue ; après retrait du Nid d’Aigle, oui', () => {
    expect(seTermineABellevue(PETIT)).toBe(false);
    const hiver = retireNidDaigle(PETIT);
    expect(seTermineABellevue(hiver)).toBe(true);
    const t1 = montee(hiver, 1);
    expect(t1.passages[t1.passages.length - 1]).toEqual({ gare: 'bellevue', a: '07:47:30' });
    expect(descente(hiver, 2).passages[0]).toEqual({ gare: 'bellevue', d: '08:33:30' });
    // Le petit service n'a pas d'express : la grille d'hiver est valide telle quelle
    expect(validationEdition(hiver).erreurs).toEqual([]);
    expect(seTermineABellevue({ ...PETIT, montees: [], descentes: [] })).toBe(false);
  });

  it('les express de l’été deviennent des erreurs à traiter (retirer la rotation ou le symbole)', () => {
    const hiver = retireNidDaigle(GRAND);
    const erreurs = validationEdition(hiver).erreurs.map((p) => p.message);
    expect(erreurs).toContain(
      "TRAIN 9 : un express va jusqu'au Nid d'Aigle (il saute Col de Voza et Bellevue) — sans passage au Nid d'Aigle, retirez la rotation ou son symbole express",
    );
    expect(erreurs.filter((e) => e.includes('un express va'))).toHaveLength(6); // 9, 17, 23 et 10, 18 — plus la descente 24 non express : 5 + …
    // En retirant les trois rotations express, la grille d'hiver est valide
    let g = hiver;
    for (const n of [9, 17, 23]) g = supprimeRotation(g, n);
    expect(validationEdition(g).erreurs).toEqual([]);
    expect(g.montees).toHaveLength(10);
  });

  it('garesDansLeSens : du Fayet au sommet en montée, l’inverse en descente', () => {
    expect(garesDansLeSens('montee')[0]).toBe('le-fayet');
    expect(garesDansLeSens('descente')[0]).toBe('nid-daigle');
  });
});

describe('versionCorrigee', () => {
  it('ajoute le premier suffixe libre à la racine de la version', () => {
    expect(versionCorrigee('2026-ete-petit-service', ['2026-ete-petit-service'])).toBe(
      '2026-ete-petit-service-v2',
    );
    expect(
      versionCorrigee('2026-ete-petit-service-v2', [
        '2026-ete-petit-service',
        '2026-ete-petit-service-v2',
      ]),
    ).toBe('2026-ete-petit-service-v3');
    // Une v2 corrigée alors que la v1 a été supprimée de la liste : la racine reste réservée
    expect(versionCorrigee('2026-ete-petit-service-v2', ['2026-ete-petit-service-v2'])).toBe(
      '2026-ete-petit-service-v3',
    );
  });
});
