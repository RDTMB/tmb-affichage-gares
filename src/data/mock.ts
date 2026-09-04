// DataProvider factice — démo complète SANS Supabase : l'état d'exploitation
// (circulations modifiées, terminus, messages, paramètres, médias, écrans)
// vit dans localStorage et se propage entre onglets (événement `storage`) :
// une modification en supervision mock apparaît sur les écrans mock < 2 s.
// Démo par défaut (maquette validée) : facultatifs 3/4/9/10/17/18 activés,
// retard +10 min (Météo) sur le TRAIN 11, descente 16 supprimée (Météo).
// Paramètre d'URL écran : ?terminus=N (bascule « à partir du TRAIN N »).
// Connexion mock : le début de l'email fixe le rôle (admin… → admin,
// caisse… → caisse, sinon supervision) ; mot de passe libre.
import {
  A_QUAI_ORIGINE_DEFAUT_S,
  appliqueTerminusBellevue,
  generationJour,
  serviceActif,
} from '../core/horaires';
import { paramsValides } from '../core/params';
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
  EntreeJournal,
  FiltreJournal,
} from '../core/types';
import { contenuSansMetadonnees } from '../core/grilles';
import type { DataProvider } from './provider';
// Grilles de référence (docs/grilles-historique/) : URL de fichiers copiés au
// build, jamais inlinées dans le JS.
import grandServiceUrl from '../../docs/grilles-historique/2026-ete-grand-service.json?url';
import petitServiceUrl from '../../docs/grilles-historique/2026-ete-petit-service.json?url';

const CLE_ETAT = 'tmb-mock-etat';
/**
 * Les heartbeats vivent dans une clé SÉPARÉE : écrits dans CLE_ETAT, ils
 * déclenchaient l'événement `storage` des autres onglets (6 écrans toutes
 * les 30 s) et donc un rechargement complet en boucle.
 */
const CLE_ECRANS = 'tmb-mock-ecrans';
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

/** Bibliothèque initiale validée par l'exploitant (voir supabase/ajout-modeles.sql). */
const MODELES_DEMO: ModeleMessage[] = [
  [
    'Réservation obligatoire',
    'Réservation',
    'Réservation obligatoire pour tous les trajets.',
    'Booking is compulsory for all journeys.',
  ],
  [
    'Réserver sa descente',
    'Réservation',
    'Pensez à réserver votre descente.',
    'Remember to book your descent.',
  ],
  [
    'Ligne jaune',
    'Sécurité',
    'Restez derrière la ligne jaune à l’approche du train.',
    'Please stand behind the yellow line when the tram approaches.',
  ],
  [
    'Enfants sur les quais',
    'Sécurité',
    'Tenez les enfants par la main sur les quais.',
    'Please hold children by the hand on the platforms.',
  ],
  [
    'Vent fort au sommet',
    'Météo',
    'Vent fort au sommet : les circulations peuvent être adaptées.',
    'Strong wind at the summit: services may be adjusted.',
  ],
  [
    'Visibilité réduite',
    'Météo',
    'Visibilité réduite sur la ligne et au sommet : soyez prudents.',
    'Reduced visibility on the line and at the summit: please take care.',
  ],
  [
    'Tronçon supérieur fermé',
    'Météo',
    'Tronçon Bellevue – Nid d’Aigle fermé pour raisons météorologiques.',
    'The Bellevue – Nid d’Aigle section is closed due to weather conditions.',
  ],
  [
    'Terminus exceptionnel Bellevue',
    'Météo',
    'Terminus exceptionnel à Bellevue.',
    'Exceptional terminus at Bellevue.',
  ],
  [
    'Train complet',
    'Exploitation',
    'Train complet : présentez-vous au personnel en gare.',
    'This service is full: please speak to station staff.',
  ],
  [
    'Vélos',
    'Exploitation',
    'Vélos acceptés dans la limite de 5 par train, selon l’affluence.',
    'Bikes carried subject to availability, up to 5 per tram.',
  ],
  [
    'Vêtements chauds',
    'Confort',
    'Prévoyez des vêtements chauds : la température baisse fortement avec l’altitude.',
    'Please bring warm clothing: temperatures drop sharply with altitude.',
  ],
  [
    'Travaux en gare',
    'Travaux',
    'Travaux en gare : suivez la signalisation.',
    'Works in progress: please follow the signs.',
  ],
].map(([titre, categorie, texte_fr, texte_en], i) => ({
  id: `modele-${i + 1}`,
  titre: titre ?? '',
  categorie: categorie ?? '',
  texte_fr: texte_fr ?? '',
  texte_en: texte_en ?? '',
  ordre: (i + 1) * 10,
  actif: true,
}));

