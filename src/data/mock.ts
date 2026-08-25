// DataProvider factice — démo complète SANS Supabase : l'état d'exploitation
// (circulations modifiées, terminus, messages, paramètres, médias, écrans)
// vit dans localStorage et se propage entre onglets (événement `storage`) :
// une modification en supervision mock apparaît sur les écrans mock < 2 s.
// Démo par défaut (maquette validée) : facultatifs 3/4/9/10/17/18 activés,
// retard +10 min (Météo) sur le TRAIN 11, descente 16 supprimée (Météo).
// Paramètre d'URL écran : ?terminus=N (bascule « à partir du TRAIN N »).
// Connexion mock : le début de l'email fixe le rôle (admin… → admin,
// caisse… → caisse, sinon supervision) ; mot de passe libre.
import { appliqueTerminusBellevue, generationJour, serviceActif } from '../core/horaires';
import type {
  Circulation,
  EcranInfo,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  Message,
  MediaMeta,
  Motif,
  Params,
  Role,
  Session,
  TerminusFlag,
  User,
} from '../core/types';
import type { DataProvider } from './provider';

const CLE_ETAT = 'tmb-mock-etat';
const CLE_SESSION = 'tmb-mock-session';
const EVENEMENT_LOCAL = 'tmb-mock-change';

const FACULTATIFS_ACTIVES = [3, 4, 9, 10, 17, 18];

