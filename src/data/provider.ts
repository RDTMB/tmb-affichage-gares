// Interface unique d'accès aux données (docs/02 §1) : AUCUN appel Supabase
// hors de src/data/. Implémentations : MockProvider (démo/tests), puis
// SupabaseProvider (phase 1, étape 5) et ApiProvider (phase 2, étape 10).
import type {
  Circulation,
  EcranInfo,
  EntreeJournal,
  FiltreJournal,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  MediaMeta,
  Message,
  ModeleMessage,
  Motif,
  Ciel,
  MetadonneesGrille,
  Onglet,
  OptionsEnregistrementGrille,
  Profil,
  PassageGrille,
  Params,
  Role,
  VisibiliteOnglets,
  Session,
  SectionJour,
  TerminusFlag,
  User,
} from '../core/types';

/** Réglages propres à un poste, renvoyés par le signal de vie. */
export interface ReglagesPoste {
  /** Veille de nuit propre ; null = le poste suit le réglage global. */
  veille: { debut: string; fin: string } | null;
  /** Vitesse du bandeau propre (px/s) ; null = réglage global. */
  vitesse_ticker_px_s: number | null;
}

export interface DataProvider {
  /**
   * Grilles ACTIVES (écrans, génération des journées). Elles vivent en base
   * (table `grilles`, importées depuis l'Excel exploitation en supervision) ;
   * le mock les lit dans les JSON de référence. Le service en vigueur à une
   * date se déduit par `serviceActif()` (src/core/horaires.ts).
   */
  getGrilles(): Promise<Grille[]>;
  /** TOUTES les grilles, actives ou non, avec leurs métadonnées (onglet Horaires). */
  listGrilles(): Promise<Grille[]>;
  /**
   * Enregistre une NOUVELLE grille, active par défaut. Une version existante
   * n'est jamais écrasée : l'appel échoue, l'import crée alors « …-v2 ».
   */
  saveGrille(g: Grille, options?: OptionsEnregistrementGrille): Promise<void>;
  /** Active ou désactive une grille ; la désactivation est le retour arrière. */
  setGrilleActive(version: string, actif: boolean): Promise<void>;
  /**
   * Modifie EN PLACE les seules métadonnées d'une grille (nom, dates de
   * validité, commentaire), avec trace au journal d'exploitation. Le contenu
   * n'est jamais réécrit : une correction d'heures passe par saveGrille().
   */
  updateGrilleMetadonnees(version: string, meta: MetadonneesGrille): Promise<void>;
  /** Dates (« YYYY-MM-DD », bornes incluses) dont la journée existe déjà en base. */
  listJoursGeneres(du: string, au: string): Promise<string[]>;
  /** Circulations + drapeaux du jour (terminus…). */
  getJour(date: string): Promise<Jour>;
  getMessages(gare: GareId): Promise<Message[]>;
  /** URLs + durées des médias ACTIFS ciblant la gare (écrans). */
  getMedias(gare: GareId): Promise<Media[]>;
  /** TOUS les médias, y compris désactivés (supervision). */
  listMedias(): Promise<Media[]>;
  /** Météo, veille nuit, durées, motifs, machines. */
  getParams(): Promise<Params>;
  /** Temps réel : rappelé à chaque changement ; retourne la désinscription. */
  onChange(cb: () => void): () => void;
  /**
   * Signal de vie. Retourne les réglages PROPRES au poste — veille de nuit et
   * vitesse du bandeau, null = il suit le global : l'écran les applique sans
   * rechargement, au plus tard au cycle suivant.
   */
  heartbeat(e: EcranInfo): Promise<ReglagesPoste>;
  /**
   * Vitesse du bandeau propre à un poste (px/s), null = retour au réglage
   * global. Même modèle que `saveVeilleEcran`.
   */
  saveVitesseEcran(id: string, px_s: number | null): Promise<void>;

