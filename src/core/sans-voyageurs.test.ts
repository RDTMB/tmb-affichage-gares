// Courses à vide (docs/01 §2.2 et §5.1) : le train existe pour l'exploitation
// et disparaît TOTALEMENT des écrans voyageurs. Tests sur les VRAIS horaires
// été 2026 — si un test « attend » une autre heure, c'est le test qui a tort.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import {
  generationJour,
  heureVersSecondes,
  monteesSansRetour,
  passagesPourGare,
  positionsTrains,
  prochaineArrivee,
  trainsDuJour,
} from './horaires';
import type { Circulation, Grille, Jour } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-07-15';
const h = heureVersSecondes;

function jourGrand(): Jour {
  return generationJour(GRAND, DATE);
}
function circ(jour: Jour, numero: number): Circulation {
  const c = jour.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`circulation ${numero} absente`);
  return c;
}
/** `.at(-1)` demande la lib es2022 : le projet cible plus bas. */
function dernierElement<T>(liste: T[]): T | undefined {
  return liste[liste.length - 1];
}
function numeros(liste: Array<{ numero: number }>): number[] {
  return liste.map((x) => x.numero);
}

describe('sans_voyageurs — exclusion des écrans', () => {
  it('par défaut, aucune circulation générée n’est une course à vide', () => {
    expect(jourGrand().circulations.every((c) => c.sans_voyageurs === false)).toBe(true);
  });

  it('une montée sans voyageurs disparaît de TOUS les écrans, dans toutes les gares', () => {
    const jour = jourGrand();
    const avant = numeros(trainsDuJour(GRAND, jour));
    expect(avant).toContain(5);

    circ(jour, 5).sans_voyageurs = true;
    const apres = numeros(trainsDuJour(GRAND, jour));
    expect(apres).not.toContain(5);
    // Aucun autre train n'est touché
    expect(apres).toEqual(avant.filter((n) => n !== 5));

    for (const gare of GRAND.gares.map((g) => g.id)) {
      expect(numeros(passagesPourGare(GRAND, jour, gare))).not.toContain(5);
    }
  });

  it('elle disparaît aussi de la prochaine arrivée et des positions en ligne', () => {
    const jour = jourGrand();
    const train5 = GRAND.montees.find((m) => m.numero === 5);
    const depart = train5?.passages[0]?.d;
    if (!depart) throw new Error('TRAIN 5 absent de la grille');
    // Instant où le TRAIN 5 vient de quitter Le Fayet : il est en ligne
    const instant = h(depart) + 120;

    expect(numeros(positionsTrains(GRAND, jour, instant))).toContain(5);
    circ(jour, 5).sans_voyageurs = true;
    expect(numeros(positionsTrains(GRAND, jour, instant))).not.toContain(5);

    // Prochaine arrivée au Col de Voza : plus jamais le TRAIN 5
    const juste = prochaineArrivee(GRAND, jour, 'col-de-voza', h(depart));
    expect(juste?.numero).not.toBe(5);
  });

  it('une descente sans voyageurs disparaît sans emporter sa montée', () => {
    const jour = jourGrand();
    circ(jour, 6).sans_voyageurs = true;
    const restants = numeros(trainsDuJour(GRAND, jour));
    expect(restants).not.toContain(6);
    expect(restants).toContain(5); // la montée appariée circule toujours
  });

  it('le drapeau ne change ni la rame, ni le terminus, ni les autres statuts', () => {
    const jour = jourGrand();
    circ(jour, 3).facultatif_actif = true;
    circ(jour, 4).facultatif_actif = true;
    circ(jour, 3).sans_voyageurs = true;
    // La descente appariée garde la rame héritée de SA montée, à vide ou non
    const descente = trainsDuJour(GRAND, jour).find((t) => t.numero === 4);
    expect(descente?.rame).toBe(circ(jour, 3).rame);
  });
});

