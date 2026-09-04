// Tests du moteur horaires sur les VRAIS horaires été 2026 (docs/02 §3).
// Rappel : si un test « attend » une autre heure que la grille officielle,
// c'est le test qui a tort — corriger le test, jamais la grille.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import {
  appliqueTerminusBellevue,
  compteARebours,
  dateSuivante,
  etatTronconFerme,
  expressATraiter,
  finDeService,
  formatHeure,
  generationJour,
  grillePourJour,
  heureVersSecondes,
  libelleTrain,
  libelleTrainCourt,
  passagesPourGare,
  positionsTrains,
  prochaineArrivee,
  quaiOccupe,
  serviceActif,
  trainsDuJour,
} from './horaires';
import { construitRotationSup } from './train-sup';
import type { Circulation, Grille, Jour, PassageGare, TrainGrille } from './types';

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

  // Grilles en BASE (chantier import des horaires) : règle documentée dans
  // docs/01 §2.1 et dans le commentaire de serviceActif().
  it('ignore une grille désactivée, sans jamais replier sur une autre hors saison', () => {
    const petitInactif: Grille = { ...PETIT, actif: false };
    expect(serviceActif([GRAND, petitInactif], '2026-06-20')).toBeNull();
    expect(serviceActif([GRAND, petitInactif], '2026-07-15')?.version).toBe(
      '2026-ete-grand-service',
    );
  });

  it('deux grilles actives sur la même date : la plus récemment créée l’emporte, quel que soit l’ordre', () => {
    const v1: Grille = { ...GRAND, version: 'grand-v1', cree_le: '2026-06-05T10:00:00Z' };
    const v2: Grille = { ...GRAND, version: 'grand-v2', cree_le: '2026-09-01T10:00:00Z' };
    expect(serviceActif([v1, v2], '2026-07-15')?.version).toBe('grand-v2');
    expect(serviceActif([v2, v1], '2026-07-15')?.version).toBe('grand-v2');
  });

  it('désactiver la grille la plus récente redonne la main à la précédente (retour arrière)', () => {
    const v1: Grille = { ...GRAND, version: 'grand-v1', cree_le: '2026-06-05T10:00:00Z' };
    const v2: Grille = { ...GRAND, version: 'grand-v2', cree_le: '2026-09-01T10:00:00Z' };
    expect(serviceActif([v1, { ...v2, actif: false }], '2026-07-15')?.version).toBe('grand-v1');
    // La grille réactivée reprend aussitôt la main.
    expect(serviceActif([v1, { ...v2, actif: true }], '2026-07-15')?.version).toBe('grand-v2');
  });

  it('une grille sans date de création (fichier JSON) compte comme la plus ancienne ; à égalité, la première de la liste', () => {
    const datee: Grille = { ...GRAND, version: 'grand-datee', cree_le: '2026-06-05T10:00:00Z' };
    expect(serviceActif([GRAND, datee], '2026-07-15')?.version).toBe('grand-datee');
    expect(serviceActif([GRAND, { ...GRAND, version: 'grand-copie' }], '2026-07-15')?.version).toBe(
      '2026-ete-grand-service',
    );
  });
});

