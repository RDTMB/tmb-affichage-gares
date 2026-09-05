// Supervision (étapes 6-7-8) — fidèle à maquettes/supervision.html.
// Connexion obligatoire ; le rôle filtre les onglets (caisse : Messages
// uniquement ; supervision : tout sauf Paramètres ; admin : tout).
// Les modifications s'appliquent immédiatement ; « Publier » journalise un
// résumé horodaté (docs/01 §5.6).
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/supervision.css';

import {
  A_QUAI_ORIGINE_DEFAUT_S,
  formatHeure,
  grillePourJour,
  heureVersSecondes,
  gareHorsSection,
  libelleTrain,
  messageTronconDefaut,
  sectionComplete,
  sectionDuJour,
  terminusPossiblesSup,
  trainsDuJour,
  monteesSansRetour,
  serviceActif,
} from '../core/horaires';
import { construitRotationSup, prochainNumeroSup } from '../core/train-sup';
import type { RotationSup } from '../core/train-sup';
import { GARE_DEBUT_DEFAUT, GARE_FIN_DEFAUT, ORDRE_GARES } from '../core/types';
import type {
  Circulation,
  EcranInfo,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  Message,
  ModeleMessage,
  Ciel,
  Params,
  PassageGrille,
  Profil,
  Role,
  SectionJour,
  TrainGrille,
  TrainJour,
  User,
  EntreeJournal,
  FiltreJournal,
} from '../core/types';
import {
  DESCRIPTION_ROLE,
  LIBELLE_ROLE,
  ROLES,
  aLeDroit,
  motifCaseVerrouillee,
  motifCompteVerrouille,
  ongletsVisibles,
  rolesAttribuables,
  type Droit,
} from '../core/roles';
import { creeProvider } from '../data';
import { baseServie, configSupabasePresente } from '../data/config';
import { initOngletHoraires, type OngletHoraires } from './onglet-horaires';
import {
  appliqueBrouillonJour,
  appliqueBrouillonMessages,
  appliqueBrouillonParams,
  estIdMessageBrouillon,
  nouvelIdMessageBrouillon,
  stageCirculation,
  videDate,
  type BrouillonCirculations,
  type BrouillonSection,
  type BrouillonSupSupprimes,
  type BrouillonMessages,
  type BrouillonTerminus,
} from './brouillon';
import { echapper } from './affichage-commun';
import { analyseLienAuth, texteFormulaireMotDePasse, verifieMotDePasse } from './lien-auth';
import type { ModeMedias } from '../core/cycle-medias';
import type { EtatBandeauApplication } from './supervision-logique';
import type { Ecart, EntreesPubliables, Instantane, JourPubliable } from './etat-publiable';
import {
  ecartsPublies,
  horodatageJournal,
  instantanePubliable,
  journalVersCsv,
  libelleObjet,
  OBJETS_JOURNAL,
  resumeEcarts,
} from './etat-publiable';
import { dureeDefilementS, NIVEAUX_VITESSE_TICKER, vitesseTickerValide } from '../core/ticker';
import { cielUtilise, optionsCiel, ordonneCiels } from './meteo-ciel';
import {
  actionGroupeeFacultatifs,
  ajusteSection,
  bandeauSection,
  bornesSectionPossibles,
  celluleTerminus,
  datetimeLocalVersIso,
  decisionBandeauApplication,
  identifiantEcranDeclare,
  recapCycle,
  resumeJournee,
  routageCirculations,
  initiales,
  libelleUtilisateur,
  etatFraicheurEcran,
  propositionAppariementFacultatif,
  isoVersDatetimeLocal,
  messageDepuisFormulaire,
  traductionLocale,
  valeursFormulaireMessage,
  type FormulaireMessage,
} from './supervision-logique';

/**
 * Lien reçu par e-mail (invitation, mot de passe oublié) ? À lire AVANT de
 * créer le fournisseur : le SDK Supabase ouvre la session depuis le fragment
 * d'URL puis l'efface.
 */
const lienAuth = analyseLienAuth(window.location.hash, window.location.search);

const provider = creeProvider();

/**
 * Suffixe d'URL des aperçus. Les pages d'affichage n'acceptent plus le repli
 * silencieux vers la démonstration (C-02) : sans configuration Supabase, un
 * aperçu ouvrirait l'écran neutre. On demande donc explicitement la
 * démonstration — et seulement dans ce cas, la vraie source primant toujours.
 */
function suffixeDemo(): string {
  return configSupabasePresente() ? '' : '&demo=1';
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el;
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

/**
 * Rôles CUMULABLES de l'agent connecté. Les onglets et les commandes s'en
 * déduisent par UNION des droits (src/core/roles.ts) ; ce n'est qu'un confort,
 * la base refuse de toute façon ce qu'elle doit refuser.
 */
let roles: Role[] = [];

/** Raccourci de lecture : l'agent connecté a-t-il ce droit ? */
function peut(droit: Droit): boolean {
  return aLeDroit(roles, droit);
}
/** Profil de l'agent connecté, lu en base : survit à la réouverture d'un onglet. */
let profilConnecte: Profil | null = null;
/** Grilles ACTIVES (celles que voient les écrans) ; l'onglet Horaires lit, lui, toutes les grilles. */
let grilles: Grille[] = [];
let ongletHoraires: OngletHoraires | null = null;
let jour: Jour | null = null;
let dateSel = dateISO(0);
let params: Params | null = null;
let messages: Message[] = [];
let medias: Media[] = [];
let utilisateurs: User[] = [];
let modeles: ModeleMessage[] = [];
let editionModeleId: string | null = null;
let traductionModeleManuelle = false;
/**
 * Écarts RÉELS avec l'état de référence. On ne compte plus les clics :
 * ramener une température de 12 à 8 n'est pas « 2 modifications », c'est
 * aucun écart. La trace permanente des allers-retours vit, elle, au journal
 * d'exploitation (alimenté par déclencheurs côté base).
 */
let reference: Instantane = {};
let referenceFixee = false;
let ecartsCourants: Ecart[] = [];
let modifs = 0;
/** Dernière publication connue, tous postes confondus. */
let dernierePublicationVue: string | null = null;
/** Dernière liste d'écrans lue : la veille par poste entre dans l'état publiable. */
let ecransConnus: EcranInfo[] = [];
/**
 * Journées telles qu'elles sont EN BASE (avant application du brouillon),
 * par date. C'est le point zéro des clés datées de l'instantané : le garder
 * évite de figer dans la référence une journée qui n'est plus affichée.
 */
const joursPublies = new Map<string, Jour>();

/**
 * Copie INDÉPENDANTE d'une journée. Indispensable : plusieurs gestionnaires
 * modifient la circulation sur place (`c.facultatif_actif = …`) avant de la
 * mettre au brouillon. Sans copie, le point de référence serait modifié en
 * même temps que l'état courant et l'écart serait toujours nul.
 */
function copieJour(j: Jour): Jour {
  return { ...j, circulations: j.circulations.map((c) => ({ ...c })) };
}
/**
 * Instant de la dernière écriture (ou publication) : référence pour juger si
 * un écran affiche bien l'état courant. null tant que rien n'a été modifié
 * depuis l'ouverture de la supervision.
 */
let referenceMajMs: number | null = null;
const journal: string[] = [];
let editionMessageId: string | null = null;
let traductionManuelle = false;

// Brouillon de publication (docs/01 §5.6 révisé le 29/08/2026) : rien de ce
// qui suit n'atteint la base tant que « Publier » n'a pas été cliqué.
// `messagesBase`/`paramsBase` gardent le DERNIER ÉTAT RÉEL (celui de la base) ;
// `messages`/`params` restent la vue EFFECTIVE (base + brouillon), déjà lue
// partout ailleurs dans ce fichier pour l'affichage.
let messagesBase: Message[] = [];
let paramsBase: Params | null = null;
const brouillonCirc: BrouillonCirculations = new Map();
/** Trains sup dont la suppression attend la publication (numéro de montée). */
const brouillonSupSupprimes: BrouillonSupSupprimes = new Map();
/**
 * Trains sup NEUFS en attente (numéro de MONTÉE, par date). Seule la création
 * y inscrit un numéro : la nouveauté se MARQUE, elle ne se devine pas. La
 * deviner à partir de `supplementaire && sens === 'montee'` faisait échouer
 * toute modification d'un renfort déjà enregistré (bug du 04/09/2026).
 */
const brouillonSupNeufs: BrouillonSupSupprimes = new Map();
const brouillonTerminus: BrouillonTerminus = new Map();
/** Section exploitée (travaux) en attente de publication, par date. */
const brouillonSection: BrouillonSection = new Map();
const brouillonMessages: BrouillonMessages = new Map();
let brouillonParams: Partial<Params> = {};

function rafraichitMessagesEffectifs(): void {
  messages = appliqueBrouillonMessages(messagesBase, brouillonMessages);
}

function rafraichitParamsEffectifs(): void {
  params = paramsBase ? appliqueBrouillonParams(paramsBase, brouillonParams) : paramsBase;
}

function rafraichitJourEffectif(): void {
  if (jour)
    jour = appliqueBrouillonJour(
      jour,
      brouillonCirc,
      brouillonTerminus,
      brouillonSupSupprimes,
      brouillonSection,
    );
}

/** Reste-t-il des modifications non publiées (toutes catégories confondues) ? */
function rienEnAttente(): boolean {
  return (
    brouillonCirc.size === 0 &&
    brouillonTerminus.size === 0 &&
    brouillonSection.size === 0 &&
    brouillonMessages.size === 0 &&
    Object.keys(brouillonParams).length === 0
  );
}

function dateISO(decalageJours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

/**
 * Grille de la journée affichée : celle qui l'a générée, sinon celle en
 * vigueur à sa date (plus jamais « la première de la liste », qui pouvait
 * être n'importe quelle grille depuis qu'elles vivent en base). Sans journée
 * chargée, la première grille active sert de repli aux listes de trains.
 */
function grilleDuJour(): Grille | null {
  return jour ? grillePourJour(grilles, jour) : (grilles[0] ?? null);
}

function circulationDe(numero: number): Circulation | null {
  return jour?.circulations.find((c) => c.numero === numero) ?? null;
}

function machineDe(nom: string): Machine {
  return (
    params?.machines.find((m) => m.nom === nom) ?? { nom, couleur: '#708DA4', en_service: true }
  );
}

let toastId = 0;
function toast(texte: string): void {
  const t = $('toast');
  t.textContent = texte;
  t.classList.add('on');
  window.clearTimeout(toastId);
  toastId = window.setTimeout(() => t.classList.remove('on'), 3600);
}

/** Écriture IMMÉDIATE (Paramètres, Médias, Écrans...) : déjà en base. */
/**
 * Dates à comparer : celle qui est affichée, plus toutes celles qui portent
 * des modifications en attente. « Publier » les publie TOUTES — les ignorer
 * griserait le bouton alors qu'il reste quelque chose à publier ailleurs.
 */
function datesPubliables(): string[] {
  return [
    ...new Set([
      dateSel,
      ...brouillonCirc.keys(),
      ...brouillonTerminus.keys(),
      ...brouillonSection.keys(),
    ]),
  ];
}

/** Journées telles qu'elles seront publiées (base + brouillon). */
function joursEffectifs(): JourPubliable[] {
  return datesPubliables().map((date) => {
    if (date === dateSel) return { date, jour };
    const base = joursPublies.get(date);
    return {
      date,
      jour: base
        ? appliqueBrouillonJour(
            base,
            brouillonCirc,
            brouillonTerminus,
            brouillonSupSupprimes,
            brouillonSection,
          )
        : null,
    };
  });
}

/** Les mêmes journées, telles qu'elles sont EN BASE : le point de référence. */
function joursDeReference(): JourPubliable[] {
  return datesPubliables().map((date) => ({ date, jour: joursPublies.get(date) ?? null }));
}

/** Instantané de l'état publiable tel que la supervision le connaît. */
function entreesCourantes(): EntreesPubliables {
  return {
    jours: joursEffectifs(),
    messages,
    medias,
    params,
    ecrans: ecransConnus,
    machines: params?.machines ?? [],
    motifs: params?.motifs ?? [],
    ciels: params?.ciels ?? [],
    modeles,
  };
}

function instantaneCourant(): Instantane {
  return instantanePubliable(entreesCourantes());
}

/**
 * Prend l'état courant comme nouvelle référence (chargement, publication).
 * Seule la partie NON DATÉE est figée ici : la partie datée se recalcule à
 * chaque comparaison depuis `joursPublies`, sans quoi un changement de date
 * ferait compter toute l'ancienne journée comme supprimée et toute la
 * nouvelle comme ajoutée.
 */
function fixeReference(): void {
  reference = instantaneCourant();
  referenceFixee = true;
  ecartsCourants = [];
  modifs = 0;
  majBarrePublication();
}

/** Recalcule les écarts et rafraîchit la barre de publication. */
function recalculeEcarts(): void {
  ecartsCourants = ecartsPublies(reference, joursDeReference(), entreesCourantes());
  modifs = ecartsCourants.length;
  majBarrePublication();
}

function majBarrePublication(): void {
  $('etat-pub').innerHTML =
    modifs === 0
      ? 'Tout est publié ✓'
      : `<b>${modifs} modification${modifs > 1 ? 's' : ''}</b> en attente de publication`;
  // Rien à publier : bouton neutre et inerte, plutôt qu'un rouge qui appelle
  // un clic sans effet.
  const bouton = $('btn-publier') as HTMLButtonElement;
  bouton.disabled = modifs === 0;
  bouton.setAttribute('aria-disabled', String(modifs === 0));
  bouton.title =
    modifs === 0
      ? 'Aucune modification depuis la dernière publication'
      : `Publier ${modifs} modification${modifs > 1 ? 's' : ''} sur les 6 gares`;
}

function bump(detail: string): void {
  // referenceMajMs est mis à jour même si la valeur revient ensuite à son
  // point de départ : les écrans ont bel et bien eu à rattraper l'état
  // intermédiaire, leur fraîcheur ne se juge pas sur l'écart net.
  referenceMajMs = Date.now();
  journal.push(detail);
  void rendreEcrans(); // met à jour les pastilles « à jour » / « en retard »
  recalculeEcarts();
}

/**
 * Modification mise EN ATTENTE (Bandeau, Circulations — docs/01 §5.6) :
 * rien n'est encore en base, donc contrairement à `bump()`, la fraîcheur des
 * écrans (`referenceMajMs`) ne doit PAS avancer avant la vraie publication.
 */
/** Modification en attente (brouillon) : n'a encore touché aucun écran. */
function bumpEnAttente(detail: string): void {
  journal.push(detail);
  recalculeEcarts();
}

function erreurVersToast(erreur: unknown): void {
  toast(`⚠ ${String(erreur instanceof Error ? erreur.message : erreur)}`);
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

async function chargeTout(): Promise<void> {
  const demande = dateSel;
  const [g, p, msg, med, mod, j] = await Promise.all([
    provider.getGrilles(),
    provider.getParams(),
    provider.getMessages('le-fayet'),
    provider.listMedias(), // TOUS les médias : un média désactivé doit rester gérable
    provider.getModelesMessages().catch(() => [] as ModeleMessage[]),
    provider.getJour(demande),
  ]);
  grilles = g;
  paramsBase = p;
  rafraichitParamsEffectifs();
  messagesBase = msg;
  rafraichitMessagesEffectifs();
  medias = med;
  modeles = mod;
  // Garde de course : ne pas écraser l'affichage si l'agent a changé de date
  // pendant le chargement (l'en-tête et le tableau seraient désynchronisées).
  if (demande === dateSel) {
    joursPublies.set(demande, copieJour(j)); // état EN BASE, avant brouillon
    jour = j;
    rafraichitJourEffectif(); // réapplique les circulations/terminus en attente pour cette date
  }

  // Une publication faite depuis un AUTRE poste remet la référence à zéro :
  // ce qu'il a publié n'est plus « en attente » pour nous non plus.
  const derniere = await provider.dernierePublication().catch(() => null);
  if (derniere !== null && derniere !== dernierePublicationVue) {
    dernierePublicationVue = derniere;
    referenceFixee = false; // une publication distante redéfinit le point zéro
  }
}

async function rechargeJour(): Promise<void> {
  const demande = dateSel;
  const j = await provider.getJour(demande);
  if (demande !== dateSel) return; // une navigation plus récente a pris le relais
  jour = j;
  rafraichitJourEffectif();
  rendreCirculations();
}

function rendreTout(): void {
  rendreEnTete();
  void ongletHoraires?.rendre().catch(() => {}); // liste des grilles (toutes, actives ou non)
  rendreCirculations();
  rendreCasesGares(); // noms de gares : les grilles sont chargées à ce stade
  rendreSelecteurModeles();
  rendreBibliotheque();
  rendreMessages();
  rendreMedias();
  rendreParametres();
  void rechargeJournal();
  // La liste des écrans (veille par poste) fait partie de l'état publiable :
  // on ne juge l'écart qu'une fois qu'elle est lue.
  void rendreEcrans().then(() => {
    if (referenceFixee) recalculeEcarts();
    else fixeReference();
  });
}

// ---------------------------------------------------------------------------
// En-tête, onglets, connexion
// ---------------------------------------------------------------------------

function rendreEnTete(): void {
  const grille = serviceActif(grilles, dateISO(0));
  $('pill-service').textContent = grille ? grille.libelle : 'Hors saison';
}

/**
 * Pastille « PRODUCTION / BASE DE TEST / DÉMONSTRATION ». Posée une fois au
 * chargement : la source de données ne change pas en cours de session.
 */
function rendreBaseServie(): void {
  const base = baseServie(window.TMB_CONFIG?.supabaseUrl);
  const pastille = $('pill-base');
  pastille.textContent = base.libelle;
  pastille.title = base.detail;
  pastille.className = `pill base ${base.classe}`;
  pastille.style.display = '';
}

/**
 * Applique les rôles CUMULÉS de l'agent : onglets visibles par union des
 * droits, puis cartes et commandes que ses rôles n'ouvrent pas. Masquer vaut
 * mieux que laisser échouer — mais ce n'est qu'un confort : RLS tranche.
 */
function appliqueRoles(): void {
  const visibles: string[] = ongletsVisibles(roles);
  document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => {
    const nom = b.dataset.t ?? '';
    b.style.display = visibles.includes(nom) ? '' : 'none';
    b.classList.toggle('on', nom === visibles[0]);
  });
  document.querySelectorAll('.onglet').forEach((o) => {
    o.classList.toggle('on', o.id === `t-${visibles[0]}`);
  });

  // Bandeau : la bibliothèque de modèles est proposée à la saisie pour tous,
  // mais son ADMINISTRATION revient au chef d'exploitation.
  montreSi('carte-modeles', peut('modeles'));

  // Écrans : déclarer ou oublier un poste relève de l'informatique, tout comme
  // la veille de nuit GLOBALE — la veille propre à un poste, elle, reste à
  // l'exploitation, sur la carte de l'écran.
  montreSi('declaration-ecran', peut('ecrans.declarer'));
  montreSi('veille-globale', peut('parametres.technique'));

  // Paramètres : chaque carte a son droit.
  montreSi('carte-machines', peut('parametres.exploitation'));
  montreSi('carte-motifs', peut('parametres.exploitation'));
  montreSi('carte-ciels', peut('parametres.exploitation'));
  montreSi('carte-a-quai', peut('parametres.exploitation'));
  montreSi('carte-users', peut('comptes.lire'));
  montreSi('carte-journal', peut('journal'));
  montreSi('carte-purge', peut('journal.purger'));
}

/** Affiche ou masque un bloc, sans lever si la page ne le contient pas. */
function montreSi(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

/**
 * Badges de rôle d'un compte. Chacun garde la largeur fixe qui aligne les
 * colonnes des lignes utilisateur ; ils passent à la ligne proprement quand un
 * compte en cumule plusieurs. Un compte sans aucun rôle le dit, plutôt que de
 * n'afficher rien du tout.
 */
/**
 * Une ligne de l'annuaire : badges, cases à cocher des rôles, activation et
 * commandes. Tout ce que l'agent connecté n'a pas le droit de faire est
 * désactivé ET expliqué — un bouton qui échoue sans dire pourquoi envoie
 * l'agent chercher une panne qui n'existe pas.
 */
function ligneUtilisateur(u: User): string {
  const moi = profilConnecte?.user_id ?? '';
  const cases = ROLES.map((r) => {
    const motif = motifCaseVerrouillee(roles, moi, u, r, utilisateurs);
    const coche = u.roles.includes(r) ? 'checked' : '';
    const bloque = motif ? 'disabled' : '';
    const titre = motif ?? DESCRIPTION_ROLE[r];
    return `<label class="case-role${motif ? ' verrouillee' : ''}" title="${echapper(titre)}">
        <input type="checkbox" data-role="${r}" ${coche} ${bloque} />${echapper(LIBELLE_ROLE[r])}
      </label>`;
  }).join('');

  const motifCompte = motifCompteVerrouille(roles, moi, u, utilisateurs);
  const verrou = motifCompte ? 'disabled' : '';
  const titreCompte = motifCompte ? ` title="${echapper(motifCompte)}"` : '';
  return `
    <div class="user-row" data-user="${echapper(u.user_id)}">
      <div class="user-identite">
        <b>${echapper(u.nom)}</b>
        <span class="user-email">${echapper(u.email)}</span>
      </div>
      <div class="user-badges">${badgesRoles(u.roles)}</div>
      <div class="user-roles">${cases}</div>
      <label class="switch"${titreCompte}><input type="checkbox" ${u.actif ? 'checked' : ''} data-champ="actif" ${verrou} />Actif</label>
      <button class="leger" data-champ="reset">Réinit. mdp</button>
      <button class="leger danger" data-champ="supprimer" ${verrou}${titreCompte}>Supprimer</button>
    </div>`;
}

/**
 * Cases à cocher du formulaire d'invitation : uniquement les rôles que l'agent
 * connecté peut attribuer. Un administrateur ne peut donc pas inviter un
 * compte technique, et réciproquement.
 */
function rendreCasesInvitation(): void {
  const bloc = document.getElementById('user-nouveau-roles');
  if (!bloc) return;
  const attribuables = rolesAttribuables(roles);
  bloc.innerHTML =
    attribuables.length === 0
      ? '<span class="sous">Vos rôles ne vous permettent d’attribuer aucun rôle.</span>'
      : attribuables
          .map(
            (r) =>
              `<label class="case-role" title="${echapper(DESCRIPTION_ROLE[r])}">
                 <input type="checkbox" data-role="${r}" />${echapper(LIBELLE_ROLE[r])}
               </label>`,
          )
          .join('');
  ($('btn-user-inviter') as HTMLButtonElement).disabled = attribuables.length === 0;
}

function badgesRoles(liste: readonly Role[]): string {
  if (liste.length === 0) return '<span class="role-tag role-aucun">SANS RÔLE</span>';
  return liste
    .map(
      (r) =>
        `<span class="role-tag role-${r}" title="${echapper(DESCRIPTION_ROLE[r])}">${LIBELLE_ROLE[
          r
        ].toUpperCase()}</span>`,
    )
    .join('');
}

function initOnglets(): void {
  document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav.tabs button').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.onglet').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $(`t-${b.dataset.t}`).classList.add('on');
      // Un élément d'onglet masqué a une largeur nulle : l'aperçu du bandeau
      // doit être remesuré une fois l'onglet réellement affiché.
      if (b.dataset.t === 'parametres' && params) {
        majApercuTicker(vitesseTickerValide(params.vitesse_ticker_px_s));
      }
    });
  });
}

