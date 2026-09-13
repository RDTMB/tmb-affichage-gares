// SupabaseProvider (phase 1) — SEUL fichier du front qui parle à Supabase.
// Lecture publique par RLS (clé « publishable »), écritures réservées aux
// sessions authentifiées. Realtime : un canal unique + rafraîchissement
// complet, repli polling 30 s.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import { datePrecedente, generationJour, sectionReportee, serviceActif } from '../core/horaires';
import { ecartDepuisEntete } from '../core/horloge';
import type {
  AccesCourse,
  Affluence,
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
  NiveauAffluence,
  Ciel,
  MetadonneesGrille,
  Onglet,
  OptionsEnregistrementGrille,
  Profil,
  PassageGrille,
  Params,
  Role,
  Session,
  SectionJour,
  Sens,
  TerminusFlag,
  User,
  VisibiliteOnglets,
  EntreeJournal,
  FiltreJournal,
} from '../core/types';
import { GARE_DEBUT_DEFAUT, GARE_FIN_DEFAUT, horsGrille } from '../core/types';
import type { NatureCirculation } from '../core/types';
import { ROLES, aLeDroit } from '../core/roles';
import { paramsValides } from '../core/params';
import {
  contenuSansMetadonnees,
  grilleDepuisEnregistrement,
  type EnregistrementGrille,
} from '../core/grilles';
import type { DataProvider, ReglagesPoste } from './provider';

/**
 * Tables dont un changement doit rafraîchir les données d'AFFICHAGE.
 * `ecrans` en est volontairement EXCLUE : ses écritures sont des heartbeats
 * (6 écrans toutes les 30 s) et provoqueraient un rechargement complet en
 * boucle chez tous les clients. L'onglet Écrans de la supervision se
 * rafraîchit, lui, par interrogation périodique.
 */
export const TABLES_AFFICHAGE = [
  'jours',
  'circulations',
  // Le guichet déclare complet le train qui part dans trois minutes : sans
  // cette entrée, l'écran ne le verrait qu'au repli de sondage de 30 s.
  'affluence',
  'messages',
  'medias',
  'params',
  'machines',
  'motifs',
  'ciels',
  'modeles_messages',
  // Import ou activation d'une grille : les écrans doivent la voir en
  // quelques secondes (la promesse getGrilles est oubliée à chaque signal).
  'grilles',
] as const;

interface LigneJour {
  date: string;
  grille_version: string;
  terminus_bellevue_a_partir_du_train: number | null;
  gare_debut: GareId | null;
  gare_fin: GareId | null;
  message_troncon_fr: string | null;
  message_troncon_en: string | null;
}

/** Messages d'erreur Supabase les plus courants sur un mot de passe, en français. */
function traduitErreurMotDePasse(message: string): string {
  if (/at least (\d+) characters/i.test(message)) {
    const n = /at least (\d+) characters/i.exec(message)?.[1];
    return `Le mot de passe doit comporter au moins ${n} caractères.`;
  }
  if (/different from the old password/i.test(message)) {
    return "Le nouveau mot de passe doit être différent de l'ancien.";
  }
  if (/Auth session missing|session/i.test(message)) {
    return 'Le lien a expiré : demandez un nouvel envoi à un administrateur.';
  }
  return message;
}

function verifie(erreur: { message: string } | null): void {
  if (erreur) throw new Error(erreur.message);
}

/**
 * Échec BRUYANT d'une écriture sans effet : PostgREST répond « succès » avec
 * 0 ligne quand la cible n'existe pas (ou que RLS filtre l'update) — sans ce
 * garde-fou, la supervision affichait un faux toast de succès (bug exploitant
 * du 25/08/2026). À utiliser avec `.select()` sur chaque update/upsert.
 */
export function exigeLignes(
  resultat: { data: unknown[] | null; error: { message: string } | null },
  contexte: string,
  attendues = 1,
): void {
  if (resultat.error) throw new Error(resultat.error.message);
  if (!resultat.data || resultat.data.length < attendues) {
    throw new Error(`Modification non enregistrée — ${contexte}`);
  }
}

/** Rôles rangés dans l'ordre d'affichage des badges (src/core/roles.ts). */
function ordonneRoles(roles: readonly string[]): Role[] {
  return ROLES.filter((r) => roles.includes(r));
}

export class SupabaseProvider implements DataProvider {
  private readonly client: SupabaseClient;
  private grilles: Promise<Grille[]> | null = null;
  /** Heure de chargement de CETTE page : référence de l'ordre de rechargement. */
  private readonly chargeeA = Date.now();
  private canal: RealtimeChannel | null = null;
  private notifieId: number | null = null;
  private readonly abonnes = new Set<() => void>();

  /**
   * Dernier écart mesuré entre l'horloge du poste et celle du serveur.
   * `null` tant qu'aucune réponse n'a porté d'en-tête `Date` lisible.
   */
  private ecartMs: number | null = null;

  /**
   * `sansSession` : le client n'ouvre AUCUNE session depuis le fragment
   * d'URL (E-02). Réservé aux pages d'AFFICHAGE.
   *
   * Le défaut est l'ancien comportement, et c'est voulu ici — l'inverse de
   * `creerSiAbsent`. `detectSessionInUrl` est ce qui consomme le fragment des
   * liens d'invitation et de réinitialisation, et qui donne à
   * `definirMotDePasse` la session sur laquelle il travaille : le désactiver
   * par défaut casserait le parcours « choisir son mot de passe », corrigé le
   * 04/09 et JAMAIS éprouvé en réel. On ne met donc pas ce parcours-là à la
   * merci d'un appelant qui oublierait une option ; c'est la page d'affichage,
   * qui n'a aucune session à ouvrir, qui le demande explicitement.
   */
  constructor(url: string, clePubliable: string, sansSession = false) {
    // `fetch` ENVELOPPÉ : chaque réponse porte un en-tête `Date`, donc une
    // référence d'heure serveur GRATUITE — aucune requête n'est ajoutée, on
    // lit ce qui passe déjà. C'est le seul point du code qui voit toutes les
    // réponses, y compris les sondes de synchronisation.
    this.client = createClient(url, clePubliable, {
      ...(sansSession
        ? {
            // Un lien d'invitation ouvert par erreur sur un écran de gare y
            // ouvrirait une session : le poste est en kiosque, sans clavier,
            // et personne ne s'en apercevrait. `persistSession` est coupé avec
            // `detectSessionInUrl` — sans lui, une session déjà écrite dans
            // `localStorage` par une version antérieure resterait relue à
            // chaque démarrage. `autoRefreshToken` n'a plus d'objet.
            auth: {
              detectSessionInUrl: false,
              persistSession: false,
              autoRefreshToken: false,
            },
          }
        : {}),
      global: {
        fetch: async (entree, init) => {
          const envoi = Date.now();
          const reponse = await fetch(entree as RequestInfo, init);
          const mesure = ecartDepuisEntete(reponse.headers.get('date'), envoi, Date.now());
          // Une mesure illisible ne remplace pas la précédente : on préfère
          // une référence un peu ancienne à pas de référence du tout.
          if (mesure !== null) this.ecartMs = mesure;
          return reponse;
        },
      },
    });
  }

