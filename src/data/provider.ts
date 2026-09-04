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
  OptionsEnregistrementGrille,
  Profil,
  Params,
  Role,
  Session,
  TerminusFlag,
  User,
} from '../core/types';

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
   * Signal de vie. Retourne la veille propre au poste (null = il suit le
   * réglage global) : l'écran l'applique sans rechargement.
   */
  heartbeat(e: EcranInfo): Promise<{ debut: string; fin: string } | null>;

  // — supervision (session requise) —
  signIn(email: string, mdp: string): Promise<Session>;
  getRole(): Promise<Role>;
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
  setTerminusBellevue(date: string, v: TerminusFlag): Promise<void>;
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
  listUsers(): Promise<User[]>;
  saveUser(u: User): Promise<void>;
  /** Suppression définitive (Edge Function — clé secrète jamais côté front). */
  deleteUser(user_id: string): Promise<void>;
  /** Création par invitation email (Edge Function — clé secrète jamais côté front). */
  inviteUser(email: string, nom: string, role: Role): Promise<void>;
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
