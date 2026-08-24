// Tests du moteur horaires sur les VRAIS horaires été 2026 (docs/02 §3).
// Rappel : si un test « attend » une autre heure que la grille officielle,
// c'est le test qui a tort — corriger le test, jamais la grille.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import {
  appliqueTerminusBellevue,
  compteARebours,
  dateSuivante,
  etatTronconFerme,
  expressATraiter,
  finDeService,
  formatHeure,
  generationJour,
  heureVersSecondes,
  passagesPourGare,
  positionsTrains,
  prochaineArrivee,
  serviceActif,
} from './horaires';
import type { Circulation, Grille, Jour } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
const GRILLES = [GRAND, PETIT];
const DATE = '2026-07-15'; // pleine saison grand service

const h = heureVersSecondes;

function jourGrand(): Jour {
  return generationJour(GRAND, DATE);
}

function circ(jour: Jour, numero: number): Circulation {
  const circulation = jour.circulations.find((c) => c.numero === numero);
  if (!circulation) throw new Error(`circulation ${numero} absente du jour généré`);
  return circulation;
}

function numeros(passages: Array<{ numero: number }>): number[] {
  return passages.map((p) => p.numero);
}

// ---------------------------------------------------------------------------

describe('heures et dates', () => {
  it('convertit HH:MM:SS et HH:MM en secondes', () => {
    expect(h('07:27:30')).toBe(26850);
    expect(h('10:30')).toBe(37800);
    expect(h('00:00:00')).toBe(0);
  });

  it('formate en HH:MM en tronquant les secondes, « — » pour null', () => {
    expect(formatHeure(h('07:27:30'))).toBe('07:27');
    expect(formatHeure(h('11:30:30'))).toBe('11:30');
    expect(formatHeure(h('08:05:30'))).toBe('08:05');
    expect(formatHeure(null)).toBe('—');
  });

  it('calcule la date du lendemain, y compris en fin de mois et d’année', () => {
    expect(dateSuivante('2026-07-15')).toBe('2026-07-16');
    expect(dateSuivante('2026-08-31')).toBe('2026-09-01');
    expect(dateSuivante('2026-12-31')).toBe('2027-01-01');
  });
});

describe('serviceActif', () => {
  it('trouve le grand service en pleine saison et à ses bornes', () => {
    expect(serviceActif(GRILLES, '2026-07-15')?.version).toBe('2026-ete-grand-service');
    expect(serviceActif(GRILLES, '2026-07-04')?.version).toBe('2026-ete-grand-service');
    expect(serviceActif(GRILLES, '2026-08-30')?.version).toBe('2026-ete-grand-service');
  });

  it('trouve le petit service sur ses deux périodes', () => {
    expect(serviceActif(GRILLES, '2026-06-13')?.version).toBe('2026-ete-petit-service');
    expect(serviceActif(GRILLES, '2026-07-03')?.version).toBe('2026-ete-petit-service');
    expect(serviceActif(GRILLES, '2026-08-31')?.version).toBe('2026-ete-petit-service');
    expect(serviceActif(GRILLES, '2026-09-27')?.version).toBe('2026-ete-petit-service');
  });

  it('renvoie null hors saison', () => {
    expect(serviceActif(GRILLES, '2026-05-01')).toBeNull();
    expect(serviceActif(GRILLES, '2026-10-05')).toBeNull();
  });
});

describe('generationJour', () => {
  it('génère toutes les circulations du grand service avec les bons défauts', () => {
    const jour = jourGrand();
    expect(jour.circulations).toHaveLength(26); // 13 montées + 13 descentes
    expect(jour.grille_version).toBe('2026-ete-grand-service');
    expect(jour.terminus_bellevue).toBe(false);
    for (const c of jour.circulations) {
      expect(c.statut).toBe('ok');
      expect(c.facultatif_actif).toBe(false);
      expect(c.terminus).toBe('nid-daigle');
      expect(c.retard_min).toBe(0);
      expect(c.rame).not.toBe('');
    }
  });

  it('apparie les rames : la descente n+1 reçoit la rame de la montée n', () => {
    const jour = jourGrand();
    for (const descente of jour.circulations.filter((c) => c.sens === 'descente')) {
      expect(descente.rame).toBe(circ(jour, descente.numero - 1).rame);
    }
  });

  it('génère aussi le petit service (8 montées + 8 descentes)', () => {
    const jour = generationJour(PETIT, '2026-09-05');
    expect(jour.circulations).toHaveLength(16);
    expect(circ(jour, 2).rame).toBe(circ(jour, 1).rame);
  });
});

