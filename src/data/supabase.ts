// SupabaseProvider (phase 1) — SEUL fichier du front qui parle à Supabase.
// Lecture publique par RLS (clé « publishable »), écritures réservées aux
// sessions authentifiées. Realtime : un canal unique + rafraîchissement
// complet, repli polling 30 s.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import { generationJour, serviceActif } from '../core/horaires';
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
import type { DataProvider } from './provider';

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
    const { data, error } = await this.client.from('medias').select('*').order('cree_le');
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
    const [paramsRes, machinesRes, motifsRes] = await Promise.all([
      this.client.from('params').select('cle, valeur'),
      this.client.from('machines').select('*').order('nom'),
      this.client.from('motifs').select('*').order('fr'),
    ]);
    verifie(paramsRes.error);
    verifie(machinesRes.error);
    verifie(motifsRes.error);
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
      machines: (machinesRes.data ?? []) as Machine[],
      motifs: (motifsRes.data ?? []) as Motif[],
    };
  }

  onChange(cb: () => void): () => void {
    this.abonnes.add(cb);
    if (!this.canal) {
      // Canal unique : tout changement déclenche un rafraîchissement complet.
      this.canal = this.client
        .channel('tmb')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => this.notifie())
        .subscribe();
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

  async heartbeat(e: EcranInfo): Promise<void> {
    const { error } = await this.client.from('ecrans').upsert({
      id: e.id,
      gare: e.gare,
      type: e.type ?? null,
      derniere_vue: new Date().toISOString(),
      version_app: e.version_app ?? null,
      reseau: e.reseau ?? null,
    });
    verifie(error);
    const { data } = await this.client
      .from('ecrans')
      .select('recharger')
      .eq('id', e.id)
      .maybeSingle();
    if ((data as { recharger?: boolean } | null)?.recharger) {
      await this.client.from('ecrans').update({ recharger: false }).eq('id', e.id);
      window.location.reload();
    }
  }

  // -------------------------------------------------------------- supervision

  async signIn(email: string, mdp: string): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password: mdp });
    if (error || !data.user) throw new Error(error?.message ?? 'Connexion refusée');
    return { user_id: data.user.id, email: data.user.email ?? email };
  }

  async getRole(): Promise<Role> {
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new Error('Session expirée');
    const { data, error } = await this.client
      .from('profils')
      .select('role, actif')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    verifie(error);
    const profil = data as { role: Role; actif: boolean } | null;
    if (!profil?.actif) throw new Error('Profil inactif ou absent');
    return profil.role;
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

  /**
   * Bascule de plage : pré-remplit la colonne Terminus des rotations
   * concernées et LIBÈRE celles qui sortent de la plage (décocher ou
   * rétrécir doit rétablir le service jusqu'au Nid d'Aigle — sinon
   * l'exploitant décoche et rien ne change à l'écran).
   */
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
    const { error } = await this.client.from('medias').insert({ ...meta, chemin, actif: true });
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
      ([cle]) => !['machines', 'motifs'].includes(cle), // tables dédiées
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

  async deleteMotif(fr: string): Promise<void> {
    verifie((await this.client.from('motifs').delete().eq('fr', fr)).error);
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
      await this.client.from('ecrans').update({ recharger: true }).eq('id', id).select(),
      'écran inconnu',
    );
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
