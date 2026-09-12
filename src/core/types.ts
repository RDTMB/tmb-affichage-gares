// Types métier partagés : grilles officielles (JSON versionnés), circulations
// du jour et structures produites par le moteur horaires (src/core/horaires.ts).

// Les rôles, leur matrice d'attribution et les droits qu'ils ouvrent vivent
// dans src/core/roles.ts. `Role` est ré-exporté ici pour que les modules qui
// importaient déjà ce fichier n'aient rien à changer.
import type { Onglet, Role, VisibiliteOnglets } from './roles';
export type { Onglet, Role, VisibiliteOnglets };

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

/** Bornes de la ligne complète : défaut de toute journée. */
/**
 * NATURE d'une circulation. UN SEUL champ, et c'est le sujet : deux booléens
 * côte à côte (`supplementaire` + `special`) rendraient représentable la
 * combinaison « sup ET spécial », qui n'existe pas en exploitation et que
 * rien n'empêcherait en base.
 *
 *  - `grille`         : le train vient du document d'exploitation. Ses heures
 *                       sont jointes depuis la grille, il ne porte pas de
 *                       passages.
 *  - `supplementaire` : renfort créé à la demande (docs/01 §2.7).
 *  - `special`        : train affrété, affiché avec la mention « privé »
 *                       (docs/01 §2.9).
 *
 * Les deux dernières portent LEURS PROPRES passages — sans quoi elles
 * seraient invisibles partout, `trainsDuJour()` ne sachant joindre que des
 * trains de grille. C'est ce que dit `horsGrille()`.
 */
export type NatureCirculation = 'grille' | 'supplementaire' | 'special';

/**
 * Le train porte-t-il SES PROPRES passages ? Vrai pour un renfort comme pour
 * un spécial. Ce prédicat a remplacé l'ancien booléen `supplementaire`
 * partout où celui-ci voulait dire « hors grille » et non « renfort » — la
 * distinction n'existait pas avant qu'une troisième nature apparaisse.
 */
export function horsGrille(t: { nature: NatureCirculation }): boolean {
  return t.nature !== 'grille';
}

export const GARE_DEBUT_DEFAUT: GareId = 'le-fayet';
export const GARE_FIN_DEFAUT: GareId = 'nid-daigle';

/** Section exploitée d'une journée, telle qu'elle se saisit et se publie. */
export interface SectionJour {
  gare_debut: GareId;
  gare_fin: GareId;
  message_troncon_fr: string | null;
  message_troncon_en: string | null;
}

export type Statut = 'ok' | 'retard' | 'supprime';

/**
 * REMPLISSAGE constaté d'un train (table `affluence`). Deux niveaux, pas
 * trois : l'ABSENCE de déclaration vaut « places disponibles ». C'est un axe
 * INDÉPENDANT de `Statut` — un train à l'heure peut être complet, un train en
 * retard peut être vide — et c'est pourquoi la pastille voyageurs ne vit pas
 * dans la colonne Statut de l'écran de gare.
 */
export type NiveauAffluence = 'limite' | 'complet';

/**
 * Affluence d'UN train d'UNE journée. La clé métier est (date, numéro) : un
 * TRAIN 9 complet l'est dans toutes les gares qu'il doit encore desservir,
 * jamais dans une seule.
 */
export interface Affluence {
  date: string;
  numero: number;
  niveau: NiveauAffluence;
  /** Adresse de qui a déclaré — posée par déclencheur, jamais par le client. */
  maj_par?: string | null;
  maj_le?: string;
}

/** Terminus possible d'une montée (les descentes partent du terminus atteint). */
export type Terminus = 'nid-daigle' | 'bellevue';