describe('passagesPourGare — horaires réels', () => {
  it('T9 express activé : Saint-Gervais 10:45, Motivon 10:57 (arrivée 10:56:30)', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;

    const sg = passagesPourGare(GRAND, jour, 'saint-gervais').find((p) => p.numero === 9);
    expect(sg?.depart_s).toBe(h('10:45:00'));
    expect(formatHeure(sg?.depart_s ?? null)).toBe('10:45');

    const motivon = passagesPourGare(GRAND, jour, 'motivon').find((p) => p.numero === 9);
    expect(motivon?.depart_s).toBe(h('10:57:30'));
    expect(motivon?.arrivee_s).toBe(h('10:56:30'));
    expect(formatHeure(motivon?.depart_s ?? null)).toBe('10:57');
  });

  it('T9 express : absent à Col de Voza et Bellevue (rien à afficher)', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    expect(numeros(passagesPourGare(GRAND, jour, 'col-de-voza'))).not.toContain(9);
    expect(numeros(passagesPourGare(GRAND, jour, 'bellevue'))).not.toContain(9);
  });

  it('T9 express : arrivée au Nid d’Aigle 11:30:30, affichée 11:30, sans départ', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    const p = passagesPourGare(GRAND, jour, 'nid-daigle').find((x) => x.numero === 9);
    expect(p?.arrivee_s).toBe(h('11:30:30'));
    expect(p?.depart_s).toBeNull();
    expect(formatHeure(p?.arrivee_s ?? null)).toBe('11:30');
  });

  it('arrivée intermédiaire = départ − 60 s (T1 à Saint-Gervais : 07:14:00)', () => {
    const p = passagesPourGare(GRAND, jourGrand(), 'saint-gervais').find((x) => x.numero === 1);
    expect(p?.depart_s).toBe(h('07:15:00'));
    expect(p?.arrivee_s).toBe(h('07:15:00') - GRAND.arret_intermediaire_s);
  });

  it('« — » au point d’origine (T1 au Fayet, T2 au Nid d’Aigle)', () => {
    const jour = jourGrand();
    const t1 = passagesPourGare(GRAND, jour, 'le-fayet').find((x) => x.numero === 1);
    expect(t1?.arrivee_s).toBeNull();
    expect(formatHeure(t1?.arrivee_s ?? null)).toBe('—');
    const t2 = passagesPourGare(GRAND, jour, 'nid-daigle').find((x) => x.numero === 2);
    expect(t2?.arrivee_s).toBeNull();
    expect(t2?.depart_s).toBe(h('08:13:30'));
  });

  it('trie par heure de départ, deux sens mélangés (T2 09:13:30 avant T5 09:15:00)', () => {
    const liste = numeros(passagesPourGare(GRAND, jourGrand(), 'saint-gervais'));
    expect(liste[0]).toBe(1);
    expect(liste.indexOf(2)).toBeLessThan(liste.indexOf(5));
    expect(liste.indexOf(2)).toBeGreaterThan(liste.indexOf(1));
  });

  it('destination et provenance : montée vers nid-daigle, descente depuis nid-daigle', () => {
    const sg = passagesPourGare(GRAND, jourGrand(), 'saint-gervais');
    const t1 = sg.find((p) => p.numero === 1);
    expect(t1?.destination).toBe('nid-daigle');
    expect(t1?.origine).toBe('le-fayet');
    const t2 = sg.find((p) => p.numero === 2);
    expect(t2?.destination).toBe('le-fayet');
    expect(t2?.origine).toBe('nid-daigle');
  });
});

