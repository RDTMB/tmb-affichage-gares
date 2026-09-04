// Logique PURE de la supervision, extraite pour être testable sans DOM :
// aller-retour entre un message et son formulaire (la cible et l'expiration
// doivent survivre à une simple correction de texte) et construction des
// identifiants d'écran.
import { dureeCycleS } from '../core/cycle-medias';
import type { ModeMedias } from '../core/cycle-medias';
import type { Circulation, EcranInfo, GareId, Media, Message, Profil, Sens } from '../core/types';
import { ORDRE_GARES } from '../core/types';
import { origineReelle, terminusReel } from '../core/horaires';
import { echapper } from './affichage-commun';
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

/**
 * Au-delà de ce silence, on précise DEPUIS QUAND un écran est en attente :
 * cela distingue une synchronisation en cours d'un poste réellement mort.
 */
export const SILENCE_A_PRECISER_MS = 2 * 60_000;

/** Mémoire du bandeau entre deux rafraîchissements. */
export interface EtatBandeauApplication {
  /** Référence déjà affichée : sert à repérer une NOUVELLE modification. */
  derniereReferenceAffichee: number | null;
  /** Le bandeau a été masqué DÉFINITIVEMENT pour cette référence. */
  resumeResorbe: boolean;
}

export interface DecisionBandeau {
  afficher: boolean;
  libelle: string;
  classe: 'ok' | 'attente';
  /** Délai avant masquage définitif ; null = affichage CONTINU. */
  minuteurMs: number | null;
  /** État à mémoriser pour l'appel suivant. */
  etat: EtatBandeauApplication;
}

/**
 * Décide de l'affichage du bandeau « Appliqué sur N/N écrans ». PURE : le
 * contrôleur ne fait qu'appliquer la décision.
 *
 * Le bandeau apparaissait et disparaissait en boucle parce que chaque
 * rafraîchissement le réaffichait, le minuteur de 6 s le masquant aussitôt
 * après. D'où la mémoire `resumeResorbe` : une fois résorbé, le bandeau reste
 * masqué jusqu'à la modification SUIVANTE.
 *
 * Un écran en retard maintient l'affichage sans minuteur : l'information doit
 * rester sous les yeux tant que la situation dure.
 */
