// SupabaseProvider (phase 1) — SEUL fichier du front qui parle à Supabase.
// Lecture publique par RLS (clé « publishable »), écritures réservées aux
// sessions authentifiées. Realtime : un canal unique + rafraîchissement
// complet, repli polling 30 s.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import { A_QUAI_ORIGINE_DEFAUT_S, generationJour, serviceActif } from '../core/horaires';
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
  Ciel,
  Profil,
  Params,
  Role,
  Session,
  TerminusFlag,
  User,
  EntreeJournal,
  FiltreJournal,
} from '../core/types';
import { VITESSE_TICKER_DEFAUT } from '../pages/ticker';
import type { DataProvider } from './provider';

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
  'messages',
  'medias',
  'params',
  'machines',
  'motifs',
  'ciels',
  'modeles_messages',
] as const;

interface LigneJour {
  date: string;
  grille_version: string;
  terminus_bellevue_a_partir_du_train: number | null;
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
): void {
  if (resultat.error) throw new Error(resultat.error.message);
  if (!resultat.data || resultat.data.length === 0) {
    throw new Error(`Modification non enregistrée — ${contexte}`);
  }
}

export class SupabaseProvider implements DataProvider {
  private readonly client: SupabaseClient;
  private grilles: Promise<Grille[]> | null = null;
  /** Heure de chargement de CETTE page : référence de l'ordre de rechargement. */
  private readonly chargeeA = Date.now();
  private canal: RealtimeChannel | null = null;
  private notifieId: number | null = null;
  private readonly abonnes = new Set<() => void>();

  constructor(url: string, clePubliable: string) {
    this.client = createClient(url, clePubliable);
  }

  // ------------------------------------------------------------------ lecture

  getGrilles(): Promise<Grille[]> {
    // Les grilles officielles restent des JSON statiques versionnés du dépôt.
    this.grilles ??= Promise.all(
      ['2026-ete-grand-service', '2026-ete-petit-service'].map(async (nom) => {
        const reponse = await fetch(`${import.meta.env.BASE_URL}grilles/${nom}.json`, {
          cache: 'no-store',
        });
        if (!reponse.ok) throw new Error(`Grille ${nom} introuvable (${reponse.status})`);
        return (await reponse.json()) as Grille;
      }),
    ).catch((erreur: unknown) => {
      // Sans cet oubli du cache, une promesse REJETÉE (démarrage hors ligne)
      // resterait mémorisée : plus aucune tentative au retour du réseau et
      // l'écran resterait figé sur l'écran neutre toute la journée.
      this.grilles = null;
      throw erreur;
    });
    return this.grilles;
  }