describe('facultatif', () => {
  it('n’apparaît sur AUCUN écran tant qu’il n’est pas activé', () => {
    const jour = jourGrand();
    for (const gare of ['le-fayet', 'saint-gervais', 'motivon', 'nid-daigle'] as const) {
      expect(numeros(passagesPourGare(GRAND, jour, gare))).not.toContain(3);
    }
  });

  it('s’affiche normalement une fois activé en supervision', () => {
    const jour = jourGrand();
    circ(jour, 3).facultatif_actif = true;
    const p = passagesPourGare(GRAND, jour, 'saint-gervais').find((x) => x.numero === 3);
    expect(p?.depart_s).toBe(h('08:15:00'));
  });
});

describe('retard', () => {
  it('décale TOUS les passages du train et conserve l’heure théorique', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 11), { statut: 'retard', retard_min: 10, motif: 'Météo' });

    const sg = passagesPourGare(GRAND, jour, 'saint-gervais').find((p) => p.numero === 11);
    expect(sg?.depart_s).toBe(h('11:25:00'));
    expect(sg?.depart_theorique_s).toBe(h('11:15:00'));
    expect(sg?.arrivee_s).toBe(h('11:24:00'));
    expect(sg?.motif).toBe('Météo');

    const motivon = passagesPourGare(GRAND, jour, 'motivon').find((p) => p.numero === 11);
    expect(motivon?.depart_s).toBe(h('11:37:30'));
  });

  it('la ligne reste affichée 2 min après le départ RÉEL, puis disparaît', () => {
    const jour = jourGrand();
    // T1 part de Saint-Gervais à 07:15:00 → retiré après 07:17:00
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais', h('07:16:59')))).toContain(1);
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais', h('07:17:01')))).not.toContain(1);
  });
});

describe('suppression', () => {
  it('reste affiché (barré, aux heures théoriques) jusqu’à son heure théorique', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 16), { statut: 'supprime', motif: 'Technique' });

    const p = passagesPourGare(GRAND, jour, 'saint-gervais', h('14:00')).find(
      (x) => x.numero === 16,
    );
    expect(p?.statut).toBe('supprime');
    expect(p?.depart_s).toBe(h('15:13:30')); // pas de décalage pour un supprimé
    expect(p?.depart_theorique_s).toBe(h('15:13:30'));
  });

  it('disparaît immédiatement à son heure théorique', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 16), { statut: 'supprime' });
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais', h('15:13:29')))).toContain(16);
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais', h('15:13:30')))).not.toContain(
      16,
    );
  });

  it('est exclu de la prochaine arrivée', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 16), { statut: 'supprime' });
    // Sans suppression, T16 (arrivée 15:12:30) précéderait T21 (arrivée 15:14:00)
    const prochaine = prochaineArrivee(GRAND, jour, 'saint-gervais', h('15:00'));
    expect(prochaine?.numero).toBe(21);
    expect(prochaine?.heure_s).toBe(h('15:14:00'));
  });
});

describe('compteARebours', () => {
  it('affiche « n min » sous l’heure', () => {
    expect(compteARebours(h('10:45'), h('10:00'))).toMatchObject({
      type: 'minutes',
      libelle: '45 min',
    });
    expect(compteARebours(h('10:02'), h('10:00'))).toMatchObject({ libelle: '2 min' });
  });

  it('affiche « n h mm » à partir de 60 min', () => {
    expect(compteARebours(h('11:30'), h('10:00'))).toMatchObject({
      type: 'heures',
      libelle: '1 h 30',
    });
    expect(compteARebours(h('11:00'), h('10:00'))).toMatchObject({ libelle: '1 h 00' });
  });

  it('affiche « < 1 min » clignotant de T − 1 min au départ (maquette)', () => {
    expect(compteARebours(h('10:00'), h('09:59:00'))).toMatchObject({ libelle: '1 min' });
    expect(compteARebours(h('10:00'), h('09:59:01')).type).toBe('imminent');
    expect(compteARebours(h('10:00'), h('09:59:30'))).toMatchObject({
      type: 'imminent',
      libelle: '< 1 min',
    });
  });

  it('affiche « À QUAI » du départ jusqu’au retrait de la ligne', () => {
    expect(compteARebours(h('10:00'), h('10:00:00')).type).toBe('quai');
    expect(compteARebours(h('10:00'), h('10:00:30')).type).toBe('quai');
    expect(compteARebours(h('10:00'), h('10:01:59')).type).toBe('quai');
  });
});

