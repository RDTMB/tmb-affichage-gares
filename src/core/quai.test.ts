// États « À QUAI » / « DÉPART IMMINENT » / « PARTI » (docs/01 §3).
// Tests sur les VRAIS horaires été 2026 : TRAIN 5 arrive à Saint-Gervais à
// 09:10:00 et en repart à 09:15:00 ; il part de son ORIGINE (Le Fayet) à
// 09:00:00 sans heure d'arrivée. Si un test « attend » une autre heure, c'est
// le test qui a tort — corriger le test, jamais la grille.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import {
  A_QUAI_ORIGINE_DEFAUT_S,
  compteARebours,
  enVeille,
  generationJour,
  heureVersSecondes,
  passagesPourGare,
  veilleEffective,
} from './horaires';
import type { Grille, Jour, PassageGare } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-07-15';
const h = heureVersSecondes;

function jourGrand(): Jour {
  return generationJour(GRAND, DATE);
}

/** Passage du TRAIN 5 vu d'une gare, heures RÉELLES (retard compris). */
function passage5(gare: 'saint-gervais' | 'le-fayet', jour: Jour): PassageGare {
  const p = passagesPourGare(GRAND, jour, gare).find((x) => x.numero === 5);
  if (!p) throw new Error(`TRAIN 5 absent de ${gare}`);
  return p;
}

/** Ce que la case afficherait à cet instant, bout en bout. */
function etatA(heure: string, p: PassageGare): string {
  if (p.depart_s === null) throw new Error('passage sans départ');
  return compteARebours(p.depart_s, h(heure), p.arrivee_s, A_QUAI_ORIGINE_DEFAUT_S).type;
}

describe('Gare intermédiaire : l’heure d’ARRIVÉE ouvre le stationnement à quai', () => {
  const p = passage5('saint-gervais', jourGrand());

  it('les horaires officiels sont bien ceux du scénario', () => {
    expect(p.arrivee_s).toBe(h('09:10:00'));
    expect(p.depart_s).toBe(h('09:15:00'));
  });

  it('avant l’arrivée : compte à rebours vers le DÉPART', () => {
    const c = compteARebours(p.depart_s ?? 0, h('09:09:00'), p.arrivee_s);
    expect(c.type).toBe('minutes');
    expect(c.libelle).toBe('6 min'); // 09:09 → 09:15
    expect(etatA('08:00:00', p)).toBe('heures');
  });

  it('« À QUAI » dès l’heure d’arrivée, et non après le départ', () => {
    expect(etatA('09:09:59', p)).toBe('minutes');
    expect(etatA('09:10:00', p)).toBe('quai');
    expect(etatA('09:12:30', p)).toBe('quai');
    expect(etatA('09:14:29', p)).toBe('quai');
  });

  it('« DÉPART IMMINENT » sur les 30 dernières secondes, départ inclus', () => {
    expect(etatA('09:14:30', p)).toBe('imminent');
    expect(etatA('09:14:59', p)).toBe('imminent');
    expect(etatA('09:15:00', p)).toBe('imminent'); // à la seconde du départ
  });

  it('« PARTI » après le départ, tant que la ligne reste affichée', () => {
    expect(etatA('09:15:01', p)).toBe('parti');
    expect(etatA('09:16:59', p)).toBe('parti');
  });

  it('la ligne disparaît 2 min après le départ', () => {
    const numeros = (heure: string): number[] =>
      passagesPourGare(GRAND, jourGrand(), 'saint-gervais', h(heure)).map((x) => x.numero);
    expect(numeros('09:17:00')).toContain(5);
    expect(numeros('09:17:01')).not.toContain(5);
  });

  it('les libellés sont bilingues', () => {
    const quai = compteARebours(p.depart_s ?? 0, h('09:11:00'), p.arrivee_s);
    expect([quai.libelle, quai.libelle_en]).toEqual(['À QUAI', 'AT PLATFORM']);
    const imminent = compteARebours(p.depart_s ?? 0, h('09:14:45'), p.arrivee_s);
    expect([imminent.libelle, imminent.libelle_en]).toEqual(['DÉPART IMMINENT', 'DEPARTING']);
    const parti = compteARebours(p.depart_s ?? 0, h('09:16:00'), p.arrivee_s);
    expect([parti.libelle, parti.libelle_en]).toEqual(['PARTI', 'DEPARTED']);
    // Un nombre est identique dans les deux langues : pas de seconde ligne
    const minutes = compteARebours(p.depart_s ?? 0, h('09:05:00'), p.arrivee_s);
    expect(minutes.libelle_en).toBe('');
  });
});