async function apresConnexion(): Promise<void> {
  $('connexion').style.display = 'none';
  $('tabs').style.display = '';
  $('contenu').style.display = '';
  $('barre-publier').style.display = '';
  $('bloc-user').style.display = '';
  $('user-nom').textContent = libelleUtilisateur(profilConnecte);
  $('user-nom').title = profilConnecte?.email ?? '';
  $('avatar').textContent = initiales(profilConnecte);
  $('user-role').innerHTML = badgesRoles(roles);
  appliqueRoles();
  try {
    await chargeTout();
  } catch (erreur) {
    // Jamais d'écran vide et muet : l'agent doit savoir pourquoi
    erreurVersToast(erreur);
    $('sous-titre-jour').textContent = '— données indisponibles';
    // Ne PAS écraser le message précis déjà affiché par erreurVersToast (par
    // exemple « Could not find the 'sans_voyageurs' column » quand une
    // migration SQL n'a pas été passée) : on l'enrichit au lieu de le perdre.
    const $t = $('toast');
    $t.textContent = `${$t.textContent} — chargement impossible, vérifiez la connexion ou les migrations SQL, puis rechargez la page`;
    return;
  }
  rendreTout();

  provider.onChange(() => {
    // Pas de re-rendu pendant une saisie (le rafraîchissement suivra)
    const actif = document.activeElement;
    if (actif && $('contenu').contains(actif) && actif.matches('input, select, textarea')) return;
    void chargeTout()
      .then(rendreTout)
      .catch(() => {}); // l'affichage garde le dernier état connu
  });
  window.setInterval(() => void rendreEcrans(), 10_000);
}

// ---------------------------------------------------------------------------
// Onglet Circulations
// ---------------------------------------------------------------------------

function heurePassee(depart: string): boolean {
  if (dateSel !== dateISO(0)) return false;
  const d = new Date();
  const maintenant = d.getHours() * 3600 + d.getMinutes() * 60;
  return maintenant > heureVersSecondes(depart) + 75 * 60;
}

function optionsMotifs(selection: string | null): string {
  const motifs = params?.motifs.map((m) => m.fr) ?? [];
  return ['—', ...motifs]
    .map((m) => `<option ${m === (selection ?? '—') ? 'selected' : ''}>${echapper(m)}</option>`)
    .join('');
}

/**
 * Trains effectifs de la journée affichée, indexés par numéro. Recalculés à
 * chaque rendu du tableau : ils portent les passages APRÈS section et bascule
 * Bellevue, seule vérité sur ce que les écrans montreront.
 */
let trainsEffectifs = new Map<number, TrainJour>();

/** Vue « train de grille » d'un train sup, pour réutiliser le même rendu. */
function commeTrainGrille(c: Circulation): TrainGrille {
  return {
    numero: c.numero,
    express: false,
    facultatif: false,
    velos: false,
    passages: c.passages ?? [],
  };
}

function ligneCirculation(
  train: TrainGrille,
  sens: 'montee' | 'descente',
  lectureSeule = false,
): string {
  const c = circulationDe(train.numero);
  if (!c) return '';
  const verrou = lectureSeule ? ' disabled' : '';
  const montee = sens === 'montee';
  const circMontee = montee ? c : circulationDe(train.numero - 1);
  const rameEffective = circMontee?.rame ?? c.rame;
  const machine = machineDe(rameEffective);
  const inactif = c.facultatif && !c.facultatif_actif;
  const depart = train.passages[0]?.d ?? train.passages[0]?.a ?? '00:00:00';
  const heure = formatHeure(heureVersSecondes(depart));
  const n = c.numero;

  const rame = montee
    ? `<select data-action="rame" data-numero="${n}"${verrou}>${
        // Rame absente des machines (renommée ou retirée) : on la garde en
        // tête pour ne pas afficher silencieusement une autre rame.
        (params?.machines ?? []).some((m) => m.nom === rameEffective)
          ? ''
          : `<option selected>${echapper(rameEffective)}</option>`
      }${(params?.machines ?? [])
        .filter((m) => m.en_service || m.nom === rameEffective)
        .map(
          (m) => `<option ${m.nom === rameEffective ? 'selected' : ''}>${echapper(m.nom)}</option>`,
        )
        .join('')}</select>`
    : `<span class="rame-fixe"><span class="p" style="background:${machine.couleur};${
        machine.cercle ? `box-shadow:0 0 0 2px ${machine.cercle};` : ''
      }"></span>${echapper(rameEffective)}<small>(rotation)</small></span>`;

  // Cellule Terminus : décidée par `celluleTerminus()`, PURE et testée. Un
  // train supplémentaire y est traité en premier — son terminus vient de ses
  // passages, pas de la colonne `terminus`, qui ne le concerne pas.
  const terminus = celluleTerminus({
    circulation: c,
    circulationMontee: circMontee,
    sens,
    express: train.express,
    inactif,
    lectureSeule,
    nomGare: nomDeGare,
    passagesEffectifs: trainsEffectifs.get(c.numero)?.passages ?? null,
  });

  const facultatif = c.facultatif
    ? `<label class="switch"><input type="checkbox" data-action="actif" data-numero="${n}" ${
        c.facultatif_actif ? 'checked' : ''
      }${verrou} />${c.facultatif_actif ? 'Activé' : 'Non activé'}</label>`
    : '<span style="color:#B4C4D4">—</span>';

  // Course à vide : elle reste pilotable en exploitation (rame, rotation,
  // terminus) mais n'est proposée ni au statut ni au motif voyageurs.
  const aVide = c.sans_voyageurs === true;
  const sansVoyageurs = `<label class="switch"><input type="checkbox" data-action="sans-voyageurs" data-numero="${n}" ${
    aVide ? 'checked' : ''
  }${verrou} />${aVide ? 'À vide' : 'Voyageurs'}</label>`;

  const statut = inactif
    ? '<span style="color:#B4C4D4;font-weight:700">Ne circule pas — absent des écrans</span>'
    : `<span class="seg">
        <button class="${c.statut === 'ok' ? 'on-ok' : ''}" data-action="statut-ok" data-numero="${n}"${verrou}>À l'heure</button>
        <button class="${c.statut === 'retard' ? 'on-retard' : ''}" data-action="statut-retard" data-numero="${n}"${verrou}>Retard</button>
        <button class="${c.statut === 'supprime' ? 'on-supp' : ''}" data-action="statut-supprime" data-numero="${n}"${verrou}>Supprimé</button>
      </span>${
        c.statut === 'retard'
          ? `<span class="retard-ctrl"><button data-action="retard-moins" data-numero="${n}"${verrou}>−</button><span class="val">+${c.retard_min} min</span><button data-action="retard-plus" data-numero="${n}"${verrou}>+</button></span>`
          : ''
      }`;

  return `<tr class="${heurePassee(depart) ? 'passe' : ''} ${inactif ? 'inactif' : ''} ${
    aVide ? 'a-vide' : ''
  } ${montee ? '' : 'paire-fin'}">
    <td class="h-dep">${heure}<small>${echapper(
      libelleTrain(
        { numero: n, supplementaire: c.supplementaire },
        (jour?.circulations ?? []).map((x) => ({
          numero: x.numero,
          supplementaire: x.supplementaire,
        })),
      ),
    )}</small>${
      c.supplementaire
        ? `<span class="badge-sup">SUP</span>${
            montee && !lectureSeule
              ? `<button class="leger btn-sup-suppr" data-action="sup-supprimer" data-numero="${n}">Supprimer ce train</button>`
              : ''
          }`
        : ''
    }</td>
    <td><span class="sens-tag ${montee ? 'up' : 'down'}">${montee ? '↗ Montée' : '↙ Descente'}</span>${
      train.express
        ? `<span class="exp-tag"><img src="${__MOTRICE_MARINE__}" alt="" /> EXPRESS</span>`
        : ''
    }${train.velos ? '<span class="velo-tag">🚲</span>' : ''}</td>
    <td>${rame}</td>
    <td>${terminus}</td>
    <td>${facultatif}</td>
    <td>${sansVoyageurs}${
      aVide
        ? '<small class="a-vide-note">ne circule pas pour les voyageurs — absent des écrans</small>'
        : ''
    }</td>
    <td>${statut}</td>
    <td><select data-action="motif" data-numero="${n}" ${inactif || lectureSeule ? 'disabled' : ''}>${optionsMotifs(c.motif ?? null)}</select></td>
  </tr>`;
}

// -------------------------------------------------------------------------
// SECTION EXPLOITÉE (travaux) — « une partie seulement de la ligne est
// exploitée ». Même concept que « Terminus Bellevue », qui n'en est qu'un
// cas particulier : la section est la borne extérieure, la colonne Terminus
// ne peut que réduire davantage (voir tronqueTrain()).
// -------------------------------------------------------------------------

/** Section actuellement affichée (base + brouillon). */
const sectionAffichee = (): SectionJour => {
  const { debut, fin } = sectionDuJour(
    jour ?? { gare_debut: GARE_DEBUT_DEFAUT, gare_fin: GARE_FIN_DEFAUT },
  );
  return {
    gare_debut: debut,
    gare_fin: fin,
    message_troncon_fr: jour?.message_troncon_fr ?? null,
    message_troncon_en: jour?.message_troncon_en ?? null,
  };
};

const optionsGares = (liste: GareId[], choisie: GareId): string =>
  liste
    .map(
      (g) =>
        `<option value="${echapper(g)}"${g === choisie ? ' selected' : ''}>${echapper(
          nomDeGare(g),
        )}</option>`,
    )
    .join('');

const rendBlocSection = (): void => {
  const section = sectionAffichee();
  const complete = sectionComplete(section);
  // RÈGLE : un réglage ACTIF n'est JAMAIS replié derrière un lien. Le lien
  // « Restreindre la ligne » ne masque les bornes que si la ligne est
  // ENTIÈRE. Dès qu'elle est restreinte, elles s'affichent en clair et mises
  // en évidence : une ligne partiellement exploitée est l'information la plus
  // importante de la journée, pas une option avancée.
  const deplie = !complete || $('bloc-section').dataset.ouvert === '1';
  $('bornes-section').style.display = deplie ? '' : 'none';
  $('btn-section').style.display = deplie ? 'none' : '';
  $('reglage-section').className = `reglage${complete ? '' : ' actif'}`;
  // La carte (message des gares fermées, rétablissement) ne sert que quand la
  // ligne est effectivement restreinte ou qu'on vient de déplier.
  $('bloc-section').style.display = deplie ? '' : 'none';

  const selDebut = $('sel-section-debut') as HTMLSelectElement;
  const selFin = $('sel-section-fin') as HTMLSelectElement;
  selDebut.innerHTML = optionsGares(
    bornesSectionPossibles('debut', section.gare_fin),
    section.gare_debut,
  );
  selFin.innerHTML = optionsGares(
    bornesSectionPossibles('fin', section.gare_debut),
    section.gare_fin,
  );

  ($('msg-troncon-fr') as HTMLInputElement).value = section.message_troncon_fr ?? '';
  ($('msg-troncon-en') as HTMLInputElement).value = section.message_troncon_en ?? '';

  // Aperçu du DÉFAUT : l'exploitant voit ce que les écrans diront s'il
  // n'écrit rien — un écran de gare fermée n'est jamais muet.
  const defaut = messageTronconDefaut(section.gare_debut, section.gare_fin, nomDeGare);
  const fermees = ORDRE_GARES.filter((g) => gareHorsSection(section, g)).map(nomDeGare);
  $('apercu-troncon').innerHTML = complete
    ? 'Ligne entière : aucune gare fermée.'
    : `Gares fermées : <b>${echapper(fermees.join(', '))}</b>. À défaut de message saisi, leur écran affichera « ${echapper(defaut.fr)} » / « ${echapper(defaut.en)} ».`;

  const bandeau = bandeauSection(section, nomDeGare);
  $('bandeau-report').style.display = bandeau === null ? 'none' : '';
  $('bandeau-report').textContent = bandeau ?? '';
};

/** Met la section en attente de publication et rafraîchit tout ce qui en dépend. */