describe('grillePourJour', () => {
  it('prend la grille qui a généré la journée quand elle est disponible', () => {
    const jour = generationJour(PETIT, '2026-06-20');
    expect(grillePourJour(GRILLES, jour)?.version).toBe('2026-ete-petit-service');
  });

  it('replie sur la grille en vigueur à la date si la version de la journée n’est plus disponible', () => {
    const jour: Jour = { ...jourGrand(), grille_version: '2026-ete-grand-service-v0' };
    expect(grillePourJour(GRILLES, jour)?.version).toBe('2026-ete-grand-service');
  });

  it('null hors saison plutôt que la première grille de la liste', () => {
    const jour: Jour = {
      date: '2026-12-01',
      grille_version: 'inconnue',
      terminus_bellevue: false,
      gare_debut: 'le-fayet',
      gare_fin: 'nid-daigle',
      circulations: [],
    };
    expect(grillePourJour(GRILLES, jour)).toBeNull();
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

  it('arrivée = heure réelle du document d’exploitation (T1 à Saint-Gervais : 07:10:00)', () => {
    // Arrêt de 5 min à Saint-Gervais en montée (a 07:10:00, d 07:15:00)
    const p = passagesPourGare(GRAND, jourGrand(), 'saint-gervais').find((x) => x.numero === 1);
    expect(p?.depart_s).toBe(h('07:15:00'));
    expect(p?.arrivee_s).toBe(h('07:10:00'));
  });

  it('repli : arrivée = départ − arret_intermediaire_s si le document ne donne pas d’arrivée', () => {
    const monteeSansArrivee: TrainGrille = {
      numero: 1,
      express: false,
      facultatif: false,
      velos: false,
      passages: [
        { gare: 'le-fayet', d: '07:00:00' },
        { gare: 'saint-gervais', d: '07:15:00' }, // pas de « a » : repli 60 s
        { gare: 'nid-daigle', a: '08:05:30' },
      ],
    };
    const grilleMinimale: Grille = { ...GRAND, montees: [monteeSansArrivee], descentes: [] };
    const jour = generationJour(grilleMinimale, DATE);
    const p = passagesPourGare(grilleMinimale, jour, 'saint-gervais').find((x) => x.numero === 1);
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
    expect(sg?.arrivee_s).toBe(h('11:20:00')); // arrivée réelle 11:10:00 + 10 min
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
    // Au Fayet à 15:00, T16 (arrivée théorique 15:24:30) serait la prochaine :
    // supprimé, c'est T20 (16:24:30) qui prend sa place
    const prochaine = prochaineArrivee(GRAND, jour, 'le-fayet', h('15:00'));
    expect(prochaine?.numero).toBe(20);
    expect(prochaine?.heure_s).toBe(h('16:24:30'));
  });
});

describe('compteARebours — formats numériques', () => {
  // Les états nommés (à quai / imminent / parti) sont couverts bout en bout
  // sur les horaires réels dans quai.test.ts. Ici : le formatage des nombres.
  // On passe une heure d’ARRIVÉE encore à venir pour rester dans la phase de
  // décompte ; sans elle, la fonction applique la règle des gares d’origine.
  it('affiche « n min » sous l’heure', () => {
    expect(compteARebours(h('10:45'), h('10:00'), h('10:40'))).toMatchObject({
      type: 'minutes',
      libelle: '45 min',
    });
    expect(compteARebours(h('10:02'), h('10:00'), h('10:01'))).toMatchObject({
      libelle: '2 min',
    });
  });

  it('affiche « n h mm » à partir de 60 min', () => {
    expect(compteARebours(h('11:30'), h('10:00'), h('11:25'))).toMatchObject({
      type: 'heures',
      libelle: '1 h 30',
    });
    expect(compteARebours(h('11:00'), h('10:00'), h('10:55'))).toMatchObject({
      libelle: '1 h 00',
    });
  });

  it('bascule sur « DÉPART IMMINENT » 30 s avant le départ, pas 60', () => {
    expect(compteARebours(h('10:00'), h('09:59:29'), h('09:58')).type).toBe('quai');
    expect(compteARebours(h('10:00'), h('09:59:30'), h('09:58')).type).toBe('imminent');
  });

  it('« PARTI » seulement APRÈS l’heure de départ', () => {
    expect(compteARebours(h('10:00'), h('10:00:00'), h('09:58')).type).toBe('imminent');
    expect(compteARebours(h('10:00'), h('10:00:01'), h('09:58')).type).toBe('parti');
    expect(compteARebours(h('10:00'), h('10:01:59'), h('09:58')).type).toBe('parti');
  });
});

describe('prochaineArrivee', () => {
  it('donne le prochain train arrivant en gare avec rame et provenance', () => {
    const jour = jourGrand();
    const prochaine = prochaineArrivee(GRAND, jour, 'saint-gervais', h('10:00'));
    expect(prochaine?.numero).toBe(7); // arrivée réelle 10:10:00, avant T6 (11:11:30)
    expect(prochaine?.heure_s).toBe(h('10:10:00'));
    expect(prochaine?.provenance).toBe('le-fayet');
    expect(prochaine?.rame).toBe(circ(jour, 7).rame);
  });

  it('bascule sur le train suivant si le prochain est supprimé', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 7), { statut: 'supprime' });
    // Les arrivées réelles resserrent l'ordre : T11 (11:10:00) devance T6 (11:11:30)
    const prochaine = prochaineArrivee(GRAND, jour, 'saint-gervais', h('10:00'));
    expect(prochaine?.numero).toBe(11);
    expect(prochaine?.heure_s).toBe(h('11:10:00'));
    expect(prochaine?.provenance).toBe('le-fayet');
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
    expect(bellevue?.arrivee_s).toBe(h('07:47:30')); // arrivée réelle (document d'exploitation)
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
    circ(base, 9).facultatif_actif = true; // montée express
    circ(base, 10).facultatif_actif = true; // sa descente, express aussi
    const { jour, aTraiter } = appliqueTerminusBellevue(GRAND, base, 1);
    // Seuls les express qui CIRCULENT sont signalés (T17/T23 sont facultatifs
    // non activés) — montée ET descente express de la rotation 9/10.
    expect(aTraiter).toEqual([9, 10]);
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
    expect(t19?.arrivee_s).toBe(h('14:47:30')); // arrivée réelle (document d'exploitation)
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

  it('un express supprimé ou non activé n’est plus signalé « à traiter »', () => {
    const { jour } = appliqueTerminusBellevue(GRAND, jourGrand(), 19);
    // T23/T24 sont facultatifs et non activés : ils ne circulent pas
    expect(expressATraiter(GRAND, jour)).toEqual([]);

    circ(jour, 23).facultatif_actif = true;
    expect(expressATraiter(GRAND, jour)).toEqual([23]);
    Object.assign(circ(jour, 23), { statut: 'supprime' });
    expect(expressATraiter(GRAND, jour)).toEqual([]);
  });

  it('la DESCENTE express d’une rotation limitée est aussi signalée (elle partirait du Nid d’Aigle)', () => {
    const base = jourGrand();
    circ(base, 17).facultatif_actif = true; // montée express
    circ(base, 18).facultatif_actif = true; // descente express appariée
    const { jour, aTraiter } = appliqueTerminusBellevue(GRAND, base, 15);
    // T17 (montée express) ET T18 (descente express) doivent être signalés :
    // aucun des deux ne dessert Bellevue.
    expect(aTraiter).toContain(17);
    expect(aTraiter).toContain(18);
    // T18 part toujours du Nid d'Aigle : c'est bien le train à traiter
    const nid = passagesPourGare(GRAND, jour, 'nid-daigle');
    expect(nid.find((p) => p.numero === 18)?.depart_s).toBe(h('14:48:30'));
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
    expect(t5?.arrivee_s).toBe(h('09:47:30')); // arrivée réelle (document d'exploitation)
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

  it('un train retardé est en ligne à son origine dès son heure théorique (maquette)', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 11), { statut: 'retard', retard_min: 10, motif: 'Météo' });
    // Départ théorique 11:00, départ réel 11:10 : à 11:02 le train est à quai au Fayet
    const positions = positionsTrains(GRAND, jour, h('11:02'));
    expect(positions.find((p) => p.numero === 11)?.gare).toBe('le-fayet');
    // Avant l'heure théorique : pas encore en ligne
    expect(positionsTrains(GRAND, jour, h('10:59')).find((p) => p.numero === 11)).toBeUndefined();
  });

  it('un train supprimé n’est jamais en ligne', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 7), { statut: 'supprime' });
    const positions = positionsTrains(GRAND, jour, h('10:50'));
    expect(positions.find((p) => p.numero === 7)).toBeUndefined();
  });
});