  ecartHorlogeMs(): number | null {
    return this.ecartMs;
  }

  // ------------------------------------------------------------------ lecture

  /**
   * Contenu (jsonb) de chaque grille, par version. Une version n'est JAMAIS
   * réécrite en base (l'import crée « -v2 ») : ce cache est définitif pour
   * la durée de vie de la page.
   */
  private readonly contenus = new Map<string, unknown>();

  getGrilles(): Promise<Grille[]> {
    // Grilles ACTIVES, lues en base. La promesse est mémorisée jusqu'au
    // prochain signal de changement (notifie) ou jusqu'à la prochaine
    // écriture de grille depuis ce poste.
    this.grilles ??= this.chargeGrilles(true).catch((erreur: unknown) => {
      // Sans cet oubli du cache, une promesse REJETÉE (démarrage hors ligne)
      // resterait mémorisée : plus aucune tentative au retour du réseau et
      // l'écran resterait figé sur l'écran neutre toute la journée.
      this.grilles = null;
      throw erreur;
    });
    return this.grilles;
  }

  async listGrilles(): Promise<Grille[]> {
    return this.chargeGrilles(false);
  }

  /**
   * Deux requêtes au plus : les MÉTADONNÉES de toutes les grilles (quelques
   * centaines d'octets), puis le contenu des seules versions pas encore en
   * mémoire. Les écrans se resynchronisent toutes les 30 s : relire ~25 Ko
   * de contenu à chaque fois aurait coûté ~0,5 Go par mois et par écran, pour
   * des grilles qui ne changent que quelques fois par an.
   */
  private async chargeGrilles(activesSeulement: boolean): Promise<Grille[]> {
    const colonnes = 'version, libelle, source, periodes, actif, cree_le, cree_par, commentaire';
    const base = this.client.from('grilles').select(colonnes);
    const meta = await (activesSeulement ? base.eq('actif', true) : base).order('cree_le');
    verifie(meta.error);
    const lignes = (meta.data ?? []) as Omit<EnregistrementGrille, 'contenu'>[];

    const manquantes = lignes.map((l) => l.version).filter((v) => !this.contenus.has(v));
    if (manquantes.length > 0) {
      const contenus = await this.client
        .from('grilles')
        .select('version, contenu')
        .in('version', manquantes);
      verifie(contenus.error);
      for (const l of (contenus.data ?? []) as { version: string; contenu: unknown }[]) {
        this.contenus.set(l.version, l.contenu);
      }
    }
    // grilleDepuisEnregistrement vérifie la forme du contenu (C-01) et lève
    // une erreur explicite plutôt que de servir une grille à moitié lue.
    return lignes.map((l) =>
      grilleDepuisEnregistrement({ ...l, contenu: this.contenus.get(l.version) }),
    );
  }

  async saveGrille(g: Grille, options: OptionsEnregistrementGrille = {}): Promise<void> {
    const { data: auth } = await this.client.auth.getUser();
    const resultat = await this.client
      .from('grilles')
      .insert({
        version: g.version,
        libelle: g.libelle,
        source: g.source ?? null,
        periodes: g.periodes,
        contenu: contenuSansMetadonnees(g),
        actif: options.actif ?? true,
        cree_par: auth.user?.email ?? null,
        commentaire: options.commentaire ?? null,
      })
      .select('version');
    if (resultat.error?.code === '23505') {
      // Clé primaire violée : une version n'est JAMAIS réécrite (l'import
      // doit créer « -v2 »). Message pour l'agent, pas le jargon Postgres.
      throw new Error(`Une grille « ${g.version} » existe déjà : elle n'a pas été écrasée`);
    }
    exigeLignes(resultat, 'grille refusée (droits insuffisants ?)');
    this.grilles = null;
  }

  async setGrilleActive(version: string, actif: boolean): Promise<void> {
    exigeLignes(
      await this.client.from('grilles').update({ actif }).eq('version', version).select('version'),
      `grille « ${version} » introuvable ou droits insuffisants`,
    );
    this.grilles = null;
  }

  async updateGrilleMetadonnees(version: string, meta: MetadonneesGrille): Promise<void> {
    // Colonnes de la LIGNE seulement : le contenu jsonb reste intact (le cache
    // par version reste donc valable) et la ligne fait foi sur le contenu
    // pour le nom et les périodes (src/core/grilles.ts). Le déclencheur
    // trg_journal_grilles consigne chaque champ modifié.
    exigeLignes(
      await this.client
        .from('grilles')
        .update({
          libelle: meta.libelle,
          periodes: meta.periodes,
          commentaire: meta.commentaire,
        })
        .eq('version', version)
        .select('version'),
      `grille « ${version} » introuvable ou droits insuffisants`,
    );
    this.grilles = null;
  }

  async listJoursGeneres(du: string, au: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('jours')
      .select('date')
      .gte('date', du)
      .lte('date', au)
      .order('date');
    verifie(error);
    return ((data ?? []) as { date: string }[]).map((l) => l.date);
  }