describe('prochaineArrivee', () => {
  it('donne le prochain train arrivant en gare avec rame et provenance', () => {
    const jour = jourGrand();
    const prochaine = prochaineArrivee(GRAND, jour, 'saint-gervais', h('10:00'));
    expect(prochaine?.numero).toBe(7); // arrivée 10:14:00, avant T6 (11:12:30)
    expect(prochaine?.heure_s).toBe(h('10:14:00'));
    expect(prochaine?.provenance).toBe('le-fayet');
    expect(prochaine?.rame).toBe(circ(jour, 7).rame);
  });

  it('bascule sur le train suivant si le prochain est supprimé', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 7), { statut: 'supprime' });
    const prochaine = prochaineArrivee(GRAND, jour, 'saint-gervais', h('10:00'));
    expect(prochaine?.numero).toBe(6);
    expect(prochaine?.heure_s).toBe(h('11:12:30'));
    expect(prochaine?.provenance).toBe('nid-daigle');
  });
});

describe('finDeService', () => {
  const demain = serviceActif(GRILLES, dateSuivante(DATE));

  it('après le dernier passage : premier départ du lendemain (07:00 au Fayet)', () => {
    const fin = finDeService(GRAND, jourGrand(), 'le-fayet', h('19:00'), demain);
    expect(fin).not.toBeNull();
    expect(fin?.premierDepart_s).toBe(h('07:00:00'));
    expect(formatHeure(fin?.premierDepart_s ?? null)).toBe('07:00');
  });

  it('tient le passage de minuit (23:59, toujours fin de service)', () => {
    const fin = finDeService(GRAND, jourGrand(), 'le-fayet', h('23:59'), demain);
    expect(fin?.premierDepart_s).toBe(h('07:00:00'));
  });

  it('pas de fin de service avant le premier train du matin', () => {
    expect(finDeService(GRAND, jourGrand(), 'le-fayet', h('05:00'), demain)).toBeNull();
    expect(finDeService(GRAND, jourGrand(), 'saint-gervais', h('12:00'), demain)).toBeNull();
  });

  it('se déclenche dès qu’il n’y a plus de DÉPART affichable (les arrivées continuent)', () => {
    // Au Fayet, dernier départ à 16:00 (T25) ; les descentes arrivent encore jusqu'à 18:24:30
    const fin = finDeService(GRAND, jourGrand(), 'le-fayet', h('16:30'), demain);
    expect(fin?.premierDepart_s).toBe(h('07:00:00'));
    // …et la « prochaine arrivée » reste alimentée (T22 arrive à 17:24:30)
    expect(prochaineArrivee(GRAND, jourGrand(), 'le-fayet', h('16:30'))?.numero).toBe(22);
  });

  it('au Nid d’Aigle : premier départ demain 08:13 (descente T2)', () => {
    const fin = finDeService(GRAND, jourGrand(), 'nid-daigle', h('19:00'), demain);
    expect(fin?.premierDepart_s).toBe(h('08:13:30'));
    expect(formatHeure(fin?.premierDepart_s ?? null)).toBe('08:13');
  });

  it('dernier jour de saison : pas de premier départ demain', () => {
    const jour = generationJour(PETIT, '2026-09-27');
    const grilleDemain = serviceActif(GRILLES, dateSuivante('2026-09-27'));
    expect(grilleDemain).toBeNull();
    const fin = finDeService(PETIT, jour, 'le-fayet', h('19:00'), grilleDemain);
    expect(fin).not.toBeNull();
    expect(fin?.premierDepart_s).toBeNull();
  });
});

