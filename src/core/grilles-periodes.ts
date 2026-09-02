// Périodes et priorité entre grilles enregistrées (onglet Horaires) — PUR.
//
// Module SÉPARÉ de grilles.ts à dessein : grilles.ts est chargé par les
// écrans de gare (lecture des grilles en base), alors que ces fonctions ne
// servent qu'à la supervision. Les garder ici évite de faire grossir le
// bundle des écrans d'un octet.
import { dateSuivante, serviceActif } from './horaires';
import type { Grille, Periode } from './types';

/** Toutes les dates « YYYY-MM-DD » couvertes (bornes incluses), triées, sans doublon. */
export function datesDesPeriodes(periodes: Periode[]): string[] {
  const dates = new Set<string>();
  for (const p of periodes) {
    for (let d = p.du; d <= p.au; d = dateSuivante(d)) dates.add(d);
  }
  return [...dates].sort();
}

/**
 * Grilles ACTIVES dont toutes les dates seraient couvertes par `nouvelle`,
 * plus récente : elles n'auraient plus aucun effet. La validation d'un
 * import les désactive automatiquement (annoncé dans le récapitulatif) ; une
 * grille seulement partiellement recouverte reste active pour ses autres
 * dates.
 */
export function grillesEntierementCouvertes(
  grilles: Grille[],
  nouvelle: { version: string; periodes: Periode[] },
): Grille[] {
  const couvertes = new Set(datesDesPeriodes(nouvelle.periodes));
  return grilles.filter(
    (g) =>
      g.version !== nouvelle.version &&
      g.actif !== false &&
      g.periodes.length > 0 &&
      datesDesPeriodes(g.periodes).every((d) => couvertes.has(d)),
  );
}

export interface Reprise {
  du: string;
  au: string;
  /** Grille qui reprend la main sur ces dates ; null = plus aucun service. */
  version: string | null;
  libelle: string | null;
}

/**
 * Ce qui se passerait si `version` était désactivée : pour chaque plage de
 * dates consécutives de ses périodes, la grille qui reprendrait la main (ou
 * « aucun service »). Sert au message de confirmation de la désactivation.
 */
export function reprisesApresDesactivation(grilles: Grille[], version: string): Reprise[] {
  const cible = grilles.find((g) => g.version === version);
  if (!cible) return [];
  const sansCible = grilles.filter((g) => g.version !== version);
  const reprises: Reprise[] = [];
  for (const date of datesDesPeriodes(cible.periodes)) {
    const suivante = serviceActif(sansCible, date);
    const derniere = reprises[reprises.length - 1];
    if (
      derniere &&
      derniere.version === (suivante?.version ?? null) &&
      dateSuivante(derniere.au) === date
    ) {
      derniere.au = date;
    } else {
      reprises.push({
        du: date,
        au: date,
        version: suivante?.version ?? null,
        libelle: suivante?.libelle ?? null,
      });
    }
  }
  return reprises;
}

/**
 * Grilles INACTIVES qui couvrent au moins une des dates données : ce sont
 * celles qu'on peut réactiver pour revenir en arrière.
 */
export function grillesReactivables(grilles: Grille[], du: string, au: string): Grille[] {
  return grilles.filter(
    (g) => g.actif === false && g.periodes.some((p) => p.du <= au && du <= p.au),
  );
}
