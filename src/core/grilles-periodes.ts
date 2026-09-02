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

// ---------------------------------------------------------------------------
// Modification des dates de validité d'une grille enregistrée
// ---------------------------------------------------------------------------

/** Dates gagnées par la modification, regroupées en plages consécutives. */
export interface PlageGagnee {
  du: string;
  au: string;
  /** Grille qui sert ces dates aujourd'hui (null = aucun service). */
  avant: Grille | null;
  /** Grille qui s'appliquera après la modification (null = aucun service). */
  gagnante: Grille | null;
  /** true = c'est bien la grille modifiée qui s'appliquera sur ces dates. */
  sApplique: boolean;
}

/** Dates perdues par la modification, regroupées en plages consécutives. */
export interface PlagePerdue {
  du: string;
  au: string;
  /** Grille qui reprend la main (null = plus aucun service). */
  reprise: Grille | null;
}

/** Autre grille active partageant des dates avec les nouvelles périodes. */
export interface Chevauchement {
  du: string;
  au: string;
  autre: Grille;
  /** Celle des deux qui s'applique sur ces dates (règle serviceActif). */
  prioritaire: Grille;
}

export interface EffetPeriodes {
  gagnees: PlageGagnee[];
  perdues: PlagePerdue[];
  /** Nombre de dates présentes avant comme après. */
  conservees: number;
  chevauchements: Chevauchement[];
}

/** Regroupe des dates triées en plages consécutives de même clé. */
function regroupe<T extends { du: string; au: string }>(
  dates: string[],
  cle: (date: string) => string,
  fabrique: (date: string) => T,
): T[] {
  const plages: T[] = [];
  let cleCourante = '';
  for (const date of dates) {
    const derniere = plages[plages.length - 1];
    const k = cle(date);
    if (derniere && k === cleCourante && dateSuivante(derniere.au) === date) {
      derniere.au = date;
    } else {
      plages.push(fabrique(date));
      cleCourante = k;
    }
  }
  return plages;
}

/**
 * Ce que produirait le remplacement des dates de validité de `version` par
 * `nouvelles` : dates gagnées (et qui elles remplacent, ou qui reste
 * prioritaire), dates perdues (et qui reprend la main), chevauchements avec
 * les autres grilles actives. Règle de priorité inchangée : serviceActif().
 * Une grille désactivée ne gagne rien tant qu'elle n'est pas réactivée.
 */
export function effetChangementPeriodes(
  grilles: Grille[],
  version: string,
  nouvelles: Periode[],
): EffetPeriodes {
  const cible = grilles.find((g) => g.version === version);
  if (!cible) return { gagnees: [], perdues: [], conservees: 0, chevauchements: [] };
  const simulees = grilles.map((g) => (g.version === version ? { ...g, periodes: nouvelles } : g));
  const anciennes = new Set(datesDesPeriodes(cible.periodes));
  const nouvellesDates = datesDesPeriodes(nouvelles);
  const nouvellesSet = new Set(nouvellesDates);

  const gagnees = regroupe(
    nouvellesDates.filter((d) => !anciennes.has(d)),
    (d) => {
      const g = serviceActif(simulees, d);
      return `${serviceActif(grilles, d)?.version ?? ''}|${g?.version ?? ''}`;
    },
    (d): PlageGagnee => {
      const gagnante = serviceActif(simulees, d);
      return {
        du: d,
        au: d,
        avant: serviceActif(grilles, d),
        gagnante,
        sApplique: gagnante?.version === version,
      };
    },
  );
  const perdues = regroupe(
    [...anciennes].filter((d) => !nouvellesSet.has(d)).sort(),
    (d) => serviceActif(simulees, d)?.version ?? '',
    (d): PlagePerdue => ({ du: d, au: d, reprise: serviceActif(simulees, d) }),
  );
  const conservees = nouvellesDates.filter((d) => anciennes.has(d)).length;

  const chevauchements: Chevauchement[] = [];
  for (const autre of grilles) {
    if (autre.version === version || autre.actif === false) continue;
    const communes = nouvellesDates.filter((d) =>
      autre.periodes.some((p) => p.du <= d && d <= p.au),
    );
    chevauchements.push(
      ...regroupe(
        communes,
        (d) => serviceActif(simulees, d)?.version ?? '',
        (d): Chevauchement => ({
          du: d,
          au: d,
          autre,
          prioritaire: serviceActif(simulees, d) ?? autre,
        }),
      ),
    );
  }
  return { gagnees, perdues, conservees, chevauchements };
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