describe('terminus Bellevue — journée entière (à partir du TRAIN 1)', () => {
  function jourTerminus(): Jour {
    return appliqueTerminusBellevue(GRAND, jourGrand(), 1).jour;
  }

  it('enregistre la bascule et pré-remplit la colonne Terminus de toutes les rotations', () => {
    const jour = jourTerminus();
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 1 });
    for (const c of jour.circulations.filter((x) => x.sens === 'montee')) {
      expect(c.terminus).toBe('bellevue');
    }
  });

  it('tronque les montées : Bellevue devient le terminus (arrivée seule)', () => {
    const jour = jourTerminus();
    const bellevue = passagesPourGare(GRAND, jour, 'bellevue').find((p) => p.numero === 1);
    expect(bellevue?.arrivee_s).toBe(h('07:48:30'));
    expect(bellevue?.depart_s).toBeNull();
    expect(bellevue?.destination).toBe('bellevue');
    expect(bellevue?.terminusExceptionnel).toBe(true);

    const sg = passagesPourGare(GRAND, jour, 'saint-gervais').find((p) => p.numero === 1);
    expect(sg?.destination).toBe('bellevue');
  });

  it('fait partir les descentes de Bellevue à leur horaire de passage', () => {
    const jour = jourTerminus();
    const bellevue = passagesPourGare(GRAND, jour, 'bellevue').find((p) => p.numero === 2);
    expect(bellevue?.arrivee_s).toBeNull(); // Bellevue devient l’origine
    expect(bellevue?.depart_s).toBe(h('08:33:30'));
    expect(bellevue?.origine).toBe('bellevue');
  });

  it('ne retire plus les express : ils circulent normalement et sont signalés « à traiter »', () => {
    const base = jourGrand();
    circ(base, 9).facultatif_actif = true;
    const { jour, aTraiter } = appliqueTerminusBellevue(GRAND, base, 1);
    expect(aTraiter).toEqual([9, 17, 23]); // toutes les montées express de la grille
    const t9 = passagesPourGare(GRAND, jour, 'nid-daigle').find((p) => p.numero === 9);
    expect(t9?.arrivee_s).toBe(h('11:30:30')); // jamais tronqué
    expect(t9?.destination).toBe('nid-daigle');
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais'))).toContain(9);
  });

  it('vide le Nid d’Aigle : état « tronçon fermé » toute la journée', () => {
    const jour = jourTerminus();
    expect(passagesPourGare(GRAND, jour, 'nid-daigle')).toHaveLength(0);
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('10:00'))).toBe(true);
    expect(etatTronconFerme(GRAND, jour, 'bellevue', h('10:00'))).toBe(false);
    expect(etatTronconFerme(GRAND, jourGrand(), 'nid-daigle', h('10:00'))).toBe(false);
  });

  it('laisse le Nid d’Aigle ouvert tant qu’un express « à traiter » y circule encore', () => {
    const base = jourGrand();
    circ(base, 9).facultatif_actif = true;
    const { jour } = appliqueTerminusBellevue(GRAND, base, 1);
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('10:00'))).toBe(false); // T9 arrive 11:30:30
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('12:00'))).toBe(true); // T9 passé et retiré
  });
});

