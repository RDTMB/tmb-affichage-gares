// Types métier partagés : grilles officielles (JSON versionnés), circulations
// du jour et structures produites par le moteur horaires (src/core/horaires.ts).

/** Gares dans l'ordre de la ligne, du Fayet (580 m) au Nid d'Aigle (2 412 m). */
export const ORDRE_GARES = [
  'le-fayet',
  'saint-gervais',
  'motivon',
  'col-de-voza',
  'bellevue',
  'nid-daigle',
] as const;

export type GareId = (typeof ORDRE_GARES)[number];

export type Sens = 'montee' | 'descente';

export type Statut = 'ok' | 'retard' | 'supprime';

/** Terminus possible d'une montée (les descentes partent du terminus atteint). */
export type Terminus = 'nid-daigle' | 'bellevue';

// ---------------------------------------------------------------------------
// Grille de saison (public/grilles/*.json — horaires OFFICIELS, jamais modifiés à la main)
// ---------------------------------------------------------------------------

export interface GareGrille {
  id: GareId;
  nom: string;
  altitude_m: number;
}

/**
 * Passage d'un train à une gare : `d` = heure de départ, `a` = heure d'arrivée
 * (uniquement au terminus). Format « HH:MM:SS » — les secondes sont tronquées à
 * l'affichage mais conservées dans les calculs.
 */
export interface PassageGrille {
  gare: GareId;
  d?: string;
  a?: string;
}

export interface TrainGrille {
  numero: number;
  express: boolean;
  facultatif: boolean;
  velos: boolean;
  /** Liste ordonnée : les express n'ont AUCUN passage à col-de-voza ni bellevue. */
  passages: PassageGrille[];
}

/** Période de validité d'une grille, bornes incluses (« YYYY-MM-DD »). */
export interface Periode {
  du: string;
  au: string;
}

export interface Grille {
  version: string;
  libelle: string;
  source?: string;
  periodes: Periode[];
  gares: GareGrille[];
  /** Durée d'arrêt en gare intermédiaire : arrivée = départ − cette valeur. */
  arret_intermediaire_s: number;
  regles?: Record<string, string>;
  montees: TrainGrille[];
  descentes: TrainGrille[];
}

// ---------------------------------------------------------------------------
// Jour d'exploitation (circulations générées + drapeaux du jour)
// ---------------------------------------------------------------------------

/**
 * Bascule « Terminus Bellevue » du jour : false, ou limitation PAR ROTATION
 * « à partir du TRAIN N » — N est un numéro de MONTÉE (impair, un pair est
 * normalisé vers N−1) ; toutes les rotations dont la montée porte un numéro
 * ≥ N sont limitées. Journée entière ≡ { a_partir_du_train: 1 } (régime
 * hiver permanent). La bascule ne fait que PRÉ-REMPLIR la colonne Terminus
 * des rotations concernées : la colonne reste prioritaire et ajustable.
 */
export type TerminusFlag = false | { a_partir_du_train: number };

export interface Circulation {
  date: string;
  numero: number;
  sens: Sens;
  express: boolean;
  facultatif: boolean;
  /** Un facultatif n'apparaît sur AUCUN écran tant qu'il n'est pas activé. */
  facultatif_actif: boolean;
  velos: boolean;
  /** Rame portée par la MONTÉE ; la descente appariée (numero + 1) hérite. */
  rame: string;
  /**
   * Colonne Terminus (portée par la MONTÉE) : « bellevue » = rotation
   * limitée — montée tronquée à Bellevue, descente appariée au départ de
   * Bellevue. Une montée EXPRESS n'est JAMAIS tronquée : si sa colonne est
   * sur « bellevue » (bascule de plage), elle circule normalement et est
   * signalée « à traiter » en supervision.
   */
  terminus: Terminus;
  statut: Statut;
  retard_min: number;
  motif: string | null;
}

export interface Jour {
  date: string;
  grille_version: string;
  terminus_bellevue: TerminusFlag;
  circulations: Circulation[];
}

// ---------------------------------------------------------------------------
// Sorties du moteur horaires (heures en secondes depuis minuit, heure THÉORIQUE
// sauf mention « réel » = théorique + retard)
// ---------------------------------------------------------------------------

/** Passage théorique résolu : null = « — » (pas d'arrivée à l'origine, pas de départ au terminus). */
export interface PassageTrain {
  gare: GareId;
  arrivee_s: number | null;
  depart_s: number | null;
}

/** Train effectivement en circulation ce jour, après facultatifs / terminus / rotation. */
export interface TrainJour {
  numero: number;
  sens: Sens;
  express: boolean;
  facultatif: boolean;
  velos: boolean;
  rame: string;
  statut: Statut;
  retard_min: number;
  motif: string | null;
  /** Montée tronquée à Bellevue ou descente partant de Bellevue. */
  terminusExceptionnel: boolean;
  passages: PassageTrain[];
}

/** Ligne d'affichage pour une gare donnée (écran de gare). */
export interface PassageGare {
  numero: number;
  sens: Sens;
  express: boolean;
  velos: boolean;
  rame: string;
  statut: Statut;
  retard_min: number;
  motif: string | null;
  /** Gare de départ du train (« en provenance de … »). */
  origine: GareId;
  /** Gare terminus effective (« Nid d'Aigle », « Le Fayet », « Bellevue » si exceptionnel). */
  destination: GareId;
  terminusExceptionnel: boolean;
  /** Heures réelles (retard inclus) ; un supprimé garde ses heures théoriques (affichées barrées). */
  arrivee_s: number | null;
  depart_s: number | null;
  /** Heures théoriques (« théorique HH:MM » affiché en cas de retard). */
  arrivee_theorique_s: number | null;
  depart_theorique_s: number | null;
}

export interface ProchaineArrivee {
  heure_s: number;
  numero: number;
  rame: string;
  sens: Sens;
  provenance: GareId;
}

export type CompteARebours =
  | { type: 'quai'; libelle: string }
  | { type: 'minutes'; minutes: number; libelle: string }
  | { type: 'heures'; heures: number; minutes: number; libelle: string };

/** null côté appelant = le service n'est pas terminé ; premierDepart_s null = pas de service demain. */
export interface FinDeService {
  premierDepart_s: number | null;
}

/** Dernier point de passage d'un train en ligne (point pulsant couleur rame). */
export interface PositionTrain {
  numero: number;
  sens: Sens;
  rame: string;
  gare: GareId;
}

/** Résultat de la bascule « Terminus Bellevue à partir du TRAIN N ». */
export interface ResultatTerminusBellevue {
  /** Nouveau jour : colonne Terminus pré-remplie et bascule enregistrée (entrées non modifiées). */
  jour: Jour;
  /** Rotations express de la plage (numéros de MONTÉE), signalées « à traiter » en supervision. */
  aTraiter: number[];
}