function rendreCirculations(): void {
  const grille = grilleDuJour();
  if (!grille || !jour) return;
  ($('date-picker') as HTMLInputElement).value = dateSel;
  const dateAffichee = new Date(`${dateSel}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  $('sous-titre-jour').textContent = `du ${dateAffichee}`;
  $('chip-auj').classList.toggle('on', dateSel === dateISO(0));
  $('chip-dem').classList.toggle('on', dateSel === dateISO(1));
  // Hors saison : aucun train, contrôles désactivés. Date passée jamais
  // exploitée : aperçu théorique en LECTURE SEULE (pas d'historique inventé).
  // Les dates à venir sont créées automatiquement à l'ouverture (provider).
  const horsSaison = jour.hors_saison === true;
  const lectureSeule = !horsSaison && jour.enregistre === false;
  ($('chk-terminus') as HTMLInputElement).disabled = horsSaison || lectureSeule;
  ($('sel-terminus-train') as HTMLSelectElement).disabled = horsSaison || lectureSeule;
  ($('btn-reinitialiser') as HTMLButtonElement).disabled = horsSaison || lectureSeule;
  // « + Train supplémentaire » restait ACTIF sur une journée en lecture seule
  // ou hors saison, alors que son gestionnaire refuse d'ouvrir le formulaire :
  // une commande qui ne peut rien faire ne doit pas rester cliquable.
  ($('btn-train-sup') as HTMLButtonElement).disabled = horsSaison || lectureSeule;

  // RANG 1 — quelle journée : date en toutes lettres, service complet, état.
  // Tous les libellés viennent de `resumeJournee()`, PURE et testée.
  const resume = resumeJournee(jour, serviceActif(grilles, dateSel));
  $('jour-lettres').textContent = resume.jourEnLettres;
  $('service-tag').textContent = resume.service;
  // Plus de troncature : l'étiquette a sa propre ligne. Le title reste utile
  // aux lecteurs d'écran et aux postes très étroits.
  $('service-tag').title = resume.service;
  const etatJour = $('etat-jour');
  etatJour.textContent = resume.etatLibelle;
  etatJour.className = `etat-jour ${resume.etat}`;

  // RANG 2 — compteurs des réglages.
  $('compte-facultatifs').textContent = resume.facultatifsLibelle;
  $('compte-sups').textContent = resume.supsLibelle;

  // Bascule Terminus Bellevue « à partir du TRAIN N ». Même règle que la
  // section : quand elle est ACTIVE, elle est mise en évidence, jamais
  // discrète.
  const flag = jour.terminus_bellevue;
  ($('chk-terminus') as HTMLInputElement).checked = flag !== false;
  $('bloc-terminus').className = `terminus${resume.terminusActif ? ' actif' : ''}`;
  const sel = $('sel-terminus-train') as HTMLSelectElement;
  sel.innerHTML = grille.montees
    .map(
      (m) =>
        `<option value="${m.numero}" ${
          flag !== false && flag.a_partir_du_train === m.numero ? 'selected' : ''
        }>TRAIN ${m.numero}${m.numero === 1 ? ' (journée entière)' : ''}</option>`,
    )
    .join('');

  // Section exploitée : bornes, message des gares fermées, bandeau.
  rendBlocSection();
  ($('sel-section-debut') as HTMLSelectElement).disabled = horsSaison || lectureSeule;
  ($('sel-section-fin') as HTMLSelectElement).disabled = horsSaison || lectureSeule;
  ($('btn-section') as HTMLButtonElement).disabled = horsSaison || lectureSeule;
  ($('msg-troncon-fr') as HTMLInputElement).disabled = horsSaison || lectureSeule;
  ($('msg-troncon-en') as HTMLInputElement).disabled = horsSaison || lectureSeule;

  // Action groupée sur les facultatifs + avertissement de rotation
  const btnFac = $('btn-facultatifs') as HTMLButtonElement;
  const groupe = actionGroupeeFacultatifs(jour.circulations, dateSel);
  btnFac.textContent = groupe.libelle;
  btnFac.disabled = horsSaison || lectureSeule || !groupe.disponible;
  btnFac.title = groupe.disponible
    ? 'Bascule en une fois tous les trains facultatifs de la journée affichée'
    : 'Aucun train facultatif ce jour';

  const avert = $('avert-rotation');
  const sansRetour = horsSaison ? [] : monteesSansRetour(grille, jour);
  avert.style.display = sansRetour.length === 0 ? 'none' : '';
  avert.innerHTML = sansRetour
    .map(
      (numero) => `⚠ <b>TRAIN ${numero}</b> monte des voyageurs sans descente voyageurs ensuite.`,
    )
    .join('<br />');

  // Trains tels que le MOTEUR les rendra : la cellule Terminus d'un train
  // supplémentaire doit annoncer ce que les écrans afficheront, section et
  // bascule Bellevue appliquées. Les facultatifs non activés et les courses à
  // vide n'y figurent pas — leur ligne retombe sur les passages enregistrés.
  trainsEffectifs = new Map(trainsDuJour(grille, jour).map((t) => [t.numero, t]));

  // Ordre APPARIÉ : chaque montée suivie de sa descente (même rotation)
  const tbody = document.querySelector('#tab-circ tbody');
  if (!tbody) return;
  if (horsSaison) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="padding:22px;color:var(--sec);font-weight:700">Aucun service ne circule à cette date.</td></tr>';
    return;
  }
  tbody.innerHTML =
    grille.montees
      .map((montee) => {
        const descente = grille.descentes.find((d) => d.numero === montee.numero + 1);
        return (
          ligneCirculation(montee, 'montee', lectureSeule) +
          (descente ? ligneCirculation(descente, 'descente', lectureSeule) : '')
        );
      })
      .join('') +
    // Trains SUPPLÉMENTAIRES : absents de la grille, ils portent leurs propres
    // passages. On fabrique le TrainGrille équivalent pour réutiliser
    // exactement le même rendu de ligne.
    (jour?.circulations ?? [])
      .filter((c) => c.supplementaire && c.sens === 'montee')
      .sort((a, b) => a.numero - b.numero)
      .map((montee) => {
        const descente = jour?.circulations.find(
          (c) => c.supplementaire && c.numero === montee.numero + 1,
        );
        return (
          ligneCirculation(commeTrainGrille(montee), 'montee', lectureSeule) +
          (descente ? ligneCirculation(commeTrainGrille(descente), 'descente', lectureSeule) : '')
        );
      })
      .join('');
}

/**
 * Met une circulation en attente de publication (docs/01 §5.6) : plus
 * aucune écriture réseau ici — juste le brouillon et le rendu local. Ne
 * peut pas échouer, donc plus besoin de valeur de retour à vérifier par
 * les appelants (l'ancien risque de « faux succès » du 25/08 ne s'applique
 * qu'à une écriture réelle, qui n'a lieu qu'à la publication).
 */
function stageCirculationEtRafraichit(c: Circulation, detail: string): void {
  stageCirculation(brouillonCirc, c);
  rafraichitJourEffectif();
  bumpEnAttente(detail);
  rendreCirculations();
}

function initCirculations(): void {
  $('btn-jour-prec').addEventListener('click', () => void changeDate(-1));
  $('btn-jour-suiv').addEventListener('click', () => void changeDate(1));
  $('chip-auj').addEventListener('click', () => void allerDate(dateISO(0)));
  $('chip-dem').addEventListener('click', () => void allerDate(dateISO(1)));
  $('date-picker').addEventListener('change', (e) => {
    void allerDate((e.target as HTMLInputElement).value);
  });
  // Action groupée sur les trains facultatifs de la journée affichée.
  // Même chemin d'écriture que les modifications unitaires : la journée est
  // créée si besoin et le nombre de lignes réellement écrites est contrôlé.
  $('btn-facultatifs').addEventListener('click', () => {
    if (!jour || jour.hors_saison || jour.enregistre === false) return;
    // `dateSel` change dès le clic sur une autre date, `jour` seulement au
    // retour du réseau : sans ce contrôle, une action groupée lancée pendant
    // ce laps écrirait sur la journée PRÉCÉDENTE en annonçant la nouvelle.
    if (jour.date !== dateSel) {
      toast('Chargement de la journée en cours — réessayez dans un instant');
      return;
    }
    const groupe = actionGroupeeFacultatifs(jour.circulations, dateSel);
    if (!groupe.disponible) return;
    if (!window.confirm(groupe.confirmation)) return;

    // Copies : le drapeau « sans voyageurs » et tout le reste sont conservés
    // tels quels — cette action ne touche QUE facultatif_actif. Mise EN
    // ATTENTE comme les modifications unitaires (docs/01 §5.6) : aucune
    // écriture ici, juste le brouillon — donc plus de risque d'écriture
    // partielle à ce stade (elle ne peut plus survenir qu'à la publication).
    const cibles = groupe.numeros
      .map((numero) => jour?.circulations.find((c) => c.numero === numero))
      .filter((c): c is Circulation => c !== undefined)
      .map((c) => ({ ...c, facultatif_actif: groupe.activer }));

    for (const cible of cibles) stageCirculation(brouillonCirc, cible);
    rafraichitJourEffectif();
    bumpEnAttente(
      `${cibles.length} train(s) facultatif(s) ${groupe.activer ? 'activé(s)' : 'désactivé(s)'} (en attente)`,
    );
    rendreCirculations();
    const invisibles = groupe.aVide.length;
    toast(
      groupe.activer
        ? `${cibles.length} train(s) facultatif(s) activé(s), en attente de publication${
            invisibles > 0
              ? ` — dont ${invisibles} sans voyageurs, qui ${
                  invisibles === 1 ? 'restera invisible' : 'resteront invisibles'
                }`
              : ''
          }`
        : `${cibles.length} train(s) facultatif(s) désactivé(s), en attente de publication`,
    );
  });
  // -------------------------------------------------------------------------
  // Train supplémentaire
  // -------------------------------------------------------------------------
  /** Gares desservies cochées, dans l'ordre de la ligne. */
  const garesCochees = (id: string): GareId[] =>
    [...document.querySelectorAll<HTMLInputElement>(`#${id} input[type=checkbox]`)]
      .filter((c) => c.checked)
      .map((c) => c.value as GareId);

  /** Cases d'un sens : origine et terminus toujours cochés ET verrouillés. */
  const rendCasesGaresSup = (id: string, ordre: GareId[], obligatoires: GareId[]): void => {
    $(id).innerHTML = ordre
      .map((g) => {
        const impose = obligatoires.includes(g);
        return `<label><input type="checkbox" value="${echapper(g)}" ${
          impose ? 'checked disabled' : 'checked'
        } /> ${echapper(nomDeGare(g))}</label>`;
      })
      .join('');
  };

  /**
   * Terminus proposés pour un train supplémentaire : TOUTES les gares situées
   * après la gare de départ dans la section du jour — le renfort peut être
   * limité à Saint-Gervais ou Motivon, pas seulement aux trois du haut. La
   * bascule Terminus Bellevue retire en plus ce qui est au-dessus de
   * Bellevue, puisque le train n'y circulerait pas.
   */
  const terminusPossibles = (): GareId[] => {
    const section = sectionAffichee();
    const possibles = terminusPossiblesSup(section);
    if (jour?.terminus_bellevue === false) return possibles;
    const plafond = ORDRE_GARES.indexOf('bellevue');
    return possibles.filter((g) => ORDRE_GARES.indexOf(g) <= plafond);
  };

  /** Aperçu des horaires CALCULÉS, chaque heure restant modifiable. */
  const majApercuSup = (): void => {
    const grille = grilleDuJour();
    const depart = ($('sup-depart') as HTMLInputElement).value;
    const conteneur = $('sup-apercu');
    if (!grille || !depart) {
      conteneur.innerHTML = '<i>Indiquez une heure de départ.</i>';
      delete conteneur.dataset.rotation;
      return;
    }
    try {
      const rotation = construitRotationSup(grille, {
        heureDepart_s: heureVersSecondes(depart),
        garesMontee: garesCochees('sup-gares-montee'),
        garesDescente: garesCochees('sup-gares-descente'),
        battement_s: (Number(($('sup-battement') as HTMLInputElement).value) || 5) * 60,
      });
      const lignes = (titre: string, passages: PassageGrille[], sens: string): string =>
        `<div class="sens"><b>${titre}</b>${passages
          .map(
            (p, i) =>
              `<span class="etape"><i>${echapper(nomDeGare(p.gare))}</i>${
                p.a === undefined
                  ? ''
                  : `<input type="time" step="1" data-sup="${sens}" data-i="${i}" data-champ="a" value="${echapper(p.a)}" title="Arrivée" />`
              }${
                p.d === undefined
                  ? ''
                  : `<input type="time" step="1" data-sup="${sens}" data-i="${i}" data-champ="d" value="${echapper(p.d)}" title="Départ" />`
              }</span>`,
          )
          .join('')}</div>`;
      conteneur.innerHTML =
        lignes('Montée', rotation.montee, 'montee') +
        lignes('Descente', rotation.descente, 'descente');
      conteneur.dataset.rotation = JSON.stringify(rotation);
    } catch (erreur) {
      // Aucune heure inventée : on dit pourquoi le calcul échoue.
      conteneur.innerHTML = `<span class="erreur-sup">${echapper(
        erreur instanceof Error ? erreur.message : String(erreur),
      )}</span>`;
      delete conteneur.dataset.rotation;
    }
  };

  const rendFormulaireSup = (): void => {
    const grille = grilleDuJour();
    if (!grille) return;
    const sel = $('sup-terminus') as HTMLSelectElement;
    const choisi = sel.value;
    const possibles = terminusPossibles();
    sel.innerHTML = possibles
      .map((g) => `<option value="${echapper(g)}">${echapper(nomDeGare(g))}</option>`)
      .join('');
    // Défaut : le Col de Voza s'il est dans la section (cas courant du
    // renfort), sinon le dernier terminus possible.
    const defaut = possibles.includes('col-de-voza')
      ? 'col-de-voza'
      : (possibles[possibles.length - 1] ?? 'nid-daigle');
    sel.value = possibles.includes(choisi as GareId) ? choisi : defaut;

    // La gare de DÉPART est imposée : c'est la gare de début de ligne du
    // jour (`gare_debut`), pas Le Fayet en dur — dans une section
    // [Col de Voza, Nid d'Aigle], le renfort part du Col de Voza.
    const depart = sectionAffichee().gare_debut;
    const terminus = sel.value as GareId;
    // « Départ : <gare> » et non « Départ de <gare> » : « de Le Fayet » est
    // fautif, et la gare de départ varie désormais avec la section.
    $('sup-libelle-depart').textContent = `Départ : ${nomDeGare(depart)}`;
    const ordreMontee = ORDRE_GARES.slice(
      ORDRE_GARES.indexOf(depart),
      ORDRE_GARES.indexOf(terminus) + 1,
    );
    const ordreDescente = [...ordreMontee].reverse();
    rendCasesGaresSup('sup-gares-montee', ordreMontee, [depart, terminus]);
    rendCasesGaresSup('sup-gares-descente', ordreDescente, [terminus, depart]);

    const rame = $('sup-rame') as HTMLSelectElement;
    rame.innerHTML = (params?.machines ?? [])
      .filter((m) => m.en_service)
      .map((m) => `<option>${echapper(m.nom)}</option>`)
      .join('');
    majApercuSup();
  };

  $('btn-train-sup').addEventListener('click', () => {
    if (!jour || jour.hors_saison || jour.enregistre === false) return;
    const bloc = $('form-train-sup');
    const ouvert = bloc.style.display !== 'none';
    bloc.style.display = ouvert ? 'none' : '';
    if (ouvert) return;
    const battement = $('sup-battement') as HTMLInputElement;
    if (!battement.value) battement.value = '5';
    rendFormulaireSup();
  });
  $('btn-sup-annuler').addEventListener('click', () => {
    $('form-train-sup').style.display = 'none';
  });
  $('sup-terminus').addEventListener('change', rendFormulaireSup);
  $('sup-depart').addEventListener('change', majApercuSup);
  $('sup-battement').addEventListener('change', majApercuSup);
  $('sup-gares-montee').addEventListener('change', majApercuSup);
  $('sup-gares-descente').addEventListener('change', majApercuSup);

  // Une heure corrigée à la main l'emporte sur le calcul : un train qui ne
  // s'arrête pas gagne quelques secondes que la grille ignore.
  $('sup-apercu').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    if (!champ.dataset.sup) return;
    const conteneur = $('sup-apercu');
    const brut = conteneur.dataset.rotation;
    if (!brut) return;
    const rotation = JSON.parse(brut) as RotationSup;
    const liste = champ.dataset.sup === 'montee' ? rotation.montee : rotation.descente;
    const passage = liste[Number(champ.dataset.i)];
    if (passage) {
      const valeur = champ.value.length === 5 ? `${champ.value}:00` : champ.value;
      if (champ.dataset.champ === 'a') passage.a = valeur;
      else passage.d = valeur;
    }
    conteneur.dataset.rotation = JSON.stringify(rotation);
  });

  $('btn-sup-valider').addEventListener('click', () => {
    // Même garde que l'ouverture du formulaire : sans elle, une journée en
    // lecture seule pouvait encore recevoir un renfort.
    if (!jour || jour.hors_saison || jour.enregistre === false) return;
    const brut = $('sup-apercu').dataset.rotation;
    if (!brut) {
      toast('Horaires incalculables — vérifiez l’heure de départ et les gares desservies');
      return;
    }
    const rotation = JSON.parse(brut) as RotationSup;
    const numero = prochainNumeroSup(jour.circulations.map((c) => c.numero));
    const base: Circulation = {
      date: dateSel,
      numero,
      sens: 'montee',
      express: false,
      facultatif: false,
      facultatif_actif: false,
      velos: false,
      rame: ($('sup-rame') as HTMLSelectElement).value,
      // ATTENTION : cette colonne ne dit RIEN du terminus du renfort, qui est
      // le dernier de ses `passages`. Elle ne porte que deux valeurs (contrainte
      // CHECK) et ne sert qu'à la bascule Terminus Bellevue, qui s'applique
      // aussi à un train sup. Ne JAMAIS l'afficher comme terminus : c'est ce
      // qui annonçait « Nid d'Aigle » pour un renfort créé jusqu'au Col de
      // Voza (voir `celluleTerminus()`).
      terminus: jour.terminus_bellevue === false ? 'nid-daigle' : 'bellevue',
      statut: 'ok',
      retard_min: 0,
      motif: null,
      sans_voyageurs: ($('sup-sans-voyageurs') as HTMLInputElement).checked,
      supplementaire: true,
      passages: rotation.montee,
    };
    stageCirculation(brouillonCirc, base);
    stageCirculation(brouillonCirc, {
      ...base,
      numero: numero + 1,
      sens: 'descente',
      // Seule la MONTÉE peut être à vide : la descente ramène les voyageurs,
      // c'est la raison d'être du train de renfort.
      sans_voyageurs: false,
      passages: rotation.descente,
    });
    brouillonSupSupprimes.get(dateSel)?.delete(numero);
    // MARQUE de nouveauté : c'est le seul endroit qui l'inscrit. La
    // publication s'en sert pour router la rotation vers `creerTrainSup()`
    // plutôt que vers l'écriture groupée.
    const neufs = brouillonSupNeufs.get(dateSel) ?? new Set<number>();
    neufs.add(numero);
    brouillonSupNeufs.set(dateSel, neufs);
    rafraichitJourEffectif();
    rendreCirculations();
    $('form-train-sup').style.display = 'none';
    bumpEnAttente(`train supplémentaire ${numero}/${numero + 1} créé (en attente)`);
    toast('Train supplémentaire créé — en attente de publication');
  });

  $('btn-reinitialiser').addEventListener('click', () => {
    // Seule action de l'onglet Circulations à rester IMMÉDIATE (docs/01 §5.6) :
    // c'est un retour à zéro déjà protégé par sa propre confirmation explicite,
    // pas une modification à composer avant publication.
    if (
      !window.confirm(
        `Réinitialiser IMMÉDIATEMENT la journée du ${dateSel} depuis la grille en vigueur ?\n` +
          'TOUTES les modifications du jour (publiées ou en attente) seront perdues (retour à l’horaire théorique).',
      )
    )
      return;
    void provider
      .reinitialiseJour(dateSel)
      .then(() => {
        // Le retour à zéro serveur a réussi : les modifications en attente de cette
        // date n'ont plus de sens. On les purge seulement maintenant (pas avant l'appel
        // réseau) pour ne pas perdre le brouillon local si reinitialiseJour échoue.
        videDate(
          brouillonCirc,
          brouillonTerminus,
          dateSel,
          brouillonSection,
          brouillonSupSupprimes,
          brouillonSupNeufs,
        );
        return rechargeJour();
      })
      .then(() => {
        bump(`journée ${dateSel} réinitialisée`);
        toast('Journée réinitialisée depuis la grille en vigueur');
      })
      .catch(erreurVersToast);
  });
  $('btn-csv').addEventListener('click', exporteCsv);

  const poseSection = (section: SectionJour, detail: string): void => {
    brouillonSection.set(dateSel, section);
    rafraichitJourEffectif();
    bumpEnAttente(detail);
    rendBlocSection();
    rendreCirculations();
    rendFormulaireSup();
  };

  const changeBorne = (bougee: 'debut' | 'fin') => (): void => {
    const section = sectionAffichee();
    const choisie = (
      bougee === 'debut'
        ? ($('sel-section-debut') as HTMLSelectElement)
        : ($('sel-section-fin') as HTMLSelectElement)
    ).value as GareId;
    const ajustee = ajusteSection(
      bougee === 'debut' ? choisie : section.gare_debut,
      bougee === 'fin' ? choisie : section.gare_fin,
      bougee,
    );
    poseSection(
      { ...section, gare_debut: ajustee.debut, gare_fin: ajustee.fin },
      `ligne exploitée de ${nomDeGare(ajustee.debut)} à ${nomDeGare(ajustee.fin)} (en attente)`,
    );
    toast(
      `Ligne exploitée de ${nomDeGare(ajustee.debut)} à ${nomDeGare(ajustee.fin)} — en attente de publication`,
    );
  };

  $('btn-section').addEventListener('click', () => {
    $('bloc-section').dataset.ouvert = '1';
    rendBlocSection();
  });
  $('btn-section-complete').addEventListener('click', () => {
    delete $('bloc-section').dataset.ouvert;
    poseSection(
      {
        gare_debut: GARE_DEBUT_DEFAUT,
        gare_fin: GARE_FIN_DEFAUT,
        message_troncon_fr: null,
        message_troncon_en: null,
      },
      'ligne entière rétablie (en attente)',
    );
    toast('Ligne entière rétablie — en attente de publication');
  });
  $('sel-section-debut').addEventListener('change', changeBorne('debut'));
  $('sel-section-fin').addEventListener('change', changeBorne('fin'));

  // Message des gares fermées : enregistré à la frappe retombée, traduction
  // anglaise automatique comme pour les messages voyageurs (et éditable).
  const poseMessageTroncon = antiRebond(() => {
    const section = sectionAffichee();
    const fr = ($('msg-troncon-fr') as HTMLInputElement).value.trim();
    const en = ($('msg-troncon-en') as HTMLInputElement).value.trim();
    const enregistre = (texteEn: string): void => {
      ($('msg-troncon-en') as HTMLInputElement).value = texteEn;
      poseSection(
        { ...section, message_troncon_fr: fr || null, message_troncon_en: texteEn || null },
        'message des gares fermées (en attente)',
      );
    };
    if (en || !fr) enregistre(en);
    else void provider.traduire(fr).then((t) => enregistre(t ?? traductionLocale(fr)));
  });
  $('msg-troncon-fr').addEventListener('input', poseMessageTroncon);
  $('msg-troncon-en').addEventListener('input', poseMessageTroncon);

  const terminusChange = (): void => {
    const coche = ($('chk-terminus') as HTMLInputElement).checked;
    const n = Number(($('sel-terminus-train') as HTMLSelectElement).value) || 1;
    brouillonTerminus.set(dateSel, coche ? { a_partir_du_train: n } : false);
    rafraichitJourEffectif();
    bumpEnAttente(
      coche
        ? `terminus Bellevue à partir du TRAIN ${n} (en attente)`
        : 'terminus Bellevue désactivé (en attente)',
    );
    rendreCirculations();
    toast(
      coche
        ? `Terminus Bellevue à partir du TRAIN ${n} en attente de publication : colonne Terminus pré-remplie, express signalés « à traiter »`
        : 'Retour au service normal jusqu’au Nid d’Aigle, en attente de publication',
    );
  };
  $('chk-terminus').addEventListener('change', terminusChange);
  $('sel-terminus-train').addEventListener('change', () => {
    if (($('chk-terminus') as HTMLInputElement).checked) terminusChange();
  });

  /**
   * Suppression d'une MONTÉE : propose la suppression de sa descente
   * appariée (par défaut Oui, dérogeable — rame de remplacement), docs/01 §5.1.
   */
  const proposeSuppressionDescente = (montee: Circulation): void => {
    const descente = circulationDe(montee.numero + 1);
    if (!descente || descente.statut === 'supprime') return;
    if (
      !window.confirm(
        `Supprimer aussi la descente appariée (TRAIN ${descente.numero}) ?\n` +
          'La rame ne redescendra pas : cliquez Annuler seulement si une rame de remplacement assure la descente.',
      )
    )
      return;
    descente.statut = 'supprime';
    descente.retard_min = 0;
    descente.motif = montee.motif;
    stageCirculationEtRafraichit(
      descente,
      `statut TRAIN ${descente.numero} → supprime (rotation, en attente)`,
    );
  };

  /**
   * Activer/désactiver un facultatif propose la même opération sur son train
   * apparié — sauf si celui-ci roule à vide (rotation déjà assurée).
   */
  const proposeAppariementFacultatif = (numero: number, actif: boolean): void => {
    if (!jour) return;
    const proposition = propositionAppariementFacultatif(jour.circulations, numero, actif);
    if (!proposition) return;
    if (!window.confirm(proposition.question)) return;
    const apparie = circulationDe(proposition.numero);
    if (!apparie) return;
    apparie.facultatif_actif = proposition.actif;
    stageCirculationEtRafraichit(
      apparie,
      `facultatif TRAIN ${apparie.numero} ${proposition.actif ? 'activé' : 'désactivé'} (rotation, en attente)`,
    );
  };

  // Délégation d'événements sur le tableau
  const tbody = document.querySelector('#tab-circ tbody');
  if (!tbody) return;
  const surAction = (cible: HTMLElement): void => {
    // Garde-fou : hors saison ou journée passée non exploitée = lecture seule
    if (jour?.hors_saison || jour?.enregistre === false) return;
    const action = cible.dataset.action;
    const numero = Number(cible.dataset.numero);
    if (!action || !numero) return;
    const c = circulationDe(numero);
    if (!c) return;

    // Toutes les modifications ci-dessous sont mises EN ATTENTE (docs/01 §5.6) :
    // elles n'atteignent la base — et donc les écrans — qu'au clic sur « Publier ».
    if (action === 'rame') {
      c.rame = (cible as HTMLSelectElement).value;
      stageCirculationEtRafraichit(c, `rame TRAIN ${numero} → ${c.rame}`);
      toast('Rame en attente de publication (la descente de la même rotation suivra)');
    } else if (action === 'terminus') {
      c.terminus = (cible as HTMLSelectElement).value as Circulation['terminus'];
      stageCirculationEtRafraichit(c, `terminus TRAIN ${numero} → ${c.terminus}`);
      toast(
        c.terminus === 'bellevue'
          ? `TRAIN ${numero} limité à Bellevue en attente de publication (sa descente partira de Bellevue)`
          : `TRAIN ${numero} en attente de publication (rétabli jusqu'au Nid d'Aigle)`,
      );
    } else if (action === 'actif') {
      const actif = (cible as HTMLInputElement).checked;
      c.facultatif_actif = actif;
      stageCirculationEtRafraichit(
        c,
        `facultatif TRAIN ${numero} ${actif ? 'activé' : 'désactivé'}`,
      );
      toast(
        actif
          ? 'Train facultatif activé, en attente de publication'
          : 'Train facultatif désactivé, en attente de publication',
      );
      proposeAppariementFacultatif(numero, actif);
    } else if (action === 'sup-supprimer') {
      const libelle = libelleTrain(
        { numero, supplementaire: true },
        (jour?.circulations ?? []).map((x) => ({
          numero: x.numero,
          supplementaire: x.supplementaire,
        })),
      );
      if (
        !window.confirm(
          `Supprimer ${libelle} (montée ${numero} et descente ${numero + 1}) ?
Il disparaîtra des écrans à la publication. Les trains de la grille, eux, ne se suppriment pas : ils se mettent au statut « Supprimé ».`,
        )
      )
        return;
      const retires = brouillonSupSupprimes.get(dateSel) ?? new Set<number>();
      retires.add(numero);
      brouillonSupSupprimes.set(dateSel, retires);
      // Une création jamais publiée s'annule purement et simplement : les
      // deux lignes ET la marque de nouveauté disparaissent du brouillon.
      brouillonCirc.get(dateSel)?.delete(numero);
      brouillonCirc.get(dateSel)?.delete(numero + 1);
      brouillonSupNeufs.get(dateSel)?.delete(numero);
      rafraichitJourEffectif();
      rendreCirculations();
      bumpEnAttente(`${libelle} supprimé (en attente)`);
      toast(`${libelle} supprimé — en attente de publication`);
    } else if (action === 'sans-voyageurs') {
      // COPIE volontaire (conservée) : le brouillon garde son propre objet,
      // distinct de `c`, pour ne jamais dépendre d'une mutation partagée.
      const aVide = (cible as HTMLInputElement).checked;
      stageCirculationEtRafraichit(
        { ...c, sans_voyageurs: aVide },
        `TRAIN ${numero} ${aVide ? 'passé sans voyageurs' : 'rouvert aux voyageurs'}`,
      );
      toast(
        aVide
          ? `TRAIN ${numero} sans voyageurs en attente de publication`
          : `TRAIN ${numero} rouvert aux voyageurs, en attente de publication`,
      );
    } else if (action.startsWith('statut-')) {
      const statut = action.replace('statut-', '') as Circulation['statut'];
      if (statut === 'supprime') {
        const heure = formatHeure(
          heureVersSecondes(
            grilleDuJour()
              ?.montees.concat(grilleDuJour()?.descentes ?? [])
              .find((t) => t.numero === numero)?.passages[0]?.d ?? '00:00',
          ),
        );
        if (
          !window.confirm(
            `Confirmer la suppression du TRAIN ${numero} (${heure}) ? Il restera affiché barré jusqu'à son heure théorique.`,
          )
        ) {
          rendreCirculations();
          return;
        }
      }
      c.statut = statut;
      if (statut === 'retard' && c.retard_min < 5) c.retard_min = 5;
      if (statut !== 'retard') c.retard_min = 0;
      stageCirculationEtRafraichit(c, `statut TRAIN ${numero} → ${statut}`);
      if (statut === 'supprime' && c.sens === 'montee') proposeSuppressionDescente(c);
    } else if (action === 'express-supprimer') {
      if (
        !window.confirm(
          `Supprimer l'express TRAIN ${numero} ?\n` +
            'Il restera affiché barré jusqu’à son heure théorique.',
        )
      )
        return;
      c.statut = 'supprime';
      c.retard_min = 0;
      c.motif ??= params?.motifs[0]?.fr ?? null;
      stageCirculationEtRafraichit(c, `express TRAIN ${numero} supprimé (plage Bellevue)`);
      toast(`Express TRAIN ${numero} en attente de publication (signalement levé)`);
      // Même règle que pour une montée normale (docs/01 §5.1)
      if (c.sens === 'montee') proposeSuppressionDescente(c);
    } else if (action === 'express-maintenir-descente') {
      // Descente express maintenue : on lève la limitation de SA rotation
      // (la montée repasse au Nid d'Aigle), sinon le signalement reviendrait.
      const montee = circulationDe(numero - 1);
      if (!montee) return;
      montee.terminus = 'nid-daigle';
      stageCirculationEtRafraichit(
        montee,
        `rotation TRAIN ${montee.numero}/${numero} maintenue jusqu'au Nid d'Aigle`,
      );
      toast(`Rotation express maintenue jusqu'au Nid d'Aigle, en attente de publication`);
    } else if (action === 'express-maintenir') {
      // Lève le signalement : l'express circule jusqu'au Nid d'Aigle malgré
      // la plage limitée (aucun horaire n'est inventé). Sa descente appariée,
      // express elle aussi, redescend donc bien du Nid d'Aigle.
      c.terminus = 'nid-daigle';
      stageCirculationEtRafraichit(c, `express TRAIN ${numero} maintenu jusqu'au Nid d'Aigle`);
      toast(`Express TRAIN ${numero} maintenu jusqu'au Nid d'Aigle, en attente de publication`);
    } else if (action === 'retard-plus' || action === 'retard-moins') {
      c.retard_min = Math.max(5, c.retard_min + (action === 'retard-plus' ? 5 : -5));
      stageCirculationEtRafraichit(c, `retard TRAIN ${numero} → +${c.retard_min} min`);
    } else if (action === 'motif') {
      const v = (cible as HTMLSelectElement).value;
      c.motif = v === '—' ? null : v;
      stageCirculationEtRafraichit(c, `motif TRAIN ${numero} → ${v}`);
    }
  };
  tbody.addEventListener('click', (e) => {
    const bouton = (e.target as HTMLElement).closest('button[data-action]');
    if (bouton) surAction(bouton as HTMLElement);
  });
  tbody.addEventListener('change', (e) => {
    const champ = (e.target as HTMLElement).closest('select[data-action], input[data-action]');
    if (champ) surAction(champ as HTMLElement);
  });
}

