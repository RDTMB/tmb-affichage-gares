// LE PROFIL DE LA LIGNE — la pente du Fayet au sommet, dessinée à l'échelle
// des altitudes réelles. C'est le motif propre au TMB (refonte du 10/11/2026) :
// une ligne à crémaillère est d'abord une MONTÉE, et « où suis-je, où est mon
// train » se lit d'un coup d'œil sur une pente, pas dans une liste.
//
// Trois usages, un seul dessin :
//   - écran de gare : la gare du poste est marquée, les trains en ligne y
//     sont posés à la couleur de leur rame ;
//   - embed : le même tracé sert de sélecteur de gare ;
//   - supervision : repère d'en-tête.
//
// PUR : aucune lecture du DOM, aucune horloge. Les positions viennent de
// `positionsTrains()` (src/core/horaires.ts) et gardent SA règle — à quai SUR
// la gare, en route À MI-CHEMIN de la suivante, jamais interpolé à l'heure
// (.claude/regles-affichage.md). Les couleurs passent par `couleurSure()` :
// elles atterrissent dans des attributs construits par concaténation.
import type { GareGrille, GareId, Machine, PositionTrain } from '../core/types';
import { anneauSur, couleurSure, echapper } from './affichage-commun';

/** Boîte de dessin, en unités du `viewBox`. */
export interface BoiteProfil {
  largeur: number;
  hauteur: number;
  /** Marge intérieure : place des pastilles et des altitudes aux extrémités. */
  margeX: number;
  margeHaut: number;
  margeBas: number;
}

export const BOITE_PROFIL: BoiteProfil = {
  largeur: 400,
  hauteur: 124,
  margeX: 30,
  margeHaut: 30,
  margeBas: 28,
};

/** Rayons, en unités du `viewBox` : gare, train, anneau « vous êtes ici ». */
const RAYON_GARE = 6;
const RAYON_TRAIN = 9.5;
const RAYON_ICI = 14;

export interface PointProfil {
  id: GareId;
  nom: string;
  altitude_m: number;
  x: number;
  y: number;
  /** Faux au-dessus du sommet du jour (Nid d'Aigle en hiver). */
  desservie: boolean;
}

/**
 * Les gares posées sur la pente : abscisses régulières (la grille ne porte
 * pas les distances), ordonnées proportionnelles à l'altitude.
 *
 * `sommet` = plus haute gare desservie ce jour-là (`sommetDeLaGrille`) ; les
 * gares au-dessus restent DESSINÉES, éteintes — retirer le Nid d'Aigle en
 * hiver laisserait croire que la ligne s'arrête à Bellevue pour toujours.
 */
export function pointsProfil(
  gares: readonly GareGrille[],
  sommet: GareId | null = null,
  boite: BoiteProfil = BOITE_PROFIL,
): PointProfil[] {
  if (gares.length === 0) return [];
  const altitudes = gares.map((g) => g.altitude_m);
  const bas = Math.min(...altitudes);
  const haut = Math.max(...altitudes);
  const etendue = haut - bas || 1;
  const pas = gares.length > 1 ? (boite.largeur - 2 * boite.margeX) / (gares.length - 1) : 0;
  const hauteurUtile = boite.hauteur - boite.margeHaut - boite.margeBas;
  const rangSommet = sommet ? gares.findIndex((g) => g.id === sommet) : -1;
  return gares.map((g, i) => ({
    id: g.id,
    nom: g.nom,
    altitude_m: g.altitude_m,
    x: arrondi(boite.margeX + i * pas),
    y: arrondi(boite.margeHaut + hauteurUtile * (1 - (g.altitude_m - bas) / etendue)),
    desservie: rangSommet < 0 || i <= rangSommet,
  }));
}

