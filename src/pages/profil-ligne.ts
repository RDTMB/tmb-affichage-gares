// LE PROFIL DE LA LIGNE — la pente du Fayet au sommet, dessinée à l'échelle
// des altitudes réelles. C'est le motif propre au TMB (refonte du 10/11/2026) :
// une ligne à crémaillère est d'abord une MONTÉE, et « où suis-je, où est mon
// train » se lit d'un coup d'œil sur une pente, pas dans une liste.
//
// Deux usages du même dessin : le bandeau de l'écran de gare (la gare du
// poste y est cerclée) et celui de la grille du jour.
//
// CE QUE LE PROFIL MONTRE (décisions de l'exploitant du 10/11/2026) :
//   - la ligne DU JOUR : au-dessus du sommet de la grille, rien n'est dessiné —
//     en hiver le profil va du Fayet à Bellevue, le Nid d'Aigle n'y figure pas ;
//   - le SIGLE de chaque gare au-dessus de son point (FAY, STG, MOT, CDV, BLV,
//     NDA) ;
//   - chaque machine à la couleur de sa rame, avec un NEZ qui dit son sens de
//     marche, à quai comme en route ;
//   - sa position ESTIMÉE le long de la voie (`avancementsTrains`,
//     src/core/horaires.ts) : elle glisse d'une gare à la suivante au prorata
//     du temps. Estimation d'après l'horaire et le retard déclaré, pas une
//     mesure — et pour ce dessin seulement : la grille du jour garde « à
//     mi-chemin, jamais interpolé ».
//
// PUR : aucune lecture du DOM, aucune horloge. Les couleurs passent par
// `couleurSure()` : elles atterrissent dans des attributs construits par
// concaténation.
import type {
  AvancementTrain,
  GareGrille,
  GareId,
  Machine,
  PositionTrain,
  Sens,
} from '../core/types';
import { anneauSur, couleurSure, echapper } from './affichage-commun';

/** Boîte de dessin, en unités du `viewBox`. */
export interface BoiteProfil {
  largeur: number;
  hauteur: number;
  /** Marge intérieure : place des sigles, des machines et des altitudes. */
  margeX: number;
  margeHaut: number;
  margeBas: number;
}

export const BOITE_PROFIL: BoiteProfil = {
  largeur: 400,
  hauteur: 124,
  margeX: 30,
  margeHaut: 32,
  margeBas: 30,
};

/** Rayons, en unités du `viewBox` : gare, anneau « vous êtes ici ». */
const RAYON_GARE = 6;
const RAYON_ICI = 14;

/**
 * La MACHINE : un rond de 9,3 de rayon prolongé d'un nez (pointe à 16), dessiné
 * tourné vers la droite puis orienté par `rotate()` dans le sens de la marche.
 * Un rond seul ne disait pas si la rame monte ou descend (retour de
 * l'exploitant du 10/11/2026).
 */
const TRACE_MACHINE = 'M16 0L5.6 -7.4A9.3 9.3 0 1 0 5.6 7.4Z';

/**
 * Sigles des gares, donnés par l'exploitant le 10/11/2026. Une gare qui n'y
 * figure pas (renommée, ajoutée) reçoit ses initiales — voir `sigleGare`.
 */
export const SIGLES_GARES: Record<GareId, string> = {
  'le-fayet': 'FAY',
  'saint-gervais': 'STG',
  motivon: 'MOT',
  'col-de-voza': 'CDV',
  bellevue: 'BLV',
  'nid-daigle': 'NDA',
};