async function changeDate(decalage: number): Promise<void> {
  // Arithmétique en UTC pur (midi) : insensible au fuseau et aux
  // changements d'heure d'été, contrairement à new Date('...T12:00:00').
  const [a = 0, m = 1, j = 1] = dateSel.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + decalage));
  await allerDate(d.toISOString().slice(0, 10));
}

/**
 * Change de date SANS échec muet : la date affichée ne bouge que si le
 * chargement a réussi — sinon les actions (suppression, terminus…)
 * s'appliqueraient à une date différente de celle qui est à l'écran.
 */
async function allerDate(date: string): Promise<void> {
  if (!date) {
    // Champ vidé : on ne bouge pas, mais on le dit et on remet la date réelle
    ($('date-picker') as HTMLInputElement).value = dateSel;
    toast('Date invalide — la journée affichée est inchangée');
    return;
  }
  const precedente = dateSel;
  try {
    dateSel = date; // les chargements concurrents comparent à cette valeur
    const nouveau = await provider.getJour(date);
    if (dateSel !== date) return; // une navigation plus récente a pris le relais
    joursPublies.set(date, copieJour(nouveau)); // état EN BASE de la nouvelle date
    jour = nouveau;
    rafraichitJourEffectif(); // les modifications en attente pour CETTE date réapparaissent
    rendreCirculations();
    // Sans ce recalcul, la barre gardait le compte de la date précédente et
    // ne se réveillait qu'à la première écriture — d'où le saut brutal.
    if (referenceFixee) recalculeEcarts();
  } catch (erreur) {
    if (dateSel === date) {
      dateSel = precedente;
      ($('date-picker') as HTMLInputElement).value = precedente;
      rendreCirculations(); // remet en-tête, service et bascule sur la date réelle
      if (referenceFixee) recalculeEcarts();
    }
    erreurVersToast(erreur);
  }
}