export function decisionBandeauApplication(
  ecrans: (Pick<EcranInfo, 'derniere_vue' | 'donnees_maj'> & { gare: string })[],
  referenceMajMs: number | null,
  maintenantMs: number,
  etat: EtatBandeauApplication,
  nomGare: (gare: string) => string = (g) => g,
  delaiResorptionMs = 6000,
): DecisionBandeau {
  const masque = (etatSuivant: EtatBandeauApplication): DecisionBandeau => ({
    afficher: false,
    libelle: '',
    classe: 'ok',
    minuteurMs: null,
    etat: etatSuivant,
  });

  if (referenceMajMs === null) return masque(etat); // rien n'a encore été modifié

  // Une nouvelle modification relance le cycle d'affichage.
  const etatCourant: EtatBandeauApplication =
    referenceMajMs === etat.derniereReferenceAffichee
      ? etat
      : { derniereReferenceAffichee: referenceMajMs, resumeResorbe: false };

  // Déjà résorbé : on ne réaffiche RIEN, sinon la boucle repart.
  if (etatCourant.resumeResorbe) return masque(etatCourant);

  const resume = resumeApplication(ecrans, referenceMajMs, maintenantMs, nomGare);
  const enAttente = resume.enAttente.length > 0;
  return {
    afficher: true,
    libelle: resume.libelle,
    classe: enAttente ? 'attente' : 'ok',
    // Un écran en retard : affichage continu, aucun minuteur.
    minuteurMs: enAttente ? null : delaiResorptionMs,
    etat: etatCourant,
  };
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
  // Un écran silencieux depuis plus de 2 min : on précise DEPUIS QUAND. Sans
  // cela, « en attente sur : Saint-Gervais » ne dit pas si la synchro est en
  // cours ou si le poste est mort.
  const enAttente = ecrans
    .map((e) => ({ e, etat: etatFraicheurEcran(e, publicationMs, maintenantMs) }))
    .filter((x) => x.etat.statut !== 'a-jour')
    .map((x) => {
      const nom = nomGare(x.e.gare);
      if (x.etat.statut !== 'hors-ligne') return nom;
      const vu = x.e.derniere_vue ? new Date(x.e.derniere_vue).getTime() : NaN;
      if (!Number.isFinite(vu)) return `${nom} (jamais vu)`;
      const silence = maintenantMs - vu;
      if (silence < SILENCE_A_PRECISER_MS) return nom;
      return `${nom} (hors ligne depuis ${Math.round(silence / 60_000)} min)`;
    });
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

// ---------------------------------------------------------------------------
// Section exploitée (travaux) — contrainte d'interface
// ---------------------------------------------------------------------------

/**
 * Bornes admissibles des deux listes « Ligne exploitée de … à … ».
 * `gare_debut` doit précéder STRICTEMENT `gare_fin` dans l'ordre de la ligne :
 * l'interface doit l'empêcher, pas seulement la base — une section inversée
 * viderait tous les écrans, et un message d'erreur après coup ne rattrape pas
 * un affichage voyageurs déjà faux.
 */
export function bornesSectionPossibles(cote: 'debut' | 'fin', autre: GareId): GareId[] {
  const rang = ORDRE_GARES.indexOf(autre);
  return cote === 'debut' ? ORDRE_GARES.slice(0, Math.max(rang, 1)) : ORDRE_GARES.slice(rang + 1);
}

/**
 * Section corrigée après un choix de l'exploitant : la borne qu'il vient de
 * bouger est respectée, l'AUTRE se décale du minimum nécessaire pour rester
 * ordonnée. Rien n'est refusé silencieusement, rien n'est laissé incohérent.
 */
export function ajusteSection(
  debut: GareId,
  fin: GareId,
  bougee: 'debut' | 'fin',
): { debut: GareId; fin: GareId } {
  const iDebut = ORDRE_GARES.indexOf(debut);
  const iFin = ORDRE_GARES.indexOf(fin);
  if (iDebut >= 0 && iFin >= 0 && iDebut < iFin) return { debut, fin };
  if (bougee === 'debut') {
    const suivante = ORDRE_GARES[Math.min(iDebut + 1, ORDRE_GARES.length - 1)];
    return { debut, fin: suivante ?? fin };
  }
  const precedente = ORDRE_GARES[Math.max(iFin - 1, 0)];
  return { debut: precedente ?? debut, fin };
}

/**
 * Bandeau d'information de la restriction de ligne. Il énonce ce qui est
 * certain et utile : la section, les gares fermées, et le fait que la
 * restriction se REPORTE sur les journées suivantes tant qu'elle n'est pas
 * levée — c'est ce report qui évite qu'une journée oubliée annonce des trains
 * qui ne circulent pas, l'erreur la plus grave que ce système puisse
 * commettre. Renvoie null sur une ligne entière : rien à signaler.
 */
export function bandeauSection(
  section: { gare_debut: GareId; gare_fin: GareId },
  nomGare: (gare: GareId) => string,
): string | null {
  const iDebut = ORDRE_GARES.indexOf(section.gare_debut);
  const iFin = ORDRE_GARES.indexOf(section.gare_fin);
  if (iDebut < 0 || iFin < 0 || (iDebut === 0 && iFin === ORDRE_GARES.length - 1)) return null;
  const fermees = ORDRE_GARES.filter((_, i) => i < iDebut || i > iFin).map(nomGare);
  return (
    `⚠ Ligne exploitée de ${nomGare(section.gare_debut)} à ${nomGare(section.gare_fin)} — ` +
    `${fermees.length > 1 ? 'gares fermées' : 'gare fermée'} : ${fermees.join(', ')}. ` +
    'Cette restriction est reportée sur les journées suivantes tant qu’elle n’est pas levée.'
  );
}

// ---------------------------------------------------------------------------
// Cellule « Terminus » du tableau des circulations
// ---------------------------------------------------------------------------

export interface EntreesCelluleTerminus {
  /** La circulation de la ligne rendue. */
  circulation: Circulation;
  /** La MONTÉE de la rotation (la ligne elle-même pour une montée). */
  circulationMontee: Circulation | null;
  sens: Sens;
  express: boolean;
  /** Facultatif non activé : il ne circule pas, il n'y a rien à traiter. */
  inactif: boolean;
  lectureSeule: boolean;
  nomGare: (gare: GareId) => string;
  /**
   * Passages tels que le MOTEUR les rendra (`trainsDuJour()`), quand le train
   * circule vraiment. Ils peuvent être plus courts que ceux enregistrés : une
   * bascule Terminus Bellevue activée APRÈS la création d'un renfort le
   * tronque. La supervision doit annoncer le terminus que les écrans
   * afficheront, pas celui qui dort en base.
   */
  passagesEffectifs?: readonly { gare: GareId }[] | null;
}

/** Infobulle du terminus d'un train supplémentaire : il se change en le recréant. */
export const AIDE_TERMINUS_SUP =
  'Terminus défini à la création du train supplémentaire. Pour le modifier, supprimez ce train et recréez-le.';

/**
 * Contenu de la cellule Terminus. PURE, donc testable : c'est la cellule qui
 * avait fini par MENTIR sur les trains supplémentaires, en affichant la
 * colonne `circulations.terminus` ('nid-daigle' ou 'bellevue', imposées par la
 * contrainte CHECK) au lieu du terminus réellement choisi par l'agent.
 *
 * Un train SUPPLÉMENTAIRE est donc traité EN PREMIER, avant toute autre
 * ramification : son terminus se lit sur ses `passages` (`terminusReel()` /
 * `origineReelle()`, partagées avec l'écran de gare et la grille du jour) et
 * s'affiche en TEXTE FIXE. Aucun `<select>` n'est rendu pour ces lignes — pas
 * même grisé : une écriture sur `circulations.terminus` ne changerait rien aux
 * écrans et produirait un toast de succès mensonger. Ce projet a déjà payé ce
 * type de faux succès deux fois ; une commande qui ne peut rien faire ne doit
 * pas rester cliquable.
 */
export function celluleTerminus(e: EntreesCelluleTerminus): string {
  const {
    circulation: c,
    circulationMontee,
    sens,
    express,
    inactif,
    lectureSeule,
    nomGare,
    passagesEffectifs,
  } = e;
  const n = c.numero;
  const verrou = lectureSeule ? ' disabled' : '';
  const montee = sens === 'montee';

  // --- Train SUPPLÉMENTAIRE : le terminus vient des passages, jamais de la
  //     colonne. Montée → son terminus ; descente → sa gare de départ, qui
  //     n'est pas forcément Le Fayet (un renfort peut ne pas redescendre en bas).
  if (c.supplementaire) {
    const source =
      passagesEffectifs && passagesEffectifs.length > 0 ? { passages: passagesEffectifs } : c;
    const gare = montee ? terminusReel(source) : origineReelle(source);
    const libelle = gare === null ? '—' : nomGare(gare);
    const texte = montee ? libelle : `Départ de ${libelle}`;
    return `<span class="term-fixe" title="${echapper(AIDE_TERMINUS_SUP)}">${echapper(texte)}</span>`;
  }

  // Rotation limitée = colonne Terminus de la MONTÉE sur Bellevue (pour une
  // montée, circulationMontee est la ligne elle-même). Un facultatif non
  // activé ou un train supprimé ne circule pas : plus rien à traiter (sinon
  // toute journée grand service afficherait le signalement par défaut).
  const aTraiter =
    circulationMontee?.terminus === 'bellevue' && c.statut !== 'supprime' && !inactif;

  return montee
    ? express
      ? aTraiter
        ? // Express dans une plage limitée : il n'est jamais tronqué (il ne
          // dessert pas Bellevue) — l'agent tranche explicitement.
          `<span class="term-bv" title="Un express ne dessert pas Bellevue : à supprimer, ou à maintenir jusqu'au Nid d'Aigle">À traiter ⚠</span>
           <span class="a-traiter">
             <button class="leger" data-action="express-supprimer" data-numero="${n}"${verrou}>Supprimer</button>
             <button class="leger" data-action="express-maintenir" data-numero="${n}"${verrou}>Maintenir</button>
           </span>`
        : c.terminus === 'bellevue'
          ? '<span class="term-fixe">Rotation limitée</span>'
          : '<span class="term-fixe" title="Un express ne peut pas être limité à Bellevue">Nid d\'Aigle</span>'
      : `<select data-action="terminus" data-numero="${n}"${verrou}>
          <option value="nid-daigle" ${c.terminus === 'nid-daigle' ? 'selected' : ''}>Nid d'Aigle</option>
          <option value="bellevue" ${c.terminus === 'bellevue' ? 'selected' : ''}>Bellevue ⚠</option>
        </select>`
    : circulationMontee?.terminus === 'bellevue'
      ? express
        ? // Descente EXPRESS d'une rotation limitée : elle ne dessert pas
          // Bellevue, elle partirait donc du Nid d'Aigle sur un tronçon fermé.
          !aTraiter
          ? '<span class="term-fixe">Rotation limitée</span>'
          : `<span class="term-bv" title="Un express ne part pas de Bellevue : à supprimer, ou à maintenir depuis le Nid d'Aigle">À traiter ⚠</span>
             <span class="a-traiter">
               <button class="leger" data-action="express-supprimer" data-numero="${n}"${verrou}>Supprimer</button>
               <button class="leger" data-action="express-maintenir-descente" data-numero="${n}"${verrou}>Maintenir</button>
             </span>`
        : '<span class="term-bv">Départ de Bellevue</span>'
      : '<span class="term-fixe">Le Fayet</span>';
}