describe('terminus Bellevue — à partir du TRAIN N (par rotation)', () => {
  it('exemple exploitant « à partir du T19 » : rotations ≥ 19 limitées, < 19 strictement normales', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 19);
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 19 });

    // T15/T16 strictement normaux : T16 part bien du Nid d’Aigle à 14:13:30
    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    expect(nid.find((p) => p.numero === 15)?.arrivee_s).toBe(h('14:05:30'));
    expect(nid.find((p) => p.numero === 16)?.depart_s).toBe(h('14:13:30'));
    expect(circ(jour, 15).terminus).toBe('nid-daigle');

    // Rotations T19/T20, T21/T22 et T25/T26 limitées
    const bellevue = passagesPourGare(GRAND, jour, 'bellevue');
    const t19 = bellevue.find((p) => p.numero === 19);
    expect(t19?.arrivee_s).toBe(h('14:48:30'));
    expect(t19?.depart_s).toBeNull();
    expect(t19?.destination).toBe('bellevue');
    const t20 = bellevue.find((p) => p.numero === 20);
    expect(t20?.origine).toBe('bellevue');
    expect(t20?.depart_s).toBe(h('15:33:30'));
    expect(bellevue.find((p) => p.numero === 26)?.depart_s).toBe(h('17:33:30'));
    for (const numero of [19, 20, 21, 22, 25, 26]) {
      expect(numeros(nid)).not.toContain(numero);
    }
  });

  it('T17/T18 (rotation express sous le seuil) restent strictement normaux, non signalés', () => {
    const base = jourGrand();
    circ(base, 17).facultatif_actif = true;
    circ(base, 18).facultatif_actif = true;
    const { jour, aTraiter } = appliqueTerminusBellevue(GRAND, base, 19);
    expect(aTraiter).not.toContain(17);
    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    expect(nid.find((p) => p.numero === 17)?.arrivee_s).toBe(h('14:30:30'));
    expect(nid.find((p) => p.numero === 18)?.depart_s).toBe(h('14:48:30'));
  });

  it('T23 express de la plage : signalé « à traiter », jamais tronqué ; T24 part de Bellevue', () => {
    const base = jourGrand();
    circ(base, 23).facultatif_actif = true;
    circ(base, 24).facultatif_actif = true;
    const { jour, aTraiter } = appliqueTerminusBellevue(GRAND, base, 19);
    expect(aTraiter).toEqual([23]);

    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    const t23 = nid.find((p) => p.numero === 23);
    expect(t23?.arrivee_s).toBe(h('16:30:30')); // circule normalement en attendant le traitement
    expect(t23?.destination).toBe('nid-daigle');

    const t24 = passagesPourGare(GRAND, jour, 'bellevue').find((p) => p.numero === 24);
    expect(t24?.origine).toBe('bellevue');
    expect(t24?.depart_s).toBe(h('17:08:30'));
    expect(numeros(nid)).not.toContain(24);
  });

  it('un express supprimé n’est plus signalé « à traiter »', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 19);
    Object.assign(circ(jour, 23), { statut: 'supprime' });
    expect(expressATraiter(GRAND, jour)).toEqual([]);
  });

  it('normalise un numéro PAIR vers la montée de sa rotation (T20 → T19)', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 20);
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 19 });
    expect(circ(jour, 19).terminus).toBe('bellevue');
    expect(circ(jour, 17).terminus).toBe('nid-daigle');
    expect(passagesPourGare(GRAND, jour, 'nid-daigle').find((p) => p.numero === 16)?.depart_s).toBe(
      h('14:13:30'),
    );
  });

  it('borne le seuil à la première montée (N ≤ 0 ≡ journée entière)', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 0);
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 1 });
    expect(circ(jour, 1).terminus).toBe('bellevue');
  });

  it('la colonne Terminus reste prioritaire : une rotation pré-remplie peut être rétablie', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 19);
    circ(jour, 21).terminus = 'nid-daigle'; // ajustement manuel en supervision
    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    expect(nid.find((p) => p.numero === 21)?.arrivee_s).toBe(h('16:05:30'));
    expect(nid.find((p) => p.numero === 22)?.depart_s).toBe(h('16:13:30'));
  });

  it('ferme le tronçon au Nid d’Aigle seulement après son dernier passage', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 19);
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('13:00'))).toBe(false);
    // T16 (rotation non limitée) part encore du Nid d’Aigle à 14:13:30
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('14:10'))).toBe(false);
    // Dernier passage retiré (14:13:30 + 2 min) → fermé
    expect(etatTronconFerme(GRAND, jour, 'nid-daigle', h('14:16'))).toBe(true);
  });
});