const PARAMS_DEMO: Params = {
  meteo_sommet: { t: 9, ciel_fr: 'Dégagé', ciel_en: 'Clear', heure_releve: '08:00' },
  veille_nuit: { debut: '21:00', fin: '06:00' },
  duree_horaires_s: 20,
  duree_cache_min: 15,
  mode_medias: 'alterne',
  a_quai_origine_s: A_QUAI_ORIGINE_DEFAUT_S,
  vitesse_ticker_px_s: 90,
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
  ciels: [
    { fr: 'Dégagé', en: 'Clear', ordre: 10 },
    { fr: 'Ensoleillé', en: 'Sunny', ordre: 20 },
    { fr: 'Nuageux', en: 'Cloudy', ordre: 30 },
    { fr: 'Couvert', en: 'Overcast', ordre: 40 },
    { fr: 'Pluie', en: 'Rain', ordre: 50 },
    { fr: 'Neige', en: 'Snow', ordre: 60 },
    { fr: 'Brouillard', en: 'Fog', ordre: 70 },
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
    Pick<
      Params,
      | 'meteo_sommet'
      | 'veille_nuit'
      | 'duree_horaires_s'
      | 'duree_cache_min'
      | 'vitesse_ticker_px_s'
    >
  > | null;
  machines: Machine[] | null;
  motifs: Motif[] | null;
  ciels: Ciel[] | null;
  modeles: ModeleMessage[] | null;
  medias: Media[];
  ecrans: Record<string, EcranInfo>;
  publications: { quand: string; qui: string; resume: string }[];
  /** Journal d'exploitation : en production, écrit par des DÉCLENCHEURS. */
  journal: EntreeJournal[];
  utilisateurs: User[] | null;
  /** Grilles importées en démo (table `grilles`), métadonnées comprises. */
  grillesImportees?: Grille[];
  /** Versions désactivées (grilles de référence ou importées) : retour arrière. */
  grillesDesactivees?: string[];
  /** Métadonnées modifiées en place (nom, dates, commentaire), par version. */
  grillesMetadonnees?: Record<string, Partial<MetadonneesGrille>>;
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
    ciels: null,
    modeles: null,
    medias: [],
    ecrans: {},
    publications: [],
    journal: [],
    utilisateurs: null,
    grillesImportees: [],
    grillesDesactivees: [],
  };
}

/** Date de création prêtée aux grilles de référence : celle du document d'exploitation. */
const CREE_LE_REFERENCE = '2026-06-05T00:00:00.000Z';

/**
 * Reproduit le déclencheur `private.tracer_ecriture()` : une ligne de journal
 * par CHAMP réellement modifié. Le mock doit se comporter comme la base,
 * sinon les tests de traçabilité ne prouveraient rien.
 *
 * N'est JAMAIS appelé par heartbeat() : les signaux de vie ne sont pas des
 * écritures d'exploitation et noieraient le journal.
 */
function trace(
  etat: EtatMock,
  table: string,
  cle: string,
  // `object` plutôt que `Record<string, unknown>` : les interfaces du domaine
  // (Circulation, Message…) n'ont pas de signature d'index, et les convertir
  // partout n'apporterait rien.
  avant: object | null,
  apres: object | null,
  champs?: string[],
  dateService?: string | null,
): void {
  etat.journal ??= [];
  const session = sessionStorage.getItem(CLE_SESSION);
  const qui = session ? (JSON.parse(session) as { email: string }).email : null;
  const surveilles =
    champs ??
    [...new Set([...Object.keys(apres ?? {}), ...Object.keys(avant ?? {})])].filter(
      (c) => c !== 'id' && c !== 'maj',
    );
  const texte = (v: unknown): string | null =>
    v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);

  const pose = (champ: string, a: unknown, b: unknown): void => {
    if (texte(a) === texte(b)) return;
    etat.journal.push({
      id: etat.journal.length + 1,
      quand: new Date().toISOString(),
      qui,
      table_cible: table,
      cle,
      champ,
      avant: texte(a),
      apres: texte(b),
      date_service: dateService ?? null,
    });
  };

  for (const champ of surveilles) {
    const a = (avant as Record<string, unknown> | null)?.[champ];
    const b = (apres as Record<string, unknown> | null)?.[champ];
    // Valeur JSON (params) : on descend d'un cran, comme le déclencheur.
    const objetA = a !== null && typeof a === 'object' && !Array.isArray(a);
    const objetB = b !== null && typeof b === 'object' && !Array.isArray(b);
    if (objetA || objetB) {
      const sousCles = [
        ...new Set([
          ...Object.keys(objetB ? (b as object) : {}),
          ...Object.keys(objetA ? (a as object) : {}),
        ]),
      ];
      for (const sous of sousCles) {
        pose(
          sous,
          objetA ? (a as Record<string, unknown>)[sous] : undefined,
          objetB ? (b as Record<string, unknown>)[sous] : undefined,
        );
      }
    } else {
      pose(champ, a, b);
    }
  }
}

