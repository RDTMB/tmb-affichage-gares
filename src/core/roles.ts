// Rôles MULTIPLES et CUMULABLES (docs/01 §5.5, docs/02 §5) — module PUR.
//
// Un utilisateur porte un ENSEMBLE de rôles ; un droit est accordé si AU MOINS
// UN de ses rôles le donne (UNION, jamais héritage). Aucun rôle n'en implique
// un autre : « technique » (informatique) ne donne PAS l'exploitation, et
// réciproquement. Ce module est la SEULE source de vérité du front et du mock ;
// la frontière RÉELLE reste RLS côté base (supabase/migrations/
// 2026-09-roles-multiples.sql), dont ce fichier n'est que le miroir de confort.
//
// Toute divergence entre ce miroir et la base est un BOGUE : le test
// src/data/scripts-sql.test.ts compare la matrice d'attribution ci-dessous au
// seed SQL du catalogue `roles`.

/** Les quatre rôles, dans l'ordre d'affichage (badges, cases à cocher). */
export const ROLES = ['technique', 'admin', 'supervision', 'caisse'] as const;

export type Role = (typeof ROLES)[number];

/** Libellés d'interface (le badge affiche, lui, le code en majuscules). */
export const LIBELLE_ROLE: Record<Role, string> = {
  technique: 'Technique',
  admin: 'Administrateur',
  supervision: 'Supervision',
  caisse: 'Caisse',
};

/** À quoi sert chaque rôle — infobulle des cases à cocher. */
export const DESCRIPTION_ROLE: Record<Role, string> = {
  technique:
    'Responsable informatique : grilles horaires, configuration des écrans, paramètres techniques, comptes techniques.',
  admin:
    'Chef d’exploitation : comptes supervision et caisse, modèles de messages, médias, paramètres d’exploitation.',
  supervision: 'Exploitation courante : circulations, bandeau voyageurs, publication.',
  caisse: 'Bandeau voyageurs : messages, météo du sommet, vitesse de défilement.',
};

/**
 * Rôles PROTÉGÉS : il doit toujours rester au moins un compte ACTIF qui les
 * porte. Sans technique, plus personne ne peut charger une grille ni déclarer
 * un écran ; sans admin, plus personne ne gère les comptes d'exploitation.
 * La base refuse le retrait du dernier (déclencheur de contrainte), l'interface
 * ne fait que griser la case en amont.
 */
export const ROLES_PROTEGES: readonly Role[] = ['technique', 'admin'];

/**
 * QUI ATTRIBUE QUOI. Non hiérarchique : « technique » n'attribue que
 * « technique » (l'informatique recrute l'informatique), « admin » attribue les
 * rôles d'exploitation. Personne d'autre n'attribue rien, et personne ne
 * modifie JAMAIS ses propres rôles.
 */
export const ATTRIBUABLE_PAR: Record<Role, readonly Role[]> = {
  technique: ['technique'],
  admin: ['admin'],
  supervision: ['admin'],
  caisse: ['admin'],
};

// ---------------------------------------------------------------------------
// Droits
// ---------------------------------------------------------------------------

/**
 * Capacités élémentaires. Un droit = une famille d'écritures cohérente côté
 * base ; l'interface masque ou désactive ce que le droit ne couvre pas, RLS
 * le refuse de toute façon.
 */
export const DROITS = [
  /** Journées, circulations, terminus, section, trains supplémentaires, facultatifs. */
  'circulations',
  /** « Réinitialiser la journée depuis la grille » (suppression de la journée). */
  'journee.reinitialiser',
  /** Barre « Publier » et journal des publications. */
  'publier',
  /** Messages voyageurs, météo du sommet, vitesse du bandeau. */
  'bandeau',
  /** Bibliothèque de modèles de messages (administration). */
  'modeles',
  /** Médias, mode et durée du cycle d'affichage. */
  'medias',
  /** Machines, motifs, états du ciel, délai « à quai ». */
  'parametres.exploitation',
  /** Grilles horaires : import, versions, activation, métadonnées. */
  'grilles',
  /** Déclarer ou oublier un poste (identité des écrans). */
  'ecrans.declarer',
  /** Recharger un écran à distance, veille propre à un poste. */
  'ecrans.commander',
  /** Veille de nuit GLOBALE, durée du cache — réglages d'infrastructure. */
  'parametres.technique',
  /** Voir tous les comptes et leurs rôles. */
  'comptes.lire',
  /** Inviter, renommer, désactiver, supprimer, attribuer des rôles. */
  'comptes.gerer',
  /** Journal d'exploitation (lecture). */
  'journal',
  /** Journal : lignes qui tracent les comptes et les rôles. */
  'journal.roles',
  /** Purge du journal au-delà de 12 mois. */
  'journal.purger',
] as const;