function arrondi(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface TrainProfil {
  x: number;
  y: number;
  numero: number;
  rame: string;
  enRoute: boolean;
}

/**
 * Où poser chaque train : sur sa gare s'il est à quai, au milieu du segment
 * s'il roule. Un train dont la gare n'est pas sur le profil n'est PAS dessiné
 * — on n'invente pas une position.
 */
export function trainsSurProfil(
  points: readonly PointProfil[],
  positions: readonly PositionTrain[],
): TrainProfil[] {
  const parId = new Map(points.map((p) => [p.id, p]));
  const trains: TrainProfil[] = [];
  for (const pos of positions) {
    const ici = parId.get(pos.gare);
    if (!ici) continue;
    const vers = pos.vers ? parId.get(pos.vers) : undefined;
    if (pos.vers && !vers) continue;
    trains.push({
      x: vers ? arrondi((ici.x + vers.x) / 2) : ici.x,
      y: vers ? arrondi((ici.y + vers.y) / 2) : ici.y,
      numero: pos.numero,
      rame: pos.rame,
      enRoute: vers !== undefined,
    });
  }
  return trains;
}

export interface OptionsProfil {
  gares: readonly GareGrille[];
  sommet?: GareId | null;
  /** Gare du poste (« vous êtes ici »), ou `null`. */
  ici?: GareId | null;
  positions?: readonly PositionTrain[];
  machines?: readonly Machine[];
  /** Altitudes écrites : aux deux bouts de la ligne, ou nulle part. */
  altitudes?: 'extremes' | 'aucune';
  boite?: BoiteProfil;
}

function altitudeFr(m: number): string {
  return `${m.toLocaleString('fr-FR').replace(/ | /g, ' ')} m`;
}

/**
 * Le dessin. Toutes les couleurs de STRUCTURE viennent des classes (chaque
 * feuille les règle sur son fond) ; seules les couleurs de RAME sont posées
 * en attributs, validées.
 */
export function profilSvg(o: OptionsProfil): string {
  const boite = o.boite ?? BOITE_PROFIL;
  const points = pointsProfil(o.gares, o.sommet ?? null, boite);
  if (points.length < 2) return '';

  const desservis = points.filter((p) => p.desservie);
  const trace = (ps: readonly PointProfil[]): string => ps.map((p) => `${p.x},${p.y}`).join(' ');
  const dernierDesservi = desservis[desservis.length - 1];
  const horsService = dernierDesservi
    ? [dernierDesservi, ...points.filter((p) => !p.desservie)]
    : [];

  const voies =
    `<polyline class="profil-voie" points="${trace(desservis)}" />` +
    (horsService.length > 1
      ? `<polyline class="profil-voie hors" points="${trace(horsService)}" />`
      : '');

  // « VOUS ÊTES ICI » est un ANNEAU autour de la gare, pas la gare peinte en
  // rouge : un train à quai de cette gare se pose DANS l'anneau et reste
  // visible — peinte, la gare disparaissait sous lui, et le repère avec.
  const ici = points.find((p) => p.id === o.ici);
  const anneauIci = ici
    ? `<circle class="profil-ici" cx="${ici.x}" cy="${ici.y}" r="${RAYON_ICI}" />`
    : '';

  const gares = points
    .map((p) => {
      const classes = ['profil-gare', p.id === o.ici ? 'ici' : '', p.desservie ? '' : 'hors']
        .filter(Boolean)
        .join(' ');
      return `<circle class="${classes}" cx="${p.x}" cy="${p.y}" r="${RAYON_GARE}"><title>${echapper(
        `${p.nom} — ${altitudeFr(p.altitude_m)}`,
      )}</title></circle>`;
    })
    .join('');

  let etiquettes = '';
  if ((o.altitudes ?? 'extremes') === 'extremes') {
    const premier = points[0];
    const dernier = points[points.length - 1];
    if (premier && dernier) {
      // PAS D'ALTITUDE SUR LA GARE DU POSTE. L'anneau « vous êtes ici »
      // (rayon 14) recouvrait « 2 412 m » au Nid d'Aigle et « 580 m » au Fayet
      // (constaté le 10/11/2026) ; l'écarter la sortait du bandeau (3 px
      // au-dessus de l'écran, mesuré). Et elle n'y manque pas : le nom de la
      // gare, juste à côté, porte déjà son altitude en grand.
      const etiquette = (p: PointProfil, y: number): string =>
        p.id === o.ici
          ? ''
          : `<text class="profil-alt" x="${p.x}" y="${arrondi(y)}" text-anchor="middle">${echapper(altitudeFr(p.altitude_m))}</text>`;
      etiquettes = etiquette(premier, premier.y + 24) + etiquette(dernier, dernier.y - 14);
    }
  }

  const machines = new Map((o.machines ?? []).map((m) => [m.nom, m]));
  const trains = trainsSurProfil(points, o.positions ?? [])
    .map((t) => {
      const m = machines.get(t.rame);
      // Le liseré est posé en ATTRIBUT, jamais en CSS : une règle de feuille
      // l'emporterait sur lui et effacerait l'anneau rouge de Marguerite.
      const anneau = anneauSur(m?.cercle);
      return `<circle class="profil-train${t.enRoute ? ' en-route' : ''}" cx="${t.x}" cy="${t.y}" r="${RAYON_TRAIN}" fill="${couleurSure(
        m?.couleur,
      )}" stroke="${anneau ?? '#ffffff'}"><title>${echapper(`${t.rame} — TRAIN ${t.numero}`)}</title></circle>`;
    })
    .join('');

  return `<svg class="profil-svg" viewBox="0 0 ${boite.largeur} ${boite.hauteur}" role="img" aria-label="Profil de la ligne">${voies}${anneauIci}${gares}${etiquettes}${trains}</svg>`;
}