/** Le sigle d'une gare ; à défaut, les initiales de son nom (« Col de Voza » → CDV). */
export function sigleGare(gare: Pick<GareGrille, 'id' | 'nom'>): string {
  const connu = (SIGLES_GARES as Partial<Record<string, string>>)[gare.id];
  if (connu) return connu;
  return gare.nom
    .split(/[\s'’-]+/)
    .map((mot) => mot.charAt(0))
    .join('')
    .toUpperCase();
}

export interface PointProfil {
  id: GareId;
  nom: string;
  altitude_m: number;
  x: number;
  y: number;
}

/**
 * Les gares DU JOUR posées sur la pente : abscisses régulières (la grille ne
 * porte pas les distances), ordonnées proportionnelles à l'altitude.
 *
 * `sommet` = plus haute gare desservie ce jour-là (`sommetDeLaGrille`). Les
 * gares au-dessus ne sont PAS dessinées (décision de l'exploitant du
 * 10/11/2026) : la première version les gardait « éteintes », et un tronçon
 * pâle se lisait encore comme une ligne où l'on peut aller. Le profil
 * s'étire alors sur toute la boîte, de la première gare au sommet. Sommet
 * inconnu ou absent des gares : la ligne entière, comme `sommetDeLaGrille`
 * en repli.
 */
export function pointsProfil(
  gares: readonly GareGrille[],
  sommet: GareId | null = null,
  boite: BoiteProfil = BOITE_PROFIL,
): PointProfil[] {
  const rangSommet = sommet ? gares.findIndex((g) => g.id === sommet) : -1;
  const duJour = rangSommet < 0 ? gares : gares.slice(0, rangSommet + 1);
  if (duJour.length === 0) return [];
  const altitudes = duJour.map((g) => g.altitude_m);
  const bas = Math.min(...altitudes);
  const haut = Math.max(...altitudes);
  const etendue = haut - bas || 1;
  const pas = duJour.length > 1 ? (boite.largeur - 2 * boite.margeX) / (duJour.length - 1) : 0;
  const hauteurUtile = boite.hauteur - boite.margeHaut - boite.margeBas;
  return duJour.map((g, i) => ({
    id: g.id,
    nom: g.nom,
    altitude_m: g.altitude_m,
    x: arrondi(boite.margeX + i * pas),
    y: arrondi(boite.margeHaut + hauteurUtile * (1 - (g.altitude_m - bas) / etendue)),
  }));
}

function arrondi(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Au demi-point : sans arrondi, la chaîne du dessin changerait à CHAQUE
 * seconde et l'écran réécrirait son profil soixante fois par minute. Arrondie,
 * elle ne change que lorsque la machine a bougé d'un demi-point — mesuré le
 * 10/11/2026 sur l'écran de Saint-Gervais, trois machines en route : 28
 * réécritures en 60 s.
 */
function auDemi(v: number): number {
  return Math.round(v * 2) / 2;
}

/**
 * Le point de la voie à un rang FRACTIONNAIRE : 2,5 = à mi-chemin entre la
 * troisième et la quatrième gare du profil. La machine SUIT le tracé — un
 * express entre Motivon et le Nid d'Aigle passe par les points de Col de Voza
 * et de Bellevue, il ne coupe pas en ligne droite.
 */
export function pointSurVoie(
  points: readonly PointProfil[],
  rang: number,
): { x: number; y: number } | null {
  const dernier = points.length - 1;
  if (dernier < 0) return null;
  const borne = Math.min(dernier, Math.max(0, rang));
  const avant = points[Math.floor(borne)];
  const apres = points[Math.min(dernier, Math.floor(borne) + 1)];
  if (!avant || !apres) return null;
  const part = borne - Math.floor(borne);
  return { x: avant.x + (apres.x - avant.x) * part, y: avant.y + (apres.y - avant.y) * part };
}

/**
 * Cap de la machine, en degrés (0 = vers la droite, négatif = vers le haut) :
 * la direction du tronçon où elle se trouve, dans SON sens de marche. À quai,
 * le tronçon qu'elle s'apprête à prendre ; au bout de la ligne, celui par
 * lequel elle vient d'arriver.
 */
export function capSurVoie(points: readonly PointProfil[], rang: number, sens: Sens): number {
  const dernier = points.length - 1;
  if (dernier < 1) return sens === 'montee' ? 0 : 180;
  const borne = Math.min(dernier, Math.max(0, rang));
  // Tronçon [bas, bas + 1] sur lequel se lit la pente.
  let bas = Math.floor(borne);
  if (Number.isInteger(borne) && sens === 'descente') bas -= 1; // à quai, on regarde vers le bas
  bas = Math.min(dernier - 1, Math.max(0, bas));
  const a = points[bas];
  const b = points[bas + 1];
  if (!a || !b) return sens === 'montee' ? 0 : 180;
  const pente = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return Math.round((sens === 'montee' ? pente : pente + 180) * 10) / 10;
}

export interface TrainProfil {
  x: number;
  y: number;
  /** Cap, en degrés — voir `capSurVoie`. */
  cap: number;
  numero: number;
  rame: string;
  enRoute: boolean;
}

/**
 * Où poser chaque machine, et dans quel sens la tourner. À quai : SUR sa
 * gare. En route : le long de la voie, à `part` du trajet vers la gare
 * suivante de SES passages (`avancementsTrains`) ; une position sans `part`
 * (`positionsTrains`) est posée à mi-chemin. Une gare absente du profil ne
 * fait rien inventer : la machine n'est PAS dessinée.
 */
export function trainsSurProfil(
  points: readonly PointProfil[],
  positions: readonly (PositionTrain | AvancementTrain)[],
): TrainProfil[] {
  const rangDe = new Map(points.map((p, i) => [p.id, i]));
  const trains: TrainProfil[] = [];
  for (const pos of positions) {
    const depuis = rangDe.get(pos.gare);
    if (depuis === undefined) continue;
    let rang = depuis;
    if (pos.vers) {
      const vers = rangDe.get(pos.vers);
      if (vers === undefined) continue;
      const part = 'part' in pos ? pos.part : 0.5;
      rang = depuis + (vers - depuis) * Math.min(1, Math.max(0, part));
    }
    const point = pointSurVoie(points, rang);
    if (!point) continue;
    // À quai, la machine est EXACTEMENT sur sa gare ; en route seulement, sa
    // position est arrondie (voir `auDemi`).
    const enRoute = pos.vers !== null;
    trains.push({
      x: enRoute ? auDemi(point.x) : point.x,
      y: enRoute ? auDemi(point.y) : point.y,
      cap: capSurVoie(points, rang, pos.sens),
      numero: pos.numero,
      rame: pos.rame,
      enRoute,
    });
  }
  return ecarteLesCroisements(trains);
}

/** En deçà de cette distance, deux machines se recouvrent (rayon 9,3 chacune). */
const SEUIL_CROISEMENT = 20;
/** Recul de chacune au plus fort du croisement : la longueur d'une machine, nez compris. */
const RECUL_CROISEMENT = 16;

/**
 * UN CROISEMENT SE VOIT. La ligne est à voie unique : deux rames se croisent
 * en gare tous les jours (au Col de Voza vers 10:41, par exemple), et posées
 * au même point l'une cachait entièrement l'autre — il ne restait qu'une
 * machine à l'écran, avec le nez de la seconde qui dépassait (constaté le
 * 10/11/2026). Chacune RECULE donc le long de sa propre marche : celle qui
 * monte reste en dessous de la gare, celle qui descend au-dessus, nez à nez de
 * part et d'autre du point. Ce n'est pas une position de plus, c'est la même,
 * dessinée lisiblement.
 *
 * Le recul est PROGRESSIF — nul à 20 unités d'écart, entier quand les deux
 * positions se confondent : avec un recul d'un bloc, la machine qui approche
 * aurait sauté de 16 unités en arrière en franchissant le seuil.
 */
function ecarteLesCroisements(trains: TrainProfil[]): TrainProfil[] {
  return trains.map((t, i) => {
    let plusProche = Number.POSITIVE_INFINITY;
    trains.forEach((autre, j) => {
      if (j !== i) plusProche = Math.min(plusProche, Math.hypot(t.x - autre.x, t.y - autre.y));
    });
    if (plusProche >= SEUIL_CROISEMENT) return t;
    const recul = RECUL_CROISEMENT * (1 - plusProche / SEUIL_CROISEMENT);
    const cap = (t.cap * Math.PI) / 180;
    return {
      ...t,
      x: auDemi(t.x - recul * Math.cos(cap)),
      y: auDemi(t.y - recul * Math.sin(cap)),
    };
  });
}

export interface OptionsProfil {
  gares: readonly GareGrille[];
  sommet?: GareId | null;
  /** Gare du poste (« vous êtes ici »), ou `null`. */
  ici?: GareId | null;
  positions?: readonly (PositionTrain | AvancementTrain)[];
  machines?: readonly Machine[];
  /** Altitudes écrites : aux deux bouts de la ligne, ou nulle part. */
  altitudes?: 'extremes' | 'aucune';
  boite?: BoiteProfil;
}

function altitudeFr(m: number): string {
  return `${m.toLocaleString('fr-FR').replace(/[  ]/g, ' ')} m`;
}

/**
 * Le dessin. Toutes les couleurs de STRUCTURE viennent des classes
 * (src/styles/profil.css) ; seules les couleurs de RAME sont posées en
 * attributs, validées.
 */
export function profilSvg(o: OptionsProfil): string {
  const boite = o.boite ?? BOITE_PROFIL;
  const points = pointsProfil(o.gares, o.sommet ?? null, boite);
  if (points.length < 2) return '';

  const voie = `<polyline class="profil-voie" points="${points.map((p) => `${p.x},${p.y}`).join(' ')}" />`;

  // « VOUS ÊTES ICI » est un ANNEAU autour de la gare, pas la gare peinte en
  // rouge : une machine à quai de cette gare se pose DANS l'anneau et reste
  // visible — peinte, la gare disparaissait sous elle, et le repère avec.
  const ici = points.find((p) => p.id === o.ici);
  const anneauIci = ici
    ? `<circle class="profil-ici" cx="${ici.x}" cy="${ici.y}" r="${RAYON_ICI}" />`
    : '';

  const gares = points
    .map(
      (p) =>
        `<circle class="profil-gare${p.id === o.ici ? ' ici' : ''}" cx="${p.x}" cy="${p.y}" r="${RAYON_GARE}"><title>${echapper(
          `${p.nom} — ${altitudeFr(p.altitude_m)}`,
        )}</title></circle>`,
    )
    .join('');

  // Le sigle, AU-DESSUS du point — et au-dessus de l'anneau pour la gare du
  // poste, sinon l'anneau le barre.
  const sigles = points
    .map(
      (p) =>
        `<text class="profil-sigle${p.id === o.ici ? ' ici' : ''}" x="${p.x}" y="${arrondi(
          p.y - (p.id === o.ici ? RAYON_ICI + 5 : 13),
        )}" text-anchor="middle">${echapper(sigleGare(p))}</text>`,
    )
    .join('');

  let altitudes = '';
  if ((o.altitudes ?? 'extremes') === 'extremes') {
    const premier = points[0];
    const dernier = points[points.length - 1];
    if (premier && dernier) {
      // SOUS le point, aux deux bouts : le dessus est pris par le sigle. PAS
      // D'ALTITUDE SUR LA GARE DU POSTE — l'anneau « vous êtes ici » (rayon
      // 14) la recouvrait (constaté le 10/11/2026), et le nom de la gare,
      // juste à côté dans le bandeau, la porte déjà en grand.
      const altitude = (p: PointProfil): string =>
        p.id === o.ici
          ? ''
          : `<text class="profil-alt" x="${p.x}" y="${arrondi(p.y + 24)}" text-anchor="middle">${echapper(altitudeFr(p.altitude_m))}</text>`;
      altitudes = altitude(premier) + altitude(dernier);
    }
  }

  const machines = new Map((o.machines ?? []).map((m) => [m.nom, m]));
  const trains = trainsSurProfil(points, o.positions ?? [])
    .map((t) => {
      const m = machines.get(t.rame);
      // Le liseré est posé en ATTRIBUT, jamais en CSS : une règle de feuille
      // l'emporterait sur lui et effacerait l'anneau rouge de Marguerite.
      const anneau = anneauSur(m?.cercle);
      return `<path class="profil-train${t.enRoute ? ' en-route' : ''}" d="${TRACE_MACHINE}" transform="translate(${t.x} ${t.y}) rotate(${t.cap})" fill="${couleurSure(
        m?.couleur,
      )}" stroke="${anneau ?? '#ffffff'}"><title>${echapper(`${t.rame} — TRAIN ${t.numero}`)}</title></path>`;
    })
    .join('');

  return `<svg class="profil-svg" viewBox="0 0 ${boite.largeur} ${boite.hauteur}" role="img" aria-label="Profil de la ligne">${voie}${anneauIci}${gares}${sigles}${altitudes}${trains}</svg>`;
}
