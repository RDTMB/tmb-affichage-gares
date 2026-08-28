// Interface unique d'accès aux données (docs/02 §1) : AUCUN appel Supabase
// hors de src/data/. Implémentations : MockProvider (démo/tests), puis
// SupabaseProvider (phase 1, étape 5) et ApiProvider (phase 2, étape 10).
import type {
  Circulation,
  EcranInfo,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  MediaMeta,
  Message,
  ModeleMessage,
  Motif,
  Params,
  Role,
  Session,
  TerminusFlag,
  User,
} from '../core/types';

export interface DataProvider {
  /** JSON statiques versionnés (public/grilles/). */
  getGrilles(): Promise<Grille[]>;
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
  heartbeat(e: EcranInfo): Promise<void>;

  // — supervision (session requise) —
  signIn(email: string, mdp: string): Promise<Session>;
  getRole(): Promise<Role>;
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
  /** Bibliothèque de messages préenregistrés (lecture : tout compte connecté). */
  getModelesMessages(): Promise<ModeleMessage[]>;
  /** Écriture réservée au rôle admin (RLS). */
  saveModeleMessage(m: ModeleMessage): Promise<void>;
  deleteModeleMessage(id: string): Promise<void>;
  listUsers(): Promise<User[]>;
  saveUser(u: User): Promise<void>;
  /** Création par invitation email (Edge Function — clé secrète jamais côté front). */
  inviteUser(email: string, nom: string, role: Role): Promise<void>;
  resetMotDePasse(email: string): Promise<void>;
  /** Traduction FR → EN (Edge Function DeepL ; null = service indisponible, repli local). */
  traduire(texteFr: string): Promise<string | null>;
  logPublication(resume: string): Promise<void>;
  listEcrans(): Promise<EcranInfo[]>;
  demanderRechargement(id: string): Promise<void>;
  /** Retire un écran de la liste (poste remplacé, identifiant obsolète). */
  oublierEcran(id: string): Promise<void>;
}
