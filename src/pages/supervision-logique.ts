// Logique PURE de la supervision, extraite pour être testable sans DOM :
// aller-retour entre un message et son formulaire (la cible et l'expiration
// doivent survivre à une simple correction de texte) et construction des
// identifiants d'écran.
import { dureeCycleS } from '../core/cycle-medias';
import type { ModeMedias } from '../core/cycle-medias';
import type { Circulation, EcranInfo, GareId, Media, Message, Profil } from '../core/types';
import { INTERVALLE_HEARTBEAT_MS } from './affichage-commun';

/** État du formulaire Messages (miroir exact des champs de l'onglet). */
export interface FormulaireMessage {
  texte_fr: string;
  texte_en: string;
  cible_type: Message['cible_type'];
  gares: GareId[];
  train_numero: number | null;
  priorite: Message['priorite'];
  /** « » = jamais, sinon valeur d'un champ datetime-local (heure locale). */
  expire_local: string;
}

/** ISO 8601 → valeur d'un champ datetime-local (« YYYY-MM-DDTHH:MM », heure locale). */
export function isoVersDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Valeur d'un champ datetime-local → ISO 8601, ou null si vide/invalide. */
export function datetimeLocalVersIso(valeur: string): string | null {
  if (!valeur) return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Message existant → état du formulaire : c'est ce qui garantit qu'ouvrir
 * « Modifier » restitue la cible ET l'expiration réelles du message (sans
 * quoi une correction de texte pouvait transformer un message ciblé en
 * message diffusé partout, sans expiration).
 */
export function valeursFormulaireMessage(m: Message): FormulaireMessage {
  return {
    texte_fr: m.texte_fr,
    texte_en: m.texte_en,
    cible_type: m.cible_type,
    gares: [...(m.gares ?? [])],
    train_numero: m.train_numero ?? null,
    priorite: m.priorite,
    expire_local: isoVersDatetimeLocal(m.expire_at),
  };
}

/**
 * État du formulaire → message à enregistrer. Le formulaire est l'UNIQUE
 * source de vérité : ce qui est affiché est ce qui sera enregistré (y
 * compris le retrait d'une expiration ou le changement de cible).
 */
export function messageDepuisFormulaire(f: FormulaireMessage, id: string): Message {
  return {
    id,
    texte_fr: f.texte_fr.trim(),
    texte_en: f.texte_en.trim(),
    cible_type: f.cible_type,
    gares: f.cible_type === 'gares' ? f.gares : null,
    train_numero: f.cible_type === 'train' ? f.train_numero : null,
    priorite: f.priorite,
    actif: true,
    expire_at: datetimeLocalVersIso(f.expire_local),
  };
}

/**
 * Dictionnaire de repli des PHRASES TYPES (docs/02 §5), utilisé quand le
 * service de traduction est indisponible. Volontairement limité aux
 * formulations récurrentes de l'exploitation, et apparié sur la phrase
 * ENTIÈRE : une substitution mot à mot produirait du franglais
 * (« le chef de station »), c'est-à-dire un autre faux anglais. Liste
 * extensible au fil des besoins de l'exploitant.
 */
const PHRASES_TYPES: [string, string][] = [
  [
    'réservation obligatoire pour tous les trajets — pensez à réserver votre descente',
    'Booking is compulsory for all journeys — remember to book your descent.',
  ],
  ['réservation obligatoire pour tous les trajets', 'Booking is compulsory for all journeys.'],
  ['réservation obligatoire', 'Booking is compulsory.'],
  [
    'restez derrière la ligne jaune à l’approche du train',
    'Please stand behind the yellow line when the tram approaches.',
  ],
  [
    'trains vélos : transport limité à 5 vélos, selon affluence',
    'Bike trains: limited to 5 bikes, subject to capacity.',
  ],
  ['forte affluence attendue', 'High demand expected.'],
  ['service interrompu', 'Service suspended.'],
  ['adressez-vous au personnel en gare', 'Please contact station staff.'],
];