  async getJour(
    date: string,
    options?: { creerSiAbsent?: boolean; avecCommanditaire?: boolean },
  ): Promise<Jour> {
    // Les colonnes sont ÉNUMÉRÉES, jamais `*` : `commanditaire` est retiré à
    // `anon` par droit de colonne, et `select=*` déclencherait « permission
    // denied for column commanditaire » sur les SIX écrans à la fois.
    //
    // Les deux listes sont écrites en toutes lettres, sans interpolation : le
    // typage de supabase-js lit la CHAÎNE et non sa valeur (même raison que
    // `getAffluence`). Elles doivent rester d'accord avec le `grant select`
    // de schema.sql — src/data/commanditaire.test.ts les compare.
    const table = this.client.from('circulations');
    const [grilles, jourRes, circRes] = await Promise.all([
      this.getGrilles(),
      this.client.from('jours').select('*').eq('date', date).maybeSingle(),
      options?.avecCommanditaire === true
        ? table
            .select(
              'date, numero, sens, express, facultatif, facultatif_actif, velos, rame, terminus, statut, retard_min, motif, sans_voyageurs, nature, passages, depart_reel, libelle, acces, commanditaire',
            )
            .eq('date', date)
            .order('numero')
        : table
            .select(
              'date, numero, sens, express, facultatif, facultatif_actif, velos, rame, terminus, statut, retard_min, motif, sans_voyageurs, nature, passages, depart_reel, libelle, acces',
            )
            .eq('date', date)
            .order('numero'),
    ]);
    verifie(jourRes.error);
    verifie(circRes.error);
    const ligne = jourRes.data as LigneJour | null;
    const circulations = (circRes.data ?? []) as Circulation[];

    const grille = serviceActif(grilles, date);
    if (!grille) {
      // Hors saison : AUCUN service — jamais de repli sur une autre grille,
      // aucune circulation, aucune écriture (bug exploitant du 25/08/2026).
      return {
        date,
        grille_version: '',
        terminus_bellevue: ligne ? versFlag(ligne) : false,
        ...(ligne
          ? versSection(ligne)
          : {
              gare_debut: GARE_DEBUT_DEFAUT,
              gare_fin: GARE_FIN_DEFAUT,
              message_troncon_fr: null,
              message_troncon_en: null,
            }),
        circulations: [],
        enregistre: ligne !== null,
        hors_saison: true,
      };
    }

    if (!ligne || circulations.length === 0) {
      // Ouverture d'une date à venir en supervision par un rôle qui a le
      // DROIT d'écrire l'exploitation : la journée est créée immédiatement
      // (idempotent). Un compte « caisse » ou un écran anonyme ne déclenche
      // aucune écriture (elle serait refusée par RLS).
      // `creerSiAbsent` d'abord : sans lui, aucune écriture, quels que soient
      // la date et les droits de la session. Un écran de gare et l'aperçu de
      // la supervision passent donc tout droit vers l'aperçu théorique.
      if (
        options?.creerSiAbsent === true &&
        date >= dateAujourdhuiParis() &&
        (await this.peutEcrireExploitation())
      ) {
        await this.genererJour(date);
        this.joursAssures.add(date);
        const cree = generationJour(grille, date);
        if (ligne) {
          cree.terminus_bellevue = versFlag(ligne);
          Object.assign(cree, versSection(ligne));
        }
        cree.enregistre = true;
        return cree;
      }
      // Date passée jamais exploitée (ou écran anonyme) : aperçu théorique,
      // rien n'est fabriqué en base (pas d'historique inventé).
      const defaut = generationJour(grille, date);
      if (ligne) {
        defaut.terminus_bellevue = versFlag(ligne);
        Object.assign(defaut, versSection(ligne));
      }
      defaut.enregistre = false;
      return defaut;
    }
    return {
      date,
      grille_version: ligne.grille_version,
      terminus_bellevue: versFlag(ligne),
      ...versSection(ligne),
      circulations,
      enregistre: true,
    };
  }

  /**
   * Toute écriture liée à une date crée d'abord la journée si elle n'existe
   * pas encore (idempotent, n'écrase rien) : l'exploitant n'a jamais à
   * cliquer « Générer depuis la grille » pour que ses modifications tiennent.
   */
  private readonly joursAssures = new Set<string>();

  private profilCache: Profil | null = null;

  /**
   * true si la session ouverte peut créer une journée : c'est le droit
   * `circulations` (supervision) ou celui de réinitialiser (technique), les
   * deux seuls à écrire dans `jours`.
   */
  private async peutEcrireExploitation(): Promise<boolean> {
    const { data } = await this.client.auth.getSession(); // lecture locale, pas d'appel réseau
    if (!data.session) return false;
    try {
      const roles = await this.getRoles();
      return aLeDroit(roles, 'circulations') || aLeDroit(roles, 'journee.reinitialiser');
    } catch {
      return false; // profil absent ou inactif
    }
  }

  private async assureJour(date: string): Promise<void> {
    if (this.joursAssures.has(date)) return;
    const { data, error } = await this.client
      .from('jours')
      .select('date')
      .eq('date', date)
      .maybeSingle();
    verifie(error);
    if (!data) await this.genererJour(date);
    this.joursAssures.add(date);
  }

  async getMessages(): Promise<Message[]> {
    const { data, error } = await this.client.from('messages').select('*').eq('actif', true);
    verifie(error);
    return (data ?? []) as Message[];
  }

  async getAffluence(date: string, options?: { avecSignature?: boolean }): Promise<Affluence[]> {
    // TROIS COLONNES PAR DÉFAUT, et pas une de plus. Cette lecture est faite
    // AUSSI par les écrans de gare, qui interrogent en anonyme : `maj_par`
    // porte l'adresse de l'agent et ne leur est pas accordée. La demander
    // depuis un écran ne « lirait pas un peu plus », elle ferait échouer la
    // requête ENTIÈRE — et en production seulement. La supervision, elle, est
    // authentifiée et l'affiche : deux rôles écrivent au même endroit, chacun
    // doit voir la main de l'autre.
    //
    // Deux appels et non une chaîne construite : le typage de supabase-js lit
    // la liste de colonnes comme un LITTÉRAL, et une expression conditionnelle
    // lui rend un type d'erreur.
    const table = this.client.from('affluence');
    const { data, error } =
      options?.avecSignature === true
        ? await table.select('date, numero, niveau, maj_par, maj_le').eq('date', date)
        : await table.select('date, numero, niveau').eq('date', date);
    verifie(error);
    return (data ?? []) as Affluence[];
  }

  async setAffluence(date: string, numero: number, niveau: NiveauAffluence | null): Promise<void> {
    if (niveau === null) {
      // Retour à la normale : on SUPPRIME la ligne. L'absence vaut « places
      // disponibles » — écrire un troisième niveau laisserait en base des
      // lignes sans information, à distinguer de leur absence.
      const { error } = await this.client
        .from('affluence')
        .delete()
        .eq('date', date)
        .eq('numero', numero);
      verifie(error);
      return;
    }
    // `maj_par` et `maj_le` ne sont PAS envoyées : le déclencheur les pose
    // depuis le jeton. Une signature écrite par le navigateur se forgerait,
    // et les colonnes ne nous sont d'ailleurs pas accordées.
    const { error } = await this.client
      .from('affluence')
      .upsert({ date, numero, niveau }, { onConflict: 'date,numero' });
    verifie(error);
  }

  async getMedias(gare: GareId): Promise<Media[]> {
    return (await this.tousLesMedias()).filter(
      (m) => m.actif && (!m.gares || m.gares.includes(gare)),
    );
  }

  /** Supervision : TOUS les médias, y compris désactivés (sinon ils disparaissent de la liste). */
  async listMedias(): Promise<Media[]> {
    return this.tousLesMedias();
  }

  private async tousLesMedias(): Promise<Media[]> {
    // Ordre de passage choisi en supervision ; `cree_le` départage.
    const { data, error } = await this.client
      .from('medias')
      .select('*')
      .order('ordre')
      .order('cree_le');
    verifie(error);
    interface LigneMedia extends Omit<Media, 'url'> {
      chemin: string;
      gares: GareId[] | null;
    }
    return ((data ?? []) as LigneMedia[]).map((m) => ({
      ...m,
      url: this.client.storage.from('medias').getPublicUrl(m.chemin).data.publicUrl,
    }));
  }

