// Vitesse du bandeau de messages défilants. La durée de l'animation CSS est
// CALCULÉE à partir d'une vitesse en pixels par seconde : sans cela, une
// durée fixe (80 s à l'origine) faisait défiler un long message beaucoup
// plus vite qu'un court, ce qui n'a pas de sens pour la lecture.

/** Vitesse par défaut, en pixels/seconde (« Normal »). */
export const VITESSE_TICKER_DEFAUT = 90;

/** Niveaux proposés en supervision. */
export const NIVEAUX_VITESSE_TICKER = [
  { libelle: 'Lent', px_s: 60 },
  { libelle: 'Normal', px_s: 90 },
  { libelle: 'Rapide', px_s: 130 },
  { libelle: 'Très rapide', px_s: 180 },
] as const;

/**
 * Bornes de sécurité : au-delà, l'affichage devient illisible. Exportées
 * parce que la supervision propose désormais une vitesse LIBRE : le champ
 * doit annoncer ce qu'il accepte, plutôt que corriger en silence une valeur
 * refusée.
 */
export const VITESSE_TICKER_MIN = 20;
export const VITESSE_TICKER_MAX = 400;
const VITESSE_MIN = VITESSE_TICKER_MIN;
const VITESSE_MAX = VITESSE_TICKER_MAX;

/** Valeur du <select> quand la vitesse ne correspond à aucun niveau. */
export const VITESSE_PERSONNALISEE = 'perso';

export interface ChoixVitesse {
  /** Valeur à sélectionner dans le <select> : un niveau, ou « perso ». */
  selection: string;
  /** Vitesse retenue, bornée et assainie. */
  px_s: number;
  /** Le champ libre doit-il être visible ? */
  personnalisee: boolean;
}

/**
 * État du réglage de vitesse, pour la supervision. PURE.
 *
 * Une vitesse hors des quatre niveaux — saisie libre, ou valeur posée
 * directement en base — bascule le sélecteur sur « Personnaliser » et
 * ouvre le champ, au lieu d'être silencieusement ramenée au niveau le plus
 * proche : l'exploitant a le droit de choisir 105 px/s.
 */
export function choixVitesseTicker(valeur: unknown): ChoixVitesse {
  const px_s = vitesseTickerValide(valeur);
  const niveau = NIVEAUX_VITESSE_TICKER.find((n) => n.px_s === px_s);
  return niveau
    ? { selection: String(niveau.px_s), px_s, personnalisee: false }
    : { selection: VITESSE_PERSONNALISEE, px_s, personnalisee: true };
}

/**
 * Vitesse retenue : repli sur 90 px/s si la valeur est absente, non
 * numérique, nulle ou négative ; bornée sinon (une valeur aberrante en base
 * ne doit jamais figer ou emballer le bandeau).
 */
export function vitesseTickerValide(valeur: unknown): number {
  const v = typeof valeur === 'number' ? valeur : Number(valeur);
  if (!Number.isFinite(v) || v <= 0) return VITESSE_TICKER_DEFAUT;
  return Math.min(VITESSE_MAX, Math.max(VITESSE_MIN, v));
}

/**
 * Durée de l'animation, en secondes : l'animation translate le contenu de
 * sa propre largeur (`translateX(-100%)`), donc distance = largeur mesurée.
 * Durée = distance / vitesse, d'où une vitesse de lecture constante quelle
 * que soit la longueur du texte.
 */
export function dureeDefilementS(largeurPx: number, vitessePxS: unknown): number {
  const vitesse = vitesseTickerValide(vitessePxS);
  const largeur = Number.isFinite(largeurPx) && largeurPx > 0 ? largeurPx : 0;
  // Plancher : un bandeau presque vide ne doit pas boucler frénétiquement
  return Math.max(5, largeur / vitesse);
}