describe('terminus Bellevue — par train (colonne Terminus)', () => {
  it('tronque la montée limitée et fait partir sa descente appariée de Bellevue', () => {
    const jour = jourGrand();
    circ(jour, 5).terminus = 'bellevue';

    const bellevue = passagesPourGare(GRAND, jour, 'bellevue');
    const t5 = bellevue.find((p) => p.numero === 5);
    expect(t5?.arrivee_s).toBe(h('09:48:30'));
    expect(t5?.depart_s).toBeNull();
    expect(t5?.terminusExceptionnel).toBe(true);

    const t6 = bellevue.find((p) => p.numero === 6);
    expect(t6?.origine).toBe('bellevue');
    expect(t6?.depart_s).toBe(h('10:33:30'));

    const nid = numeros(passagesPourGare(GRAND, jour, 'nid-daigle'));
    expect(nid).not.toContain(5);
    expect(nid).not.toContain(6);
    expect(nid).toContain(1); // les autres trains ne bougent pas
  });

  it('ne tronque jamais une montée express : colonne sur Bellevue → « à traiter »', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    circ(jour, 9).terminus = 'bellevue';
    const p = passagesPourGare(GRAND, jour, 'nid-daigle').find((x) => x.numero === 9);
    expect(p?.arrivee_s).toBe(h('11:30:30')); // l’express ne dessert pas Bellevue
    expect(p?.destination).toBe('nid-daigle');
    expect(expressATraiter(GRAND, jour)).toEqual([9]);
  });
});

describe('rotation des rames', () => {
  it('la descente affiche la rame de sa montée appariée, même si sa ligne diverge', () => {
    const jour = jourGrand();
    circ(jour, 1).rame = 'Jeanne';
    circ(jour, 2).rame = 'Marie'; // valeur stockée obsolète : l’héritage prime
    const t2 = passagesPourGare(GRAND, jour, 'saint-gervais').find((p) => p.numero === 2);
    expect(t2?.rame).toBe('Jeanne');
  });

  it('enchaînement réel : T1 arrive à 08:05:30, sa rame repart en T2 à 08:13:30', () => {
    const jour = jourGrand();
    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    const t1 = nid.find((p) => p.numero === 1);
    const t2 = nid.find((p) => p.numero === 2);
    expect(t1?.arrivee_s).toBe(h('08:05:30'));
    expect(t2?.depart_s).toBe(h('08:13:30'));
    expect(t1?.arrivee_s ?? 0).toBeLessThan(t2?.depart_s ?? 0);
    expect(t2?.rame).toBe(t1?.rame);
  });
});

describe('positionsTrains', () => {
  it('aucun train en ligne avant le premier départ', () => {
    expect(positionsTrains(GRAND, jourGrand(), h('06:00'))).toHaveLength(0);
  });

  it('à 07:30, T1 (parti 07:00) a Motivon pour dernier point de passage', () => {
    const positions = positionsTrains(GRAND, jourGrand(), h('07:30'));
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ numero: 1, sens: 'montee', gare: 'motivon' });
  });

  it('à 10:50 avec T9 activé : trois trains en ligne aux bons points de passage', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    const positions = positionsTrains(GRAND, jour, h('10:50'));
    expect(positions.find((p) => p.numero === 6)?.gare).toBe('col-de-voza');
    expect(positions.find((p) => p.numero === 7)?.gare).toBe('bellevue');
    expect(positions.find((p) => p.numero === 9)?.gare).toBe('saint-gervais');
    expect(positions).toHaveLength(3);
  });

  it('un train supprimé n’est jamais en ligne', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 7), { statut: 'supprime' });
    const positions = positionsTrains(GRAND, jour, h('10:50'));
    expect(positions.find((p) => p.numero === 7)).toBeUndefined();
  });
});

describe('pureté du moteur (aucun accès réseau ni horloge dans src/core/)', () => {
  it('horaires.ts et types.ts n’utilisent ni Date.now, ni fetch, ni WebSocket', () => {
    for (const fichier of ['./horaires.ts', './types.ts']) {
      const source = readFileSync(fileURLToPath(new URL(fichier, import.meta.url)), 'utf-8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/Date\.now|fetch\(|XMLHttpRequest|WebSocket|navigator\./);
      // Seule la conversion de date calendaire (Date.UTC, déterministe) est admise.
      expect(code).not.toMatch(/new Date\(\)/);
    }
  });

  it('appliqueTerminusBellevue est pur : ni le jour ni la grille fournis ne sont modifiés', () => {
    const jour = jourGrand();
    const jourAvant = JSON.stringify(jour);
    const grilleAvant = JSON.stringify(GRAND);
    appliqueTerminusBellevue(GRAND, jour, 19);
    expect(JSON.stringify(jour)).toBe(jourAvant);
    expect(JSON.stringify(GRAND)).toBe(grilleAvant);
  });
});