function exporteCsv(): void {
  const grille = grilleDuJour();
  if (!grille || !jour) return;
  const lignes = [
    [
      'date',
      'train',
      'sens',
      'heure',
      'express',
      'facultatif',
      'actif',
      'sans_voyageurs',
      'rame',
      'terminus',
      'statut',
      'retard_min',
      'motif',
    ].join(';'),
  ];
  for (const montee of grille.montees) {
    for (const t of [montee, grille.descentes.find((d) => d.numero === montee.numero + 1)]) {
      if (!t) continue;
      const c = circulationDe(t.numero);
      if (!c) continue;
      const circMontee = c.sens === 'montee' ? c : circulationDe(t.numero - 1);
      lignes.push(
        [
          dateSel,
          `TRAIN ${c.numero}`,
          c.sens,
          formatHeure(heureVersSecondes(t.passages[0]?.d ?? t.passages[0]?.a ?? '00:00')),
          t.express ? 'oui' : '',
          c.facultatif ? 'oui' : '',
          c.facultatif ? (c.facultatif_actif ? 'oui' : 'non') : '',
          c.sans_voyageurs ? 'oui' : '',
          circMontee?.rame ?? c.rame,
          c.terminus,
          c.statut,
          String(c.retard_min),
          c.motif ?? '',
        ].join(';'),
      );
    }
  }
  const blob = new Blob([`﻿${lignes.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `circulations-${dateSel}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Onglet Messages (traduction EN automatique : Edge Function + repli local)
// ---------------------------------------------------------------------------

/** Avertit l'agent que l'anglais n'a pas pu être produit automatiquement. */
function afficheAvertissementTraduction(visible: boolean): void {
  $('msg-trad-avert').style.display = visible ? '' : 'none';
}

let traductionId = 0;
function lanceTraduction(): void {
  const fr = ($('msg-fr') as HTMLInputElement).value.trim();
  if (traductionManuelle) return; // le texte EN a été retouché à la main
  if (!fr) {
    ($('msg-en') as HTMLInputElement).value = '';
    afficheAvertissementTraduction(false);
    return;
  }
  window.clearTimeout(traductionId);
  traductionId = window.setTimeout(() => {
    void provider.traduire(fr).then((en) => {
      if (traductionManuelle) return;
      // Service indisponible (null) : repli dictionnaire ; s'il ne connaît
      // pas la phrase, on laisse VIDE — jamais de faux anglais.
      const traduit = en ?? traductionLocale(fr);
      ($('msg-en') as HTMLInputElement).value = traduit;
      afficheAvertissementTraduction(traduit === '');
    });
  }, 500);
}

function libelleCible(m: Message): string {
  if (m.cible_type === 'gares') {
    return (m.gares ?? []).map((g) => nomDeGare(g)).join(', ') || 'Gares…';
  }
  if (m.cible_type === 'train') return `TRAIN ${m.train_numero}`;
  return 'Toutes les gares';
}

function nomDeGare(id: string): string {
  return grilles[0]?.gares.find((g) => g.id === id)?.nom ?? id;
}

function rendreMessages(): void {
  $('badge-msgs').textContent = String(messages.filter((m) => m.actif).length);
  $('liste-msgs').innerHTML = messages
    .map(
      (m) => `
    <div class="msg${editionMessageId === m.id ? ' en-edition' : ''}">
      <div class="prio ${m.priorite === 'importante' ? 'imp' : 'norm'}"></div>
      <div class="corps">
        <div class="fr">${echapper(m.texte_fr)}</div>
        <div class="en">${echapper(m.texte_en)}</div>
        <div class="cibles">
          <span class="chip-gare ${m.cible_type === 'toutes' ? 'toutes' : m.cible_type === 'train' ? 'train' : ''}">${echapper(libelleCible(m))}</span>
          ${m.priorite === 'importante' ? '<span class="chip-gare fixe">Bandeau fixe</span>' : ''}
          ${m.expire_at ? `<span class="chip-gare">expire ${new Date(m.expire_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}
        </div>
      </div>
      <button class="leger" data-modifier="${m.id}">Modifier</button>
      <button class="leger" data-retirer="${m.id}">Retirer</button>
    </div>`,
    )
    .join('');
}

/** Les raccourcis d'expiration remplissent le champ date : ce qui est affiché est ce qui sera enregistré. */
function appliqueRaccourciExpiration(): void {
  const choix = ($('msg-expire') as HTMLSelectElement).value;
  const champ = $('msg-expire-date') as HTMLInputElement;
  champ.style.display = choix === '' ? 'none' : '';
  if (choix === '' || choix === 'date') {
    if (choix === '') champ.value = '';
    return;
  }
  const quand = new Date();
  if (choix === 'soir') {
    quand.setHours(21, 0, 0, 0);
    // Après 21:00, « ce soir » viserait une heure passée : le message
    // n'apparaîtrait sur aucun écran. On bascule au soir suivant.
    if (quand.getTime() <= Date.now()) quand.setDate(quand.getDate() + 1);
  }
  if (choix === '1h') quand.setTime(quand.getTime() + 3_600_000);
  if (choix === '3h') quand.setTime(quand.getTime() + 3 * 3_600_000);
  champ.value = isoVersDatetimeLocal(quand.toISOString());
  ($('msg-expire') as HTMLSelectElement).value = 'date'; // la date fait foi
}

/** Lit l'état complet du formulaire (source de vérité unique à l'enregistrement). */
function formulaireMessage(): FormulaireMessage {
  return {
    texte_fr: ($('msg-fr') as HTMLInputElement).value,
    texte_en: ($('msg-en') as HTMLInputElement).value,
    cible_type: ($('msg-cible') as HTMLSelectElement).value as Message['cible_type'],
    gares: Array.from(document.querySelectorAll<HTMLInputElement>('#msg-gares input:checked')).map(
      (i) => i.value as GareId,
    ),
    train_numero: Number(($('msg-train') as HTMLSelectElement).value) || null,
    priorite: ($('msg-prio') as HTMLSelectElement).value as Message['priorite'],
    expire_local: ($('msg-expire-date') as HTMLInputElement).value,
  };
}

/** Remplit le formulaire depuis un message (édition) ou le vide (nouveau). */
function remplitFormulaireMessage(f: FormulaireMessage | null): void {
  const vide: FormulaireMessage = {
    texte_fr: '',
    texte_en: '',
    cible_type: 'toutes',
    gares: [],
    train_numero: null,
    priorite: 'normale',
    expire_local: '',
  };
  const v = f ?? vide;
  ($('msg-fr') as HTMLInputElement).value = v.texte_fr;
  ($('msg-en') as HTMLInputElement).value = v.texte_en;
  ($('msg-cible') as HTMLSelectElement).value = v.cible_type;
  ($('msg-prio') as HTMLSelectElement).value = v.priorite;
  ($('msg-expire-date') as HTMLInputElement).value = v.expire_local;
  ($('msg-expire') as HTMLSelectElement).value = v.expire_local ? 'date' : '';
  $('msg-expire-date').style.display = v.expire_local ? '' : 'none';
  majChampsCible(v.cible_type, v.train_numero);
  for (const case_ of document.querySelectorAll<HTMLInputElement>('#msg-gares input')) {
    case_.checked = v.gares.includes(case_.value as GareId);
  }
}

/** Affiche les champs de la cible choisie et (re)construit la liste des trains. */
function majChampsCible(cible: Message['cible_type'], trainSelectionne: number | null): void {
  $('msg-gares').style.display = cible === 'gares' ? '' : 'none';
  $('msg-train').style.display = cible === 'train' ? '' : 'none';
  if (cible !== 'train') return;
  // Trains de la grille du JOUR AFFICHÉ (et non toujours la première grille)
  const g = grilleDuJour() ?? grilles[0] ?? null;
  const trains = [...(g?.montees ?? []), ...(g?.descentes ?? [])].sort(
    (a, b) => a.numero - b.numero,
  );
  const options = trains.map((t) => {
    const heure = formatHeure(heureVersSecondes(t.passages[0]?.d ?? t.passages[0]?.a ?? '00:00'));
    return `<option value="${t.numero}" ${t.numero === trainSelectionne ? 'selected' : ''}>TRAIN ${t.numero} — ${heure} ${t.numero % 2 === 1 ? '↗' : '↙'}${t.express ? ' (Express)' : ''}</option>`;
  });
  // Train du message absent de cette grille (autre service à cette date) :
  // on le garde en tête, sinon le select retomberait sur le premier train et
  // l'enregistrement recyclerait silencieusement la cible vers celui-ci.
  if (trainSelectionne !== null && !trains.some((t) => t.numero === trainSelectionne)) {
    options.unshift(
      `<option value="${trainSelectionne}" selected>TRAIN ${trainSelectionne} — hors grille de cette date</option>`,
    );
  }
  ($('msg-train') as HTMLSelectElement).innerHTML = options.join('');
}

function annuleEditionMessage(): void {
  editionMessageId = null;
  traductionManuelle = false;
  afficheAvertissementTraduction(false);
  remplitFormulaireMessage(null);
  $('btn-msg').textContent = 'Ajouter';
  $('btn-msg-annuler').style.display = 'none';
  rendreMessages();
}

/** Cases à cocher des gares cibles, avec les noms de la charte (grilles chargées). */
function rendreCasesGares(): void {
  const cochees = new Set(
    Array.from(document.querySelectorAll<HTMLInputElement>('#msg-gares input:checked')).map(
      (i) => i.value,
    ),
  );
  $('msg-gares').innerHTML = ORDRE_GARES.map(
    (g) =>
      `<label><input type="checkbox" value="${g}" ${cochees.has(g) ? 'checked' : ''} /> ${echapper(nomDeGare(g))}</label>`,
  ).join('');
}

/** Sélecteur « Modèle… » du formulaire (modèles actifs, groupés par catégorie). */
function rendreSelecteurModeles(): void {
  const actifs = modeles.filter((m) => m.actif);
  const categories = [...new Set(actifs.map((m) => m.categorie))];
  const groupes = categories
    .map(
      (cat) =>
        `<optgroup label="${echapper(cat)}">${actifs
          .filter((m) => m.categorie === cat)
          .map((m) => `<option value="${echapper(m.id)}">${echapper(m.titre)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('');
  ($('msg-modele') as HTMLSelectElement).innerHTML = `<option value="">Modèle…</option>${groupes}`;
}

function initMessages(): void {
  rendreCasesGares(); // reconstruites après chargement des grilles (rendreTout)

  // Choisir un modèle remplit FR et EN ; les textes restent modifiables et
  // la cible / priorité / expiration se choisissent normalement ensuite.
  $('msg-modele').addEventListener('change', () => {
    const select = $('msg-modele') as HTMLSelectElement;
    const modele = modeles.find((m) => m.id === select.value);
    select.value = '';
    if (!modele) return;
    ($('msg-fr') as HTMLInputElement).value = modele.texte_fr;
    ($('msg-en') as HTMLInputElement).value = modele.texte_en;
    traductionManuelle = true; // ne pas écraser l'anglais du modèle
    afficheAvertissementTraduction(modele.texte_en.trim() === '');
    toast(`Modèle « ${modele.titre} » chargé — ajustez le texte si nécessaire`);
  });

  $('msg-cible').addEventListener('change', () => {
    majChampsCible(($('msg-cible') as HTMLSelectElement).value as Message['cible_type'], null);
  });
  $('msg-expire').addEventListener('change', appliqueRaccourciExpiration);
  $('msg-fr').addEventListener('input', lanceTraduction);
  $('msg-en').addEventListener('input', () => {
    const saisi = ($('msg-en') as HTMLInputElement).value.trim() !== '';
    traductionManuelle = saisi;
    if (saisi) afficheAvertissementTraduction(false); // l'agent a fourni l'anglais
  });
  $('btn-msg-annuler').addEventListener('click', annuleEditionMessage);

  $('btn-msg').addEventListener('click', () => {
    const f = formulaireMessage();
    if (!f.texte_fr.trim()) {
      toast('Saisissez d’abord le message en français');
      return;
    }
    if (f.cible_type === 'gares' && f.gares.length === 0) {
      toast('Cochez au moins une gare, sinon le message ne s’affichera nulle part');
      return;
    }
    // Anglais absent : repli dictionnaire, sinon VIDE (l'écran n'affichera
    // que le français — jamais de faux anglais). L'agent a été averti.
    if (!f.texte_en.trim()) f.texte_en = traductionLocale(f.texte_fr);
    // Le formulaire est la source de vérité : cible et expiration affichées
    // sont exactement celles enregistrées (elles ont été restituées à
    // l'ouverture de l'édition). Mis EN ATTENTE (docs/01 §5.6) : id réel si
    // on modifie un message déjà publié, sinon un id de brouillon temporaire
    // (remplacé par un id définitif à la publication, lors de l'insertion).
    const idCourant = editionMessageId ?? nouvelIdMessageBrouillon();
    const message = messageDepuisFormulaire(f, idCourant);
    brouillonMessages.set(idCourant, message);
    rafraichitMessagesEffectifs();
    bumpEnAttente(
      editionMessageId ? 'message modifié (en attente)' : 'message ajouté (en attente)',
    );
    toast(
      editionMessageId
        ? 'Message modifié, en attente de publication'
        : 'Message en attente de publication',
    );
    annuleEditionMessage();
    rendreMessages();
  });

  $('liste-msgs').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    const idModif = cible.dataset.modifier;
    const idRetrait = cible.dataset.retirer;
    if (idModif) {
      const m = messages.find((x) => x.id === idModif);
      if (!m) return;
      editionMessageId = m.id;
      traductionManuelle = true; // ne pas écraser l'anglais existant
      // Restitution COMPLÈTE : textes, cible (gares/train) et expiration
      remplitFormulaireMessage(valeursFormulaireMessage(m));
      $('btn-msg').textContent = 'Enregistrer';
      $('btn-msg-annuler').style.display = '';
      rendreMessages();
      ($('msg-fr') as HTMLInputElement).focus();
    } else if (idRetrait) {
      if (estIdMessageBrouillon(idRetrait)) {
        // Jamais publié : simple retrait du brouillon, aucune écriture prévue.
        brouillonMessages.delete(idRetrait);
      } else {
        brouillonMessages.set(idRetrait, null); // suppression en attente de publication
      }
      rafraichitMessagesEffectifs();
      if (editionMessageId === idRetrait) annuleEditionMessage();
      bumpEnAttente('message retiré (en attente)');
      rendreMessages();
    }
  });
}

// ---------------------------------------------------------------------------
// Onglet Médias
// ---------------------------------------------------------------------------

function rendreMedias(): void {
  ($('duree-horaires') as HTMLInputElement).value = String(params?.duree_horaires_s ?? 20);
  const mode = params?.mode_medias ?? 'alterne';
  ($('mode-alterne') as HTMLInputElement).checked = mode === 'alterne';
  ($('mode-serie') as HTMLInputElement).checked = mode === 'serie';
  // Le récapitulatif décrit ce que verront les écrans : seuls les médias
  // ACTIFS y figurent, dans leur ordre de passage.
  $('recap-cycle').textContent = recapCycle(
    medias.filter((m) => m.actif),
    mode,
    params?.duree_horaires_s ?? 20,
  );

  $('medias').innerHTML = medias
    .map(
      (m, index) => `
    <div class="media">
      <div class="apercu">${
        m.type === 'video'
          ? `<video src="${echapper(m.url)}" muted playsinline></video>`
          : `<img src="${echapper(m.url)}" alt="" />`
      }</div>
      <div class="infos">
        <div class="nom"><span class="rang">${index + 1}</span>${echapper(m.nom)}</div>
        <div class="det">${m.type === 'video' ? 'Vidéo (muette)' : 'Image'}
          <span class="ordre-boutons">
            <button class="leger" data-monter="${m.id}" ${index === 0 ? 'disabled' : ''} title="Passer plus tôt dans le cycle">▲</button>
            <button class="leger" data-descendre="${m.id}" ${index === medias.length - 1 ? 'disabled' : ''} title="Passer plus tard dans le cycle">▼</button>
          </span>
        </div>
        <div class="ligne">
          Durée : <input type="number" min="3" max="120" value="${m.duree_s}" data-duree="${m.id}" /> s
          <label class="switch" style="margin-left:auto"><input type="checkbox" ${m.actif ? 'checked' : ''} data-actif="${m.id}" />Actif</label>
          <button class="leger" data-suppr="${m.id}">Retirer</button>
        </div>
        <div class="ligne" style="margin-top:6px">
          Expire :
          <input type="datetime-local" value="${isoVersDatetimeLocal(m.expire_at)}" data-expire="${m.id}" />
          <button class="leger" data-expire-jamais="${m.id}">Jamais</button>
        </div>
        <div class="ligne media-gares" style="margin-top:6px">
          Gares :
          <label><input type="checkbox" data-gare-toutes="${m.id}" ${m.gares?.length ? '' : 'checked'} /> toutes</label>
          ${ORDRE_GARES.map(
            (g) =>
              `<label><input type="checkbox" data-gare="${m.id}" value="${g}" ${
                m.gares?.includes(g) ? 'checked' : ''
              } /> ${echapper(nomDeGare(g))}</label>`,
          ).join('')}
        </div>
      </div>
    </div>`,
    )
    .join('');
}

async function rechargeMedias(): Promise<void> {
  medias = await provider.listMedias();
  rendreMedias();
}

function initMedias(): void {
  /**
   * Enregistre une modification SANS muter l'état local avant l'écriture
   * (une écriture refusée ne doit rien laisser en mémoire, sinon elle
   * pourrait être publiée plus tard silencieusement) et ne re-dessine que
   * lorsque c'est nécessaire.
   */
  const majMedia = (id: string, patch: Partial<Media>, reRendre: boolean): void => {
    const media = medias.find((m) => m.id === id);
    if (!media) return;
    void provider
      .saveMedia({ ...media, ...patch })
      .then(() => {
        Object.assign(media, patch); // aligné SEULEMENT après succès
        bump(`média ${media.nom} mis à jour`);
        if (reRendre) rendreMedias();
      })
      .catch((erreur: unknown) => {
        erreurVersToast(erreur);
        rendreMedias(); // rétablit les valeurs réellement enregistrées
      });
  };

  $('btn-media-ajout').addEventListener('click', () => $('media-fichier').click());
  $('media-fichier').addEventListener('change', () => {
    const fichier = ($('media-fichier') as HTMLInputElement).files?.[0];
    if (!fichier) return;
    if (fichier.size > 20_971_520) {
      toast('Fichier trop lourd : 20 Mo maximum');
      return;
    }
    const type = fichier.type.startsWith('video/') ? 'video' : 'image';
    void provider
      .uploadMedia(fichier, { nom: fichier.name, type, duree_s: 8, gares: null })
      .then(() => rechargeMedias())
      .then(() => {
        bump(`média ajouté : ${fichier.name}`);
        toast('Média ajouté : il entre dans le cycle des écrans');
      })
      .catch(erreurVersToast);
    ($('media-fichier') as HTMLInputElement).value = '';
  });
  // Mode du cycle : même chemin d'enregistrement que la durée horaires.
  for (const id of ['mode-alterne', 'mode-serie']) {
    $(id).addEventListener('change', () => {
      const mode: ModeMedias = ($('mode-serie') as HTMLInputElement).checked ? 'serie' : 'alterne';
      void provider
        .saveParams({ mode_medias: mode })
        .then(() => {
          if (params) params.mode_medias = mode;
          rendreMedias(); // le récapitulatif suit immédiatement
          bumpEnAttente(`mode des médias → ${mode}`);
          toast(
            mode === 'serie'
              ? 'Mode série : les médias s’enchaîneront, puis retour aux horaires'
              : 'Mode alterné : retour aux horaires entre chaque média',
          );
        })
        .catch(erreurVersToast);
    });
  }

  $('duree-horaires').addEventListener('change', () => {
    const v = Number(($('duree-horaires') as HTMLInputElement).value) || 20;
    void provider
      .saveParams({ duree_horaires_s: v })
      .then(() => {
        bump(`durée horaires → ${v} s`);
        if (params) params.duree_horaires_s = v;
      })
      .catch(erreurVersToast);
  });
  $('medias').addEventListener('change', (e) => {
    const cible = e.target as HTMLInputElement;
    if (cible.dataset.duree) {
      majMedia(
        cible.dataset.duree,
        { duree_s: Math.min(120, Math.max(3, Number(cible.value) || 8)) },
        false,
      );
    } else if (cible.dataset.actif) {
      majMedia(cible.dataset.actif, { actif: cible.checked }, true);
    } else if (cible.dataset.expire) {
      // Pas de re-render : re-dessiner la carte pendant la saisie d'une date
      // détruirait le champ à la première frappe.
      majMedia(cible.dataset.expire, { expire_at: datetimeLocalVersIso(cible.value) }, false);
    } else if (cible.dataset.gare || cible.dataset.gareToutes) {
      const id = cible.dataset.gare ?? cible.dataset.gareToutes ?? '';
      // « toutes » cochée = aucune gare précise ; sinon les gares cochées
      // (aucune cochée revenant à « toutes », comme à la création).
      const toutes = cible.dataset.gareToutes ? cible.checked : false;
      const cochees = Array.from(
        document.querySelectorAll<HTMLInputElement>(`#medias input[data-gare="${id}"]:checked`),
      ).map((i) => i.value as GareId);
      majMedia(id, { gares: toutes || cochees.length === 0 ? null : cochees }, true);
    }
  });
  /**
   * Monte ou descend un média : on ÉCHANGE son ordre avec celui du voisin.
   * Échanger plutôt que renuméroter évite de réécrire toute la liste, donc
   * de polluer le journal d'exploitation à chaque clic.
   */
  const deplaceMedia = (id: string, sens: -1 | 1): void => {
    const index = medias.findIndex((m) => m.id === id);
    const courant = medias[index];
    const voisin = medias[index + sens];
    if (!courant || !voisin) return; // haut ou bas de liste
    void Promise.all([
      provider.saveMedia({ ...courant, ordre: voisin.ordre }),
      provider.saveMedia({ ...voisin, ordre: courant.ordre }),
    ])
      .then(() => rechargeMedias())
      .then(() => {
        bump(`ordre des médias : « ${courant.nom} » ${sens < 0 ? 'monté' : 'descendu'}`);
        toast(`« ${courant.nom} » passe en position ${index + 1 + sens}`);
      })
      .catch(erreurVersToast);
  };

  $('medias').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    const idJamais = cible.dataset.expireJamais;
    if (idJamais) {
      majMedia(idJamais, { expire_at: null }, true);
      return;
    }
    if (cible.dataset.monter) {
      deplaceMedia(cible.dataset.monter, -1);
      return;
    }
    if (cible.dataset.descendre) {
      deplaceMedia(cible.dataset.descendre, 1);
      return;
    }
    const id = cible.dataset.suppr;
    if (!id) return;
    const media = medias.find((m) => m.id === id);
    if (!media || !window.confirm(`Retirer le média « ${media.nom} » ?`)) return;
    void provider
      .deleteMedia(id)
      .then(() => rechargeMedias())
      .then(() => bump(`média retiré : ${media.nom}`))
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Onglet Écrans
// ---------------------------------------------------------------------------

async function rendreEcrans(): Promise<void> {
  let liste;
  try {
    liste = await provider.listEcrans();
  } catch {
    return;
  }
  ecransConnus = liste;
  const maintenant = Date.now();
  const etats = new Map(
    liste.map((e) => [e.id, etatFraicheurEcran(e, referenceMajMs, maintenant)]),
  );
  const enLigne = (id: string): boolean => etats.get(id)?.statut !== 'hors-ligne';
  const actifs = liste.filter((e) => enLigne(e.id)).length;
  $('pill-ecrans').innerHTML =
    `<span class="dot ${actifs === liste.length ? '' : 'rouge'}"></span> ${actifs}/${liste.length || '—'} écrans en ligne`;

  // Bandeau de publication : synthèse « Appliqué sur N/N écrans »
  majResumeApplication(liste, maintenant);

  $('ecrans').innerHTML = liste.length
    ? liste
        .map((e) => {
          const etat = etats.get(e.id) ?? {
            statut: 'hors-ligne' as const,
            retard_min: 0,
            libelle: 'hors ligne',
          };
          const ok = etat.statut !== 'hors-ligne';
          // Une seule des deux bornes ne décrit pas une fenêtre : on ne parle
          // de réglage propre que si les DEUX sont posées (même règle que le moteur).
          const propre = Boolean(e.veille_debut && e.veille_fin);
          const vu = e.derniere_vue
            ? `${Math.max(0, Math.round((maintenant - new Date(e.derniere_vue).getTime()) / 1000))} s`
            : '—';
          const donnees = e.donnees_maj
            ? new Date(e.donnees_maj).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—';
          return `
      <div class="ecran">
        <div class="haut"><span class="dot ${ok ? '' : 'rouge'}"></span>${echapper(nomDeGare(e.gare))} · ${echapper(e.id)}
          <span class="net">${echapper(e.reseau ?? (e.gare === 'nid-daigle' ? '5G · solaire' : 'Fibre'))}</span></div>
        <div class="fraicheur ${etat.statut}">${echapper(etat.libelle)}</div>
        <div class="sub">${echapper(e.type ?? 'écran')} · vu il y a ${vu} · données de ${donnees}${
          e.date_affichee ? ` · journée ${echapper(e.date_affichee)}` : ''
        } · ${echapper(e.version_app ?? '—')}</div>
        <div class="veille-ecran">
          ${
            propre
              ? `<span class="veille-propre">Réglage propre ${echapper(e.veille_debut?.slice(0, 5) ?? '')} → ${echapper(e.veille_fin?.slice(0, 5) ?? '')}</span>`
              : '<span class="veille-suit">Suit le réglage global</span>'
          }
          <input type="time" data-veille-debut="${echapper(e.id)}" value="${echapper(e.veille_debut?.slice(0, 5) ?? '')}" />
          <input type="time" data-veille-fin="${echapper(e.id)}" value="${echapper(e.veille_fin?.slice(0, 5) ?? '')}" />
          ${propre ? `<button class="leger" data-veille-global="${echapper(e.id)}">Revenir au global</button>` : ''}
        </div>
        <div class="actions">
          <button class="leger" data-recharger="${echapper(e.id)}">⟳ Recharger</button>
          <button class="leger" data-voir="${echapper(e.gare)}" data-type="${echapper(e.type ?? 'ecran')}">Voir</button>
          ${ok ? '' : `<button class="leger" data-oublier="${echapper(e.id)}">Oublier</button>`}
        </div>
      </div>`;
        })
        .join('')
    : '<div class="note">Aucun écran déclaré. Déclarez les postes ci-dessous : un écran ne s’inscrit plus de lui-même.</div>';
}

let resumeId = 0;
/**
 * Mémoire du bandeau d'application : quelle référence a déjà été affichée, et
 * a-t-il déjà été masqué pour celle-ci. Sans cette mémoire, chaque
 * rafraîchissement le réaffichait et le minuteur le remasquait : il clignotait.
 */
let etatBandeau: EtatBandeauApplication = {
  derniereReferenceAffichee: null,
  resumeResorbe: false,
};
/**
 * Bandeau de publication : « Appliqué sur N/N écrans » (ou la liste des gares
 * en attente), calculé à partir des horodatages `donnees_maj` remontés par
 * les écrans. Affiché quelques secondes quand tout est appliqué, maintenu
 * tant que des écrans restent en retard.
 */
function majResumeApplication(liste: EcranInfo[], maintenantMs: number): void {
  const decision = decisionBandeauApplication(
    liste,
    referenceMajMs,
    maintenantMs,
    etatBandeau,
    nomDeGare,
  );
  etatBandeau = decision.etat;
  const bloc = $('resume-application');

  // Rien à montrer. Surtout : on ne réaffiche PAS un bandeau déjà résorbé —
  // c'est ce `display = ''` à chaque rafraîchissement qui le faisait
  // clignoter, le minuteur de 6 s le remasquant aussitôt après.
  if (!decision.afficher) {
    window.clearTimeout(resumeId);
    bloc.style.display = 'none';
    return;
  }

  bloc.textContent = decision.libelle;
  bloc.className = `resume-application ${decision.classe}`;
  bloc.style.display = '';
  window.clearTimeout(resumeId);
  // Un écran en retard : affichage CONTINU, aucun minuteur — l'information
  // doit rester sous les yeux tant que la situation dure.
  if (decision.minuteurMs === null) return;
  resumeId = window.setTimeout(() => {
    bloc.style.display = 'none';
    // Résorbé : plus rien ne le réaffichera avant la modification suivante.
    etatBandeau = { ...etatBandeau, resumeResorbe: true };
  }, decision.minuteurMs);
}

function initEcrans(): void {
  // --- Déclaration préalable d'un poste (administrateur) ---
  const selGare = $('decl-gare') as HTMLSelectElement;
  const selType = $('decl-type') as HTMLSelectElement;
  const numero = $('decl-numero') as HTMLInputElement;
  selGare.innerHTML = ORDRE_GARES.map(
    (g) => `<option value="${g}">${echapper(nomDeGare(g))}</option>`,
  ).join('');

  const idPropose = (): string =>
    identifiantEcranDeclare(
      selType.value === 'grille' ? 'grille' : 'ecran',
      selGare.value,
      Math.max(1, Number(numero.value) || 1),
    );
  const majApercu = (): void => {
    $('decl-apercu').textContent = idPropose();
  };
  for (const champ of [selGare, selType, numero]) champ.addEventListener('change', majApercu);
  numero.addEventListener('input', majApercu);
  majApercu();

  $('btn-declarer').addEventListener('click', () => {
    const id = idPropose();
    void provider
      .declareEcran({ id, gare: selGare.value as GareId, type: selType.value })
      .then(() => rendreEcrans())
      .then(() => {
        bump(`écran déclaré : ${id}`);
        toast(`Écran ${id} déclaré — il apparaîtra dès son premier signal de vie`);
      })
      .catch(erreurVersToast);
  });

  // --- Veille de nuit : réglage global de la ligne ---
  const sauveVeilleGlobale = (): void => {
    void provider
      .saveParams({
        veille_nuit: {
          debut: ($('veille-debut') as HTMLInputElement).value || '21:00',
          fin: ($('veille-fin') as HTMLInputElement).value || '06:00',
        },
      })
      .then(() => rechargeParams())
      .then(() => {
        bump('veille de nuit modifiée');
        toast('Veille de nuit appliquée aux écrans qui suivent le réglage global');
      })
      .catch(erreurVersToast);
  };
  $('veille-debut').addEventListener('change', sauveVeilleGlobale);
  $('veille-fin').addEventListener('change', sauveVeilleGlobale);

  // --- Veille propre à un poste ---
  $('ecrans').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const id = champ.dataset.veilleDebut ?? champ.dataset.veilleFin;
    if (!id) return;
    const lire = (attribut: string): string =>
      (document.querySelector(`[data-${attribut}="${CSS.escape(id)}"]`) as HTMLInputElement | null)
        ?.value ?? '';
    const debut = lire('veille-debut');
    const fin = lire('veille-fin');
    // Tant que les deux bornes ne sont pas posées, le poste suit le global :
    // enregistrer une demi-fenêtre laisserait un écran dans un état indécis.
    if ((debut && !fin) || (!debut && fin)) {
      toast('Indiquez les DEUX heures pour donner à cet écran son propre horaire');
      return;
    }
    void provider
      .saveVeilleEcran(id, debut || null, fin || null)
      .then(() => rendreEcrans())
      .then(() => {
        bump(debut ? `veille ${id} : ${debut} → ${fin}` : `veille ${id} : retour au global`);
        toast(
          debut
            ? `${id} : veille propre ${debut} → ${fin}`
            : `${id} suit de nouveau le réglage global`,
        );
      })
      .catch(erreurVersToast);
  });

  $('ecrans').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    if (cible.dataset.veilleGlobal) {
      const id = cible.dataset.veilleGlobal;
      void provider
        .saveVeilleEcran(id, null, null)
        .then(() => rendreEcrans())
        .then(() => {
          bump(`veille ${id} : retour au global`);
          toast(`${id} suit de nouveau le réglage global`);
        })
        .catch(erreurVersToast);
    } else if (cible.dataset.recharger) {
      void provider
        .demanderRechargement(cible.dataset.recharger)
        .then(() =>
          toast(`L'écran ${cible.dataset.recharger} rechargera sa page au prochain signal de vie`),
        )
        .catch(erreurVersToast);
    } else if (cible.dataset.voir) {
      // La bonne page selon le type, et ?apercu=1 pour ne PAS battre sous
      // l'identifiant du poste réel (sinon sa dernière vue serait faussée et
      // son ordre de rechargement consommé par cet onglet d'aperçu).
      const page = cible.dataset.type === 'grille' ? 'grille.html' : 'ecran.html';
      window.open(`${page}?gare=${cible.dataset.voir}&apercu=1${suffixeDemo()}`, '_blank');
    } else if (cible.dataset.oublier) {
      const id = cible.dataset.oublier;
      if (
        !window.confirm(
          `Oublier l'écran « ${id} » ?
Il ne réapparaîtra PAS tout seul : un écran doit être déclaré ici pour que son signal de vie soit enregistré.`,
        )
      )
        return;
      void provider
        .oublierEcran(id)
        .then(() => rendreEcrans())
        .then(() => {
          bump(`écran oublié : ${id}`);
          toast(`Écran ${id} retiré de la liste`);
        })
        .catch(erreurVersToast);
    }
  });
}