  // — supervision (session requise) —
  signIn(email: string, mdp: string): Promise<Session>;
  /**
   * Rôles CUMULABLES de l'agent connecté (src/core/roles.ts). Un droit est
   * accordé si au moins l'un d'eux le donne ; le tableau peut être vide.
   */
  getRoles(): Promise<Role[]>;
  /** Profil complet de l'agent connecté ; lève si la session ou le profil manque. */
  getProfil(): Promise<Profil>;
  genererJour(date: string): Promise<void>;
  /** Supprime les circulations de la date et régénère depuis la grille en vigueur. */
  reinitialiseJour(date: string): Promise<void>;
  saveCirculation(c: Circulation): Promise<void>;
  /**
   * Écriture groupée (action de masse sur les facultatifs) : même chemin que
   * l'écriture unitaire — création de la journée si besoin — et échec bruyant
   * si le nombre de lignes réellement écrites ne correspond pas.
   */
  saveCirculations(cs: Circulation[]): Promise<void>;
  /** Crée la rotation d'un train supplémentaire (montée impaire + descente n+1). */
  creerTrainSup(date: string, montee: Circulation, descente: Circulation): Promise<void>;
  /**
   * Supprime la rotation d'un train supplémentaire. REFUSÉ si le train n'est
   * pas supplémentaire : un train de grille ne se supprime pas, il se met au
   * statut « supprimé ».
   */
  supprimerTrainSup(date: string, numeroMontee: number): Promise<void>;
  /**
   * DÉPART RÉEL constaté d'une descente supplémentaire : écrit l'heure et les
   * passages recalculés. Écriture IMMÉDIATE, hors brouillon — voir
   * `confirmeDepartSup()` dans supervision.ts pour la raison.
   */
  confirmerDepartSup(
    date: string,
    numeroDescente: number,
    departReel: string,
    passages: PassageGrille[],
  ): Promise<void>;
  setTerminusBellevue(date: string, v: TerminusFlag): Promise<void>;
  /**
   * SECTION EXPLOITÉE du jour (travaux) et message des gares fermées.
   * « Terminus Bellevue » reste une écriture distincte : il agit sur la
   * colonne Terminus des circulations, la section sur la journée elle-même.
   */
  setSectionJour(date: string, section: SectionJour): Promise<void>;
  saveMessage(m: Message): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  uploadMedia(file: File, meta: MediaMeta): Promise<void>;
  saveMedia(m: Media): Promise<void>;
  deleteMedia(id: string): Promise<void>;
  saveParams(p: Partial<Params>): Promise<void>;
  saveMachine(m: Machine): Promise<void>;
  deleteMachine(nom: string): Promise<void>;
  saveMotif(m: Motif): Promise<void>;
  deleteMotif(fr: string): Promise<void>;
  saveCiel(c: Ciel): Promise<void>;
  deleteCiel(fr: string): Promise<void>;
  /** Bibliothèque de messages préenregistrés (lecture : tout compte connecté). */
  getModelesMessages(): Promise<ModeleMessage[]>;
  /** Écriture réservée au rôle admin (RLS). */
  saveModeleMessage(m: ModeleMessage): Promise<void>;
  deleteModeleMessage(id: string): Promise<void>;
  /** Comptes et leurs rôles. Un rôle non attribuable par l'agent reste visible, jamais modifiable. */
  listUsers(): Promise<User[]>;
  /** Nom et activation UNIQUEMENT : les rôles passent par setRolesUser(). */
  saveUser(u: User): Promise<void>;
  /**
   * Applique l'ensemble de rôles voulu pour un compte : la différence est
   * traduite en attributions puis en retraits, dans CET ordre — la base refuse
   * de laisser un rôle protégé sans détenteur, un échange doit donc toujours
   * commencer par donner.
   */
  setRolesUser(user_id: string, roles: Role[]): Promise<void>;
  /**
   * Onglets visibles par rôle (table `onglets_par_role`). `null` = réglage
   * INDISPONIBLE — base injoignable, table absente ou vide : l'appelant
   * retombe alors sur la matrice du code (`ongletsVisibles()`).
   *
   * ⚠ Ce réglage ne peut que RETRANCHER. Il n'accorde rien : RLS refuse
   * exactement ce qu'elle refusait. Voir src/core/roles.ts.
   */
  getOngletsParRole(): Promise<VisibiliteOnglets>;
  /**
   * Rend un onglet visible à un rôle, ou le masque. Un geste = une ligne, donc
   * une ligne de journal : accorder et masquer ne se confondent jamais.
   * La base refuse le masquage qui fermerait le dernier accès à l'onglet
   * Utilisateurs (déclencheur de contrainte différé).
   */
  setOngletRole(role: Role, onglet: Onglet, visible: boolean): Promise<void>;
  /** Suppression définitive (Edge Function — clé secrète jamais côté front). */
  deleteUser(user_id: string): Promise<void>;
  /** Création par invitation email (Edge Function — clé secrète jamais côté front). */
  inviteUser(email: string, nom: string, roles: Role[]): Promise<void>;
  /**
   * Envoie le lien « mot de passe oublié » ; la personne revient sur la page
   * de supervision qui lui propose alors d'en choisir un nouveau.
   */
  resetMotDePasse(email: string): Promise<void>;
  /**
   * Enregistre le mot de passe de la session ouverte par un lien reçu par
   * e-mail (invitation ou réinitialisation).
   */
  definirMotDePasse(mdp: string): Promise<void>;
  /** Traduction FR → EN (Edge Function DeepL ; null = service indisponible, repli local). */
  traduire(texteFr: string): Promise<string | null>;
  logPublication(resume: string): Promise<void>;
  /** Horodatage de la dernière publication, tous postes confondus (null si aucune). */
  dernierePublication(): Promise<string | null>;
  /** Journal d'exploitation : lecture seule, antéchronologique. */
  listJournal(filtre: FiltreJournal): Promise<EntreeJournal[]>;
  listEcrans(): Promise<EcranInfo[]>;
  /**
   * Déclaration préalable d'un poste (administrateur). Un écran ne peut plus
   * s'inscrire lui-même : l'INSERT anonyme est interdit par RLS. Sans
   * déclaration, son signal de vie ne touche aucune ligne.
   */
  declareEcran(e: Pick<EcranInfo, 'id' | 'gare' | 'type'>): Promise<void>;
  demanderRechargement(id: string): Promise<void>;
  /** Veille propre à un écran ; `null, null` = retour au réglage global. */
  saveVeilleEcran(id: string, debut: string | null, fin: string | null): Promise<void>;
  /** Retire un écran de la liste (poste remplacé, identifiant obsolète). */
  oublierEcran(id: string): Promise<void>;
}