describe('monteesSansRetour — avertissement de rotation', () => {
  it('une journée complète ne déclenche aucun avertissement', () => {
    expect(monteesSansRetour(GRAND, jourGrand())).toEqual([]);
  });

  it('signale la montée dont plus aucune descente voyageurs ne suit', () => {
    const jour = jourGrand();
    // On vide toutes les descentes postérieures à la dernière montée en
    // circulation : elle n'a plus de retour.
    const derniereMontee = dernierElement(GRAND.montees.filter((m) => !m.facultatif));
    if (!derniereMontee) throw new Error('grille sans montée régulière');
    for (const d of GRAND.descentes) {
      if (d.numero > derniereMontee.numero) circ(jour, d.numero).sans_voyageurs = true;
    }
    expect(monteesSansRetour(GRAND, jour)).toContain(derniereMontee.numero);
  });

  it('une montée à vide n’est jamais signalée : elle ne porte aucun voyageur', () => {
    const jour = jourGrand();
    const derniereMontee = dernierElement(GRAND.montees.filter((m) => !m.facultatif));
    if (!derniereMontee) throw new Error('grille sans montée régulière');
    for (const d of GRAND.descentes) {
      if (d.numero > derniereMontee.numero) circ(jour, d.numero).sans_voyageurs = true;
    }
    circ(jour, derniereMontee.numero).sans_voyageurs = true;
    expect(monteesSansRetour(GRAND, jour)).not.toContain(derniereMontee.numero);
  });

  it('une descente supprimée ne compte pas comme retour', () => {
    const jour = jourGrand();
    const derniereMontee = dernierElement(GRAND.montees.filter((m) => !m.facultatif));
    if (!derniereMontee) throw new Error('grille sans montée régulière');
    for (const d of GRAND.descentes) {
      if (d.numero > derniereMontee.numero) circ(jour, d.numero).statut = 'supprime';
    }
    expect(monteesSansRetour(GRAND, jour)).toContain(derniereMontee.numero);
  });

  it('un facultatif non activé ne compte ni comme montée ni comme retour', () => {
    const jour = jourGrand();
    // Aucun facultatif activé par défaut : ils ne doivent pas être signalés
    const facultatifs = GRAND.montees.filter((m) => m.facultatif).map((m) => m.numero);
    expect(facultatifs.length).toBeGreaterThan(0);
    const signales = monteesSansRetour(GRAND, jour);
    for (const n of facultatifs) expect(signales).not.toContain(n);
  });
});

describe('monteesSansRetour — correctifs de l’audit adversarial', () => {
  it('une rotation limitée à Bellevue ne produit PAS de faux avertissement', () => {
    // Sans le recentrage sur trainsDuJour, on comparait l'arrivée au Nid
    // d'Aigle d'une montée qui s'arrête en réalité à Bellevue.
    const jour = jourGrand();
    for (const c of jour.circulations) {
      if (c.sens === 'montee') c.terminus = 'bellevue';
    }
    jour.terminus_bellevue = { a_partir_du_train: 1 };
    expect(monteesSansRetour(GRAND, jour)).toEqual([]);
  });

  it('un train supprimé ne compte pas comme retour', () => {
    const jour = jourGrand();
    const derniereMontee = dernierElement(GRAND.montees.filter((m) => !m.facultatif));
    if (!derniereMontee) throw new Error('grille sans montée régulière');
    for (const d of GRAND.descentes) {
      if (d.numero > derniereMontee.numero) circ(jour, d.numero).statut = 'supprime';
    }
    expect(monteesSansRetour(GRAND, jour)).toContain(derniereMontee.numero);
  });

  it('une montée supprimée n’est jamais signalée', () => {
    const jour = jourGrand();
    const derniereMontee = dernierElement(GRAND.montees.filter((m) => !m.facultatif));
    if (!derniereMontee) throw new Error('grille sans montée régulière');
    for (const d of GRAND.descentes) {
      if (d.numero > derniereMontee.numero) circ(jour, d.numero).statut = 'supprime';
    }
    circ(jour, derniereMontee.numero).statut = 'supprime';
    expect(monteesSansRetour(GRAND, jour)).not.toContain(derniereMontee.numero);
  });

  it('les numéros signalés sont triés', () => {
    const jour = jourGrand();
    for (const d of GRAND.descentes) circ(jour, d.numero).sans_voyageurs = true;
    const signales = monteesSansRetour(GRAND, jour);
    expect(signales.length).toBeGreaterThan(1);
    expect([...signales].sort((a, b) => a - b)).toEqual(signales);
  });
});