// ---------------------------------------------------------------------------
// Bibliothèque de messages préenregistrés (admin)
// ---------------------------------------------------------------------------

function rendreBibliotheque(): void {
  const liste = $('modeles');
  if (modeles.length === 0) {
    liste.innerHTML =
      '<div class="note">Aucun modèle : exécutez <code>supabase/ajout-modeles.sql</code> ou ajoutez-en un.</div>';
    return;
  }
  liste.innerHTML = modeles
    .map(
      (m, i) => `
    <div class="modele-row${m.actif ? '' : ' inactif'}">
      <span class="cat">${echapper(m.categorie)}</span>
      <span class="titre">${echapper(m.titre)}</span>
      <span class="textes">
        ${echapper(m.texte_fr)}<br />
        <span class="en">${
          m.texte_en.trim() ? echapper(m.texte_en) : '<span class="manque">anglais manquant</span>'
        }</span>
      </span>
      <button class="leger" data-monter="${echapper(m.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="leger" data-descendre="${echapper(m.id)}" ${
        i === modeles.length - 1 ? 'disabled' : ''
      }>↓</button>
      <label class="switch"><input type="checkbox" ${m.actif ? 'checked' : ''} data-modele-actif="${echapper(m.id)}" />Actif</label>
      <button class="leger" data-modele-modifier="${echapper(m.id)}">Modifier</button>
      <button class="leger" data-modele-suppr="${echapper(m.id)}">Retirer</button>
    </div>`,
    )
    .join('');
}

function remplitFormulaireModele(m: ModeleMessage | null): void {
  editionModeleId = m?.id ?? null;
  traductionModeleManuelle = (m?.texte_en ?? '').trim() !== '';
  ($('modele-titre') as HTMLInputElement).value = m?.titre ?? '';
  ($('modele-categorie') as HTMLInputElement).value = m?.categorie ?? 'Général';
  const dernierOrdre = modeles.length > 0 ? (modeles[modeles.length - 1]?.ordre ?? 0) : 0;
  ($('modele-ordre') as HTMLInputElement).value = String(m?.ordre ?? dernierOrdre + 10);
  ($('modele-fr') as HTMLInputElement).value = m?.texte_fr ?? '';
  ($('modele-en') as HTMLInputElement).value = m?.texte_en ?? '';
  $('modele-trad-avert').style.display = 'none';
  $('form-modele').style.display = '';
}

async function rechargeModeles(): Promise<void> {
  modeles = await provider.getModelesMessages();
  rendreBibliotheque();
  rendreSelecteurModeles();
}

let traductionModeleId = 0;
function initBibliotheque(): void {
  $('btn-modele-ajout').addEventListener('click', () => remplitFormulaireModele(null));
  $('btn-modele-annuler').addEventListener('click', () => {
    $('form-modele').style.display = 'none';
    editionModeleId = null;
  });

  // Traduction anglaise proposée à la saisie du français, modifiable
  $('modele-fr').addEventListener('input', () => {
    if (traductionModeleManuelle) return;
    const fr = ($('modele-fr') as HTMLInputElement).value.trim();
    window.clearTimeout(traductionModeleId);
    traductionModeleId = window.setTimeout(() => {
      void provider.traduire(fr).then((en) => {
        if (traductionModeleManuelle) return;
        const traduit = fr ? (en ?? traductionLocale(fr)) : '';
        ($('modele-en') as HTMLInputElement).value = traduit;
        $('modele-trad-avert').style.display = fr && !traduit ? '' : 'none';
      });
    }, 500);
  });
  $('modele-en').addEventListener('input', () => {
    traductionModeleManuelle = ($('modele-en') as HTMLInputElement).value.trim() !== '';
    if (traductionModeleManuelle) $('modele-trad-avert').style.display = 'none';
  });

  $('btn-modele-valider').addEventListener('click', () => {
    const titre = ($('modele-titre') as HTMLInputElement).value.trim();
    const fr = ($('modele-fr') as HTMLInputElement).value.trim();
    if (!titre || !fr) {
      toast('Titre et texte français requis');
      return;
    }
    const modele: ModeleMessage = {
      id: editionModeleId ?? '',
      titre,
      categorie: ($('modele-categorie') as HTMLInputElement).value.trim() || 'Général',
      ordre: Number(($('modele-ordre') as HTMLInputElement).value) || 0,
      texte_fr: fr,
      texte_en: ($('modele-en') as HTMLInputElement).value.trim(),
      actif: modeles.find((m) => m.id === editionModeleId)?.actif ?? true,
    };
    const enEdition = editionModeleId !== null;
    void provider
      .saveModeleMessage(modele)
      .then(() => rechargeModeles())
      .then(() => {
        bump(`modèle ${enEdition ? 'modifié' : 'ajouté'} : ${titre}`);
        toast(`Modèle « ${titre} » enregistré`);
        $('form-modele').style.display = 'none';
        editionModeleId = null;
      })
      .catch(erreurVersToast);
  });

  /** Réordonnancement : échange l'ordre avec le voisin. */
  const deplace = (id: string, sens: -1 | 1): void => {
    const index = modeles.findIndex((m) => m.id === id);
    const courant = modeles[index];
    const voisin = modeles[index + sens];
    if (!courant || !voisin) return;
    const ordreCourant = courant.ordre;
    void provider
      .saveModeleMessage({ ...courant, ordre: voisin.ordre })
      .then(() => provider.saveModeleMessage({ ...voisin, ordre: ordreCourant }))
      .then(() => rechargeModeles())
      .then(() => bump(`ordre du modèle ${courant.titre} modifié`))
      .catch(erreurVersToast);
  };

  $('modeles').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    if (cible.dataset.monter) deplace(cible.dataset.monter, -1);
    else if (cible.dataset.descendre) deplace(cible.dataset.descendre, 1);
    else if (cible.dataset.modeleModifier) {
      const m = modeles.find((x) => x.id === cible.dataset.modeleModifier);
      if (m) remplitFormulaireModele(m);
    } else if (cible.dataset.modeleSuppr) {
      const m = modeles.find((x) => x.id === cible.dataset.modeleSuppr);
      if (!m || !window.confirm(`Retirer le modèle « ${m.titre} » ?`)) return;
      void provider
        .deleteModeleMessage(m.id)
        .then(() => rechargeModeles())
        .then(() => bump(`modèle retiré : ${m.titre}`))
        .catch(erreurVersToast);
    }
  });
  $('modeles').addEventListener('change', (e) => {
    const cible = e.target as HTMLInputElement;
    const id = cible.dataset.modeleActif;
    if (!id) return;
    const m = modeles.find((x) => x.id === id);
    if (!m) return;
    void provider
      .saveModeleMessage({ ...m, actif: cible.checked })
      .then(() => rechargeModeles())
      .then(() => bump(`modèle ${m.titre} ${cible.checked ? 'activé' : 'désactivé'}`))
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Onglet Paramètres (admin)
// ---------------------------------------------------------------------------

function rendreFiltreJournalQui(): void {
  const sel = $('journal-qui') as HTMLSelectElement;
  const choisi = sel.value;
  sel.innerHTML =
    '<option value="">Tous les utilisateurs</option>' +
    utilisateurs
      .map((u) => `<option value="${echapper(u.email)}">${echapper(u.nom || u.email)}</option>`)
      .join('');
  sel.value = choisi;
}

function rendreParametres(): void {
  rendreFiltreJournalQui();
  if (!params) return;
  // Machines
  $('machines').innerHTML = params.machines
    .map(
      (m) => `
    <div class="machine-row" data-nom="${echapper(m.nom)}">
      <input type="color" value="${m.couleur}" data-champ="couleur" title="Couleur de pastille" />
      <input type="color" value="${m.cercle ?? '#ffffff'}" data-champ="cercle" title="Couleur d'anneau (blanc = aucun)" />
      <input type="text" value="${echapper(m.nom)}" data-champ="nom" />
      <label class="switch" style="margin-left:auto"><input type="checkbox" ${m.en_service ? 'checked' : ''} data-champ="en_service" />En service</label>
      <button class="leger" data-champ="retirer">Retirer</button>
    </div>`,
    )
    .join('');
  // Motifs
  $('motifs').innerHTML = params.motifs
    .map(
      (m) =>
        `<span class="motif-chip">${echapper(m.fr)} <small>/ ${echapper(m.en)}</small><button data-motif="${echapper(m.fr)}">×</button></span>`,
    )
    .join('');
  // États du ciel : édition FR + EN + ordre, suppression avec confirmation.
  $('ciels').innerHTML = ordonneCiels(params.ciels)
    .map(
      (c) => `
    <div class="machine-row" data-fr="${echapper(c.fr)}">
      <input type="text" value="${echapper(c.fr)}" data-champ="fr" style="width:130px" title="État (FR)" />
      <input type="text" value="${echapper(c.en)}" data-champ="en" style="width:130px" title="État (EN)" />
      <input type="number" value="${c.ordre}" data-champ="ordre" style="width:70px" title="Ordre" />
      <button class="leger" style="margin-left:auto" data-champ="retirer">Retirer</button>
    </div>`,
    )
    .join('');
  // Utilisateurs : une ligne peut porter PLUSIEURS badges, et l'édition des
  // rôles se fait par cases à cocher — seules celles que l'agent connecté a le
  // droit d'attribuer sont actives, chaque case verrouillée disant pourquoi.
  $('users').innerHTML = utilisateurs.map((u) => ligneUtilisateur(u)).join('');
  rendreCasesInvitation();
  // Grilles horaires : elles se gèrent dans l'onglet Horaires (chargement
  // depuis l'Excel exploitation, activation, retour arrière). Ici, un simple
  // renvoi, avec la grille en service aujourd'hui.
  const enService = serviceActif(grilles, dateISO(0));
  $('saisons').innerHTML = `<div class="saison"><b>${
    enService ? echapper(enService.libelle) : 'Hors saison'
  }</b><span class="per">${
    enService ? 'grille en service aujourd’hui' : 'aucune grille ne couvre la date du jour'
  } · les grilles (été, hiver, dates de validité, chargement depuis l’Excel exploitation) se gèrent dans l’onglet Horaires</span><button class="leger" id="btn-vers-horaires">Ouvrir l’onglet Horaires</button></div>`;
  $('btn-vers-horaires').addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('nav.tabs button[data-t="horaires"]')?.click();
  });
  // Vitesse du bandeau + aperçu en direct
  const vitesse = vitesseTickerValide(params.vitesse_ticker_px_s);
  const selVitesse = $('vitesse-ticker') as HTMLSelectElement;
  selVitesse.innerHTML = NIVEAUX_VITESSE_TICKER.map(
    (n) =>
      `<option value="${n.px_s}" ${n.px_s === vitesse ? 'selected' : ''}>${n.libelle} (${n.px_s} px/s)</option>`,
  ).join('');
  if (!NIVEAUX_VITESSE_TICKER.some((n) => n.px_s === vitesse)) {
    // Valeur hors niveaux (saisie directe en base) : on l'affiche telle quelle
    selVitesse.insertAdjacentHTML(
      'afterbegin',
      `<option value="${vitesse}" selected>Personnalisée (${vitesse} px/s)</option>`,
    );
  }
  majApercuTicker(vitesse);

  // Veille (onglet Écrans) + météo et délai « à quai »
  majChampSansGener($('veille-debut') as HTMLInputElement, params.veille_nuit.debut);
  majChampSansGener($('veille-fin') as HTMLInputElement, params.veille_nuit.fin);
  // Température neutralisée par paramsValides() (valeur corrompue en base) :
  // champ VIDE, jamais le texte « NaN ».
  majChampSansGener(
    $('meteo-t') as HTMLInputElement,
    Number.isFinite(params.meteo_sommet.t) ? String(params.meteo_sommet.t) : '',
  );
  rendreSelectCiel(params);
  majChampSansGener($('meteo-heure') as HTMLInputElement, params.meteo_sommet.heure_releve ?? '');
  majChampSansGener(
    $('a-quai-origine') as HTMLInputElement,
    String(Math.round((params.a_quai_origine_s ?? A_QUAI_ORIGINE_DEFAUT_S) / 60)),
  );
}

