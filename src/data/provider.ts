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
  /** URLs + durées des médias ciblant la gare. */
  getMedias(gare: GareId): Promise<Media[]>;
  /** Météo, veille nuit, durées, motifs, machines. */
  getParams(): Promise<Params>;
  /** Temps réel : rappelé à chaque changement ; retourne la désinscription. */
  onChange(cb: () => void): () => void;
  heartbeat(e: EcranInfo): Promise<void>;

  // — supervision (session requise) —
  signIn(email: string, mdp: string): Promise<Session>;
  getRole(): Promise<Role>;
  genererJour(date: string): Promise<void>;
  saveCirculation(c: Circulation): Promise<void>;
  setTerminusBellevue(date: string, v: TerminusFlag): Promise<void>;
  saveMessage(m: Message): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  uploadMedia(file: File, meta: MediaMeta): Promise<void>;
  saveMedia(m: Media): Promise<void>;
  deleteMedia(id: string): Promise<void>;
  saveParams(p: Partial<Params>): Promise<void>;
  saveMachine(m: Machine): Promise<void>;
  saveMotif(m: Motif): Promise<void>;
  listUsers(): Promise<User[]>;
  saveUser(u: User): Promise<void>;
  logPublication(resume: string): Promise<void>;
  listEcrans(): Promise<EcranInfo[]>;
  demanderRechargement(id: string): Promise<void>;
}
