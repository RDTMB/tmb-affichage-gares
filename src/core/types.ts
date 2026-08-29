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
 * Passage d'un train à une gare : `a` = arrivée RÉELLE (document
 * d'exploitation — absente au point d'origine), `d` = départ (absent au
 * terminus). Format « HH:MM:SS » — les secondes sont tronquées à l'affichage
 * mais conservées dans les calculs. Si `a` manque, le moteur replie sur
 * « départ − arret_intermediaire_s ».
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
  /** REPLI uniquement : arrivée = départ − cette valeur si le document ne donne pas d'arrivée. */
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
  /**
   * Course à vide : le train circule pour l'exploitation (rame, rotation,
   * terminus conservés) mais ne prend AUCUN voyageur. Il est donc totalement
   * absent des écrans — départs, grille du jour, prochaine arrivée, position
   * en ligne. Une montée comme une descente peut l'être.
   */
  sans_voyageurs: boolean;
  /**
   * TRAIN SUPPLÉMENTAIRE : train de renfort créé à la demande, absent de
   * toute grille. Il porte donc SES PROPRES passages — sans quoi il serait
   * invisible partout, trainsDuJour() ne sachant joindre que des trains de
   * grille.
   */
  supplementaire: boolean;
  /**
   * Passages du train sup, au format des grilles JSON
   * (`[{"gare":"le-fayet","d":"17:00:00"}, …]`). null pour un train de
   * grille — contrainte SQL circulations_sup_passages.
   */
  passages?: PassageGrille[] | null;
}