/** Comparaison indulgente : casse, accents d'apostrophe et ponctuation finale. */
function normalise(texte: string): string {
  return texte
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '’')
    .replace(/[.!…]+$/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Traduction de repli. Renvoie une chaîne VIDE si la phrase n'est pas une
 * phrase type connue : on ne fabrique JAMAIS de faux anglais — ni un texte
 * français préfixé « [EN] », ni du franglais mot à mot. L'écran n'affiche
 * alors que le français, et la supervision avertit l'agent.
 */
export function traductionLocale(fr: string): string {
  const source = normalise(fr);
  if (!source) return '';
  return PHRASES_TYPES.find(([type]) => normalise(type) === source)?.[1] ?? '';
}

/**
 * Identifiant physique d'un écran : le TYPE de page en fait partie, sinon
 * l'écran des départs et l'écran grille d'une même gare s'écrasent dans
 * « État des écrans » et le bouton « Recharger » vise le mauvais poste.
 */
/**
 * Convention d'identifiant d'un poste, SOURCE UNIQUE : elle sert à la fois à
 * l'écran qui se signale et à l'administrateur qui le déclare — les deux
 * doivent tomber sur la même chaîne, sinon le signal de vie n'atteint
 * aucune ligne.
 */
export function identifiantEcranDeclare(
  type: 'ecran' | 'grille',
  gare: string,
  numero = 1,
): string {
  return `${gare}-${type}-${numero}`;
}

export function identifiantEcran(
  type: 'ecran' | 'grille',
  gare: string | null,
  parametre: string | null,
): string {
  if (parametre) return parametre; // ?ecran= reste prioritaire
  return identifiantEcranDeclare(type, gare ?? 'sans-gare');
}

// ---------------------------------------------------------------------------
// Preuve de mise à jour par écran
// ---------------------------------------------------------------------------

/**
 * Silence toléré avant de déclarer un écran hors ligne (docs/01 §5.4) :
 * deux cycles et demi de signal de vie. Un cycle manqué (réseau qui hoquette,
 * page qui redémarre) ne doit pas faire passer un écran sain au rouge.
 */
export const SEUIL_HORS_LIGNE_MS = 2.5 * INTERVALLE_HEARTBEAT_MS;

/**
 * Deux délais s'additionnent avant qu'une modification soit VISIBLE en
 * supervision : l'écran se resynchronise dans les 30 s, puis n'en informe la
 * supervision qu'à son signal de vie suivant (60 s). Pendant cette fenêtre,
 * un écran qui n'a pas encore rattrapé n'est pas « en retard » — sans elle,
 * TOUS les écrans passeraient à l'orange après chaque clic.
 */
export const DELAI_PROPAGATION_MS = 95_000;

export interface EtatFraicheur {
  /**
   * hors-ligne : plus de signal de vie depuis 90 s (la machine ne répond plus) ;
   * a-jour : ses données sont postérieures à la dernière publication ;
   * en-retard : la machine tourne, mais elle affiche encore d'anciennes données.
   */
  statut: 'a-jour' | 'en-retard' | 'hors-ligne';
  /** Écart en minutes entre la dernière publication et les données de l'écran. */
  retard_min: number;
  libelle: string;
}

/**
 * État de fraîcheur d'un écran : « à jour » ne veut PAS dire « allumé ». Un
 * Raspberry Pi peut très bien être en ligne tout en affichant un instantané
 * périmé (réseau coupé côté données) : c'est `donnees_maj` qui le prouve, pas
 * `derniere_vue`.
 */
export function etatFraicheurEcran(
  ecran: Pick<EcranInfo, 'derniere_vue' | 'donnees_maj'>,
  publicationMs: number | null,
  maintenantMs: number,
): EtatFraicheur {
  const vuMs = ecran.derniere_vue ? new Date(ecran.derniere_vue).getTime() : Number.NaN;
  if (!Number.isFinite(vuMs) || maintenantMs - vuMs >= SEUIL_HORS_LIGNE_MS) {
    return { statut: 'hors-ligne', retard_min: 0, libelle: 'hors ligne' };
  }

  const majMs = ecran.donnees_maj ? new Date(ecran.donnees_maj).getTime() : Number.NaN;
  // Aucune publication de référence, ou écran qui ne sait pas dater ses
  // données (version antérieure) : on ne prétend pas qu'il est en retard.
  if (publicationMs === null || !Number.isFinite(majMs)) {
    return { statut: 'a-jour', retard_min: 0, libelle: 'à jour' };
  }
  if (majMs >= publicationMs) return { statut: 'a-jour', retard_min: 0, libelle: 'à jour' };

  const retard_min = Math.max(1, Math.round((publicationMs - majMs) / 60_000));
  if (maintenantMs - publicationMs < DELAI_PROPAGATION_MS) {
    // Propagation normale en cours (prochaine synchro dans ≤ 30 s)
    return { statut: 'en-retard', retard_min, libelle: 'application en cours…' };
  }
  return { statut: 'en-retard', retard_min, libelle: `en retard de ${retard_min} min` };
}

/** Synthèse pour le bandeau de publication : « Appliqué sur N/N écrans ». */
export function resumeApplication(
  ecrans: (Pick<EcranInfo, 'derniere_vue' | 'donnees_maj'> & { gare: string })[],
  publicationMs: number | null,
  maintenantMs: number,
  nomGare: (gare: string) => string = (g) => g,
): { total: number; aJour: number; enAttente: string[]; libelle: string } {
  const etats = ecrans.map((e) => ({
    gare: e.gare,
    etat: etatFraicheurEcran(e, publicationMs, maintenantMs),
  }));
  const aJour = etats.filter((e) => e.etat.statut === 'a-jour').length;
  const enAttente = etats.filter((e) => e.etat.statut !== 'a-jour').map((e) => nomGare(e.gare));
  const total = etats.length;
  if (total === 0) return { total, aJour, enAttente, libelle: 'aucun écran connecté' };
  const libelle =
    enAttente.length === 0
      ? `Appliqué sur ${aJour}/${total} écrans`
      : `Appliqué sur ${aJour}/${total} écrans — en attente sur : ${[...new Set(enAttente)].join(', ')}`;
  return { total, aJour, enAttente, libelle };
}

// ============================================================================
// Trains facultatifs : action groupée et rotations appariées (docs/01 §5.1)
// ============================================================================

/** « 2026-08-25 » → « mardi 25 août » (midi UTC : insensible au fuseau). */
export function dateEnToutesLettres(dateISO: string): string {
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export interface ActionGroupeeFacultatifs {
  /** true = le clic ACTIVE, false = il désactive. */
  activer: boolean;
  /** false = aucun train facultatif ce jour : bouton grisé. */
  disponible: boolean;
  /** Trains que le clic changera réellement. */
  numeros: number[];
  /** Parmi eux, ceux qui resteront invisibles car marqués « sans voyageurs ». */
  aVide: number[];
  libelle: string;
  confirmation: string;
}

/**
 * Bouton d'action groupée sur les facultatifs de la journée affichée.
 * Le nombre annoncé est celui des trains que le clic changera VRAIMENT —
 * jamais un total flatteur incluant des trains déjà dans l'état visé.
 * Le drapeau « sans voyageurs » n'est jamais touché par cette action.
 */
export function actionGroupeeFacultatifs(
  circulations: Pick<
    Circulation,
    'numero' | 'facultatif' | 'facultatif_actif' | 'sans_voyageurs'
  >[],
  dateISO: string,
): ActionGroupeeFacultatifs {
  const facultatifs = circulations.filter((c) => c.facultatif);
  if (facultatifs.length === 0) {
    return {
      activer: true,
      disponible: false,
      numeros: [],
      aVide: [],
      libelle: 'Aucun train facultatif ce jour',
      confirmation: '',
    };
  }
  const inactifs = facultatifs.filter((c) => !c.facultatif_actif);
  // Tous activés → le bouton désactive ; sinon il active ce qui reste.
  const activer = inactifs.length > 0;
  const cibles = activer ? inactifs : facultatifs;
  const numeros = cibles.map((c) => c.numero).sort((a, b) => a - b);
  const n = numeros.length;
  const verbe = activer ? 'Activer' : 'Désactiver';
  const groupe = n === 1 ? 'le train facultatif' : `les ${n} trains facultatifs`;
  // Un facultatif marqué « sans voyageurs » reste invisible même activé :
  // l'annoncer, plutôt que promettre une apparition qui n'aura pas lieu.
  const aVide = cibles.filter((c) => c.sans_voyageurs).map((c) => c.numero);
  const reserve =
    !activer || aVide.length === 0
      ? ''
      : `\nTRAIN ${aVide.join(', TRAIN ')} : sans voyageurs, donc ${
          aVide.length === 1 ? 'il restera invisible' : 'ils resteront invisibles'
        } sur les écrans.`;
  return {
    activer,
    disponible: true,
    numeros,
    aVide,
    libelle: `${verbe} ${groupe}`,
    confirmation:
      `${verbe} ${groupe} du ${dateEnToutesLettres(dateISO)} ?\n` +
      (activer
        ? 'Ils apparaîtront immédiatement sur les écrans.'
        : 'Ils disparaîtront immédiatement des écrans.') +
      reserve,
  };
}

export interface PropositionAppariement {
  /** Train apparié à basculer avec celui sur lequel l'agent vient d'agir. */
  numero: number;
  /** État visé pour ce train apparié (le même que celui qui vient d'être posé). */
  actif: boolean;
  question: string;
}

/**
 * Activer ou désactiver un facultatif propose la même opération sur son train
 * apparié (montée n ↔ descente n+1) — même principe que la suppression d'une
 * montée. Aucune proposition si l'apparié est déjà dans l'état visé, s'il
 * n'est pas facultatif, ou s'il est SANS VOYAGEURS : la rotation est alors
 * assurée, simplement à vide.
 */
export function propositionAppariementFacultatif(
  circulations: Pick<
    Circulation,
    'numero' | 'sens' | 'facultatif' | 'facultatif_actif' | 'sans_voyageurs'
  >[],
  numero: number,
  actif: boolean,
): PropositionAppariement | null {
  const train = circulations.find((c) => c.numero === numero);
  if (!train || !train.facultatif) return null;
  const estMontee = train.sens === 'montee';
  const numeroApparie = estMontee ? numero + 1 : numero - 1;
  const apparie = circulations.find((c) => c.numero === numeroApparie);
  if (!apparie || !apparie.facultatif) return null;
  if (apparie.sans_voyageurs) return null; // rotation assurée à vide
  if (apparie.facultatif_actif === actif) return null; // déjà dans l'état visé

  const quoi = estMontee ? 'la descente appariée' : 'la montée appariée';
  // Si le train sur lequel on agit roule lui-même à vide, l'enjeu est la rame,
  // pas les voyageurs : le dire autrement plutôt qu'affirmer un faux.
  const aVide = train.sans_voyageurs === true;
  const motif = actif
    ? estMontee
      ? aVide
        ? `Sans elle, la rame du TRAIN ${numero} resterait en haut de la ligne.`
        : `Sans elle, le TRAIN ${numero} monterait des voyageurs sans train pour les redescendre.`
      : `Sans elle, aucune rame ne serait montée pour assurer le TRAIN ${numero}.`
    : estMontee
      ? `Maintenue seule, elle redescendrait une rame qui n'est pas montée.`
      : aVide
        ? `Maintenue seule, la montée laisserait sa rame en haut de la ligne.`
        : `Maintenue seule, la montée porterait des voyageurs sans train pour les redescendre.`;
  return {
    numero: numeroApparie,
    actif,
    question:
      `${actif ? 'Activer' : 'Désactiver'} aussi ${quoi} (TRAIN ${numeroApparie}) ?\n` +
      `${motif}\nCliquez Annuler pour ne changer que le TRAIN ${numero}.`,
  };
}

// ============================================================================
// Identité de l'agent connecté (en-tête de la supervision)
// ============================================================================

/**
 * Ce qu'affiche l'en-tête : le nom du profil, à défaut l'e-mail, à défaut une
 * mention neutre. Jamais de repli déduit de l'onglet courant — c'est ce qui
 * faisait afficher « agent connecté » dès qu'un onglet était rouvert.
 */
export function libelleUtilisateur(profil: Pick<Profil, 'nom' | 'email'> | null): string {
  const nom = profil?.nom?.trim();
  if (nom) return nom;
  const email = profil?.email?.trim();
  if (email) return email;
  return 'Agent connecté';
}

/**
 * Initiales de la pastille : les premières lettres des deux premiers mots du
 * nom (« Thomas Musset » → « TM »), sinon les deux premières lettres du seul
 * mot, sinon celles de l'e-mail, sinon « AG ». Majuscules, accents conservés
 * (« Élodie Perrin » → « ÉP »).
 */
export function initiales(profil: Pick<Profil, 'nom' | 'email'> | null): string {
  const majuscules = (texte: string): string => texte.toLocaleUpperCase('fr');
  const mots = (profil?.nom ?? '').trim().split(/\s+/).filter(Boolean);
  if (mots.length >= 2) {
    return majuscules((mots[0]?.charAt(0) ?? '') + (mots[1]?.charAt(0) ?? ''));
  }
  if (mots.length === 1) return majuscules((mots[0] ?? '').slice(0, 2));
  const email = (profil?.email ?? '').trim();
  if (email) return majuscules(email.slice(0, 2));
  return 'AG';
}

// ============================================================================
// Récapitulatif du cycle des médias (onglet Médias)
// ============================================================================

/**
 * Phrase récapitulative du cycle, recalculée en direct sous le choix de mode.
 * PURE : elle décrit exactement ce que fera l'écran, durées comprises.
 */
export function recapCycle(
  liste: Pick<Media, 'duree_s'>[],
  mode: ModeMedias,
  dureeHorairesS: number,
): string {
  if (liste.length === 0) {
    return `Cycle actuel : horaires en continu — aucun média actif.`;
  }
  const etapes: string[] = [`horaires ${dureeHorairesS} s`];
  if (mode === 'serie') {
    liste.forEach((m, i) => etapes.push(`média ${i + 1} (${m.duree_s} s)`));
    etapes.push('horaires');
  } else {
    // Alterné : un retour aux horaires entre chaque média.
    liste.forEach((m, i) => {
      etapes.push(`média ${i + 1} (${m.duree_s} s)`);
      if (i < liste.length - 1) etapes.push(`horaires ${dureeHorairesS} s`);
    });
    etapes.push('horaires');
  }
  const total = dureeCycleS(liste as Media[], mode, dureeHorairesS);
  return `Cycle actuel : ${etapes.join(' → ')} — ${total} s au total`;
}
