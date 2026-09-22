// Carte « Corriger cette grille » : ce qui bloque l'enregistrement, ce qui
// est enregistré, ce qui est consigné. Aucune règle métier n'est vérifiée ici
// — elles le sont dans edition-grille.test.ts et import-grille.test.ts ; ce
// qui est vérifié, c'est que cette carte les fait bien appliquer.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import {
  poseHeure,
  poseIndicateur,
  retireNidDaigle,
  supprimeRotation,
} from '../core/edition-grille';
import type { Grille } from '../core/types';
import {
  avertissementsCorrection,
  cleCellule,
  ecartsCorrection,
  effetNouvelleGrille,
  grilleAEnregistrerCorrection,
  nouvelleCorrection,
  nouvelleDuplication,
  periodesRetenues,
  raisonsBlocageCorrection,
  resumeCorrection,
} from './correction-grille';

const GRAND: Grille = {
  ...(grandServiceJson as unknown as Grille),
  cree_le: '2026-06-05T08:00:00Z',
};
const PETIT: Grille = {
  ...(petitServiceJson as unknown as Grille),
  cree_le: '2026-06-05T08:00:00Z',
};

describe('nouvelleCorrection', () => {
  it('part d’une copie : corriger la saisie ne touche pas la grille enregistrée', () => {
    const c = nouvelleCorrection(GRAND);
    expect(c.mode).toBe('correction');
    expect(ecartsCorrection(c).aucun).toBe(true);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' },
      '9h27',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    expect(ecartsCorrection(c).heures).toHaveLength(1);
    expect(
      GRAND.montees.find((m) => m.numero === 5)?.passages.find((p) => p.gare === 'motivon')?.a,
    ).toBe('09:26:30');
  });

  it('les dates et le nom restent ceux de l’originale (ils se modifient ailleurs)', () => {
    const c = nouvelleCorrection(GRAND);
    c.periodes = [{ du: '2030-01-01', au: '2030-01-02' }];
    // Une correction ne peut pas déplacer les dates, même si le champ existe.
    expect(periodesRetenues(c)).toEqual(GRAND.periodes);
    expect(grilleAEnregistrerCorrection(c, [GRAND.version]).periodes).toEqual(GRAND.periodes);
    expect(grilleAEnregistrerCorrection(c, [GRAND.version]).libelle).toBe(GRAND.libelle);
  });
});

describe('raisonsBlocageCorrection', () => {
  it('rien à enregistrer tant que rien n’a changé', () => {
    expect(raisonsBlocageCorrection(nouvelleCorrection(GRAND))).toEqual([
      'Aucune correction à enregistrer : la grille est identique à l’originale.',
    ]);
  });

  it('une correction valide débloque l’enregistrement', () => {
    const c = nouvelleCorrection(GRAND);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'le-fayet', champ: 'd' },
      '9h01',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    expect(avertissementsCorrection(c)).toEqual([]);
    expect(raisonsBlocageCorrection(c)).toEqual([]);
  });

  it('une erreur du validateur de l’import bloque, et c’est son message qui s’affiche', () => {
    const c = nouvelleCorrection(GRAND);
    // Une arrivée à Motivon APRÈS le départ du Col de Voza : chronologie rompue.
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' },
      '23:59',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    const raisons = raisonsBlocageCorrection(c);
    expect(raisons.length).toBeGreaterThan(0);
    expect(raisons.join(' ')).toMatch(/TRAIN 5/);
  });

  it('une saisie refusée bloque tant que la cellule n’est pas corrigée', () => {
    const c = nouvelleCorrection(GRAND);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'le-fayet', champ: 'd' },
      '9h01',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    c.erreursCellules.set(cleCellule('montee', 7, 'bellevue', 'd'), {
      saisie: 'midi',
      message: '« midi » n’est pas une heure',
    });
    expect(raisonsBlocageCorrection(c)).toEqual([
      '1 saisie(s) refusée(s) : corrigez les cellules signalées en rouge.',
    ]);
    c.erreursCellules.clear();
    expect(raisonsBlocageCorrection(c)).toEqual([]);
  });

  it('les avertissements s’acquittent, ils ne bloquent pas', () => {
    const c = nouvelleCorrection(GRAND);
    // Arrêt inhabituel à Motivon : le validateur avertit sans refuser.
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'd' },
      '9h35',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    expect(avertissementsCorrection(c).length).toBeGreaterThan(0);
    expect(raisonsBlocageCorrection(c)).toEqual([
      'Lisez les avertissements et cochez « J’ai lu ces avertissements ».',
    ]);
    c.avertissementsAcquittes = true;
    expect(raisonsBlocageCorrection(c)).toEqual([]);
  });

  it('une grille vidée de ses trains ne s’enregistre pas', () => {
    const c = nouvelleCorrection(PETIT);
    for (const m of [...c.grille.montees]) c.grille = supprimeRotation(c.grille, m.numero);
    expect(raisonsBlocageCorrection(c)).toContain('La grille ne contient aucun train.');
  });
});