describe('pureté du moteur (aucun accès réseau ni horloge dans src/core/)', () => {
  it('aucun module de src/core/ n’utilise Date.now, fetch ni WebSocket', () => {
    for (const fichier of ['./horaires.ts', './types.ts', './cycle-medias.ts']) {
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

describe('quaiOccupe — source unique de la règle « pas de média à quai »', () => {
  // Cas réel de Saint-Gervais : le TRAIN 5 arrive à 09:10:00 et repart à
  // 09:15:00. L'ancien garde-fou du cycle médias (« départ dans ≤ 2 min »)
  // ne se déclenchait qu'à 09:13 : de 09:10 à 09:13, l'écran affichait
  // « À QUAI » ET des médias par-dessus (bug production du 29/08/2026).
  const jour = jourGrand();
  const passages = passagesPourGare(GRAND, jour, 'saint-gervais');
  const t5 = passages.filter((p) => p.numero === 5);

  it('les horaires officiels sont bien ceux du scénario', () => {
    expect(t5[0]?.arrivee_s).toBe(h('09:10:00'));
    expect(t5[0]?.depart_s).toBe(h('09:15:00'));
  });

  it('avant l’arrivée, le quai est libre : les médias peuvent passer', () => {
    expect(quaiOccupe(t5, h('09:09:00'))).toBe(false);
  });

  it('DÈS l’heure d’arrivée, le quai est occupé — le cas qui échouait', () => {
    expect(quaiOccupe(t5, h('09:10:00'))).toBe(true);
    // …et l'ancienne règle, elle, laissait passer les médias :
    const ancienneRegle = (t5[0]?.depart_s ?? 0) - h('09:10:00') <= 120;
    expect(ancienneRegle).toBe(false);
  });

  it('reste occupé pendant tout l’arrêt, jusqu’au retrait de la ligne', () => {
    expect(quaiOccupe(t5, h('09:12:00'))).toBe(true); // À QUAI
    expect(quaiOccupe(t5, h('09:14:45'))).toBe(true); // DÉPART IMMINENT
    expect(quaiOccupe(t5, h('09:15:30'))).toBe(true); // PARTI, encore affiché
  });

  it('une fois le train retiré de l’affichage, les médias reprennent', () => {
    const restants = passagesPourGare(GRAND, jour, 'saint-gervais', h('09:17:30'));
    expect(restants.some((p) => p.numero === 5)).toBe(false);
    expect(
      quaiOccupe(
        restants.filter((p) => p.numero === 5),
        h('09:17:30'),
      ),
    ).toBe(false);
  });

  it('gare d’origine (aucune arrivée) : occupé dès D − 5 min', () => {
    const auFayet = passagesPourGare(GRAND, jour, 'le-fayet').filter((p) => p.numero === 5);
    expect(auFayet[0]?.arrivee_s).toBeNull();
    expect(auFayet[0]?.depart_s).toBe(h('09:00:00'));
    expect(quaiOccupe(auFayet, h('08:54:59'))).toBe(false);
    expect(quaiOccupe(auFayet, h('08:55:00'))).toBe(true);
    // Le délai est celui du paramètre, pas une constante figée
    expect(quaiOccupe(auFayet, h('08:50:00'), 600)).toBe(true);
  });

  it('un train supprimé n’occupe jamais le quai', () => {
    const supprime = t5.map((p) => ({ ...p, statut: 'supprime' as const }));
    expect(quaiOccupe(supprime, h('09:12:00'))).toBe(false);
  });

  it('aucun passage : quai libre', () => {
    expect(quaiOccupe([], h('09:12:00'))).toBe(false);
  });

  it('le préavis couvre un passage dont l’heure d’arrivée est inconnue', () => {
    const sansArrivee = [{ ...(t5[0] as PassageGare), arrivee_s: null }];
    // Sans arrivée ET sans délai d'origine, seul le préavis joue
    expect(quaiOccupe(sansArrivee, h('09:12:00'), 0)).toBe(false);
    expect(quaiOccupe(sansArrivee, h('09:13:00'), 0)).toBe(true); // D − 2 min
  });

  it('un train parti depuis longtemps ne bloque pas les médias', () => {
    // Liste non filtrée : le garde-fou borne « parti » au retrait de la ligne
    expect(quaiOccupe(t5, h('11:00:00'))).toBe(false);
  });
});

describe('Trains supplémentaires dans le moteur', () => {
  const DATE_SUP = '2026-07-15';

  /** Journée avec une rotation sup Le Fayet ⇄ Col de Voza (101 / 102). */
  function jourAvecSup(surcharge: Partial<Circulation> = {}): Jour {
    const jour = jourGrand();
    const rotation = construitRotationSup(GRAND, {
      heureDepart_s: h('17:00:00'),
      garesMontee: ['le-fayet', 'col-de-voza'],
      garesDescente: ['col-de-voza', 'le-fayet'],
      battement_s: 5 * 60,
    });
    const base: Circulation = {
      date: DATE_SUP,
      numero: 101,
      sens: 'montee',
      express: false,
      facultatif: false,
      facultatif_actif: false,
      velos: false,
      rame: 'Jeanne',
      terminus: 'nid-daigle',
      statut: 'ok',
      retard_min: 0,
      motif: null,
      sans_voyageurs: false,
      supplementaire: true,
      passages: rotation.montee,
    };
    jour.circulations.push(
      { ...base, ...surcharge },
      {
        ...base,
        numero: 102,
        sens: 'descente',
        rame: 'PEU IMPORTE', // doit être écrasée par l'héritage de la montée
        passages: rotation.descente,
      },
    );
    return jour;
  }

  it('le train sup apparaît au Fayet et au Col de Voza', () => {
    const jour = jourAvecSup();
    expect(numeros(passagesPourGare(GRAND, jour, 'le-fayet'))).toContain(101);
    expect(numeros(passagesPourGare(GRAND, jour, 'col-de-voza'))).toContain(101);
  });

  it('…et PAS à Saint-Gervais ni à Motivon, qu’il ne dessert pas', () => {
    const jour = jourAvecSup();
    expect(numeros(passagesPourGare(GRAND, jour, 'saint-gervais'))).not.toContain(101);
    expect(numeros(passagesPourGare(GRAND, jour, 'motivon'))).not.toContain(101);
  });

  it('ses heures sont celles de ses propres passages', () => {
    const jour = jourAvecSup();
    const auVoza = passagesPourGare(GRAND, jour, 'col-de-voza').find((p) => p.numero === 101);
    expect(auVoza?.arrivee_s).toBe(h('17:34:30'));
    const auFayet = passagesPourGare(GRAND, jour, 'le-fayet').find((p) => p.numero === 101);
    expect(auFayet?.depart_s).toBe(h('17:00:00'));
    expect(auFayet?.arrivee_s).toBeNull(); // origine
  });

  it('il n’est PAS marqué express : ni picto motrice, ni mention express', () => {
    const train = trainsDuJour(GRAND, jourAvecSup()).find((t) => t.numero === 101);
    expect(train?.express).toBe(false);
    expect(train?.supplementaire).toBe(true);
    // Le drapeau est reporté jusqu'aux passages affichés
    const p = passagesPourGare(GRAND, jourAvecSup(), 'le-fayet').find((x) => x.numero === 101);
    expect(p?.supplementaire).toBe(true);
    expect(p?.express).toBe(false);
  });

  it('la descente 102 hérite de la rame de la montée 101', () => {
    const descente = trainsDuJour(GRAND, jourAvecSup()).find((t) => t.numero === 102);
    expect(descente?.rame).toBe('Jeanne');
  });

  it('une montée sup sans voyageurs est invisible, sa descente reste visible', () => {
    const jour = jourAvecSup({ sans_voyageurs: true });
    const tous = numeros(trainsDuJour(GRAND, jour));
    expect(tous).not.toContain(101);
    expect(tous).toContain(102);
  });

  it('un retard de 10 min décale TOUS ses passages', () => {
    const jour = jourAvecSup({ statut: 'retard', retard_min: 10 });
    const auFayet = passagesPourGare(GRAND, jour, 'le-fayet').find((p) => p.numero === 101);
    expect(auFayet?.depart_s).toBe(h('17:10:00'));
    expect(auFayet?.depart_theorique_s).toBe(h('17:00:00'));
    const auVoza = passagesPourGare(GRAND, jour, 'col-de-voza').find((p) => p.numero === 101);
    expect(auVoza?.arrivee_s).toBe(h('17:44:30'));
  });

  it('un train sup supprimé reste affiché barré, puis disparaît', () => {
    const jour = jourAvecSup({ statut: 'supprime', motif: 'Météo' });
    const avant = passagesPourGare(GRAND, jour, 'le-fayet', h('16:59:00'));
    expect(numeros(avant)).toContain(101);
    const apres = passagesPourGare(GRAND, jour, 'le-fayet', h('17:00:30'));
    expect(numeros(apres)).not.toContain(101);
  });

  it('Terminus Bellevue : un train sup vers le Nid d’Aigle est tronqué', () => {
    const jour = jourGrand();
    const rotation = construitRotationSup(GRAND, {
      heureDepart_s: h('17:00:00'),
      garesMontee: ['le-fayet', 'col-de-voza', 'bellevue', 'nid-daigle'],
      garesDescente: ['nid-daigle', 'bellevue', 'col-de-voza', 'le-fayet'],
      battement_s: 5 * 60,
    });
    const base: Circulation = {
      date: DATE_SUP,
      numero: 101,
      sens: 'montee',
      express: false,
      facultatif: false,
      facultatif_actif: false,
      velos: false,
      rame: 'Jeanne',
      terminus: 'bellevue', // rotation limitée
      statut: 'ok',
      retard_min: 0,
      motif: null,
      sans_voyageurs: false,
      supplementaire: true,
      passages: rotation.montee,
    };
    jour.circulations.push(base, {
      ...base,
      numero: 102,
      sens: 'descente',
      passages: rotation.descente,
    });

    const montee = trainsDuJour(GRAND, jour).find((t) => t.numero === 101);
    expect(montee?.terminusExceptionnel).toBe(true);
    expect(montee?.passages[montee.passages.length - 1]?.gare).toBe('bellevue');
    // Plus aucun passage au Nid d'Aigle : le tronçon supérieur est fermé
    expect(numeros(passagesPourGare(GRAND, jour, 'nid-daigle'))).not.toContain(101);

    const descente = trainsDuJour(GRAND, jour).find((t) => t.numero === 102);
    expect(descente?.passages[0]?.gare).toBe('bellevue');
  });

  it('un train sup limité au Col de Voza n’est pas concerné par Bellevue', () => {
    const jour = jourAvecSup({ terminus: 'bellevue' });
    const montee = trainsDuJour(GRAND, jour).find((t) => t.numero === 101);
    // Aucun passage à Bellevue : rien à tronquer, le train reste intact
    expect(montee?.terminusExceptionnel).toBe(false);
    expect(montee?.passages[montee.passages.length - 1]?.gare).toBe('col-de-voza');
  });
});

describe('libelleTrain — source unique du libellé', () => {
  const grilleTrains = [
    { numero: 9, supplementaire: false },
    { numero: 10, supplementaire: false },
  ];

  it('un train de grille garde « TRAIN 9 »', () => {
    expect(libelleTrain({ numero: 9, supplementaire: false }, grilleTrains)).toBe('TRAIN 9');
  });

  it('un seul train sup dans la journée : « TRAIN SUP », sans numéro', () => {
    const tous = [
      ...grilleTrains,
      { numero: 101, supplementaire: true },
      { numero: 102, supplementaire: true },
    ];
    expect(libelleTrain({ numero: 101, supplementaire: true }, tous)).toBe('TRAIN SUP');
    // La descente appariée porte le MÊME libellé : c'est la même rotation
    expect(libelleTrain({ numero: 102, supplementaire: true }, tous)).toBe('TRAIN SUP');
  });

  it('deux trains sup : « TRAIN SUP 1 » et « TRAIN SUP 2 », dans l’ordre des numéros', () => {
    const tous = [
      ...grilleTrains,
      { numero: 103, supplementaire: true },
      { numero: 104, supplementaire: true },
      { numero: 101, supplementaire: true },
      { numero: 102, supplementaire: true },
    ];
    expect(libelleTrain({ numero: 101, supplementaire: true }, tous)).toBe('TRAIN SUP 1');
    expect(libelleTrain({ numero: 102, supplementaire: true }, tous)).toBe('TRAIN SUP 1');
    expect(libelleTrain({ numero: 103, supplementaire: true }, tous)).toBe('TRAIN SUP 2');
    expect(libelleTrain({ numero: 104, supplementaire: true }, tous)).toBe('TRAIN SUP 2');
  });
});

describe('libelleTrainCourt — écriture compacte du badge de l’écran de gare', () => {
  const grilleTrains = [
    { numero: 11, supplementaire: false },
    { numero: 12, supplementaire: false },
  ];

  it('un train de grille : « T11 »', () => {
    expect(libelleTrainCourt({ numero: 11, supplementaire: false }, grilleTrains)).toBe('T11');
  });

  it('un seul train sup dans la journée : « SUP », sans numéro', () => {
    const tous = [
      ...grilleTrains,
      { numero: 101, supplementaire: true },
      { numero: 102, supplementaire: true },
    ];
    expect(libelleTrainCourt({ numero: 101, supplementaire: true }, tous)).toBe('SUP');
    expect(libelleTrainCourt({ numero: 102, supplementaire: true }, tous)).toBe('SUP');
  });

  it('deux rotations sup : « SUP 1 » et « SUP 2 », la descente partageant le rang de sa montée', () => {
    const tous = [
      ...grilleTrains,
      { numero: 103, supplementaire: true },
      { numero: 104, supplementaire: true },
      { numero: 101, supplementaire: true },
      { numero: 102, supplementaire: true },
    ];
    expect(libelleTrainCourt({ numero: 101, supplementaire: true }, tous)).toBe('SUP 1');
    expect(libelleTrainCourt({ numero: 102, supplementaire: true }, tous)).toBe('SUP 1');
    expect(libelleTrainCourt({ numero: 103, supplementaire: true }, tous)).toBe('SUP 2');
    expect(libelleTrainCourt({ numero: 104, supplementaire: true }, tous)).toBe('SUP 2');
  });

  it('le rang est le MÊME que celui de libelleTrain, sur les mêmes entrées', () => {
    // Les deux libellés décrivent le même objet : si le badge et la
    // supervision divergeaient sur le rang, l'exploitant ne pourrait plus
    // désigner un train au téléphone.
    const tous = [
      ...grilleTrains,
      { numero: 105, supplementaire: true },
      { numero: 106, supplementaire: true },
      { numero: 101, supplementaire: true },
      { numero: 102, supplementaire: true },
      { numero: 103, supplementaire: true },
    ];
    for (const t of tous) {
      const long = libelleTrain(t, tous);
      const court = libelleTrainCourt(t, tous);
      // « TRAIN 11 » → « T11 » ; « TRAIN SUP 2 » → « SUP 2 »
      expect(court).toBe(
        t.supplementaire ? long.replace('TRAIN ', '') : long.replace('TRAIN ', 'T'),
      );
    }
  });

  it('un train sup absent de la liste retombe sur « SUP », comme le libellé long', () => {
    const tous = [
      ...grilleTrains,
      { numero: 101, supplementaire: true },
      { numero: 103, supplementaire: true },
    ];
    // 201 n'appartient pas à la journée : aucun rang à lui donner.
    expect(libelleTrainCourt({ numero: 201, supplementaire: true }, tous)).toBe('SUP');
    expect(libelleTrain({ numero: 201, supplementaire: true }, tous)).toBe('TRAIN SUP');
  });
});