const MESSAGES_DEMO: Message[] = [
  {
    id: 'demo-1',
    texte_fr: 'Réservation obligatoire pour tous les trajets — pensez à réserver votre descente.',
    texte_en: 'Booking is compulsory for all journeys — remember to book your descent.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
  {
    id: 'demo-2',
    texte_fr: 'Restez derrière la ligne jaune à l’approche du train.',
    texte_en: 'Please stand behind the yellow line when the tram approaches.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
  {
    id: 'demo-3',
    texte_fr: 'Trains vélos : transport limité à 5 vélos, selon affluence.',
    texte_en: 'Bike trains: limited to 5 bikes, subject to capacity.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
];

const PARAMS_DEMO: Params = {
  meteo_sommet: { t: 9, ciel_fr: 'Dégagé', ciel_en: 'Clear' },
  veille_nuit: { debut: '21:00', fin: '06:00' },
  duree_horaires_s: 20,
  duree_cache_min: 15,
  machines: [
    { nom: 'Marie', couleur: '#2E74B5', en_service: true },
    { nom: 'Anne', couleur: '#7FA51E', en_service: true },
    { nom: 'Jeanne', couleur: '#C2447A', en_service: true },
    { nom: 'Marguerite', couleur: '#FFFFFF', cercle: '#E52A23', en_service: true },
  ],
  motifs: [
    { fr: 'Météo', en: 'Weather' },
    { fr: 'Croisement', en: 'Crossing' },
    { fr: 'Technique', en: 'Technical issue' },
    { fr: 'Affluence', en: 'High demand' },
    { fr: 'Exploitation', en: 'Operations' },
  ],
};

const UTILISATEURS_DEMO: User[] = [
  { user_id: 'demo-admin', nom: 'Thomas (démo)', email: 'admin@demo', role: 'admin', actif: true },
  {
    user_id: 'demo-sup',
    nom: 'Supervision (démo)',
    email: 'supervision@demo',
    role: 'supervision',
    actif: true,
  },
  {
    user_id: 'demo-caisse',
    nom: 'Caisse (démo)',
    email: 'caisse@demo',
    role: 'caisse',
    actif: true,
  },
];

/** État persistant partagé entre onglets. */
interface EtatMock {
  jours: Record<
    string,
    { terminus: number | null; circulations: Record<string, Partial<Circulation>> }
  >;
  messages: Message[] | null; // null = messages de démo
  paramsSimples: Partial<
    Pick<Params, 'meteo_sommet' | 'veille_nuit' | 'duree_horaires_s' | 'duree_cache_min'>
  > | null;
  machines: Machine[] | null;
  motifs: Motif[] | null;
  medias: Media[];
  ecrans: Record<string, EcranInfo & { recharger?: boolean }>;
  publications: { quand: string; qui: string; resume: string }[];
  utilisateurs: User[] | null;
}

function litEtat(): EtatMock {
  try {
    const brut = localStorage.getItem(CLE_ETAT);
    if (brut) return JSON.parse(brut) as EtatMock;
  } catch {
    // état corrompu : on repart de la démo
  }
  return {
    jours: {},
    messages: null,
    paramsSimples: null,
    machines: null,
    motifs: null,
    medias: [],
    ecrans: {},
    publications: [],
    utilisateurs: null,
  };
}

function ecritEtat(etat: EtatMock): void {
  localStorage.setItem(CLE_ETAT, JSON.stringify(etat));
  window.dispatchEvent(new Event(EVENEMENT_LOCAL)); // même onglet ; autres onglets : `storage`
}

export interface OptionsMock {
  /** Bascule Terminus Bellevue « à partir du TRAIN N » appliquée à l'affichage (démo écrans). */
  terminusAPartirDuTrain?: number;
  /** Date « du jour » figée (« YYYY-MM-DD ») — tests uniquement. */
  aujourdhui?: string;
}

function dateAujourdhuiParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

export class MockProvider implements DataProvider {
  private grilles: Promise<Grille[]> | null = null;

  constructor(private readonly options: OptionsMock = {}) {}

  getGrilles(): Promise<Grille[]> {
    // `no-store` : la sonde traverse le service worker et détecte la coupure
    // réseau (mode dégradé) ; les données restent servies par le snapshot.
    this.grilles ??= Promise.all(
      ['2026-ete-grand-service', '2026-ete-petit-service'].map(async (nom) => {
        const reponse = await fetch(`${import.meta.env.BASE_URL}grilles/${nom}.json`, {
          cache: 'no-store',
        });
        if (!reponse.ok) throw new Error(`Grille ${nom} introuvable (${reponse.status})`);
        return (await reponse.json()) as Grille;
      }),
    ).catch((erreur: unknown) => {
      this.grilles = null; // nouvelle tentative à la prochaine synchro
      throw erreur;
    });
    return this.grilles;
  }

  async getJour(date: string): Promise<Jour> {
    const grilles = await this.getGrilles();
    const grille = serviceActif(grilles, date);
    if (!grille) {
      // Hors saison : aucun service, aucune circulation, aucune écriture.
      return {
        date,
        grille_version: '',
        terminus_bellevue: false,
        circulations: [],
        enregistre: false,
        hors_saison: true,
      };
    }

    const jour = generationJour(grille, date);
    // Perturbations de démonstration (état du jour de la maquette validée)
    for (const numero of FACULTATIFS_ACTIVES) {
      const c = jour.circulations.find((x) => x.numero === numero);
      if (c) c.facultatif_actif = true;
    }
    const t11 = jour.circulations.find((x) => x.numero === 11);
    if (t11) Object.assign(t11, { statut: 'retard', retard_min: 10, motif: 'Météo' });
    const t16 = jour.circulations.find((x) => x.numero === 16);
    if (t16) Object.assign(t16, { statut: 'supprime', motif: 'Météo' });

    // Ouverture en supervision d'une date non passée : la journée est créée
    // d'emblée (idempotent) — plus aucune action manuelle requise. Une date
    // PASSÉE sans données reste un aperçu théorique (pas d'historique inventé).
    let etatJour = litEtat().jours[date];
    const aujourdhui = this.options.aujourdhui ?? dateAujourdhuiParis();
    if (!etatJour && date >= aujourdhui && sessionStorage.getItem(CLE_SESSION) !== null) {
      const etat = litEtat();
      etat.jours[date] = { terminus: null, circulations: {} };
      localStorage.setItem(CLE_ETAT, JSON.stringify(etat)); // simple lecture : pas de notification
      etatJour = etat.jours[date];
    }
    jour.enregistre = etatJour !== undefined; // false = aperçu théorique
    if (etatJour) {
      for (const c of jour.circulations) {
        const modif = etatJour.circulations[String(c.numero)];
        if (modif) Object.assign(c, modif);
      }
      jour.terminus_bellevue =
        etatJour.terminus === null ? false : { a_partir_du_train: etatJour.terminus };
    }

    if (this.options.terminusAPartirDuTrain !== undefined) {
      return appliqueTerminusBellevue(grille, jour, this.options.terminusAPartirDuTrain).jour;
    }
    return jour;
  }

  async getMessages(): Promise<Message[]> {
    return litEtat().messages ?? MESSAGES_DEMO;
  }

  async getMedias(gare: GareId): Promise<Media[]> {
    return litEtat().medias.filter((m) => m.actif && (!m.gares || m.gares.includes(gare)));
  }

  async getParams(): Promise<Params> {
    const etat = litEtat();
    return {
      ...PARAMS_DEMO,
      ...etat.paramsSimples,
      machines: etat.machines ?? PARAMS_DEMO.machines,
      motifs: etat.motifs ?? PARAMS_DEMO.motifs,
    };
  }

  onChange(cb: () => void): () => void {
    const surStorage = (e: StorageEvent): void => {
      if (e.key === CLE_ETAT) cb();
    };
    const surLocal = (): void => cb();
    window.addEventListener('storage', surStorage);
    window.addEventListener(EVENEMENT_LOCAL, surLocal);
    return () => {
      window.removeEventListener('storage', surStorage);
      window.removeEventListener(EVENEMENT_LOCAL, surLocal);
    };
  }

  async heartbeat(e: EcranInfo): Promise<void> {
    const etat = litEtat();
    const existant = etat.ecrans[e.id];
    etat.ecrans[e.id] = { ...e, derniere_vue: new Date().toISOString(), recharger: false };
    localStorage.setItem(CLE_ETAT, JSON.stringify(etat)); // sans notification (bruit)
    if (existant?.recharger) window.location.reload();
  }

  // -------------------------------------------------------------- supervision

  async signIn(email: string, _mdp: string): Promise<Session> {
    const role: Role = email.startsWith('admin')
      ? 'admin'
      : email.startsWith('caisse')
        ? 'caisse'
        : 'supervision';
    sessionStorage.setItem(CLE_SESSION, JSON.stringify({ email, role }));
    return { user_id: `mock-${role}`, email };
  }

  async getRole(): Promise<Role> {
    const brut = sessionStorage.getItem(CLE_SESSION);
    if (!brut) throw new Error('Non connecté');
    return (JSON.parse(brut) as { role: Role }).role;
  }

  async genererJour(date: string): Promise<void> {
    const etat = litEtat();
    // Idempotent : n'écrase jamais les modifications déjà enregistrées
    etat.jours[date] ??= { terminus: null, circulations: {} };
    ecritEtat(etat);
  }

  async reinitialiseJour(date: string): Promise<void> {
    const etat = litEtat();
    // Retour à l'horaire théorique : toutes les modifications du jour sont perdues
    etat.jours[date] = { terminus: null, circulations: {} };
    ecritEtat(etat);
  }

  async saveCirculation(c: Circulation): Promise<void> {
    const etat = litEtat();
    etat.jours[c.date] ??= { terminus: null, circulations: {} };
    const jour = etat.jours[c.date];
    if (jour) jour.circulations[String(c.numero)] = c;
    ecritEtat(etat);
  }

  async setTerminusBellevue(date: string, v: TerminusFlag): Promise<void> {
    const grilles = await this.getGrilles();
    const grille = serviceActif(grilles, date) ?? grilles[0];
    const etat = litEtat();
    etat.jours[date] ??= { terminus: null, circulations: {} };
    const etatJour = etat.jours[date];
    if (!etatJour || !grille) return;
    if (v === false) {
      etatJour.terminus = null;
    } else {
      const seuil = Math.max(
        1,
        v.a_partir_du_train % 2 === 0 ? v.a_partir_du_train - 1 : v.a_partir_du_train,
      );
      etatJour.terminus = seuil;
      // Pré-remplissage de la colonne Terminus (docs/01 §2.3), ajustable ensuite
      for (const montee of grille.montees) {
        if (montee.numero < seuil) continue;
        const cle = String(montee.numero);
        etatJour.circulations[cle] = { ...etatJour.circulations[cle], terminus: 'bellevue' };
      }
    }
    ecritEtat(etat);
  }

  async saveMessage(m: Message): Promise<void> {
    const etat = litEtat();
    const liste = etat.messages ?? [...MESSAGES_DEMO];
    const complet: Message = { ...m, id: m.id || `msg-${Date.now()}` };
    const index = liste.findIndex((x) => x.id === complet.id);
    if (index >= 0) liste[index] = complet;
    else liste.push(complet);
    etat.messages = liste;
    ecritEtat(etat);
  }

  async deleteMessage(id: string): Promise<void> {
    const etat = litEtat();
    etat.messages = (etat.messages ?? [...MESSAGES_DEMO]).filter((m) => m.id !== id);
    ecritEtat(etat);
  }

  async uploadMedia(file: File, meta: MediaMeta): Promise<void> {
    if (!file.type.startsWith('image/') || file.size > 1_500_000) {
      throw new Error('Mode mock : images ≤ 1,5 Mo uniquement (vidéos : nécessite Supabase).');
    }
    const url = await new Promise<string>((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result));
      lecteur.onerror = () => reject(new Error('Lecture du fichier impossible'));
      lecteur.readAsDataURL(file);
    });
    const etat = litEtat();
    etat.medias.push({ ...meta, id: `media-${Date.now()}`, url, actif: true });
    ecritEtat(etat);
  }

  async saveMedia(m: Media): Promise<void> {
    const etat = litEtat();
    const index = etat.medias.findIndex((x) => x.id === m.id);
    if (index >= 0) etat.medias[index] = m;
    ecritEtat(etat);
  }

  async deleteMedia(id: string): Promise<void> {
    const etat = litEtat();
    etat.medias = etat.medias.filter((m) => m.id !== id);
    ecritEtat(etat);
  }

  async saveParams(p: Partial<Params>): Promise<void> {
    const etat = litEtat();
    const { machines, motifs, ...simples } = p;
    if (machines) etat.machines = machines;
    if (motifs) etat.motifs = motifs;
    etat.paramsSimples = { ...etat.paramsSimples, ...simples };
    ecritEtat(etat);
  }

  async saveMachine(m: Machine): Promise<void> {
    const etat = litEtat();
    const liste = etat.machines ?? [...PARAMS_DEMO.machines];
    const index = liste.findIndex((x) => x.nom === m.nom);
    if (index >= 0) liste[index] = m;
    else liste.push(m);
    etat.machines = liste;
    ecritEtat(etat);
  }

  async deleteMachine(nom: string): Promise<void> {
    const etat = litEtat();
    etat.machines = (etat.machines ?? [...PARAMS_DEMO.machines]).filter((m) => m.nom !== nom);
    ecritEtat(etat);
  }

  async saveMotif(m: Motif): Promise<void> {
    const etat = litEtat();
    const liste = etat.motifs ?? [...PARAMS_DEMO.motifs];
    const index = liste.findIndex((x) => x.fr === m.fr);
    if (index >= 0) liste[index] = m;
    else liste.push(m);
    etat.motifs = liste;
    ecritEtat(etat);
  }

  async deleteMotif(fr: string): Promise<void> {
    const etat = litEtat();
    etat.motifs = (etat.motifs ?? [...PARAMS_DEMO.motifs]).filter((m) => m.fr !== fr);
    ecritEtat(etat);
  }

  async listUsers(): Promise<User[]> {
    return litEtat().utilisateurs ?? UTILISATEURS_DEMO;
  }

  async saveUser(u: User): Promise<void> {
    const etat = litEtat();
    const liste = etat.utilisateurs ?? [...UTILISATEURS_DEMO];
    const index = liste.findIndex((x) => x.user_id === u.user_id);
    if (index >= 0) liste[index] = u;
    else liste.push(u);
    etat.utilisateurs = liste;
    ecritEtat(etat);
  }

  async inviteUser(email: string, nom: string, role: Role): Promise<void> {
    await this.saveUser({ user_id: `mock-${Date.now()}`, nom, email, role, actif: true });
  }

  async resetMotDePasse(): Promise<void> {
    // rien à faire en mode mock
  }

  async traduire(): Promise<string | null> {
    return null; // repli : dictionnaire local de phrases types
  }

  async logPublication(resume: string): Promise<void> {
    const etat = litEtat();
    const session = sessionStorage.getItem(CLE_SESSION);
    const qui = session ? (JSON.parse(session) as { email: string }).email : 'inconnu';
    etat.publications.push({ quand: new Date().toISOString(), qui, resume });
    ecritEtat(etat);
  }

  async listEcrans(): Promise<EcranInfo[]> {
    return Object.values(litEtat().ecrans);
  }

  async demanderRechargement(id: string): Promise<void> {
    const etat = litEtat();
    const ecran = etat.ecrans[id];
    if (ecran) ecran.recharger = true;
    ecritEtat(etat);
  }
}