/**
 * Ne réécrit un champ que s'il n'est pas en cours de saisie : avec
 * l'enregistrement automatique, un rafraîchissement pourrait sinon effacer
 * les caractères que l'agent est en train de taper.
 */
function majChampSansGener(champ: HTMLInputElement, valeur: string): void {
  if (document.activeElement === champ) return;
  champ.value = valeur;
}

/**
 * Sélecteur d'état du ciel (onglet Bandeau). Reconstruit à chaque
 * rafraîchissement SAUF s'il est ouvert par l'agent. Une valeur historique hors
 * liste est ajoutée en tête, marquée « (ancienne valeur) » et présélectionnée :
 * ouvrir l'onglet ne change JAMAIS la météo affichée en gare.
 */
function rendreSelectCiel(p: Params): void {
  const select = $('meteo-ciel') as HTMLSelectElement;
  if (document.activeElement === select) return;
  select.innerHTML = optionsCiel(p.ciels, p.meteo_sommet.ciel_fr, p.meteo_sommet.ciel_en)
    .map(
      (o) =>
        `<option value="${echapper(o.fr)}" data-en="${echapper(o.en)}"${o.selected ? ' selected' : ''}>` +
        `${echapper(o.fr)}${o.ancienne ? ' (ancienne valeur)' : ''}</option>`,
    )
    .join('');
}

/**
 * Anti-rebond : l'enregistrement part une fois la frappe retombée, pas à
 * chaque caractère (sinon 20 écritures pour « Ensoleillé »).
 */
function antiRebond(action: () => void, delai = 800): () => void {
  let minuteur: number | undefined;
  return () => {
    window.clearTimeout(minuteur);
    minuteur = window.setTimeout(action, delai);
  };
}

/** Aperçu en direct : même calcul durée = largeur / vitesse que les écrans. */
function majApercuTicker(vitessePxS: number): void {
  const apercu = $('apercu-ticker');
  const texte =
    messages
      .filter((m) => m.actif)
      .map((m) => m.texte_fr)
      .join(' ◆ ') || 'Aperçu du bandeau de messages voyageurs ◆ Passenger information ticker';
  if (apercu.textContent !== texte) apercu.textContent = texte;
  apercu.style.animationDuration = `${dureeDefilementS(apercu.offsetWidth, vitessePxS)}s`;
}

async function rechargeParams(): Promise<void> {
  paramsBase = await provider.getParams();
  rafraichitParamsEffectifs();
  rendreParametres();
}

/**
 * Onglet Bandeau : messages voyageurs, bibliothèque de modèles, vitesse de
 * défilement et météo du sommet. Tout s'enregistre à la saisie — c'est la
 * règle du reste de la supervision, et l'unique bouton « Enregistrer » de
 * l'application (celui de la météo) a disparu avec elle.
 */
function initBandeau(): void {
  $('vitesse-ticker').addEventListener('change', () => {
    const v = vitesseTickerValide(($('vitesse-ticker') as HTMLSelectElement).value);
    majApercuTicker(v); // aperçu immédiat, avant même la publication
    brouillonParams.vitesse_ticker_px_s = v;
    rafraichitParamsEffectifs();
    bumpEnAttente(`vitesse du bandeau → ${v} px/s (en attente)`);
    toast('Vitesse du bandeau en attente de publication');
  });

  const champMeteo = (id: string): HTMLInputElement => $(id) as HTMLInputElement;
  const selectCiel = (): HTMLSelectElement => $('meteo-ciel') as HTMLSelectElement;
  // L'option choisie porte le `fr` en valeur et l'`en` en attribut : un seul
  // choix renseigne ciel_fr ET ciel_en.
  const cielEnChoisi = (): string => selectCiel().selectedOptions[0]?.dataset.en ?? '';
  const sauveMeteo = (): void => {
    // Champ vide ou illisible : on CONSERVE la température publiée plutôt que
    // de publier 0 °C. Le `|| 0` d'origine transformait une saisie vide en
    // « 0 °C » affiché en gare — une information fausse. 0 reste évidemment
    // une valeur légitime quand l'agent la saisit vraiment.
    const saisi = champMeteo('meteo-t').value.trim();
    const nSaisi = saisi === '' ? Number.NaN : Number(saisi);
    brouillonParams.meteo_sommet = {
      t: Number.isFinite(nSaisi) ? nSaisi : (paramsBase?.meteo_sommet.t ?? Number.NaN),
      ciel_fr: selectCiel().value || '—',
      ciel_en: cielEnChoisi() || '—',
      heure_releve: champMeteo('meteo-heure').value || undefined,
    };
    rafraichitParamsEffectifs();
    bumpEnAttente('météo du sommet modifiée (en attente)');
    toast('Météo en attente de publication');
  };
  const sauveMeteoDifferee = antiRebond(sauveMeteo);

  // Toute correction de la température ou du ciel horodate le relevé : une
  // température sans heure ne dit pas si elle date de dix minutes ou de la
  // veille. L'agent peut ensuite corriger cette heure à la main.
  const horodateEtSauve = (): void => {
    const base = paramsBase?.meteo_sommet;
    const inchangee =
      base !== undefined &&
      Number(champMeteo('meteo-t').value) === base.t &&
      selectCiel().value === base.ciel_fr &&
      cielEnChoisi() === base.ciel_en;
    // Retour à la valeur publiée : on restitue SON heure de relevé. Horodater
    // « maintenant » ferait afficher aux écrans un relevé plus récent que la
    // mesure qu'il accompagne.
    champMeteo('meteo-heure').value = inchangee ? (base?.heure_releve ?? '') : heureCourante();
    sauveMeteoDifferee();
  };
  champMeteo('meteo-t').addEventListener('input', horodateEtSauve);
  selectCiel().addEventListener('change', horodateEtSauve);
  // Le champ d'heure lui-même : enregistrement direct, sans réhorodater.
  $('meteo-heure').addEventListener('change', sauveMeteo);
}

/** « HH:MM » à l'instant présent, fuseau Europe/Paris. */
function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Journal d'exploitation (lecture seule)
// ---------------------------------------------------------------------------

const PAGE_JOURNAL = 100;
let pageJournal = 0;
let entreesJournal: EntreeJournal[] = [];

function filtreJournal(): FiltreJournal {
  const val = (id: string): string => ($(id) as HTMLInputElement | HTMLSelectElement).value;
  return {
    du: val('journal-du') || null,
    au: val('journal-au') || null,
    qui: val('journal-qui') || null,
    table_cible: val('journal-table') || null,
    limite: PAGE_JOURNAL,
    depuis: pageJournal * PAGE_JOURNAL,
  };
}

async function rechargeJournal(): Promise<void> {
  const corps = document.querySelector('#tab-journal tbody');
  if (!corps) return;
  try {
    entreesJournal = await provider.listJournal(filtreJournal());
  } catch (erreur) {
    // Journal absent = migration non passée : le dire, plutôt qu'un tableau
    // vide qu'on prendrait pour « aucune écriture ».
    corps.innerHTML = `<tr><td colspan="5" style="padding:18px;color:var(--sec);font-weight:700">Journal indisponible — ${echapper(
      erreur instanceof Error ? erreur.message : String(erreur),
    )}</td></tr>`;
    return;
  }

  corps.innerHTML = entreesJournal.length
    ? entreesJournal
        .map(
          (e) => `<tr>
        <td class="quand">${echapper(horodatageJournal(e.quand))}</td>
        <td>${echapper(e.qui ?? '—')}</td>
        <td>${echapper(libelleObjet(e.table_cible))} <b>${echapper(e.cle)}</b></td>
        <td>${echapper(e.champ)}</td>
        <td class="ecart"><span class="avant">${echapper(e.avant ?? '—')}</span> → <b>${echapper(e.apres ?? '—')}</b></td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" style="padding:18px;color:var(--sec)">Aucune écriture sur cette période.</td></tr>';

  $('journal-page').textContent =
    entreesJournal.length === 0 && pageJournal === 0
      ? '—'
      : `page ${pageJournal + 1} · ${entreesJournal.length} ligne(s)`;
  ($('btn-journal-prec') as HTMLButtonElement).disabled = pageJournal === 0;
  ($('btn-journal-suiv') as HTMLButtonElement).disabled = entreesJournal.length < PAGE_JOURNAL;
}

function initJournal(): void {
  // Les listes de filtres se remplissent depuis les utilisateurs connus et
  // les objets tracés — pas de saisie libre à côté de la plaque.
  ($('journal-table') as HTMLSelectElement).innerHTML =
    '<option value="">Tous les objets</option>' +
    Object.entries(OBJETS_JOURNAL)
      .map(([cle, libelle]) => `<option value="${cle}">${echapper(libelle)}</option>`)
      .join('');

  const filtrer = (): void => {
    pageJournal = 0;
    void rechargeJournal();
  };
  $('btn-journal-filtrer').addEventListener('click', filtrer);
  for (const id of ['journal-du', 'journal-au', 'journal-qui', 'journal-table']) {
    $(id).addEventListener('change', filtrer);
  }
  $('btn-journal-prec').addEventListener('click', () => {
    if (pageJournal === 0) return;
    pageJournal -= 1;
    void rechargeJournal();
  });
  $('btn-journal-suiv').addEventListener('click', () => {
    if (entreesJournal.length < PAGE_JOURNAL) return;
    pageJournal += 1;
    void rechargeJournal();
  });

  $('btn-journal-csv').addEventListener('click', () => {
    // L'export porte sur le FILTRE courant, pas sur la seule page affichée :
    // exporter 100 lignes en croyant tout avoir serait trompeur.
    void provider
      .listJournal({ ...filtreJournal(), limite: 5000, depuis: 0 })
      .then((tout) => {
        const blob = new Blob([journalVersCsv(tout)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `journal-exploitation-${dateISO(0)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`${tout.length} ligne(s) exportée(s)`);
      })
      .catch(erreurVersToast);
  });
}