// ---------------------------------------------------------------------------
// Grille de saison (table `grilles`, chargée depuis l'Excel exploitation en
// supervision ; docs/grilles-historique/ = référence été 2026, jamais modifiée à la main)
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
  // --- Métadonnées d'ENREGISTREMENT (table `grilles`), posées par le
  // fournisseur de données ; absentes d'un fichier JSON de référence. ---
  /**
   * false = grille désactivée : ignorée par serviceActif(), les écrans
   * retombent sur la grille précédente couvrant la date (retour arrière).
   * Absent ou true = active.
   */
  actif?: boolean;
  /**
   * Horodatage ISO de l'enregistrement. Entre deux grilles ACTIVES couvrant
   * la même date, la plus récemment créée l'emporte (serviceActif()).
   */
  cree_le?: string;
  /** Email de l'agent qui a importé la grille (ou nom du script SQL). */
  cree_par?: string | null;
  commentaire?: string | null;
}

/** Options d'enregistrement d'une grille importée (DataProvider.saveGrille). */
export interface OptionsEnregistrementGrille {
  /** Défaut true : la grille s'applique dès sa première date de validité. */
  actif?: boolean;
  commentaire?: string | null;
}

/**
 * Métadonnées d'une grille modifiables EN PLACE (DataProvider.updateGrilleMetadonnees) :
 * nom, dates de validité, commentaire. Le CONTENU (heures, trains,
 * indicateurs) ne se modifie jamais en place : toute correction crée une
 * nouvelle version (« -v2 ») qui remplace la précédente, réactivable.
 */
export interface MetadonneesGrille {
  libelle: string;
  periodes: Periode[];
  commentaire: string | null;
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
   * GRILLE, RENFORT ou SPÉCIAL. Les deux dernières sont absentes de toute
   * grille et portent donc SES PROPRES passages — sans quoi elles seraient
   * invisibles partout, trainsDuJour() ne sachant joindre que des trains de
   * grille.
   *
   * La colonne SQL `supplementaire` existe encore en base, dérivée de
   * celle-ci par déclencheur et tenue par une contrainte. Elle n'est plus ni
   * lue ni écrite par le front, et son retrait est prévu pour la saison 2027
   * (une fois qu'aucun poste ne peut plus servir l'ancien bundle).
   */
  nature: NatureCirculation;
  /**
   * Passages du train sup, au format des grilles JSON
   * (`[{"gare":"le-fayet","d":"17:00:00"}, …]`). null pour un train de
   * grille — contrainte SQL circulations_sup_passages.
   */
  passages?: PassageGrille[] | null;
  /**
   * DÉPART RÉEL depuis le terminus, « HH:MM:SS » — descente d'une rotation
   * SUPPLÉMENTAIRE uniquement. null = horaire encore ESTIMÉ (le battement
   * choisi à la création) ; renseignée = l'agent a constaté l'heure de
   * départ, et `passages` a été recalculé depuis elle.
   */
  depart_reel?: string | null;
  /**
   * COMMANDITAIRE d'un train SPÉCIAL : qui l'a affrété. Champ INTERNE —
   * visible en supervision et dans le journal, JAMAIS servi aux écrans. Le
   * droit de SELECT est retiré à `anon` en base (droits de colonne), donc
   * absent des lectures d'écran : c'est `undefined` là-bas, et ce n'est pas
   * un oubli.
   *
   * Colonne propre et non `motif` : celui-ci porte déjà la raison d'une
   * suppression et celle d'un retard.
   */
  commanditaire?: string | null;
  /**
   * LIBELLÉ D'AFFICHAGE, facultatif (docs/01 §2.10). Quand il existe, il
   * remplace VERBATIM ce que rendent `libelleTrain()` et
   * `libelleTrainCourt()` : l'agent a écrit « T17 », on affiche « T17 » —
   * aucun préfixe ajouté, aucun reformatage.
   *
   * Il MASQUE le numéro technique, il ne le remplace pas : celui-ci reste
   * dans sa plage (spécial ≥ 201, renfort 101–199) et continue d'apparier la
   * montée à sa descente.
   */
  libelle?: string | null;
}