describe('grilleAEnregistrerCorrection (correction)', () => {
  it('crée la version suivante, active, sans métadonnée héritée', () => {
    const c = nouvelleCorrection(GRAND);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' },
      '9h27',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    const g = grilleAEnregistrerCorrection(c, [GRAND.version, PETIT.version]);
    expect(g.version).toBe(`${GRAND.version}-v2`);
    expect(g.libelle).toBe(GRAND.libelle);
    expect(g.source).toBe(
      `corrigée en supervision depuis « ${GRAND.libelle} » (référence ${GRAND.version})`,
    );
    expect('cree_le' in g).toBe(false);
    expect('cree_par' in g).toBe(false);
    expect('actif' in g).toBe(false);
    // Le contenu corrigé, et lui seul.
    expect(ecartsCorrection(c).heures).toHaveLength(1);
  });

  it('une deuxième correction repart de la racine : -v3, jamais d’écrasement', () => {
    const v2: Grille = { ...GRAND, version: `${GRAND.version}-v2` };
    const c = nouvelleCorrection(v2);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' },
      '9h27',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    expect(grilleAEnregistrerCorrection(c, [GRAND.version, v2.version]).version).toBe(
      `${GRAND.version}-v3`,
    );
  });
});

describe('duplication', () => {
  it('reprend le contenu, vide le nom et les dates, et les réclame', () => {
    const d = nouvelleDuplication(PETIT);
    expect(d.mode).toBe('duplication');
    expect(d.libelle).toBe('');
    expect(ecartsCorrection(d).aucun).toBe(true);
    // Contrairement à une correction, un contenu inchangé ne bloque pas : ce
    // qui manque, c'est l'identité.
    const raisons = raisonsBlocageCorrection(d);
    expect(raisons).toContain('Donnez un nom à la nouvelle grille.');
    expect(raisons.join(' ')).toMatch(/dates incomplètes ou invalides/);
  });

  it('grille d’hiver : dupliquer, retirer le Nid d’Aigle, retirer des rotations', () => {
    const d = nouvelleDuplication(PETIT);
    d.libelle = 'Hiver';
    d.periodes = [{ du: '2026-12-19', au: '2027-03-14' }];
    d.grille = retireNidDaigle(d.grille);
    // Les express n'existent qu'avec le Nid d'Aigle : le validateur les signale.
    for (const t of [...d.grille.montees, ...d.grille.descentes]) {
      if (t.express) {
        d.grille = poseIndicateur(
          d.grille,
          d.grille.montees.includes(t) ? 'montee' : 'descente',
          t.numero,
          'express',
          false,
        );
      }
    }
    d.grille = supprimeRotation(d.grille, d.grille.montees[0]?.numero ?? 1);
    expect(raisonsBlocageCorrection(d)).toEqual([]);
    const g = grilleAEnregistrerCorrection(d, [PETIT.version]);
    expect(g.version).toBe('2026-2027-hiver');
    expect(g.libelle).toBe('Hiver');
    expect(g.periodes).toEqual([{ du: '2026-12-19', au: '2027-03-14' }]);
    expect(g.source).toBe(`copie de « ${PETIT.libelle} » (référence ${PETIT.version})`);
    expect(g.montees.every((m) => m.passages.every((p) => p.gare !== 'nid-daigle'))).toBe(true);
  });

  it('un identifiant déjà pris prend le suffixe suivant', () => {
    const d = nouvelleDuplication(PETIT);
    d.libelle = 'Hiver';
    d.periodes = [{ du: '2026-12-19', au: '2027-03-14' }];
    expect(grilleAEnregistrerCorrection(d, ['2026-2027-hiver']).version).toBe('2026-2027-hiver-v2');
  });

  it('les périodes incomplètes ne sont pas retenues', () => {
    const d = nouvelleDuplication(PETIT);
    d.periodes = [
      { du: '2026-12-19', au: '2027-03-14' },
      { du: '2027-04-01', au: '' },
    ];
    expect(periodesRetenues(d)).toEqual([{ du: '2026-12-19', au: '2027-03-14' }]);
  });
});

