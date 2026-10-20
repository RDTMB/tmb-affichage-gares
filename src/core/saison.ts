// Saison d'une grille, déduite de ses périodes — PUR.
//
// Module à part, et minuscule, pour que l'embed du site web lise la saison
// d'une grille sans importer `import-grille.ts` (l'import Excel de la
// supervision). Une seule règle pour les deux : celle qui nomme la grille à
// l'import (« 2026-2027-hiver ») est celle qui fait dire à l'embed « période
// hivernale ».
import type { Periode } from './types';

export type Saison = 'ete' | 'hiver';

/** Saison déduite de la première période : mai → octobre = été, sinon hiver. */
export function saisonDepuisPeriodes(periodes: readonly Periode[]): Saison | null {
  const premiere = [...periodes].sort((a, b) => a.du.localeCompare(b.du))[0];
  if (!premiere) return null;
  const mois = Number(premiere.du.slice(5, 7));
  return mois >= 5 && mois <= 10 ? 'ete' : 'hiver';
}