  async getJour(date: string): Promise<Jour> {
    const [grilles, jourRes, circRes] = await Promise.all([
      this.getGrilles(),
      this.client.from('jours').select('*').eq('date', date).maybeSingle(),
      this.client.from('circulations').select('*').eq('date', date).order('numero'),
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
      if (date >= dateAujourdhuiParis() && (await this.peutEcrireExploitation())) {
        await this.genererJour(date);
        this.joursAssures.add(date);
        const cree = generationJour(grille, date);
        if (ligne) cree.terminus_bellevue = versFlag(ligne);
        cree.enregistre = true;
        return cree;
      }
      // Date passée jamais exploitée (ou écran anonyme) : aperçu théorique,
      // rien n'est fabriqué en base (pas d'historique inventé).
      const defaut = generationJour(grille, date);
      if (ligne) defaut.terminus_bellevue = versFlag(ligne);
      defaut.enregistre = false;
      return defaut;
    }
    return {
      date,
      grille_version: ligne.grille_version,
      terminus_bellevue: versFlag(ligne),
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

  /** Rôle mémorisé pour éviter une requête à chaque getJour. */
  private roleCache: Role | null = null;
  private profilCache: Profil | null = null;

  /** true si une session ouverte peut écrire l'exploitation (admin ou supervision). */
  private async peutEcrireExploitation(): Promise<boolean> {
    const { data } = await this.client.auth.getSession(); // lecture locale, pas d'appel réseau
    if (!data.session) return false;
    try {
      this.roleCache ??= await this.getRole();
    } catch {
      return false; // profil absent ou inactif
    }
    return this.roleCache === 'admin' || this.roleCache === 'supervision';
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
    return {
      meteo_sommet: (valeurs.get('meteo_sommet') as Params['meteo_sommet']) ?? {
        t: 0,
        ciel_fr: '—',
        ciel_en: '—',
      },
      veille_nuit: (valeurs.get('veille_nuit') as Params['veille_nuit']) ?? {
        debut: '21:00',
        fin: '06:00',
      },
      duree_horaires_s: (valeurs.get('duree_horaires_s') as number) ?? 20,
      duree_cache_min: (valeurs.get('duree_cache_min') as number) ?? 15,
      mode_medias: (valeurs.get('mode_medias') as Params['mode_medias']) ?? 'alterne',
      a_quai_origine_s: (valeurs.get('a_quai_origine_s') as number) ?? A_QUAI_ORIGINE_DEFAUT_S,
      // Repli et bornes appliqués à l'affichage par vitesseTickerValide()
      vitesse_ticker_px_s: (valeurs.get('vitesse_ticker_px_s') as number) ?? VITESSE_TICKER_DEFAUT,
      machines: (machinesRes.data ?? []) as Machine[],
      motifs: (motifsRes.data ?? []) as Motif[],
      ciels: (cielsRes.data ?? []) as Ciel[],
    };
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
    if (this.notifieId !== null) return; // anti-rafale : au plus 1 refresh / 300 ms
    this.notifieId = window.setTimeout(() => {
      this.notifieId = null;
      for (const cb of this.abonnes) cb();
    }, 300);
  }

  async heartbeat(e: EcranInfo): Promise<{ debut: string; fin: string } | null> {
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
      .select('recharger_demande_at, veille_debut, veille_fin');
    verifie(error);
    const lignes = (data ?? []) as {
      recharger_demande_at: string | null;
      veille_debut: string | null;
      veille_fin: string | null;
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
    return ligne?.veille_debut && ligne.veille_fin
      ? { debut: ligne.veille_debut.slice(0, 5), fin: ligne.veille_fin.slice(0, 5) }
      : null;
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

  async getProfil(): Promise<Profil> {
    if (this.profilCache) return this.profilCache;
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new Error('Session expirée');
    const { data, error } = await this.client
      .from('profils')
      .select('nom, email, role, actif')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    verifie(error);
    const profil = data as { nom: string; email: string; role: Role; actif: boolean } | null;
    if (!profil?.actif) throw new Error('Profil inactif ou absent');
    this.profilCache = {
      user_id: auth.user.id,
      nom: profil.nom,
      // L'e-mail du profil fait foi ; celui du compte Auth n'est qu'un repli.
      email: profil.email ?? auth.user.email ?? '',
      role: profil.role,
    };
    return this.profilCache;
  }

  /** Le rôle vient du profil : une seule requête, une seule source de vérité. */
  async getRole(): Promise<Role> {
    return (await this.getProfil()).role;
  }

  async genererJour(date: string): Promise<void> {
    const grilles = await this.getGrilles();
    const grille = serviceActif(grilles, date);
    if (!grille) throw new Error('Aucun service ne circule à cette date');
    const jour = generationJour(grille, date);
    // Idempotent : n'écrase JAMAIS une ligne déjà présente/modifiée
    const jours = await this.client
      .from('jours')
      .upsert(
        { date, grille_version: grille.version },
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
    verifie((await this.client.from('jours').delete().eq('date', date)).error);
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

  async supprimerTrainSup(date: string, numeroMontee: number): Promise<void> {
    // Garde-fou : on ne supprime QUE des trains supplémentaires. Un train de
    // grille se met au statut « supprimé », il ne disparaît pas de la journée.
    const { data, error } = await this.client
      .from('circulations')
      .select('numero, supplementaire')
      .eq('date', date)
      .in('numero', [numeroMontee, numeroMontee + 1]);
    verifie(error);
    const lignes = (data ?? []) as { numero: number; supplementaire: boolean }[];
    if (lignes.length === 0) throw new Error(`TRAIN ${numeroMontee} introuvable au ${date}`);
    if (lignes.some((l) => !l.supplementaire)) {
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

  async setTerminusBellevue(date: string, v: TerminusFlag): Promise<void> {
    await this.assureJour(date);
    const resultat = await this.client
      .from('jours')
      .update({
        terminus_bellevue_a_partir_du_train: v === false ? null : v.a_partir_du_train,
      })
      .eq('date', date)
      .select();
    exigeLignes(resultat, 'journée absente en base');

    const seuil =
      v === false
        ? Number.POSITIVE_INFINITY // tout est libéré
        : Math.max(
            1,
            v.a_partir_du_train % 2 === 0 ? v.a_partir_du_train - 1 : v.a_partir_du_train,
          );

    // Libération des montées hors plage (retour au Nid d'Aigle)
    const liberation = await this.client
      .from('circulations')
      .update({ terminus: 'nid-daigle' })
      .eq('date', date)
      .eq('sens', 'montee')
      .eq('terminus', 'bellevue');
    verifie(liberation.error); // 0 ligne est normal ici : rien n'était limité

    if (v !== false) {
      // Pré-remplissage de la colonne Terminus des rotations concernées
      // (docs/01 §2.3) — la colonne reste ajustable ensuite.
      const maj = await this.client
        .from('circulations')
        .update({ terminus: 'bellevue' })
        .eq('date', date)
        .eq('sens', 'montee')
        .gte('numero', seuil)
        .select();
      exigeLignes(maj, 'journée absente en base');
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
    const { data, error } = await this.client.from('profils').select('*').order('nom');
    verifie(error);
    return (data ?? []) as User[];
  }

  async saveUser(u: User): Promise<void> {
    exigeLignes(
      await this.client
        .from('profils')
        .update({ nom: u.nom, role: u.role, actif: u.actif })
        .eq('user_id', u.user_id)
        .select(),
      'profil introuvable ou écriture refusée',
    );
  }

  async deleteUser(user_id: string): Promise<void> {
    // La suppression exige la clé secrète : Edge Function côté Supabase.
    const { error } = await this.client.functions.invoke('supprimer-utilisateur', {
      body: { user_id },
    });
    if (error) throw new Error(error.message);
  }

  async inviteUser(email: string, nom: string, role: Role): Promise<void> {
    // La création de compte exige la clé secrète : Edge Function côté Supabase.
    const { error } = await this.client.functions.invoke('inviter-utilisateur', {
      body: { email, nom, role },
    });
    if (error) throw new Error(error.message);
  }

  async resetMotDePasse(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
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