describe('effetNouvelleGrille', () => {
  it('la nouvelle grille l’emporte sur ses dates, et dit qui elle remplace', () => {
    const d = nouvelleDuplication(PETIT);
    d.libelle = 'Renfort août';
    d.periodes = [{ du: '2026-08-10', au: '2026-08-11' }];
    const candidate = grilleAEnregistrerCorrection(d, [GRAND.version, PETIT.version]);
    const effet = effetNouvelleGrille([GRAND, PETIT], candidate, '2026-09-22T10:00:00Z');
    expect(effet.perdues).toEqual([]);
    expect(effet.gagnees).toHaveLength(1);
    expect(effet.gagnees[0]?.sApplique).toBe(true);
    expect(effet.gagnees[0]?.du).toBe('2026-08-10');
    expect(effet.gagnees[0]?.au).toBe('2026-08-11');
    // Le grand service couvre ces dates : c'est lui qu'elle remplace.
    expect(effet.gagnees[0]?.avant?.version).toBe(GRAND.version);
    expect(effet.chevauchements.length).toBeGreaterThan(0);
    expect(effet.chevauchements[0]?.prioritaire.version).toBe(candidate.version);
  });

  it('hors de toute grille existante : elle s’applique sans rien remplacer', () => {
    const d = nouvelleDuplication(PETIT);
    d.libelle = 'Hiver';
    d.periodes = [{ du: '2026-12-19', au: '2026-12-20' }];
    const candidate = grilleAEnregistrerCorrection(d, []);
    const effet = effetNouvelleGrille([GRAND, PETIT], candidate, '2026-09-22T10:00:00Z');
    expect(effet.gagnees[0]?.avant).toBe(null);
    expect(effet.gagnees[0]?.sApplique).toBe(true);
    expect(effet.chevauchements).toEqual([]);
  });
});

describe('resumeCorrection', () => {
  it('correction : nomme la version créée, celle qu’elle remplace, et compte les écarts', () => {
    const c = nouvelleCorrection(GRAND);
    const r = poseHeure(
      c.grille,
      { sens: 'montee', numero: 5, gare: 'motivon', champ: 'a' },
      '9h27',
    );
    if (!r.ok) throw new Error(r.erreur);
    c.grille = r.grille;
    c.commentaire = 'heure fausse signalée par le conducteur';
    c.joursAReinitialiser.add('2026-07-15');
    const g = grilleAEnregistrerCorrection(c, [GRAND.version]);
    expect(resumeCorrection(c, g)).toBe(
      `Grille « ${GRAND.libelle} » corrigée : nouvelle version ${GRAND.version}-v2 (depuis ${GRAND.version}, désactivée et réactivable) — ` +
        '1 écart(s) avec « ' +
        GRAND.libelle +
        ' » : 0 train(s) ajouté(s), 0 retiré(s), 1 heure(s) et 0 indicateur(s) modifié(s) — ' +
        'heure fausse signalée par le conducteur — journée réinitialisée : 15/07/2026',
    );
  });

  it('duplication : dit de quelle grille elle vient et sur quelles dates', () => {
    const d = nouvelleDuplication(PETIT);
    d.libelle = 'Hiver';
    d.periodes = [{ du: '2026-12-19', au: '2027-03-14' }];
    const g = grilleAEnregistrerCorrection(d, []);
    expect(resumeCorrection(d, g)).toBe(
      `Grille « Hiver » créée par copie de « ${PETIT.libelle} » (référence 2026-2027-hiver) : 19/12/2026 → 14/03/2027 — contenu identique`,
    );
  });
});