function initParametres(): void {
  $('machines').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const rangee = champ.closest('.machine-row') as HTMLElement | null;
    const nomOriginal = rangee?.dataset.nom;
    const machine = params?.machines.find((m) => m.nom === nomOriginal);
    if (!machine || !rangee) return;
    const maj: Machine = { ...machine };
    if (champ.dataset.champ === 'couleur') maj.couleur = champ.value;
    if (champ.dataset.champ === 'cercle')
      maj.cercle =
        champ.value.toLowerCase() === '#ffffff' && machine.cercle == null ? null : champ.value;
    if (champ.dataset.champ === 'en_service') maj.en_service = champ.checked;
    if (champ.dataset.champ === 'nom') maj.nom = champ.value.trim() || machine.nom;
    const promesse =
      maj.nom !== machine.nom
        ? provider.deleteMachine(machine.nom).then(() => provider.saveMachine(maj))
        : provider.saveMachine(maj);
    void promesse
      .then(() => rechargeParams())
      .then(() => bump(`machine ${maj.nom} mise à jour`))
      .catch(erreurVersToast);
  });
  $('machines').addEventListener('click', (e) => {
    const bouton = e.target as HTMLElement;
    if (bouton.dataset.champ !== 'retirer') return;
    const nom = (bouton.closest('.machine-row') as HTMLElement | null)?.dataset.nom;
    if (!nom || !window.confirm(`Retirer la machine « ${nom} » ?`)) return;
    void provider
      .deleteMachine(nom)
      .then(() => rechargeParams())
      .then(() => bump(`machine retirée : ${nom}`))
      .catch(erreurVersToast);
  });
  $('btn-machine-ajout').addEventListener('click', () => {
    const nom = window.prompt('Nom de la nouvelle machine ?');
    if (!nom?.trim()) return;
    void provider
      .saveMachine({ nom: nom.trim(), couleur: '#708DA4', en_service: true })
      .then(() => rechargeParams())
      .then(() => bump(`machine ajoutée : ${nom.trim()}`))
      .catch(erreurVersToast);
  });

  $('btn-motif-ajout').addEventListener('click', () => {
    const fr = ($('nouveau-motif') as HTMLInputElement).value.trim();
    if (!fr) return;
    const en = ($('nouveau-motif-en') as HTMLInputElement).value.trim();
    const enregistre = (texteEn: string): void => {
      void provider
        .saveMotif({ fr, en: texteEn })
        .then(() => rechargeParams())
        .then(() => {
          bump(`motif ajouté : ${fr}`);
          ($('nouveau-motif') as HTMLInputElement).value = '';
          ($('nouveau-motif-en') as HTMLInputElement).value = '';
        })
        .catch(erreurVersToast);
    };
    if (en) enregistre(en);
    else void provider.traduire(fr).then((t) => enregistre(t ?? traductionLocale(fr)));
  });
  $('motifs').addEventListener('click', (e) => {
    const fr = (e.target as HTMLElement).dataset.motif;
    if (!fr) return;
    void provider
      .deleteMotif(fr)
      .then(() => rechargeParams())
      .then(() => bump(`motif retiré : ${fr}`))
      .catch(erreurVersToast);
  });

  $('btn-ciel-ajout').addEventListener('click', () => {
    const fr = ($('nouveau-ciel') as HTMLInputElement).value.trim();
    if (!fr) return;
    const en = ($('nouveau-ciel-en') as HTMLInputElement).value.trim();
    // Nouvel état ajouté en fin de liste (ordre = max + 10).
    const ordre = (params?.ciels ?? []).reduce((m, c) => Math.max(m, c.ordre), 0) + 10;
    const enregistre = (texteEn: string): void => {
      void provider
        .saveCiel({ fr, en: texteEn, ordre })
        .then(() => rechargeParams())
        .then(() => {
          bump(`état du ciel ajouté : ${fr}`);
          ($('nouveau-ciel') as HTMLInputElement).value = '';
          ($('nouveau-ciel-en') as HTMLInputElement).value = '';
        })
        .catch(erreurVersToast);
    };
    if (en) enregistre(en);
    else void provider.traduire(fr).then((t) => enregistre(t ?? traductionLocale(fr)));
  });
  $('ciels').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const rangee = champ.closest('.machine-row') as HTMLElement | null;
    const ciel = params?.ciels.find((c) => c.fr === rangee?.dataset.fr);
    if (!ciel || !rangee) return;
    const maj: Ciel = { ...ciel };
    if (champ.dataset.champ === 'fr') maj.fr = champ.value.trim() || ciel.fr;
    if (champ.dataset.champ === 'en') maj.en = champ.value.trim();
    if (champ.dataset.champ === 'ordre') maj.ordre = Number(champ.value) || ciel.ordre;
    // Renommer le FR (clé primaire) = créer la nouvelle ligne puis retirer
    // l'ancienne ; on enregistre AVANT de supprimer pour ne rien perdre.
    const promesse =
      maj.fr !== ciel.fr
        ? provider.saveCiel(maj).then(() => provider.deleteCiel(ciel.fr))
        : provider.saveCiel(maj);
    void promesse
      .then(() => rechargeParams())
      .then(() => bump(`état du ciel ${maj.fr} mis à jour`))
      .catch(erreurVersToast);
  });
  $('ciels').addEventListener('click', (e) => {
    const bouton = e.target as HTMLElement;
    if (bouton.dataset.champ !== 'retirer') return;
    const fr = (bouton.closest('.machine-row') as HTMLElement | null)?.dataset.fr;
    if (!fr) return;
    // Un état actuellement affiché en gare ne peut pas être supprimé.
    if (params && cielUtilise(fr, params.meteo_sommet.ciel_fr)) {
      toast(`Impossible : « ${fr} » est l'état météo affiché en gare.`);
      return;
    }
    if (!window.confirm(`Supprimer l'état du ciel « ${fr} » ?`)) return;
    void provider
      .deleteCiel(fr)
      .then(() => rechargeParams())
      .then(() => bump(`état du ciel retiré : ${fr}`))
      .catch(erreurVersToast);
  });

  $('btn-user-ajout').addEventListener('click', () => {
    const f = $('form-user');
    f.style.display = f.style.display === 'none' ? '' : 'none';
  });
  $('btn-user-inviter').addEventListener('click', () => {
    const nom = ($('user-nouveau-nom') as HTMLInputElement).value.trim();
    const email = ($('user-nouveau-email') as HTMLInputElement).value.trim();
    const choisis = [
      ...document.querySelectorAll<HTMLInputElement>('#user-nouveau-roles input:checked'),
    ].map((c) => c.dataset.role as Role);
    if (!nom || !email) {
      toast('Nom et email requis');
      return;
    }
    if (choisis.length === 0) {
      toast('Cochez au moins un rôle pour cette personne');
      return;
    }
    void provider
      .inviteUser(email, nom, choisis)
      .then(() => provider.listUsers())
      .then((liste) => {
        utilisateurs = liste;
        bump(`utilisateur invité : ${email}`);
        toast(`Invitation envoyée à ${email}`);
        rendreParametres();
      })
      .catch(erreurVersToast);
  });
  $('users').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const id = (champ.closest('.user-row') as HTMLElement | null)?.dataset.user;
    const u = utilisateurs.find((x) => x.user_id === id);
    if (!u) return;

    // Rôles : on envoie l'ENSEMBLE voulu, le fournisseur en déduit ce qu'il
    // faut attribuer puis retirer — dans cet ordre, celui qu'impose la base.
    if (champ.dataset.role) {
      const role = champ.dataset.role as Role;
      const voulus = champ.checked ? [...u.roles, role] : u.roles.filter((r) => r !== role);
      void provider
        .setRolesUser(u.user_id, voulus)
        .then(() => provider.listUsers())
        .then((liste) => {
          utilisateurs = liste;
          bump(
            `${champ.checked ? 'rôle attribué' : 'rôle retiré'} : ${LIBELLE_ROLE[role]} — ${u.email}`,
          );
          toast(
            champ.checked
              ? `${LIBELLE_ROLE[role]} attribué à ${u.nom}`
              : `${LIBELLE_ROLE[role]} retiré à ${u.nom}`,
          );
          rendreParametres();
        })
        .catch((erreur: unknown) => {
          erreurVersToast(erreur);
          rendreParametres(); // la case revient à l'état réel
        });
      return;
    }

    if (champ.dataset.champ === 'actif') {
      const voulu = { ...u, actif: champ.checked };
      void provider
        .saveUser(voulu)
        .then(() => provider.listUsers())
        .then((liste) => {
          utilisateurs = liste;
          bump(`compte ${champ.checked ? 'réactivé' : 'désactivé'} : ${u.email}`);
          rendreParametres();
        })
        .catch((erreur: unknown) => {
          erreurVersToast(erreur);
          rendreParametres();
        });
    }
  });
  $('users').addEventListener('click', (e) => {
    const bouton = e.target as HTMLElement;
    const id = (bouton.closest('.user-row') as HTMLElement | null)?.dataset.user;
    const u = utilisateurs.find((x) => x.user_id === id);
    if (!u) return;
    if (bouton.dataset.champ === 'reset') {
      void provider
        .resetMotDePasse(u.email)
        .then(() => toast(`Réinitialisation du mot de passe envoyée à ${u.email}`))
        .catch(erreurVersToast);
    } else if (bouton.dataset.champ === 'supprimer') {
      if (!window.confirm(`Supprimer définitivement le compte de ${u.nom} (${u.email}) ?`)) return;
      void provider
        .deleteUser(u.user_id)
        .then(() => provider.listUsers())
        .then((liste) => {
          utilisateurs = liste;
          bump(`utilisateur supprimé : ${u.email}`);
          toast(`Compte supprimé : ${u.email}`);
          rendreParametres();
        })
        .catch(erreurVersToast);
    }
  });

  // « À quai » en gare d'origine : exprimé en MINUTES à la saisie, stocké en
  // secondes comme le reste du moteur.
  $('a-quai-origine').addEventListener(
    'input',
    antiRebond(() => {
      const minutes = Math.min(
        30,
        Math.max(0, Number(($('a-quai-origine') as HTMLInputElement).value) || 0),
      );
      void provider
        .saveParams({ a_quai_origine_s: minutes * 60 })
        .then(() => rechargeParams())
        .then(() => {
          bump(`« à quai » en gare d'origine → ${minutes} min`);
          toast(`Les gares d'origine annoncent « À QUAI » ${minutes} min avant le départ`);
        })
        .catch(erreurVersToast);
    }),
  );
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Publie le brouillon : c'est ICI, et seulement ici, que les écritures
 * réseau des onglets Bandeau et Circulations ont lieu (docs/01 §5.6 révisé
 * le 29/08/2026). Chaque catégorie (météo/vitesse, messages, circulations,
 * bascule Terminus) est écrite indépendamment : l'échec d'une catégorie ne
 * doit ni bloquer les autres, ni être annoncé comme un succès (même
 * principe que « jamais de succès silencieux » déjà en vigueur ailleurs).
 * Seules les catégories qui ont RÉUSSI sont vidées de leur brouillon.
 */
async function publieLeBrouillon(): Promise<boolean> {
  const echecs: string[] = [];
  /**
   * Échec consigné AVEC sa cause. Jusqu'ici `erreurVersToast()` affichait le
   * vrai message, que le toast « Publication incomplète » écrasait une
   * fraction de seconde plus tard : l'agent ne voyait jamais la cause, ce qui
   * a coûté deux allers-retours le 04/09/2026. Les causes réelles sont
   * désormais gardées et affichées dans un bandeau PERSISTANT.
   */
  const causes: string[] = [];
  const echoue = (quoi: string, erreur: unknown): void => {
    echecs.push(quoi);
    causes.push(`${quoi} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  };

  if (Object.keys(brouillonParams).length > 0) {
    try {
      await provider.saveParams(brouillonParams);
      brouillonParams = {};
    } catch (erreur) {
      echoue('météo/vitesse', erreur);
    }
  }

  if (brouillonMessages.size > 0) {
    const entrees = [...brouillonMessages.entries()];
    for (const [id, message] of entrees) {
      try {
        if (message === null) {
          await provider.deleteMessage(id);
        } else if (estIdMessageBrouillon(id)) {
          await provider.saveMessage({ ...message, id: '' }); // création : id attribué par la base
        } else {
          await provider.saveMessage(message);
        }
        brouillonMessages.delete(id);
      } catch (erreur) {
        echoue(`message ${id}`, erreur);
      }
    }
  }

  // Suppressions de trains supplémentaires D'ABORD : si l'agent a supprimé
  // puis recréé un train au même numéro, la création doit gagner.
  for (const [date, numeros] of [...brouillonSupSupprimes.entries()]) {
    for (const numeroMontee of [...numeros]) {
      try {
        await provider.supprimerTrainSup(date, numeroMontee);
        numeros.delete(numeroMontee); // ce qui a réussi sort du brouillon
      } catch (erreur) {
        echoue(`suppression du train supplémentaire ${numeroMontee} du ${date}`, erreur);
      }
    }
    if (numeros.size === 0) brouillonSupSupprimes.delete(date);
  }

  for (const [date, parNumero] of [...brouillonCirc.entries()]) {
    // Rotations sup NEUVES → creerTrainSup (insert des deux lignes) ; tout le
    // reste, modification d'un renfort déjà en base comprise → écriture
    // groupée. La nouveauté est MARQUÉE, jamais devinée (`routageCirculations`).
    let routage;
    try {
      routage = routageCirculations([...parNumero.values()], brouillonSupNeufs.get(date));
    } catch (erreur) {
      echoue(`circulations du ${date}`, erreur);
      continue;
    }

    // CHAQUE écriture réussie sort du brouillon immédiatement. Vider la date
    // entière seulement « si tout passe » faisait réapparaître comme « en
    // attente » des trains DÉJÀ enregistrés en base — observé en production
    // le 04/09/2026 sur le train sup 101/102.
    for (const { montee, descente } of routage.creations) {
      try {
        await provider.creerTrainSup(date, montee, descente);
        parNumero.delete(montee.numero);
        parNumero.delete(descente.numero);
        brouillonSupNeufs.get(date)?.delete(montee.numero);
      } catch (erreur) {
        echoue(`création du train supplémentaire ${montee.numero} du ${date}`, erreur);
      }
    }

    if (routage.misesAJour.length > 0) {
      try {
        await provider.saveCirculations(routage.misesAJour);
        for (const c of routage.misesAJour) parNumero.delete(c.numero);
      } catch (erreur) {
        // Écriture groupée : en cas d'échec on garde TOUT le lot. Une reprise
        // est idempotente (upsert sur date + numéro), alors qu'oublier une
        // ligne réellement non écrite la perdrait pour de bon.
        echoue(`circulations du ${date}`, erreur);
      }
    }

    if (parNumero.size === 0) brouillonCirc.delete(date);
    if (brouillonSupNeufs.get(date)?.size === 0) brouillonSupNeufs.delete(date);
  }

  // La SECTION avant la bascule Terminus : la section est la borne
  // extérieure, l'écrire d'abord évite un état intermédiaire où la colonne
  // Terminus désignerait une gare déjà hors service.
  for (const [date, section] of [...brouillonSection.entries()]) {
    try {
      await provider.setSectionJour(date, section);
      brouillonSection.delete(date);
    } catch (erreur) {
      echoue(`ligne exploitée du ${date}`, erreur);
    }
  }

  for (const [date, flag] of [...brouillonTerminus.entries()]) {
    try {
      await provider.setTerminusBellevue(date, flag);
      brouillonTerminus.delete(date);
    } catch (erreur) {
      echoue(`terminus Bellevue du ${date}`, erreur);
    }
  }

  rafraichitMessagesEffectifs();
  rafraichitParamsEffectifs();
  rafraichitJourEffectif();

  if (echecs.length > 0) {
    // La CAUSE dans un bandeau persistant, le résumé dans le toast : un
    // diagnostic qui s'efface avant d'être lu ne sert à personne.
    afficheEchecPublication(causes);
    toast(
      `⚠ Publication incomplète — resté(e) en attente : ${echecs.join(', ')}. Réessayez « Publier ».`,
    );
    // Publication partielle : on recompte ce qui reste réellement en écart
    // plutôt que de réafficher un total devenu faux.
    recalculeEcarts();
    return false;
  }
  afficheEchecPublication([]);
  return true;
}

/**
 * Bandeau des causes d'une publication incomplète. Persistant : il n'est
 * effacé que par une publication qui réussit, ou par une nouvelle tentative.
 */
function afficheEchecPublication(causes: string[]): void {
  const bloc = $('echec-publication');
  if (causes.length === 0) {
    bloc.style.display = 'none';
    bloc.textContent = '';
    return;
  }
  bloc.style.display = '';
  bloc.innerHTML =
    '<b>⚠ Publication incomplète</b><ul>' +
    causes.map((c) => `<li>${echapper(c)}</li>`).join('') +
    '</ul>';
}

function initPublication(): void {
  $('btn-apercu').addEventListener('click', () =>
    window.open(`ecran.html?gare=saint-gervais${suffixeDemo()}`, '_blank'),
  );
  $('btn-publier').addEventListener('click', () => {
    // Le résumé consigné décrit les ÉCARTS RÉELS : une température revenue à
    // sa valeur d'origine n'y figure pas.
    const resume = resumeEcarts(ecartsCourants);
    afficheEchecPublication([]); // la tentative précédente n'a plus cours
    void publieLeBrouillon()
      .then((succes) => {
        if (!succes) return; // les catégories en échec restent en attente, rien n'est journalisé
        journal.length = 0;
        referenceMajMs = Date.now(); // nouvelle référence de fraîcheur des écrans : les écrans reçoivent seulement maintenant
        return chargeTout()
          .then(() => {
            rendreTout();
            return provider.logPublication(resume);
          })
          .then(() => provider.dernierePublication().catch(() => null))
          .then((quand) => {
            dernierePublicationVue = quand;
            void rendreEcrans().then(fixeReference);
            fixeReference(); // référence remise à jour immédiatement
            toast('✓ Publié — les 6 gares sont synchronisées · consigné dans l’historique');
          });
      })
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function demarre(): Promise<void> {
  ($('logo') as HTMLImageElement).src = __LOGO_ROND_BLANC__;
  rendreBaseServie();
  initOnglets();
  initCirculations();
  initMessages();
  initMedias();
  initEcrans();
  initBibliotheque();
  initBandeau();
  initJournal();
  initParametres();
  initPublication();
  ongletHoraires = initOngletHoraires({
    provider,
    $,
    toast,
    erreurVersToast,
    roles: () => roles,
    // Une grille chargée ou (dés)activée change les grilles ACTIVES et donc
    // la journée affichée : on relit tout, comme après une publication.
    apresChangement: async () => {
      await chargeTout();
      rendreTout();
    },
  });

  $('btn-deconnexion').addEventListener('click', () => {
    // Le brouillon (Bandeau, Circulations) ne vit qu'en mémoire : se
    // déconnecter sans publier le perdrait silencieusement.
    if (
      !rienEnAttente() &&
      !window.confirm(
        `${modifs} modification(s) en attente de publication seront perdues. Se déconnecter quand même ?`,
      )
    ) {
      return;
    }
    sessionStorage.clear();
    window.location.reload();
  });

  // Même risque en cas de fermeture d'onglet ou de rechargement accidentel.
  window.addEventListener('beforeunload', (e) => {
    if (rienEnAttente()) return;
    e.preventDefault();
  });

  /** Charge le profil de la session ouverte et entre dans la supervision. */
  async function entreAvecSession(): Promise<void> {
    profilConnecte = await provider.getProfil();
    roles = profilConnecte.roles;
    utilisateurs = await provider.listUsers().catch(() => []);
    await apresConnexion();
  }

  $('form-connexion').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = ($('login-email') as HTMLInputElement).value.trim();
    const mdp = ($('login-mdp') as HTMLInputElement).value;
    $('login-erreur').textContent = '';
    void provider
      .signIn(email, mdp)
      .then(entreAvecSession)
      .catch((erreur: unknown) => {
        $('login-erreur').textContent = String(
          erreur instanceof Error ? erreur.message : 'Connexion refusée',
        );
      });
  });

  // Lien reçu par e-mail refusé par Supabase (expiré, déjà utilisé…) : on le
  // dit clairement au-dessus du formulaire plutôt que de laisser la personne
  // chercher un mot de passe qu'elle n'a jamais choisi.
  if (lienAuth && 'erreur' in lienAuth) {
    $('login-erreur').textContent = lienAuth.erreur;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }

  // Invitation ou réinitialisation : la session est ouverte par le jeton du
  // lien, mais aucun mot de passe n'existe encore — on le fait choisir ici.
  if (lienAuth && 'type' in lienAuth && lienAuth.type !== 'autre') {
    await accueilMotDePasse(lienAuth.type, entreAvecSession);
    return;
  }

  // Session déjà ouverte (Supabase persiste, mock via sessionStorage)
  try {
    // Le profil vient de la base, pas de l'onglet : un onglet rouvert
    // affichait « agent connecté » puisque la clé de session lui manquait.
    await entreAvecSession();
  } catch {
    // pas de session : formulaire de connexion
  }
}

/**
 * Formulaire « choisissez votre mot de passe » affiché à la place de la
 * connexion après un lien d'invitation ou de réinitialisation. Une fois le mot
 * de passe enregistré, on entre directement dans la supervision.
 */
async function accueilMotDePasse(
  type: 'invite' | 'recovery',
  entreAvecSession: () => Promise<void>,
): Promise<void> {
  const textes = texteFormulaireMotDePasse(type);
  $('form-connexion').hidden = true;
  $('form-mdp').hidden = false;
  $('mdp-titre').textContent = textes.titre;
  $('mdp-consigne').textContent = textes.consigne;
  ($('mdp-valider') as HTMLButtonElement).textContent = textes.bouton;

  // Rappelle pour quel compte on agit ; si le SDK n'a pas pu ouvrir la
  // session (jeton mort, horloge fausse), on le signale tout de suite.
  try {
    const profil = await provider.getProfil();
    $('mdp-compte').textContent = `Compte : ${profil.email}`;
  } catch {
    $('mdp-compte').textContent = '';
    $('mdp-erreur').textContent =
      'Le lien n’a pas permis d’ouvrir votre compte (expiré ou déjà utilisé). ' +
      'Demandez un nouvel envoi à un administrateur.';
    ($('mdp-valider') as HTMLButtonElement).disabled = true;
  }

  $('form-mdp').addEventListener('submit', (e) => {
    e.preventDefault();
    const mdp = ($('mdp-nouveau') as HTMLInputElement).value;
    const confirmation = ($('mdp-confirmation') as HTMLInputElement).value;
    const probleme = verifieMotDePasse(mdp, confirmation);
    $('mdp-erreur').textContent = probleme ?? '';
    if (probleme) return;
    const bouton = $('mdp-valider') as HTMLButtonElement;
    bouton.disabled = true;
    void provider
      .definirMotDePasse(mdp)
      .then(async () => {
        toast('Mot de passe enregistré');
        await entreAvecSession();
        $('form-mdp').hidden = true;
        $('form-connexion').hidden = false;
      })
      .catch((erreur: unknown) => {
        bouton.disabled = false;
        $('mdp-erreur').textContent = String(
          erreur instanceof Error ? erreur.message : 'Enregistrement impossible',
        );
      });
  });
}

void demarre();