export interface Jour {
  date: string;
  grille_version: string;
  terminus_bellevue: TerminusFlag;
  circulations: Circulation[];
  /**
   * false = journée pas encore enregistrée côté données (aperçu théorique) :
   * n'arrive plus que pour une date PASSÉE jamais exploitée (lecture seule)
   * ou côté écrans anonymes — en supervision, l'ouverture d'une date à venir
   * crée la journée immédiatement.
   */
  enregistre?: boolean;
  /** true = aucun service ne circule à cette date (aucune circulation, aucune écriture). */
  hors_saison?: boolean;
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
  /** Train de renfort, absent des grilles (docs/01 §2.7). */
  supplementaire: boolean;
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
  /** Train de renfort, absent des grilles (docs/01 §2.7). */
  supplementaire: boolean;
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

/**
 * État affiché dans la case de compte à rebours. `libelle` est le français,
 * `libelle_en` l'anglais (vide quand le libellé est un nombre, identique
 * dans les deux langues) : l'écran compose lui-même les deux lignes.
 */
export type CompteARebours =
  | { type: 'quai'; libelle: string; libelle_en: string }
  | { type: 'imminent'; libelle: string; libelle_en: string }
  | { type: 'parti'; libelle: string; libelle_en: string }
  | { type: 'minutes'; minutes: number; libelle: string; libelle_en: string }
  | { type: 'heures'; heures: number; minutes: number; libelle: string; libelle_en: string };

/**
 * Une écriture consignée au journal d'exploitation : UNE ligne par champ
 * réellement modifié, écrite par un déclencheur Postgres (donc jamais
 * contournable depuis le client).
 */
export interface EntreeJournal {
  id: number;
  quand: string;
  qui: string | null;
  table_cible: string;
  cle: string;
  champ: string;
  avant: string | null;
  apres: string | null;
  date_service: string | null;
}

/** Filtres de consultation du journal d'exploitation. */
export interface FiltreJournal {
  /** Bornes incluses, « YYYY-MM-DD ». */
  du?: string | null;
  au?: string | null;
  qui?: string | null;
  table_cible?: string | null;
  limite?: number;
  /** Décalage pour la pagination (100 lignes par page). */
  depuis?: number;
}

/**
 * Profil de l'agent connecté. Le NOM vient de la table `profils` : c'est
 * lui qu'affiche l'en-tête de la supervision, jamais un repli déduit de
 * l'onglet courant.
 */
export interface Profil {
  user_id: string;
  nom: string;
  email: string;
  role: Role;
}

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

// ---------------------------------------------------------------------------
// Données d'exploitation hors horaires (messages, médias, paramètres, comptes)
// ---------------------------------------------------------------------------

export type ModeMedias = 'alterne' | 'serie';

export interface MeteoSommet {
  t: number;
  ciel_fr: string;
  ciel_en: string;
  /**
   * Heure du relevé (« HH:MM »), pré-remplie à l'heure de la modification et
   * modifiable : une température sans heure ne dit pas si elle date de dix
   * minutes ou de la veille.
   */
  heure_releve?: string;
}

/** Plage de veille nuit « HH:MM » → « HH:MM » (peut franchir minuit). */
export interface VeilleNuit {
  debut: string;
  fin: string;
}

/** Machine (rame) paramétrable en supervision ; `cercle` = couleur d'anneau (Marguerite). */
export interface Machine {
  nom: string;
  couleur: string;
  cercle?: string | null;
  en_service: boolean;
}

/** Motif de perturbation avec sa traduction (défauts : Météo→Weather…). */
export interface Motif {
  fr: string;
  en: string;
}

export interface Params {
  meteo_sommet: MeteoSommet;
  veille_nuit: VeilleNuit;
  /** Temps d'affichage de la page horaires entre deux médias (défaut 20 s). */
  duree_horaires_s: number;
  /** Âge maximal du cache avant écran neutre (défaut 15 min). */
  duree_cache_min: number;
  /**
   * Enchaînement des médias sur les écrans (défaut 'alterne') :
   * 'alterne' = retour aux horaires entre chaque média (comportement
   * historique) ; 'serie' = tous les médias à la suite, puis horaires.
   */
  mode_medias: ModeMedias;
  /**
   * Gare d'ORIGINE seulement (Le Fayet en montée, Nid d'Aigle en descente) :
   * il n'y a pas d'heure d'arrivée, la rame est à quai depuis ce délai avant
   * le départ (défaut 5 min).
   */
  a_quai_origine_s: number;
  /**
   * Vitesse de défilement du bandeau de messages, en PIXELS PAR SECONDE :
   * la durée de l'animation est recalculée selon la longueur du texte, pour
   * que la vitesse de lecture reste constante (défaut 90).
   */
  vitesse_ticker_px_s: number;
  machines: Machine[];
  motifs: Motif[];
}

/** Message préenregistré bilingue, proposé dans le formulaire Messages. */
export interface ModeleMessage {
  id: string;
  titre: string;
  texte_fr: string;
  texte_en: string;
  categorie: string;
  /** Ordre d'affichage dans le sélecteur et la bibliothèque. */
  ordre: number;
  actif: boolean;
}

export type CibleMessage = 'toutes' | 'gares' | 'train';

export interface Message {
  id: string;
  texte_fr: string;
  texte_en: string;
  cible_type: CibleMessage;
  /** Si cible_type = 'gares'. */
  gares?: GareId[] | null;
  /** Si cible_type = 'train' : affiché dans les gares encore desservies par ce train. */
  train_numero?: number | null;
  priorite: 'normale' | 'importante';
  actif: boolean;
  expire_at?: string | null;
}

export interface Media {
  id: string;
  nom: string;
  type: 'image' | 'video';
  url: string;
  duree_s: number;
  /** Ordre de passage croissant ; `cree_le` départage les égalités. */
  ordre: number;
  /** null = toutes les gares. */
  gares?: GareId[] | null;
  actif: boolean;
  expire_at?: string | null;
}

export interface MediaMeta {
  nom: string;
  type: 'image' | 'video';
  duree_s: number;
  /**
   * Optionnel à l'envoi : `uploadMedia()` place d'office un nouveau média en
   * DERNIER (max des ordres + 10). Ne le renseigner que pour imposer une
   * position précise.
   */
  ordre?: number;
  gares?: GareId[] | null;
  expire_at?: string | null;
}

export type Role = 'admin' | 'supervision' | 'caisse';

export interface Session {
  user_id: string;
  email: string;
}

export interface User {
  user_id: string;
  nom: string;
  email: string;
  role: Role;
  actif: boolean;
}

export interface EcranInfo {
  id: string;
  gare: GareId;
  type?: string | null;
  /** Dernier signal de vie : prouve que la MACHINE tourne. */
  derniere_vue?: string | null;
  /**
   * Dernière synchronisation RÉUSSIE des données affichées : prouve que ce
   * qui est à l'écran est FRAIS. Une machine allumée peut très bien afficher
   * un instantané périmé — seule cette colonne le révèle.
   */
  donnees_maj?: string | null;
  /** Date de la journée d'exploitation affichée (« YYYY-MM-DD »). */
  date_affichee?: string | null;
  version_app?: string | null;
  reseau?: string | null;
  /**
   * Ordre de rechargement à distance : un HORODATAGE, pas un booléen.
   * L'écran le compare à sa propre heure de chargement — il n'a donc rien à
   * réécrire (l'écriture lui est refusée sur cette colonne) et ne peut pas
   * entrer dans une boucle de rechargement.
   */
  recharger_demande_at?: string | null;
  /**
   * Veille de nuit propre à ce poste (« HH:MM »). Nulles = l'écran suit le
   * réglage global `params.veille_nuit`. Un écran de quai très exposé peut
   * ainsi s'éteindre plus tôt que les autres.
   */
  veille_debut?: string | null;
  veille_fin?: string | null;
}

/** Résultat de la bascule « Terminus Bellevue à partir du TRAIN N ». */
export interface ResultatTerminusBellevue {
  /** Nouveau jour : colonne Terminus pré-remplie et bascule enregistrée (entrées non modifiées). */
  jour: Jour;
  /** Rotations express de la plage (numéros de MONTÉE), signalées « à traiter » en supervision. */
  aTraiter: number[];
}