export type Droit = (typeof DROITS)[number];

/**
 * MATRICE droit × rôle (docs/01 §5.5). Validée par l'exploitant le 05/09/2026 :
 * l'exploitation ne doit JAMAIS attendre l'informatique un matin de service —
 * grilles, rechargement d'écran et réinitialisation d'une journée sont donc
 * PARTAGÉS, et seuls les réglages d'infrastructure restent exclusifs.
 */
const DROITS_PAR_ROLE: Record<Role, readonly Droit[]> = {
  technique: [
    'grilles',
    'journee.reinitialiser',
    'ecrans.declarer',
    'ecrans.commander',
    'parametres.technique',
    'comptes.lire',
    'comptes.gerer',
    'journal',
    'journal.roles',
    'journal.purger',
    'publier',
  ],
  admin: [
    'bandeau',
    'modeles',
    'medias',
    'parametres.exploitation',
    'grilles',
    'comptes.lire',
    'comptes.gerer',
    'journal',
    'journal.roles',
    'publier',
  ],
  supervision: [
    'circulations',
    'journee.reinitialiser',
    'grilles',
    'bandeau',
    'medias',
    'ecrans.commander',
    'journal',
    'publier',
  ],
  caisse: ['bandeau', 'journal', 'publier'],
};

/** Union des droits portés par un ensemble de rôles. */
export function droits(roles: readonly Role[]): Set<Droit> {
  const union = new Set<Droit>();
  for (const role of roles) for (const droit of DROITS_PAR_ROLE[role] ?? []) union.add(droit);
  return union;
}

/** Raccourci : cet ensemble de rôles donne-t-il ce droit ? */
export function aLeDroit(roles: readonly Role[], droit: Droit): boolean {
  return roles.some((r) => (DROITS_PAR_ROLE[r] ?? []).includes(droit));
}

// ---------------------------------------------------------------------------
// Onglets de la supervision
// ---------------------------------------------------------------------------

/** Onglets, dans l'ordre de la barre de navigation (supervision.html). */
export const ONGLETS = [
  'circulations',
  'horaires',
  'bandeau',
  'medias',
  'ecrans',
  'parametres',
] as const;

export type Onglet = (typeof ONGLETS)[number];

/** Un onglet est visible dès qu'un droit qui l'habite est accordé. */
const DROITS_DE_L_ONGLET: Record<Onglet, readonly Droit[]> = {
  circulations: ['circulations'],
  // La caisse voit les horaires en LECTURE SEULE (« Voir » uniquement) : la
  // grille du jour lui sert au guichet.
  horaires: ['grilles', 'circulations', 'bandeau'],
  bandeau: ['bandeau'],
  medias: ['medias'],
  ecrans: ['ecrans.declarer', 'ecrans.commander', 'parametres.technique'],
  parametres: ['parametres.exploitation', 'comptes.lire', 'journal.purger'],
};

/** Onglets visibles pour un ensemble de rôles, dans l'ordre de la barre. */
export function ongletsVisibles(roles: readonly Role[]): Onglet[] {
  const acquis = droits(roles);
  return ONGLETS.filter((onglet) =>
    DROITS_DE_L_ONGLET[onglet].some((droit) => acquis.has(droit)),
  );
}

// ---------------------------------------------------------------------------
// Attribution des rôles
// ---------------------------------------------------------------------------

/** L'appelant peut-il donner (ou retirer) CE rôle ? */
export function peutAttribuer(mesRoles: readonly Role[], role: Role): boolean {
  return ATTRIBUABLE_PAR[role].some((r) => mesRoles.includes(r));
}

/** Rôles que l'appelant peut attribuer, dans l'ordre d'affichage. */
export function rolesAttribuables(mesRoles: readonly Role[]): Role[] {
  return ROLES.filter((role) => peutAttribuer(mesRoles, role));
}

