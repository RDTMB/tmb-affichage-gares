// LA BOUCLE COMPLÈTE : exporter une grille au format du document, la relire
// par le lecteur de l'import, zéro écart. C'est le seul test qui compte
// vraiment ici — le format n'est pas décrit deux fois, il est refermé sur
// lui-même.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { ecarts } from './ecarts-grille';
import { poseHeure, retireNidDaigle, supprimeRotation } from './edition-grille';
import {
  cellulesGrille,
  dateEnProse,
  fractionDeJour,
  notesBasDeFeuille,
  problemesExport,
  titreFeuille,
} from './export-grille';
import { estFeuilleHoraires, parseFeuille } from './import-grille';
import type { Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;

/** Exporte puis relit : ce que l'exploitation fera réellement du fichier. */
function allerRetour(g: Grille): ReturnType<typeof parseFeuille> {
  return parseFeuille(cellulesGrille(g));
}

describe('boucle export → import', () => {
  for (const g of [PETIT, GRAND]) {
    it(`« ${g.libelle} » : zéro écart après export et réimport`, () => {
      const lu = allerRetour(g);
      expect(lu.erreurs).toEqual([]);
      expect(lu.avertissements).toEqual([]);
      expect(lu.grille).not.toBeNull();
      const e = ecarts(g, lu.grille as Grille);
      expect(e.trainsAjoutes).toEqual([]);
      expect(e.trainsRetires).toEqual([]);
      expect(e.heures).toEqual([]);
      expect(e.indicateurs).toEqual([]);
      expect(e.aucun).toBe(true);
      // Les secondes du document survivent au passage : ce sont elles qui
      // servent aux états « À QUAI » / « DÉPART IMMINENT ».
      expect(
        lu.grille?.montees.find((m) => m.numero === 5)?.passages.find((p) => p.gare === 'motivon')
          ?.a,
      ).toBe(g.montees.find((m) => m.numero === 5)?.passages.find((p) => p.gare === 'motivon')?.a);
    });

    it(`« ${g.libelle} » : les dates de validité reviennent par le titre`, () => {
      expect(allerRetour(g).periodesProposees).toEqual(g.periodes);
    });
  }

  it('la feuille exportée est reconnue comme une feuille d’horaires', () => {
    expect(estFeuilleHoraires(cellulesGrille(PETIT))).toBe(true);
  });

  it('une grille d’hiver (sans Nid d’Aigle) fait le même aller-retour', () => {
    let hiver = retireNidDaigle(PETIT);
    // Les express n'existent qu'avec le Nid d'Aigle : ils deviennent ordinaires.
    hiver = {
      ...hiver,
      libelle: 'Hiver 2026-2027',
      periodes: [{ du: '2026-12-19', au: '2027-03-14' }],
      montees: hiver.montees.filter((m) => !m.express),
      descentes: hiver.descentes.filter((d) => !d.express),
    };
    for (const m of hiver.montees) {
      if (!hiver.descentes.some((d) => d.numero === m.numero + 1)) {
        hiver = supprimeRotation(hiver, m.numero);
      }
    }
    const lu = allerRetour(hiver);
    expect(lu.erreurs).toEqual([]);
    expect(ecarts(hiver, lu.grille as Grille).aucun).toBe(true);
    expect(lu.periodesProposees).toEqual([{ du: '2026-12-19', au: '2027-03-14' }]);
    // Bellevue est le terminus : elle n'a plus de ligne « D » en montée.
    const bellevueD = cellulesGrille(hiver).lignes.filter(
      (l) => l[0] === 'Bellevue' || l[1] === 'D',
    );
    expect(bellevueD.length).toBeGreaterThan(0);
    expect(notesBasDeFeuille(hiver)[1]).toBe(
      'Cette grille s’arrête à Bellevue : aucun train ne monte au Nid d’Aigle.'.replace(/’/g, "'"),
    );
  });
});

describe('mise en page', () => {
  it('reprend les repères du document : titres, numéros, lettres, légende', () => {
    const f = cellulesGrille(PETIT, { miseAJour: '05/06/2026', nomFeuille: 'Petit service' });
    expect(f.nom).toBe('Petit service');
    expect(f.lignes[0]?.[0]).toBe(
      'HORAIRES PETIT SERVICE — ÉTÉ 2026 DU 13 JUIN 2026 AU 3 JUILLET 2026 ET DU 31 AOUT 2026 AU 27 SEPTEMBRE 2026',
    );
    expect(f.lignes[0]?.[11]).toBe('Mise à jour du 05/06/2026');
    expect(f.lignes[1]?.[0]).toBe("LE FAYET <> LE NID D'AIGLE");
    expect(f.lignes[1]?.[11]).toBe('LEGENDE');
    const colonneA = f.lignes.map((l) => l[0]);
    expect(colonneA).toContain('HORAIRES DES MONTEES');
    expect(colonneA).toContain('HORAIRES DES DESCENTES');
    // La ligne des trains suit immédiatement le titre du bloc.
    const iMontees = colonneA.indexOf('HORAIRES DES MONTEES');
    expect(f.lignes[iMontees + 1]?.[2]).toBe('Train 1');
    // Les lettres de la légende, telles que l'import les lit.
    const lettres = f.lignes[iMontees + 2] ?? [];
    expect(lettres[11]).toBe('R');
    expect(lettres[2]).toBe('b'); // TRAIN 1 : vélos
  });

  it('un train qui ne dessert pas une gare porte un tiret sur ses DEUX lignes', () => {
    const express = GRAND.montees.find((m) => m.express);
    expect(express).toBeDefined();
    const f = cellulesGrille(GRAND);
    const colonne = 2 + GRAND.montees.indexOf(express as never);
    const lignesVoza: number[] = [];
    f.lignes.forEach((l, i) => {
      if (l[0] === 'Col de Voza') lignesVoza.push(i);
    });
    const depart = lignesVoza[0] ?? 0;
    expect(f.lignes[depart]?.[colonne]).toBe('-');
    expect(f.lignes[depart + 1]?.[colonne]).toBe('-');
  });

  it('les heures sont des heures Excel, pas du texte', () => {
    const f = cellulesGrille(PETIT);
    const ligneFayet = f.lignes.find((l) => l[0] === 'Le Fayet');
    expect(typeof ligneFayet?.[2]).toBe('number');
    expect(ligneFayet?.[2]).toBe(fractionDeJour('07:00:00'));
  });

  it('toutes les lignes ont la même largeur (tableau dense, comme à la lecture)', () => {
    const f = cellulesGrille(GRAND);
    const largeurs = new Set(f.lignes.map((l) => l.length));
    expect(largeurs.size).toBe(1);
  });
});

describe('titreFeuille et dateEnProse', () => {
  it('écrit l’année sur les deux bornes', () => {
    expect(dateEnProse('2026-07-04')).toBe('4 JUILLET 2026');
    expect(dateEnProse('2026-12-31')).toBe('31 DECEMBRE 2026');
    expect(titreFeuille('Hiver', [{ du: '2026-12-19', au: '2027-03-14' }])).toBe(
      'HORAIRES HIVER DU 19 DECEMBRE 2026 AU 14 MARS 2027',
    );
  });

  it('une grille sans dates donne un titre sans dates (rien n’est inventé)', () => {
    expect(titreFeuille('Essai', [])).toBe('HORAIRES ESSAI');
  });
});

describe('problemesExport', () => {
  it('ne dit rien des grilles réelles', () => {
    expect(problemesExport(PETIT)).toEqual([]);
    expect(problemesExport(GRAND)).toEqual([]);
  });

  it('signale le train dont le terminus diffère de celui de ses voisins', () => {
    // TRAIN 1 s'arrête à Bellevue quand les autres montent au Nid d'Aigle :
    // la case « Bellevue / D » de sa colonne n'a plus de sens dans le document.
    let g = PETIT;
    const r = poseHeure(g, { sens: 'montee', numero: 1, gare: 'nid-daigle', champ: 'a' }, '');
    if (!r.ok) throw new Error(r.erreur);
    g = r.grille;
    const problemes = problemesExport(g);
    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toMatch(/TRAIN 1 : Bellevue sans départ/);
    // Et la boucle échouerait bien : c'est ce que l'avertissement annonce.
    expect(allerRetour(g).erreurs.length).toBeGreaterThan(0);
  });
});

// Ajouts après la campagne de mutation du 22/09/2026 : ces trois mutations-là
// avaient SURVÉCU — le document exporté pouvait mentir sur son terminus et
// perdre la note qui explique l'absence de Mont Lachat, sans qu'un test bronche.
describe('ce que le document IMPRIMÉ annonce', () => {
  it('le sous-titre nomme le vrai sommet de la grille', () => {
    expect(cellulesGrille(PETIT).lignes[1]?.[0]).toBe("LE FAYET <> LE NID D'AIGLE");
    expect(cellulesGrille(retireNidDaigle(PETIT)).lignes[1]?.[0]).toBe('LE FAYET <> BELLEVUE');
  });

  it('la note dit pourquoi Mont Lachat n’y est pas', () => {
    const notes = notesBasDeFeuille(PETIT);
    expect(notes[0]).toMatch(/Mont Lachat/);
    expect(notes[0]).toMatch(/halte de service/i);
    // Et elle est bien dans la feuille, pas seulement dans la fonction.
    const colonneA = cellulesGrille(PETIT).lignes.map((l) => l[0]);
    expect(colonneA.filter((c) => typeof c === 'string' && c.includes('Mont Lachat'))).toHaveLength(
      1,
    );
  });
});