  async getParams(): Promise<Params> {
    const [paramsRes, machinesRes, motifsRes, cielsRes] = await Promise.all([
      this.client.from('params').select('cle, valeur'),
      this.client.from('machines').select('*').order('nom'),
      this.client.from('motifs').select('*').order('fr'),
      this.client.from('ciels').select('*').order('ordre').order('fr'),
    ]);
    verifie(paramsRes.error);
    verifie(machinesRes.error);
    verifie(motifsRes.error);
    verifie(cielsRes.error);
    const valeurs = new Map(
      ((paramsRes.data ?? []) as { cle: string; valeur: unknown }[]).map((p) => [p.cle, p.valeur]),
    );
    // `params.valeur` est du jsonb : la base n'impose AUCUNE forme et le
    // typage TypeScript ne vaut qu'à la compilation. Tout passe donc par
    // paramsValides(), unique point de coercition et de bornage (C-01).
    // `Object.fromEntries` et non `{ ...valeurs }` : le spread d'une Map
    // donne un objet VIDE, ce qui remettrait tous les paramètres au défaut.
    return paramsValides({
      ...Object.fromEntries(valeurs),
      machines: machinesRes.data,
      motifs: motifsRes.data,
      ciels: cielsRes.data,
    });
  }

  onChange(cb: () => void): () => void {
    this.abonnes.add(cb);
    if (!this.canal) {
      // Canal unique : tout changement d'une table d'AFFICHAGE déclenche un
      // rafraîchissement complet. La table `ecrans` en est exclue : ses
      // écritures sont des heartbeats (6 écrans toutes les 30 s) et
      // provoqueraient un rechargement en boucle chez tous les clients.
      let canal = this.client.channel('tmb');
      for (const table of TABLES_AFFICHAGE) {
        canal = canal.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
          this.notifie(),
        );
      }
      this.canal = canal.subscribe();
      // Repli polling 30 s si le temps réel est indisponible
      window.setInterval(() => this.notifie(), 30_000);
    }
    return () => {
      this.abonnes.delete(cb);
    };
  }

  private notifie(): void {
    // Les grilles ont pu changer (import, activation) : la prochaine lecture
    // relit leurs métadonnées — requête légère, le contenu d'une version déjà
    // connue restant en mémoire.
    this.grilles = null;
    if (this.notifieId !== null) return; // anti-rafale : au plus 1 refresh / 300 ms
    this.notifieId = window.setTimeout(() => {
      this.notifieId = null;
      for (const cb of this.abonnes) cb();
    }, 300);
  }

  async heartbeat(e: EcranInfo): Promise<ReglagesPoste> {
    // UPDATE seulement : l'INSERT anonyme est interdit (les postes sont
    // pré-déclarés). Seules les colonnes du signal de vie sont envoyées —
    // les autres sont refusées par les GRANT de colonnes.
    const { data, error } = await this.client
      .from('ecrans')
      .update({
        // RÉÉCRITE par le serveur (déclencheur trg_signal_de_vie) : toute
        // écriture qui modifie derniere_vue voit sa valeur remplacée par
        // now(). L'horloge d'un Raspberry n'entre plus dans le calcul de
        // fraîcheur, et un signal ne peut être ni antidaté ni postdaté.
        // On garde malgré tout le champ dans l'update : c'est lui qui
        // déclenche l'horodatage, le retirer laisserait la colonne hors du
        // UPDATE — et le déclencheur, conditionnel, ne ferait rien.
        derniere_vue: new Date().toISOString(),
        donnees_maj: e.donnees_maj ?? null,
        date_affichee: e.date_affichee ?? null,
        version_app: e.version_app ?? null,
        reseau: e.reseau ?? null,
      })
      .eq('id', e.id)
      .select('recharger_demande_at, veille_debut, veille_fin, vitesse_ticker_px_s');
    verifie(error);
    const lignes = (data ?? []) as {
      recharger_demande_at: string | null;
      veille_debut: string | null;
      veille_fin: string | null;
      vitesse_ticker_px_s: number | null;
    }[];
    if (lignes.length === 0) {
      throw new Error(
        `Écran « ${e.id} » non déclaré en supervision : son signal de vie n'est enregistré nulle part`,
      );
    }
    // Rechargement demandé APRÈS le chargement de cette page : on obéit une
    // fois. Rien à réécrire, donc aucune boucle possible.
    const demande = lignes[0]?.recharger_demande_at;
    if (demande && new Date(demande).getTime() > this.chargeeA) window.location.reload();

    const ligne = lignes[0];
    return {
      vitesse_ticker_px_s: ligne?.vitesse_ticker_px_s ?? null,
      veille:
        ligne?.veille_debut && ligne.veille_fin
          ? { debut: ligne.veille_debut.slice(0, 5), fin: ligne.veille_fin.slice(0, 5) }
          : null,
    };
  }

  async saveVitesseEcran(id: string, px_s: number | null): Promise<void> {
    exigeLignes(
      await this.client.from('ecrans').update({ vitesse_ticker_px_s: px_s }).eq('id', id).select(),
      'écran inconnu',
    );
  }

  async declareEcran(e: Pick<EcranInfo, 'id' | 'gare' | 'type'>): Promise<void> {
    exigeLignes(
      await this.client
        .from('ecrans')
        .insert({ id: e.id, gare: e.gare, type: e.type ?? null })
        .select(),
      'déclaration refusée',
    );
  }

  // -------------------------------------------------------------- supervision

  async signIn(email: string, mdp: string): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password: mdp });
    if (error || !data.user) throw new Error(error?.message ?? 'Connexion refusée');
    this.profilCache = null; // le profil du compte précédent ne vaut plus rien
    return { user_id: data.user.id, email: data.user.email ?? email };
  }

  /**
   * Ferme la session (E-01) et oublie le profil mémorisé.
   *
   * `scope: 'local'` : on ferme la session de CE poste, pas celles des autres.
   * Un agent qui quitte la supervision d'une gare ne doit pas déconnecter son
   * collègue d'une autre — et le poste de gare peut être partagé.
   *
   * L'oubli du cache est fait AVANT l'appel réseau : même si `signOut`
   * échoue, faute de réseau par exemple, le profil du compte précédent ne
   * traîne plus en mémoire. C'est la moitié qui ne dépend de personne.
   */
  async signOut(): Promise<void> {
    this.profilCache = null;
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    verifie(error);
  }

  async getProfil(): Promise<Profil> {
    if (this.profilCache) return this.profilCache;
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new Error('Session expirée');
    // Les rôles arrivent par jointure (clé étrangère profils_roles → profils) :
    // une seule requête, une seule source de vérité.
    const { data, error } = await this.client
      .from('profils')
      .select('nom, email, actif, profils_roles(role)')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    verifie(error);
    const profil = data as {
      nom: string;
      email: string;
      actif: boolean;
      profils_roles: { role: Role }[] | null;
    } | null;
    if (!profil?.actif) throw new Error('Profil inactif ou absent');
    this.profilCache = {
      user_id: auth.user.id,
      nom: profil.nom,
      // L'e-mail du profil fait foi ; celui du compte Auth n'est qu'un repli.
      email: profil.email ?? auth.user.email ?? '',
      roles: ordonneRoles((profil.profils_roles ?? []).map((r) => r.role)),
    };
    return this.profilCache;
  }

  /** Les rôles viennent du profil : une seule requête, une seule source de vérité. */
  async getRoles(): Promise<Role[]> {
    return (await this.getProfil()).roles;
  }

  /**
   * Relit le profil et ses rôles depuis la base. La supervision s'en sert à
   * chaque rafraîchissement : un rôle retiré pendant la session doit se voir
   * dans l'interface, et pas seulement être refusé par la base au premier clic.
   */
  async rafraichitProfil(): Promise<Profil> {
    this.profilCache = null;
    return this.getProfil();
  }

  async genererJour(date: string): Promise<void> {
    const grilles = await this.getGrilles();
    const grille = serviceActif(grilles, date);
    if (!grille) throw new Error('Aucun service ne circule à cette date');
    const jour = generationJour(grille, date);
    // REPORT DE LA VEILLE : un chantier dure des semaines, et une journée
    // créée sur la ligne complète afficherait des trains qui ne circulent
    // pas — un voyageur attendrait à une gare fermée. Le report ne s'applique
    // qu'à la CRÉATION (`ignoreDuplicates`), et reste modifiable ensuite.
    const veille = await this.client
      .from('jours')
      .select('*')
      .eq('date', datePrecedente(date))
      .maybeSingle();
    verifie(veille.error);
    const ligneVeille = veille.data as LigneJour | null;
    const reportee = ligneVeille ? sectionReportee({ ...jour, ...versSection(ligneVeille) }) : null;
    // Idempotent : n'écrase JAMAIS une ligne déjà présente/modifiée
    const jours = await this.client
      .from('jours')
      .upsert(
        { date, grille_version: grille.version, ...(reportee ?? {}) },
        { onConflict: 'date', ignoreDuplicates: true },
      );
    verifie(jours.error);
    const circulations = await this.client
      .from('circulations')
      .upsert(jour.circulations, { onConflict: 'date,numero', ignoreDuplicates: true });
    verifie(circulations.error);
  }

  async reinitialiseJour(date: string): Promise<void> {
    // Retour à l'horaire théorique : suppression de la journée (les
    // circulations suivent par cascade) puis régénération depuis la grille.
    // `.select()` + exigeLignes : une politique RLS ne lève pas, elle FILTRE —
    // sans ce contrôle, un agent non habilité verrait « journée réinitialisée »
    // alors que rien n'aurait bougé (bug exploitant du 25/08/2026).
    exigeLignes(
      await this.client.from('jours').delete().eq('date', date).select('date'),
      'journée absente, ou réinitialisation non autorisée pour vos rôles',
    );
    this.joursAssures.delete(date);
    await this.genererJour(date);
    this.joursAssures.add(date);
  }

  async saveCirculation(c: Circulation): Promise<void> {
    await this.assureJour(c.date);
    const resultat = await this.client
      .from('circulations')
      .upsert(c, { onConflict: 'date,numero' })
      .select();
    exigeLignes(resultat, 'journée absente en base');
  }

  async saveCirculations(cs: Circulation[]): Promise<void> {
    if (cs.length === 0) return;
    for (const date of new Set(cs.map((c) => c.date))) await this.assureJour(date);
    const resultat = await this.client
      .from('circulations')
      .upsert(cs, { onConflict: 'date,numero' })
      .select();
    exigeLignes(resultat, 'journée absente en base');
    // Une écriture partielle (RLS, ligne disparue) ne doit JAMAIS passer pour
    // un succès : l'agent croirait la journée entière traitée.
    const ecrites = resultat.data?.length ?? 0;
    if (ecrites !== cs.length) {
      throw new Error(
        `Modification incomplète — ${ecrites} train(s) enregistré(s) sur ${cs.length} : rechargez la page et vérifiez`,
      );
    }
  }

  /**
   * Bascule de plage : pré-remplit la colonne Terminus des rotations
   * concernées et LIBÈRE celles qui sortent de la plage (décocher ou
   * rétrécir doit rétablir le service jusqu'au Nid d'Aigle — sinon
   * l'exploitant décoche et rien ne change à l'écran).
   */
  async creerTrainSup(date: string, montee: Circulation, descente: Circulation): Promise<void> {
    await this.assureJour(date);
    const resultat = await this.client
      .from('circulations')
      .upsert([montee, descente], { onConflict: 'date,numero' })
      .select();
    exigeLignes(resultat, 'journée absente en base');
    if ((resultat.data?.length ?? 0) !== 2) {
      throw new Error(
        `Train supplémentaire incomplet — ${resultat.data?.length ?? 0} circulation(s) sur 2 enregistrée(s)`,
      );
    }
  }

  async confirmerDepartSup(
    date: string,
    numeroDescente: number,
    departReel: string,
    passages: PassageGrille[],
  ): Promise<void> {
    // Garde-fou identique aux autres écritures de renfort : on ne touche
    // qu'une DESCENTE supplémentaire. Un train de grille n'a pas de départ à
    // constater, ses heures viennent du document d'exploitation.
    const { data, error } = await this.client
      .from('circulations')
      .select('numero, sens, nature')
      .eq('date', date)
      .eq('numero', numeroDescente)
      .maybeSingle();
    verifie(error);
    const ligne = data as { sens: Sens; nature: NatureCirculation } | null;
    if (!ligne) throw new Error(`TRAIN ${numeroDescente} introuvable au ${date}`);
    if (!horsGrille(ligne) || ligne.sens !== 'descente') {
      throw new Error(
        `TRAIN ${numeroDescente} n'est pas une descente supplémentaire : départ réel refusé`,
      );
    }
    exigeLignes(
      await this.client
        .from('circulations')
        .update({ depart_reel: departReel, passages })
        .eq('date', date)
        .eq('numero', numeroDescente)
        .select(),
      'descente supplémentaire introuvable',
    );
  }

  async supprimerTrainSup(date: string, numeroMontee: number): Promise<void> {
    // Garde-fou : on ne supprime QUE des trains supplémentaires. Un train de
    // grille se met au statut « supprimé », il ne disparaît pas de la journée.
    const { data, error } = await this.client
      .from('circulations')
      .select('numero, nature')
      .eq('date', date)
      .in('numero', [numeroMontee, numeroMontee + 1]);
    verifie(error);
    const lignes = (data ?? []) as { numero: number; nature: NatureCirculation }[];
    if (lignes.length === 0) throw new Error(`TRAIN ${numeroMontee} introuvable au ${date}`);
    if (lignes.some((l) => !horsGrille(l))) {
      throw new Error(
        `TRAIN ${numeroMontee} n'est pas un train supplémentaire : suppression refusée`,
      );
    }
    exigeLignes(
      await this.client
        .from('circulations')
        .delete()
        .eq('date', date)
        .in('numero', [numeroMontee, numeroMontee + 1])
        .select(),
      'train supplémentaire introuvable',
    );
  }

  async setSectionJour(date: string, section: SectionJour): Promise<void> {
    await this.assureJour(date);
    const resultat = await this.client
      .from('jours')
      .update({
        gare_debut: section.gare_debut,
        gare_fin: section.gare_fin,
        // Message vide → NULL : le défaut bilingue construit sur la section
        // reprend alors la main côté écran.
        message_troncon_fr: section.message_troncon_fr?.trim() || null,
        message_troncon_en: section.message_troncon_en?.trim() || null,
      })
      .eq('date', date)
      .select();
    exigeLignes(resultat, 'journée absente en base');
  }

  /**
   * Bascule « Terminus Bellevue à partir du TRAIN N » (M-21).
   *
   * La bascule est un PRÉ-REMPLISSAGE de la colonne Terminus, pas une source
   * de vérité : « la colonne reste prioritaire et ajustable » (docs/01 §2.3,
   * CLAUDE.md). Elle ne touche donc QUE les montées qui ENTRENT ou SORTENT de
   * la plage, calculées par différence avec la plage PRÉCÉDENTE.
   *
   * Avant, elle recalculait la colonne entière : libération de toutes les
   * montées limitées, puis re-pose de Bellevue sur les numéros ≥ seuil. Le
   * scénario, un matin de montagne ordinaire — mauvais temps au sommet,
   * « Terminus Bellevue à partir du TRAIN 1 », publié ; le temps se lève, on
   * ramène la plage au TRAIN 15 mais on laisse VOLONTAIREMENT le TRAIN 11
   * limité, geste que l'interface propose explicitement. Le recalcul remettait
   * le TRAIN 11 au Nid d'Aigle : il était annoncé « Nid d'Aigle » sur les six
   * écrans alors qu'il s'arrête à Bellevue, et des voyageurs restaient à bord
   * pour un tronçon qui ne circule pas ce jour-là.
   *
   * Conséquence utile de la différence : réappliquer la MÊME plage n'écrit
   * plus rien du tout, donc ne peut plus effacer un geste de l'agent.
   */
  /**
   * ACCÈS d'une course — PAR APPEL DE FONCTION, jamais par un update direct.
   *
   * C'est le point de sécurité du lot, et il tient à une propriété de
   * PostgreSQL qu'il vaut mieux écrire que redécouvrir : `admin`,
   * `supervision` et `caisse` sont le MÊME rôle PostgreSQL, `authenticated` —
   * la distinction est applicative (`profils_roles`, `private.a_le_role()`).
   * Un `grant update (acces)` ne saurait donc pas viser l'un d'eux, et une
   * politique RLS, qui filtre des LIGNES, ne sait pas borner les COLONNES
   * écrites. Une politique « admin peut modifier une circulation de grille »
   * lui ouvrirait du même coup `statut`, `retard_min`, `terminus` et
   * `passages`.
   *
   * `public.definir_acces` est SECURITY DEFINER : elle vérifie elle-même le
   * rôle applicatif et n'écrit que `acces` et `commanditaire`. Aucune
   * politique RLS nouvelle n'est posée sur `circulations` — admin n'y gagne
   * pas une ligne de plus.
   */
  async setAccesCourse(
    date: string,
    numero: number,
    acces: AccesCourse,
    commanditaire: string | null,
  ): Promise<void> {
    const { data, error } = await this.client.rpc('definir_acces', {
      p_date: date,
      p_numero: numero,
      p_acces: acces,
      p_commanditaire: commanditaire,
    });
    verifie(error);
    // La fonction rend le nombre de lignes touchées. Zéro n'est PAS un succès
    // silencieux : la circulation a disparu, ou la journée n'est pas celle
    // qu'on croit. Sans ce contrôle, l'agent verrait « privatisé » sur une
    // ligne que personne n'a écrite — c'est la leçon de `saveCirculations`.
    if (data !== 1) {
      throw new Error(
        `Accès non enregistré pour le train ${numero} du ${date} — rechargez la page et vérifiez`,
      );
    }
  }

  async setTerminusBellevue(date: string, v: TerminusFlag): Promise<void> {
    await this.assureJour(date);

    /** Numéro de MONTÉE : un pair vise la montée de sa rotation (N − 1). */
    const normalise = (n: number): number => Math.max(1, n % 2 === 0 ? n - 1 : n);
    // `null` = pas de plage.
    const seuil = v === false ? null : normalise(v.a_partir_du_train);

    // Plage PRÉCÉDENTE, lue avant de l'écraser : c'est elle qui dit ce qui
    // entre et ce qui sort. Sans elle, on ne sait pas distinguer une montée
    // limitée par l'ancienne plage d'une montée limitée à la main.
    const avant = await this.client
      .from('jours')
      .select('terminus_bellevue_a_partir_du_train')
      .eq('date', date)
      .maybeSingle();
    verifie(avant.error);
    const brut = (avant.data as { terminus_bellevue_a_partir_du_train: number | null } | null)
      ?.terminus_bellevue_a_partir_du_train;
    const ancien = typeof brut === 'number' ? normalise(brut) : null;

    const resultat = await this.client
      .from('jours')
      .update({ terminus_bellevue_a_partir_du_train: seuil })
      .eq('date', date)
      .select();
    exigeLignes(resultat, 'journée absente en base');

    // RESTREINDRE d'abord, LIBÉRER ensuite. Les deux ensembles sont disjoints,
    // donc l'ordre ne change pas l'état final — seulement l'état INTERMÉDIAIRE
    // si la seconde écriture échoue. Restreindre en premier fait que cet
    // intermédiaire limite TROP (un train annoncé Bellevue qui monte en réalité
    // au Nid d'Aigle) au lieu de limiter TROP PEU (un train annoncé Nid d'Aigle
    // qui s'arrête à Bellevue, avec des voyageurs qui restent à bord pour un
    // tronçon fermé). Même principe que la section écrite avant la bascule.

    // ENTRENT dans la plage : [seuil, ancien) — élargissement.
    if (seuil !== null && (ancien === null || seuil < ancien)) {
      let entrent = this.client
        .from('circulations')
        .update({ terminus: 'bellevue' })
        .eq('date', date)
        .eq('sens', 'montee')
        .gte('numero', seuil);
      if (ancien !== null) entrent = entrent.lt('numero', ancien);
      // 0 ligne est normal : la plage peut ne couvrir aucun train de la grille.
      verifie((await entrent).error);
    }

    // SORTENT de la plage : [ancien, seuil) — rétrécissement. Décocher, lui,
    // libère TOUT : c'est une décision explicite (« plus aucune limitation
    // aujourd'hui »), et laisser une montée limitée que la bascule n'indique
    // plus serait pire que d'effacer un réglage manuel.
    const libere = v === false || (ancien !== null && seuil !== null && seuil > ancien);
    if (libere) {
      let sortent = this.client
        .from('circulations')
        .update({ terminus: 'nid-daigle' })
        .eq('date', date)
        .eq('sens', 'montee')
        .eq('terminus', 'bellevue');
      if (v !== false) {
        if (ancien !== null) sortent = sortent.gte('numero', ancien);
        if (seuil !== null) sortent = sortent.lt('numero', seuil);
      }
      verifie((await sortent).error); // 0 ligne est normal : rien n'était limité
    }
  }

  async saveMessage(m: Message): Promise<void> {
    const { id, ...reste } = m;
    const resultat = id
      ? await this.client.from('messages').update(reste).eq('id', id).select()
      : await this.client.from('messages').insert(reste).select();
    exigeLignes(resultat, 'message introuvable ou écriture refusée');
  }

  async deleteMessage(id: string): Promise<void> {
    verifie((await this.client.from('messages').delete().eq('id', id)).error);
  }

  async uploadMedia(file: File, meta: MediaMeta): Promise<void> {
    const chemin = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const stockage = await this.client.storage.from('medias').upload(chemin, file);
    if (stockage.error) throw new Error(stockage.error.message);
    // Un média fraîchement envoyé passe en DERNIER : l'exploitant remonte
    // ensuite ce qu'il veut, plutôt que de voir un nouvel arrivant s'insérer
    // au milieu d'une série réglée.
    const existants = await this.tousLesMedias();
    const maximum = existants.reduce((haut, m) => Math.max(haut, m.ordre ?? 0), 90);
    const { error } = await this.client
      .from('medias')
      .insert({ ...meta, ordre: maximum + 10, chemin, actif: true });
    verifie(error);
  }

  async saveMedia(m: Media): Promise<void> {
    const { id, url: _url, ...reste } = m;
    const resultat = await this.client.from('medias').update(reste).eq('id', id).select();
    exigeLignes(resultat, 'média introuvable ou écriture refusée');
  }

  async deleteMedia(id: string): Promise<void> {
    const { data } = await this.client.from('medias').select('chemin').eq('id', id).maybeSingle();
    verifie((await this.client.from('medias').delete().eq('id', id)).error);
    const chemin = (data as { chemin?: string } | null)?.chemin;
    if (chemin) await this.client.storage.from('medias').remove([chemin]);
  }

  async saveParams(p: Partial<Params>): Promise<void> {
    const entrees = Object.entries(p).filter(
      ([cle]) => !['machines', 'motifs', 'ciels'].includes(cle), // tables dédiées
    );
    for (const [cle, valeur] of entrees) {
      exigeLignes(
        await this.client.from('params').upsert({ cle, valeur }).select(),
        `paramètre ${cle} refusé (droits insuffisants ?)`,
      );
    }
  }

  async saveMachine(m: Machine): Promise<void> {
    exigeLignes(
      await this.client.from('machines').upsert(m).select(),
      'machine refusée (droits insuffisants ?)',
    );
  }

  async deleteMachine(nom: string): Promise<void> {
    verifie((await this.client.from('machines').delete().eq('nom', nom)).error);
  }

  async saveMotif(m: Motif): Promise<void> {
    exigeLignes(
      await this.client.from('motifs').upsert(m).select(),
      'motif refusé (droits insuffisants ?)',
    );
  }

  async getModelesMessages(): Promise<ModeleMessage[]> {
    const { data, error } = await this.client
      .from('modeles_messages')
      .select('*')
      .order('ordre')
      .order('titre');
    verifie(error);
    return (data ?? []) as ModeleMessage[];
  }

  async saveModeleMessage(m: ModeleMessage): Promise<void> {
    const { id, ...reste } = m;
    const resultat = id
      ? await this.client.from('modeles_messages').update(reste).eq('id', id).select()
      : await this.client.from('modeles_messages').insert(reste).select();
    exigeLignes(resultat, 'modèle refusé (droits administrateur requis ?)');
  }

  async deleteModeleMessage(id: string): Promise<void> {
    exigeLignes(
      await this.client.from('modeles_messages').delete().eq('id', id).select(),
      'modèle introuvable ou droits insuffisants',
    );
  }

  async deleteMotif(fr: string): Promise<void> {
    verifie((await this.client.from('motifs').delete().eq('fr', fr)).error);
  }

  async saveCiel(c: Ciel): Promise<void> {
    exigeLignes(
      await this.client.from('ciels').upsert(c).select(),
      'état du ciel refusé (droits insuffisants ?)',
    );
  }

  async deleteCiel(fr: string): Promise<void> {
    verifie((await this.client.from('ciels').delete().eq('fr', fr)).error);
  }

  async listUsers(): Promise<User[]> {
    const { data, error } = await this.client
      .from('profils')
      .select('user_id, nom, email, actif, profils_roles(role)')
      .order('nom');
    verifie(error);
    const lignes = (data ?? []) as {
      user_id: string;
      nom: string;
      email: string;
      actif: boolean;
      profils_roles: { role: Role }[] | null;
    }[];
    return lignes.map((l) => ({
      user_id: l.user_id,
      nom: l.nom,
      email: l.email,
      actif: l.actif,
      roles: ordonneRoles((l.profils_roles ?? []).map((r) => r.role)),
    }));
  }

  /** Nom et activation UNIQUEMENT : les rôles passent par setRolesUser(). */
  async saveUser(u: User): Promise<void> {
    exigeLignes(
      await this.client
        .from('profils')
        .update({ nom: u.nom, actif: u.actif })
        .eq('user_id', u.user_id)
        .select(),
      'profil introuvable ou écriture refusée',
    );
  }

  async setRolesUser(user_id: string, roles: Role[]): Promise<void> {
    const { data, error } = await this.client
      .from('profils_roles')
      .select('role')
      .eq('user_id', user_id);
    verifie(error);
    const actuels = ((data ?? []) as { role: Role }[]).map((r) => r.role);
    const aAjouter = roles.filter((r) => !actuels.includes(r));
    const aRetirer = actuels.filter((r) => !roles.includes(r));

    // ATTRIBUER D'ABORD, RETIRER ENSUITE. La base refuse de laisser un rôle
    // protégé sans détenteur actif ; l'ordre inverse ferait échouer tout
    // échange (« retirer technique à A pour le donner à B »).
    if (aAjouter.length > 0) {
      exigeLignes(
        await this.client
          .from('profils_roles')
          .insert(aAjouter.map((role) => ({ user_id, role })))
          .select(),
        'attribution refusée : vous n’êtes pas habilité à donner ce rôle',
        aAjouter.length,
      );
    }
    for (const role of aRetirer) {
      exigeLignes(
        await this.client
          .from('profils_roles')
          .delete()
          .eq('user_id', user_id)
          .eq('role', role)
          .select(),
        `retrait du rôle « ${role} » refusé`,
      );
    }
  }

  /**
   * Onglets visibles par rôle. Rend `null` — et NON un objet vide — dès que le
   * réglage est indisponible : table absente sur une base d'avant la migration,
   * requête en échec, ou table vide. L'appelant retombe alors sur la matrice du
   * code, jamais sur « aucun onglet » : l'exploitation ne doit pas se retrouver
   * devant une supervision aveugle parce qu'une table manque.
   */
  async getOngletsParRole(): Promise<VisibiliteOnglets> {
    const { data, error } = await this.client.from('onglets_par_role').select('role, onglet');
    if (error || !data || data.length === 0) return null;
    const parRole: Partial<Record<Role, Onglet[]>> = {};
    for (const ligne of data as { role: Role; onglet: Onglet }[]) {
      (parRole[ligne.role] ??= []).push(ligne.onglet);
    }
    return parRole;
  }

  /**
   * Un geste = une ligne. Accorder est un INSERT, masquer un DELETE : deux
   * politiques distinctes, deux lignes de journal. Le refus du dernier accès à
   * l'onglet Utilisateurs vient du déclencheur DIFFÉRÉ — il tombe donc au
   * COMMIT, avec son propre message, que l'on laisse remonter tel quel.
   */
  async setOngletRole(role: Role, onglet: Onglet, visible: boolean): Promise<void> {
    if (visible) {
      exigeLignes(
        await this.client.from('onglets_par_role').insert({ role, onglet }).select(),
        `l’onglet « ${onglet} » n’a pas pu être rendu au rôle « ${role} »`,
      );
      return;
    }
    exigeLignes(
      await this.client
        .from('onglets_par_role')
        .delete()
        .eq('role', role)
        .eq('onglet', onglet)
        .select(),
      `l’onglet « ${onglet} » n’a pas pu être masqué pour le rôle « ${role} »`,
    );
  }

  async deleteUser(user_id: string): Promise<void> {
    // La suppression exige la clé secrète : Edge Function côté Supabase.
    const { error } = await this.client.functions.invoke('supprimer-utilisateur', {
      body: { user_id },
    });
    if (error) throw new Error(error.message);
  }

  /**
   * Adresse de retour des liens envoyés par e-mail : CETTE page de
   * supervision (production ou serveur de développement), qui sait accueillir
   * la personne et lui faire choisir un mot de passe. Doit figurer dans les
   * « Redirect URLs » du projet Supabase (docs/mise-en-service.md), sinon
   * Supabase retombe sur sa « Site URL ».
   */
  private static urlRetourAuth(): string {
    return `${window.location.origin}${window.location.pathname}`;
  }

  async inviteUser(email: string, nom: string, roles: Role[]): Promise<void> {
    // La création de compte exige la clé secrète : Edge Function côté Supabase.
    const { error } = await this.client.functions.invoke('inviter-utilisateur', {
      body: { email, nom, roles, redirectTo: SupabaseProvider.urlRetourAuth() },
    });
    if (error) throw new Error(error.message);
  }

  async resetMotDePasse(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: SupabaseProvider.urlRetourAuth(),
    });
    if (error) throw new Error(error.message);
  }

  async definirMotDePasse(mdp: string): Promise<void> {
    // La session a été ouverte par le jeton du lien (fragment d'URL lu par
    // le SDK au chargement) ; on fixe le mot de passe sur cette session.
    const { error } = await this.client.auth.updateUser({ password: mdp });
    if (error) throw new Error(traduitErreurMotDePasse(error.message));
    this.profilCache = null;
  }

  async traduire(texteFr: string): Promise<string | null> {
    try {
      const { data, error } = await this.client.functions.invoke('traduire', {
        body: { texte: texteFr },
      });
      if (error) return null;
      return (data as { texte_en?: string } | null)?.texte_en ?? null;
    } catch {
      return null; // repli : dictionnaire local
    }
  }

  async dernierePublication(): Promise<string | null> {
    const { data, error } = await this.client
      .from('publications')
      .select('quand')
      .order('quand', { ascending: false })
      .limit(1)
      .maybeSingle();
    verifie(error);
    return (data as { quand: string } | null)?.quand ?? null;
  }

  async listJournal(filtre: FiltreJournal): Promise<EntreeJournal[]> {
    let requete = this.client
      .from('journal_exploitation')
      .select('*')
      .order('quand', { ascending: false });
    if (filtre.du) requete = requete.gte('quand', `${filtre.du}T00:00:00Z`);
    if (filtre.au) requete = requete.lte('quand', `${filtre.au}T23:59:59Z`);
    if (filtre.qui) requete = requete.eq('qui', filtre.qui);
    if (filtre.table_cible) requete = requete.eq('table_cible', filtre.table_cible);
    const depuis = filtre.depuis ?? 0;
    const limite = filtre.limite ?? 100;
    const { data, error } = await requete.range(depuis, depuis + limite - 1);
    verifie(error);
    return (data ?? []) as EntreeJournal[];
  }

  async logPublication(resume: string): Promise<void> {
    const { data: auth } = await this.client.auth.getUser();
    verifie(
      (
        await this.client
          .from('publications')
          .insert({ resume, qui: auth.user?.email ?? 'inconnu' })
      ).error,
    );
  }

  async listEcrans(): Promise<EcranInfo[]> {
    const { data, error } = await this.client.from('ecrans').select('*').order('gare');
    verifie(error);
    return (data ?? []) as EcranInfo[];
  }

  async demanderRechargement(id: string): Promise<void> {
    exigeLignes(
      await this.client
        .from('ecrans')
        .update({ recharger_demande_at: new Date().toISOString() })
        .eq('id', id)
        .select(),
      'écran inconnu',
    );
  }

  async saveVeilleEcran(id: string, debut: string | null, fin: string | null): Promise<void> {
    exigeLignes(
      await this.client
        .from('ecrans')
        .update({ veille_debut: debut, veille_fin: fin })
        .eq('id', id)
        .select(),
      'écran inconnu',
    );
  }

  async oublierEcran(id: string): Promise<void> {
    exigeLignes(await this.client.from('ecrans').delete().eq('id', id).select(), 'écran inconnu');
  }
}

function dateAujourdhuiParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function versFlag(ligne: LigneJour): TerminusFlag {
  return ligne.terminus_bellevue_a_partir_du_train === null
    ? false
    : { a_partir_du_train: ligne.terminus_bellevue_a_partir_du_train };
}

/**
 * Section exploitée portée par la ligne `jours`. Les colonnes ont un défaut
 * en base, mais une ligne écrite avant la migration les rend nulles : on
 * retombe sur la ligne complète, et `sectionDuJour()` assainit ensuite.
 */
function versSection(ligne: LigneJour): SectionJour {
  return {
    gare_debut: ligne.gare_debut ?? GARE_DEBUT_DEFAUT,
    gare_fin: ligne.gare_fin ?? GARE_FIN_DEFAUT,
    message_troncon_fr: ligne.message_troncon_fr,
    message_troncon_en: ligne.message_troncon_en,
  };
}