/**
 * Peut-on renommer, désactiver ou supprimer ce compte ? Règle STRICTE voulue
 * par l'exploitant : il faut pouvoir attribuer TOUS les rôles de la cible.
 * Un administrateur ne touche donc pas au compte du prestataire informatique,
 * et réciproquement — la séparation des fonctions vaut aussi pour la gestion
 * des comptes eux-mêmes.
 *
 * Un compte SANS rôle (invitation en cours, rôles retirés) est gérable par
 * quiconque peut attribuer au moins un rôle : sans cela, il deviendrait
 * orphelin dès sa création.
 */
export function peutGererProfil(mesRoles: readonly Role[], rolesCible: readonly Role[]): boolean {
  if (rolesAttribuables(mesRoles).length === 0) return false;
  return rolesCible.every((role) => peutAttribuer(mesRoles, role));
}

/**
 * Ce compte est-il le DERNIER détenteur actif d'un rôle protégé ? L'interface
 * s'en sert pour griser la case et le bouton « Désactiver » ; la base tranche
 * de toute façon (déclencheur de contrainte différé).
 */
export function estDernierDetenteur(
  comptes: readonly { user_id: string; roles: readonly Role[]; actif: boolean }[],
  user_id: string,
  role: Role,
): boolean {
  if (!ROLES_PROTEGES.includes(role)) return false;
  const detenteurs = comptes.filter((c) => c.actif && c.roles.includes(role));
  return detenteurs.length === 1 && detenteurs[0]?.user_id === user_id;
}

/** Rôles protégés dont ce compte est l'unique détenteur actif. */
export function rolesDontIlEstLeDernier(
  comptes: readonly { user_id: string; roles: readonly Role[]; actif: boolean }[],
  user_id: string,
): Role[] {
  return ROLES_PROTEGES.filter((role) => estDernierDetenteur(comptes, user_id, role));
}

/** Motif de blocage d'une case à cocher, ou null si elle est manipulable. */
export function motifCaseVerrouillee(
  mesRoles: readonly Role[],
  moi: string,
  cible: { user_id: string; roles: readonly Role[]; actif: boolean },
  role: Role,
  comptes: readonly { user_id: string; roles: readonly Role[]; actif: boolean }[],
): string | null {
  if (cible.user_id === moi) return 'Personne ne modifie ses propres rôles.';
  if (!peutAttribuer(mesRoles, role)) {
    const qui = ATTRIBUABLE_PAR[role].map((r) => LIBELLE_ROLE[r]).join(' ou ');
    return `Le rôle « ${LIBELLE_ROLE[role]} » ne s’attribue que depuis un compte ${qui}.`;
  }
  if (cible.roles.includes(role) && estDernierDetenteur(comptes, cible.user_id, role)) {
    return `Dernier compte actif portant « ${LIBELLE_ROLE[role]} » : donnez d’abord ce rôle à quelqu’un d’autre.`;
  }
  return null;
}

/**
 * Motif de blocage de la désactivation ou de la suppression d'un compte,
 * ou null si l'action est possible.
 */
export function motifCompteVerrouille(
  mesRoles: readonly Role[],
  moi: string,
  cible: { user_id: string; roles: readonly Role[]; actif: boolean },
  comptes: readonly { user_id: string; roles: readonly Role[]; actif: boolean }[],
): string | null {
  if (cible.user_id === moi) return 'Vous ne pouvez pas désactiver ni supprimer votre propre compte.';
  if (!peutGererProfil(mesRoles, cible.roles)) {
    return 'Ce compte porte un rôle que vous n’attribuez pas : sa gestion revient au rôle correspondant.';
  }
  const derniers = rolesDontIlEstLeDernier(comptes, cible.user_id);
  if (derniers.length > 0) {
    const liste = derniers.map((r) => LIBELLE_ROLE[r]).join(' et ');
    return `Dernier compte actif portant « ${liste} » : transmettez d’abord ce rôle.`;
  }
  return null;
}

/**
 * Rôles déduits d'une adresse de DÉMONSTRATION (mock). Le préfixe avant « @ »
 * est découpé sur « + » : « technique+admin@demo » ouvre une session cumulant
 * les deux rôles, ce qui permet d'essayer le cumul sans base.
 */
export function rolesDemoDepuisEmail(email: string): Role[] {
  const prefixe = (email.split('@')[0] ?? '').toLocaleLowerCase('fr');
  const demandes = prefixe.split('+').map((mot) => mot.trim());
  const reconnus = ROLES.filter((role) => demandes.includes(role));
  return reconnus.length > 0 ? reconnus : ['supervision'];
}