/** Médias triés comme en production : ordre de passage, puis ancienneté. */
function tousLesMedias(): Media[] {
  return [...litEtat().medias].sort((a, b) => (a.ordre ?? 100) - (b.ordre ?? 100));
}

function ecritEtat(etat: EtatMock): void {
  localStorage.setItem(CLE_ETAT, JSON.stringify(etat));
  window.dispatchEvent(new Event(EVENEMENT_LOCAL)); // même onglet ; autres onglets : `storage`
}

type EcransMock = Record<string, EcranInfo>;

function litEcrans(): EcransMock {
  try {
    const brut = localStorage.getItem(CLE_ECRANS);
    if (brut) return JSON.parse(brut) as EcransMock;
  } catch {
    // état corrompu : liste vide
  }
  return {};
}

/** Écriture SANS notification : un heartbeat ne doit réveiller personne. */
function ecritEcrans(ecrans: EcransMock): void {
  localStorage.setItem(CLE_ECRANS, JSON.stringify(ecrans));
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
  /** Heure de chargement de CETTE page : référence de l’ordre de rechargement. */
  private readonly chargeeA = Date.now();
  private grillesJson: Promise<Grille[]> | null = null;

  constructor(private readonly options: OptionsMock = {}) {}

  /**
   * Les deux grilles JSON de référence (docs/grilles-historique/), copiées au
   * build comme simples fichiers (import `?url`) : seule la démonstration les
   * télécharge, le bundle des écrans n'en porte que deux URL. `no-store` : la
   * sonde traverse le service worker et détecte la coupure réseau (mode
   * dégradé) ; les données restent servies par l'instantané.
   */
  private grillesDeReference(): Promise<Grille[]> {
    this.grillesJson ??= Promise.all(
      [grandServiceUrl, petitServiceUrl].map(async (url) => {
        const reponse = await fetch(url, { cache: 'no-store' });
        if (!reponse.ok) throw new Error(`Grille de référence introuvable (${reponse.status})`);
        return (await reponse.json()) as Grille;
      }),
    ).catch((erreur: unknown) => {
      this.grillesJson = null; // nouvelle tentative à la prochaine synchro
      throw erreur;
    });
    return this.grillesJson;
  }

  /**
   * Toutes les grilles — référence + importées en démo — avec leurs
   * métadonnées, comme la table `grilles`. Les grilles de référence sont
   * datées du document d'exploitation : une grille importée ensuite, plus
   * récente, l'emporte sur les dates communes (serviceActif).
   */
  async listGrilles(): Promise<Grille[]> {
    const etat = litEtat();
    const desactivees = new Set(etat.grillesDesactivees ?? []);
    const reference = (await this.grillesDeReference()).map((g) => ({
      ...g,
      cree_le: CREE_LE_REFERENCE,
      cree_par: 'grilles de référence (démo)',
      commentaire: null,
    }));
    return [...reference, ...(etat.grillesImportees ?? [])].map((g) => ({
      ...g,
      // Comme en base : la LIGNE (métadonnées modifiées) fait foi sur le contenu.
      ...(etat.grillesMetadonnees?.[g.version] ?? {}),
      actif: !desactivees.has(g.version),
    }));
  }

  async updateGrilleMetadonnees(version: string, meta: MetadonneesGrille): Promise<void> {
    const cible = (await this.listGrilles()).find((g) => g.version === version);
    if (!cible) throw new Error(`Grille « ${version} » introuvable`);
    const etat = litEtat();
    trace(
      etat,
      'grilles',
      version,
      { libelle: cible.libelle, periodes: cible.periodes, commentaire: cible.commentaire ?? null },
      { libelle: meta.libelle, periodes: meta.periodes, commentaire: meta.commentaire },
      ['libelle', 'periodes', 'commentaire'],
    );
    etat.grillesMetadonnees = {
      ...etat.grillesMetadonnees,
      [version]: {
        libelle: meta.libelle,
        periodes: meta.periodes.map((p) => ({ ...p })),
        commentaire: meta.commentaire,
      },
    };
    ecritEtat(etat);
  }

  /** Grilles ACTIVES seulement (écrans, génération des journées). */
  async getGrilles(): Promise<Grille[]> {
    return (await this.listGrilles()).filter((g) => g.actif !== false);
  }

  async saveGrille(g: Grille, options: OptionsEnregistrementGrille = {}): Promise<void> {
    if ((await this.listGrilles()).some((x) => x.version === g.version)) {
      // Comme la clé primaire en base : une version n'est JAMAIS réécrite.
      throw new Error(`Une grille « ${g.version} » existe déjà : elle n'a pas été écrasée`);
    }
    const etat = litEtat();
    const session = sessionStorage.getItem(CLE_SESSION);
    const enregistree: Grille = {
      ...contenuSansMetadonnees(g),
      actif: options.actif ?? true,
      cree_le: new Date().toISOString(),
      cree_par: session ? (JSON.parse(session) as { email: string }).email : null,
      commentaire: options.commentaire ?? null,
    };
    etat.grillesImportees = [...(etat.grillesImportees ?? []), enregistree];
    if (options.actif === false) {
      etat.grillesDesactivees = [...(etat.grillesDesactivees ?? []), g.version];
    }
    // Même trace que le déclencheur trg_journal_grilles : actif, libellé,
    // périodes, commentaire — jamais le contenu.
    trace(
      etat,
      'grilles',
      g.version,
      null,
      {
        actif: enregistree.actif,
        libelle: g.libelle,
        periodes: g.periodes,
        commentaire: enregistree.commentaire,
      },
      ['actif', 'libelle', 'periodes', 'commentaire'],
    );
    ecritEtat(etat);
  }

  async setGrilleActive(version: string, actif: boolean): Promise<void> {
    const cible = (await this.listGrilles()).find((g) => g.version === version);
    if (!cible) throw new Error(`Grille « ${version} » introuvable`);
    const etat = litEtat();
    const desactivees = new Set(etat.grillesDesactivees ?? []);
    trace(etat, 'grilles', version, { actif: !desactivees.has(version) }, { actif }, ['actif']);
    if (actif) desactivees.delete(version);
    else desactivees.add(version);
    etat.grillesDesactivees = [...desactivees];
    ecritEtat(etat);
  }

  async listJoursGeneres(du: string, au: string): Promise<string[]> {
    return Object.keys(litEtat().jours)
      .filter((d) => d >= du && d <= au)
      .sort();
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
      // Trains SUPPLÉMENTAIRES : ils n'ont aucune contrepartie dans la grille,
      // donc aucune circulation générée à compléter — il faut les AJOUTER,
      // sans quoi ils disparaîtraient à la relecture.
      const connus = new Set(jour.circulations.map((c) => c.numero));
      for (const brut of Object.values(etatJour.circulations)) {
        if (brut?.supplementaire !== true || connus.has(brut.numero ?? -1)) continue;
        jour.circulations.push(brut as Circulation);
      }
      jour.circulations.sort((x, y) => x.numero - y.numero);
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
    return tousLesMedias().filter((m) => m.actif && (!m.gares || m.gares.includes(gare)));
  }

  /** Supervision : TOUS les médias, y compris désactivés. */
  async listMedias(): Promise<Media[]> {
    return tousLesMedias();
  }

  async getParams(): Promise<Params> {
    const etat = litEtat();
    // `etat.paramsSimples` sort de JSON.parse(localStorage) : aucune garantie
    // de forme, comme le jsonb côté Supabase. Même point de validation unique
    // (C-01), et AVANT le tri : `localeCompare` lèverait sur un `fr` non
    // textuel, ce qui figerait l'écran.
    const p = paramsValides({
      ...PARAMS_DEMO,
      ...etat.paramsSimples,
      machines: etat.machines ?? PARAMS_DEMO.machines,
      motifs: etat.motifs ?? PARAMS_DEMO.motifs,
      ciels: etat.ciels ?? PARAMS_DEMO.ciels,
    });
    // Même ordre que le provider Supabase (.order('ordre').order('fr')).
    return {
      ...p,
      ciels: [...p.ciels].sort((a, b) => a.ordre - b.ordre || a.fr.localeCompare(b.fr, 'fr')),
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

  async heartbeat(e: EcranInfo): Promise<{ debut: string; fin: string } | null> {
    const ecrans = litEcrans();
    const existant = ecrans[e.id];
    // Fidèle à la production : un écran NON DÉCLARÉ ne s'inscrit pas tout
    // seul, son signal de vie ne touche aucune ligne.
    if (!existant) {
      throw new Error(
        `Écran « ${e.id} » non déclaré en supervision : son signal de vie n'est enregistré nulle part`,
      );
    }
    ecrans[e.id] = {
      ...existant,
      // Seules les colonnes du signal de vie : id, gare et type viennent de
      // la déclaration et ne sont pas réécrits par l'écran.
      derniere_vue: new Date().toISOString(),
      donnees_maj: e.donnees_maj ?? null,
      date_affichee: e.date_affichee ?? null,
      version_app: e.version_app ?? null,
      reseau: e.reseau ?? null,
    };
    ecritEcrans(ecrans); // clé séparée : ne réveille aucun autre client
    const demande = existant.recharger_demande_at;
    if (demande && new Date(demande).getTime() > this.chargeeA) window.location.reload();

    return existant.veille_debut && existant.veille_fin
      ? { debut: existant.veille_debut.slice(0, 5), fin: existant.veille_fin.slice(0, 5) }
      : null;
  }

  async declareEcran(e: Pick<EcranInfo, 'id' | 'gare' | 'type'>): Promise<void> {
    const ecrans = litEcrans();
    if (ecrans[e.id]) throw new Error(`Écran ${e.id} déjà déclaré`);
    const etat = litEtat();
    trace(etat, 'ecrans', e.id, null, { gare: e.gare, type: e.type ?? null }, ['gare', 'type']);
    ecritEtat(etat);
    ecrans[e.id] = { id: e.id, gare: e.gare, type: e.type ?? null };
    ecritEcrans(ecrans);
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
    return (await this.getProfil()).role;
  }

  async getProfil(): Promise<Profil> {
    const brut = sessionStorage.getItem(CLE_SESSION);
    if (!brut) throw new Error('Non connecté');
    const session = JSON.parse(brut) as { email: string; role: Role };
    return {
      user_id: `mock-${session.role}`,
      // Faute d'annuaire, la démo déduit un nom présentable de l'e-mail :
      // « marie-claire.dupond@… » → « Marie Claire Dupond ».
      nom: (session.email.split('@')[0] ?? '')
        .split(/[.-_]+/)
        .filter(Boolean)
        .map((mot) => mot.charAt(0).toLocaleUpperCase('fr') + mot.slice(1))
        .join(' '),
      email: session.email,
      role: session.role,
    };
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

  /**
   * État d'une circulation AVANT écriture, tel que la base le contient : le
   * mock ne stocke que les modifications, mais en production la ligne existe
   * déjà (journée générée). Sans ce repli sur la circulation théorique, la
   * première écriture consignerait les SEPT champs au journal au lieu du seul
   * qui change.
   */
  private async circulationAvant(date: string, numero: number): Promise<Circulation | null> {
    const stocke = litEtat().jours[date]?.circulations[String(numero)];
    const grille = serviceActif(await this.getGrilles(), date);
    if (!grille) return (stocke as Circulation) ?? null;
    const theorique = generationJour(grille, date).circulations.find((x) => x.numero === numero);
    if (!theorique) return (stocke as Circulation) ?? null;
    return { ...theorique, ...(stocke ?? {}) };
  }

  async saveCirculation(c: Circulation): Promise<void> {
    const avant = await this.circulationAvant(c.date, c.numero);
    const etat = litEtat();
    etat.jours[c.date] ??= { terminus: null, circulations: {} };
    const jour = etat.jours[c.date];
    if (jour) {
      trace(
        etat,
        'circulations',
        `${c.date} ${c.numero}`,
        avant,
        c,
        ['statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif', 'sans_voyageurs'],
        c.date,
      );
      jour.circulations[String(c.numero)] = c;
    }
    ecritEtat(etat);
  }

  async saveCirculations(cs: Circulation[]): Promise<void> {
    if (cs.length === 0) return;
    const avants = new Map<string, Circulation | null>();
    for (const c of cs) {
      avants.set(`${c.date}|${c.numero}`, await this.circulationAvant(c.date, c.numero));
    }
    const etat = litEtat();
    for (const c of cs) {
      etat.jours[c.date] ??= { terminus: null, circulations: {} };
      const jour = etat.jours[c.date];
      if (jour) {
        trace(
          etat,
          'circulations',
          `${c.date} ${c.numero}`,
          avants.get(`${c.date}|${c.numero}`) ?? null,
          c,
          [
            'statut',
            'retard_min',
            'motif',
            'rame',
            'terminus',
            'facultatif_actif',
            'sans_voyageurs',
          ],
          c.date,
        );
        jour.circulations[String(c.numero)] = c;
      }
    }
    ecritEtat(etat); // une seule notification pour toute l'action groupée
  }

  async creerTrainSup(date: string, montee: Circulation, descente: Circulation): Promise<void> {
    const etat = litEtat();
    etat.jours[date] ??= { terminus: null, circulations: {} };
    const jour = etat.jours[date];
    if (!jour) return;
    for (const c of [montee, descente]) {
      trace(etat, 'circulations', `${date} ${c.numero}`, null, c, undefined, date);
      jour.circulations[String(c.numero)] = c;
    }
    ecritEtat(etat);
  }

  async supprimerTrainSup(date: string, numeroMontee: number): Promise<void> {
    const etat = litEtat();
    const jour = etat.jours[date];
    const montee = jour?.circulations[String(numeroMontee)];
    if (!jour || !montee) throw new Error(`TRAIN ${numeroMontee} introuvable au ${date}`);
    // Même garde-fou qu'en production : un train de grille ne se supprime pas.
    if (montee.supplementaire !== true) {
      throw new Error(
        `TRAIN ${numeroMontee} n'est pas un train supplémentaire : suppression refusée`,
      );
    }
    for (const numero of [numeroMontee, numeroMontee + 1]) {
      const c = jour.circulations[String(numero)];
      if (!c) continue;
      trace(etat, 'circulations', `${date} ${numero}`, c, null, undefined, date);
      delete jour.circulations[String(numero)];
    }
    ecritEtat(etat);
  }

  async setTerminusBellevue(date: string, v: TerminusFlag): Promise<void> {
    const grilles = await this.getGrilles();
    const grille = serviceActif(grilles, date) ?? grilles[0];
    const etat = litEtat();
    etat.jours[date] ??= { terminus: null, circulations: {} };
    const etatJour = etat.jours[date];
    if (!etatJour || !grille) return;
    const seuil =
      v === false
        ? Number.POSITIVE_INFINITY
        : Math.max(
            1,
            v.a_partir_du_train % 2 === 0 ? v.a_partir_du_train - 1 : v.a_partir_du_train,
          );
    trace(
      etat,
      'jours',
      date,
      { terminus_bellevue_a_partir_du_train: etatJour.terminus },
      { terminus_bellevue_a_partir_du_train: v === false ? null : seuil },
      ['terminus_bellevue_a_partir_du_train'],
      date,
    );
    etatJour.terminus = v === false ? null : seuil;
    // Pré-remplissage de la colonne Terminus (docs/01 §2.3), ajustable
    // ensuite ; les montées hors plage sont LIBÉRÉES (décocher ou rétrécir
    // rétablit le service jusqu'au Nid d'Aigle).
    for (const montee of grille.montees) {
      const cle = String(montee.numero);
      etatJour.circulations[cle] = {
        ...etatJour.circulations[cle],
        terminus: montee.numero >= seuil ? 'bellevue' : 'nid-daigle',
      };
    }
    ecritEtat(etat);
  }

  async saveMessage(m: Message): Promise<void> {
    const etat = litEtat();
    const liste = etat.messages ?? [...MESSAGES_DEMO];
    const complet: Message = { ...m, id: m.id || `msg-${Date.now()}` };
    const index = liste.findIndex((x) => x.id === complet.id);
    trace(etat, 'messages', complet.id, index >= 0 ? (liste[index] ?? null) : null, complet);
    if (index >= 0) liste[index] = complet;
    else liste.push(complet);
    etat.messages = liste;
    ecritEtat(etat);
  }

  async deleteMessage(id: string): Promise<void> {
    const etat = litEtat();
    const liste = etat.messages ?? [...MESSAGES_DEMO];
    trace(etat, 'messages', id, liste.find((m) => m.id === id) ?? null, null);
    etat.messages = liste.filter((m) => m.id !== id);
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
    // Comme en production : un nouveau média passe en DERNIER.
    const maximum = etat.medias.reduce((haut, m) => Math.max(haut, m.ordre ?? 0), 90);
    etat.medias.push({
      ...meta,
      ordre: meta.ordre ?? maximum + 10,
      id: `media-${Date.now()}`,
      url,
      actif: true,
    });
    ecritEtat(etat);
  }

  async saveMedia(m: Media): Promise<void> {
    const etat = litEtat();
    const index = etat.medias.findIndex((x) => x.id === m.id);
    // Échec bruyant, comme le provider Supabase (jamais de faux succès)
    if (index < 0) throw new Error(`Média ${m.id} introuvable`);
    trace(etat, 'medias', m.id, etat.medias[index] ?? null, m);
    etat.medias[index] = m;
    ecritEtat(etat);
  }

  async deleteMedia(id: string): Promise<void> {
    const etat = litEtat();
    trace(etat, 'medias', id, etat.medias.find((m) => m.id === id) ?? null, null);
    etat.medias = etat.medias.filter((m) => m.id !== id);
    ecritEtat(etat);
  }

  async saveParams(p: Partial<Params>): Promise<void> {
    const etat = litEtat();
    const { machines, motifs, ciels, ...simples } = p;
    if (machines) etat.machines = machines;
    if (motifs) etat.motifs = motifs;
    if (ciels) etat.ciels = ciels;
    // Une ligne de journal par CLÉ de paramètre, comme le déclencheur.
    const avant = { ...PARAMS_DEMO, ...etat.paramsSimples } as Record<string, unknown>;
    for (const [cle, valeur] of Object.entries(simples)) {
      trace(etat, 'params', cle, { [cle]: avant[cle] }, { [cle]: valeur }, [cle]);
    }
    etat.paramsSimples = { ...etat.paramsSimples, ...simples };
    ecritEtat(etat);
  }

  async saveMachine(m: Machine): Promise<void> {
    const etat = litEtat();
    const liste = etat.machines ?? [...PARAMS_DEMO.machines];
    const index = liste.findIndex((x) => x.nom === m.nom);
    trace(etat, 'machines', m.nom, index >= 0 ? (liste[index] ?? null) : null, m);
    if (index >= 0) liste[index] = m;
    else liste.push(m);
    etat.machines = liste;
    ecritEtat(etat);
  }

  async deleteMachine(nom: string): Promise<void> {
    const etat = litEtat();
    const liste = etat.machines ?? [...PARAMS_DEMO.machines];
    trace(etat, 'machines', nom, liste.find((m) => m.nom === nom) ?? null, null);
    etat.machines = liste.filter((m) => m.nom !== nom);
    ecritEtat(etat);
  }

  async getModelesMessages(): Promise<ModeleMessage[]> {
    const liste = litEtat().modeles ?? MODELES_DEMO;
    return [...liste].sort((a, b) => a.ordre - b.ordre || a.titre.localeCompare(b.titre));
  }

  async saveModeleMessage(m: ModeleMessage): Promise<void> {
    const etat = litEtat();
    const liste = etat.modeles ?? [...MODELES_DEMO];
    const complet: ModeleMessage = { ...m, id: m.id || `modele-${Date.now()}` };
    const index = liste.findIndex((x) => x.id === complet.id);
    trace(
      etat,
      'modeles_messages',
      complet.id,
      index >= 0 ? (liste[index] ?? null) : null,
      complet,
    );
    if (index >= 0) liste[index] = complet;
    else liste.push(complet);
    etat.modeles = liste;
    ecritEtat(etat);
  }

  async deleteModeleMessage(id: string): Promise<void> {
    const etat = litEtat();
    const liste = etat.modeles ?? [...MODELES_DEMO];
    trace(etat, 'modeles_messages', id, liste.find((m) => m.id === id) ?? null, null);
    if (!liste.some((m) => m.id === id)) throw new Error(`Modèle ${id} introuvable`);
    etat.modeles = liste.filter((m) => m.id !== id);
    ecritEtat(etat);
  }

  async saveMotif(m: Motif): Promise<void> {
    const etat = litEtat();
    const liste = etat.motifs ?? [...PARAMS_DEMO.motifs];
    const index = liste.findIndex((x) => x.fr === m.fr);
    trace(etat, 'motifs', m.fr, index >= 0 ? (liste[index] ?? null) : null, m);
    if (index >= 0) liste[index] = m;
    else liste.push(m);
    etat.motifs = liste;
    ecritEtat(etat);
  }

  async deleteMotif(fr: string): Promise<void> {
    const etat = litEtat();
    const liste = etat.motifs ?? [...PARAMS_DEMO.motifs];
    trace(etat, 'motifs', fr, liste.find((m) => m.fr === fr) ?? null, null);
    etat.motifs = liste.filter((m) => m.fr !== fr);
    ecritEtat(etat);
  }

  async saveCiel(c: Ciel): Promise<void> {
    const etat = litEtat();
    const liste = etat.ciels ?? [...PARAMS_DEMO.ciels];
    const index = liste.findIndex((x) => x.fr === c.fr);
    trace(etat, 'ciels', c.fr, index >= 0 ? (liste[index] ?? null) : null, c);
    if (index >= 0) liste[index] = c;
    else liste.push(c);
    etat.ciels = liste;
    ecritEtat(etat);
  }

  async deleteCiel(fr: string): Promise<void> {
    const etat = litEtat();
    const liste = etat.ciels ?? [...PARAMS_DEMO.ciels];
    trace(etat, 'ciels', fr, liste.find((c) => c.fr === fr) ?? null, null);
    etat.ciels = liste.filter((c) => c.fr !== fr);
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

  async deleteUser(user_id: string): Promise<void> {
    const etat = litEtat();
    etat.utilisateurs = (etat.utilisateurs ?? [...UTILISATEURS_DEMO]).filter(
      (u) => u.user_id !== user_id,
    );
    ecritEtat(etat);
  }

  async inviteUser(email: string, nom: string, role: Role): Promise<void> {
    await this.saveUser({ user_id: `mock-${Date.now()}`, nom, email, role, actif: true });
  }

  async resetMotDePasse(): Promise<void> {
    // rien à faire en mode mock
  }

  async definirMotDePasse(): Promise<void> {
    // rien à faire en mode mock (pas de mot de passe en démo)
  }

  async traduire(): Promise<string | null> {
    return null; // repli : dictionnaire local de phrases types
  }

  async dernierePublication(): Promise<string | null> {
    const publications = litEtat().publications;
    return publications[publications.length - 1]?.quand ?? null;
  }

  async listJournal(filtre: FiltreJournal): Promise<EntreeJournal[]> {
    // Le mock n'a pas de déclencheurs : il consigne à l'écriture (voir
    // `trace()`). Le filtrage reproduit celui de la base.
    const entrees = litEtat().journal ?? [];
    const filtrees = entrees.filter((e) => {
      if (filtre.du && e.quand < `${filtre.du}T00:00:00`) return false;
      if (filtre.au && e.quand > `${filtre.au}T23:59:59Z`) return false;
      if (filtre.qui && e.qui !== filtre.qui) return false;
      if (filtre.table_cible && e.table_cible !== filtre.table_cible) return false;
      return true;
    });
    filtrees.sort((a, b) => (a.quand < b.quand ? 1 : a.quand > b.quand ? -1 : b.id - a.id));
    const depuis = filtre.depuis ?? 0;
    return filtrees.slice(depuis, depuis + (filtre.limite ?? 100));
  }

  async logPublication(resume: string): Promise<void> {
    const etat = litEtat();
    const session = sessionStorage.getItem(CLE_SESSION);
    const qui = session ? (JSON.parse(session) as { email: string }).email : 'inconnu';
    etat.publications.push({ quand: new Date().toISOString(), qui, resume });
    ecritEtat(etat);
  }

  async listEcrans(): Promise<EcranInfo[]> {
    return Object.values(litEcrans());
  }

  async demanderRechargement(id: string): Promise<void> {
    const ecrans = litEcrans();
    const ecran = ecrans[id];
    if (!ecran) throw new Error(`Écran ${id} inconnu`);
    ecran.recharger_demande_at = new Date().toISOString();
    ecritEcrans(ecrans);
  }

  async saveVeilleEcran(id: string, debut: string | null, fin: string | null): Promise<void> {
    const ecrans = litEcrans();
    const ecran = ecrans[id];
    if (!ecran) throw new Error(`Écran ${id} inconnu`);
    const etat = litEtat();
    trace(
      etat,
      'ecrans',
      id,
      { veille_debut: ecran.veille_debut ?? null, veille_fin: ecran.veille_fin ?? null },
      { veille_debut: debut, veille_fin: fin },
      ['veille_debut', 'veille_fin'],
    );
    ecritEtat(etat);
    ecran.veille_debut = debut;
    ecran.veille_fin = fin;
    ecritEcrans(ecrans);
  }

  async oublierEcran(id: string): Promise<void> {
    const ecrans = litEcrans();
    const ecran = ecrans[id];
    if (!ecran) throw new Error(`Écran ${id} inconnu`);
    const etat = litEtat();
    trace(etat, 'ecrans', id, { gare: ecran.gare, type: ecran.type ?? null }, null, [
      'gare',
      'type',
    ]);
    ecritEtat(etat);
    delete ecrans[id];
    ecritEcrans(ecrans);
  }
}