export interface Jour {
  date: string;
  grille_version: string;
  terminus_bellevue: TerminusFlag;
  /**
   * SECTION DE LIGNE EXPLOITÉE ce jour, bornes INCLUSES (travaux, fermeture
   * d'un tronçon). « Terminus Bellevue » n'est qu'un CAS PARTICULIER de
   * « une partie de la ligne n'est pas desservie » : il n'existe donc qu'une
   * seule troncature dans le moteur (`tronqueTrain()`), et la section est la
   * borne EXTÉRIEURE — la colonne `terminus` d'une circulation ne peut que
   * réduire davantage, jamais dépasser.
   *
   * Lire ces bornes par `sectionDuJour()` et JAMAIS directement : elles
   * peuvent venir d'un instantané en cache antérieur au déploiement, donc
   * être absentes ou hors de `ORDRE_GARES` (leçon C-01).
   */
  gare_debut: GareId;
  gare_fin: GareId;
  /**
   * Message affiché par les écrans des gares FERMÉES (hors section). Vide :
   * un défaut bilingue est construit sur la section réelle — un écran ne
   * reste jamais muet.
   */
  message_troncon_fr?: string | null;
  message_troncon_en?: string | null;
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
  /** Grille, renfort (docs/01 §2.7) ou spécial (docs/01 §2.9). */
  nature: NatureCirculation;
  /** Libellé d'affichage libre, quand l'agent en a donné un (docs/01 §2.10). */
  libelle?: string | null;
  /**
   * Descente supplémentaire dont le départ du terminus a été CONSTATÉ : ses
   * heures ne sont plus une estimation. Ce n'est PAS un retard — l'écran le
   * dit en couleur neutre.
   */
  departConfirme: boolean;
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
  /** Grille, renfort (docs/01 §2.7) ou spécial (docs/01 §2.9). */
  nature: NatureCirculation;
  /** Libellé d'affichage libre, quand l'agent en a donné un (docs/01 §2.10). */
  libelle?: string | null;
  /** Descente supplémentaire au départ CONSTATÉ (mention neutre, jamais « retard »). */
  departConfirme: boolean;
  /** Heures réelles (retard inclus) ; un supprimé garde ses heures théoriques (affichées barrées). */
  arrivee_s: number | null;
  depart_s: number | null;
  /** Heures théoriques (« théorique HH:MM » affiché en cas de retard). */
  arrivee_theorique_s: number | null;
  depart_theorique_s: number | null;
  /**
   * Remplissage constaté (pastille « Complet » / « Dernières places »).
   * Posé sur la LIGNE D'AFFICHAGE et non sur `Circulation` : la circulation
   * reste ce que l'exploitation ferroviaire sait du train. Le moteur horaires
   * l'ignore entièrement — la jointure se fait dans la page, après
   * `passagesPourGare()`, par `appliqueAffluence()`.
   * Absent ou null = places disponibles.
   */
  affluence?: NiveauAffluence | null;
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
  /**
   * Rôles CUMULABLES de l'agent : un droit est accordé si au moins l'un
   * d'entre eux le donne (src/core/roles.ts). Un tableau vide signifie « aucun
   * droit » — l'agent voit la supervision, sans aucun onglet.
   */
  roles: Role[];
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

/** État du ciel proposé dans la liste météo (FR + EN + ordre d'affichage). */
export interface Ciel {
  fr: string;
  en: string;
  ordre: number;
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
  ciels: Ciel[];
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

export interface Session {
  user_id: string;
  email: string;
}

export interface User {
  user_id: string;
  nom: string;
  email: string;
  /** Rôles cumulables (src/core/roles.ts) ; vide = compte sans aucun droit. */
  roles: Role[];
  actif: boolean;
}

export interface EcranInfo {
  id: string;
  gare: GareId;
  type?: string | null;
  /**
   * Vitesse du bandeau PROPRE à ce poste (px/s) ; null = il suit le réglage
   * global. Taille de l'écran, distance de lecture et quantité d'information
   * diffusée ne sont pas les mêmes d'une gare à l'autre.
   */
  vitesse_ticker_px_s?: number | null;
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