describe('Retard de 10 min : tout le scénario glisse d’autant', () => {
  function jourRetarde(): Jour {
    const jour = jourGrand();
    const c = jour.circulations.find((x) => x.numero === 5);
    if (!c) throw new Error('TRAIN 5 absent');
    c.statut = 'retard';
    c.retard_min = 10;
    return jour;
  }
  const p = passage5('saint-gervais', jourRetarde());

  it('les heures réelles portent le retard', () => {
    expect(p.arrivee_s).toBe(h('09:20:00'));
    expect(p.depart_s).toBe(h('09:25:00'));
    expect(p.arrivee_theorique_s).toBe(h('09:10:00')); // le théorique est conservé
  });

  it('à 09:12 le train n’est PAS à quai : il n’est pas encore arrivé', () => {
    expect(etatA('09:12:00', p)).toBe('minutes');
  });

  it('les trois états suivent le retard', () => {
    expect(etatA('09:20:00', p)).toBe('quai');
    expect(etatA('09:24:29', p)).toBe('quai');
    expect(etatA('09:24:30', p)).toBe('imminent');
    expect(etatA('09:25:01', p)).toBe('parti');
  });
});

describe('Gare d’origine : pas d’heure d’arrivée, délai forfaitaire', () => {
  const p = passage5('le-fayet', jourGrand());

  it('le point d’origine n’a effectivement pas d’arrivée', () => {
    expect(p.arrivee_s).toBeNull();
    expect(p.depart_s).toBe(h('09:00:00'));
  });

  it('« À QUAI » à partir du délai paramétré (5 min par défaut)', () => {
    expect(etatA('08:54:59', p)).toBe('minutes');
    expect(etatA('08:55:00', p)).toBe('quai');
    expect(etatA('08:59:29', p)).toBe('quai');
  });

  it('puis « DÉPART IMMINENT » à 30 s, « PARTI » après le départ', () => {
    expect(etatA('08:59:30', p)).toBe('imminent');
    expect(etatA('09:00:00', p)).toBe('imminent');
    expect(etatA('09:00:01', p)).toBe('parti');
  });

  it('le délai est paramétrable', () => {
    const avec = (delai: number, heure: string): string =>
      compteARebours(p.depart_s ?? 0, h(heure), p.arrivee_s, delai).type;
    expect(avec(600, '08:50:00')).toBe('quai'); // 10 min
    expect(avec(600, '08:49:59')).toBe('minutes');
    expect(avec(60, '08:55:00')).toBe('minutes'); // 1 min : à quai plus tard
    expect(avec(60, '08:59:00')).toBe('quai');
  });

  it('un délai nul ou négatif ne fait jamais passer « à quai » trop tôt', () => {
    expect(compteARebours(p.depart_s ?? 0, h('08:59:00'), null, 0).type).toBe('minutes');
    expect(compteARebours(p.depart_s ?? 0, h('08:59:00'), null, -600).type).toBe('minutes');
  });
});

describe('Veille de nuit : fenêtre globale et surcharge par écran', () => {
  const GLOBALE = { debut: '21:00', fin: '06:00' };

  it('la fenêtre enjambe minuit', () => {
    expect(enVeille('21:00', '06:00', h('22:30'))).toBe(true);
    expect(enVeille('21:00', '06:00', h('03:00'))).toBe(true);
    expect(enVeille('21:00', '06:00', h('05:59:59'))).toBe(true);
    expect(enVeille('21:00', '06:00', h('06:00'))).toBe(false);
    expect(enVeille('21:00', '06:00', h('12:00'))).toBe(false);
    expect(enVeille('21:00', '06:00', h('20:59:59'))).toBe(false);
  });

  it('une fenêtre en pleine journée reste un simple intervalle', () => {
    expect(enVeille('13:00', '14:00', h('13:30'))).toBe(true);
    expect(enVeille('13:00', '14:00', h('12:30'))).toBe(false);
    expect(enVeille('13:00', '14:00', h('14:00'))).toBe(false);
  });

  it('deux bornes identiques = jamais en veille (fenêtre vide)', () => {
    expect(enVeille('21:00', '21:00', h('21:00'))).toBe(false);
    expect(enVeille('21:00', '21:00', h('03:00'))).toBe(false);
  });

  it('sans réglage propre, l’écran suit la ligne', () => {
    expect(veilleEffective(GLOBALE, null)).toEqual({ fenetre: GLOBALE, propre: false });
    expect(veilleEffective(GLOBALE, { debut: null, fin: null }).propre).toBe(false);
  });

  it('une surcharge complète l’emporte', () => {
    const r = veilleEffective(GLOBALE, { debut: '19:00', fin: '06:30' });
    expect(r).toEqual({ fenetre: { debut: '19:00', fin: '06:30' }, propre: true });
    // Un écran qui s'éteint à 19:00 est bien en veille à 19:30, la ligne non
    expect(enVeille(r.fenetre.debut, r.fenetre.fin, h('19:30'))).toBe(true);
    expect(enVeille(GLOBALE.debut, GLOBALE.fin, h('19:30'))).toBe(false);
  });

  it('une SEULE borne ne décrit pas une fenêtre : retour au global', () => {
    expect(veilleEffective(GLOBALE, { debut: '19:00', fin: null }).propre).toBe(false);
    expect(veilleEffective(GLOBALE, { debut: null, fin: '06:30' }).propre).toBe(false);
    expect(veilleEffective(GLOBALE, { debut: '19:00' }).fenetre).toEqual(GLOBALE);
  });
});
