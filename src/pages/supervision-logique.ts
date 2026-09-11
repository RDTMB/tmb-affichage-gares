// Logique PURE de la supervision, extraite pour être testable sans DOM :
// aller-retour entre un message et son formulaire (la cible et l'expiration
// doivent survivre à une simple correction de texte) et construction des
// identifiants d'écran.
import { dureeCycleS } from '../core/cycle-medias';
import type { ModeMedias } from '../core/cycle-medias';
import type {
  Circulation,
  EcranInfo,
  GareId,
  Grille,
  Jour,
  Media,
  Message,
  PassageGrille,
  Profil,
  Sens,
} from '../core/types';
import type { Onglet, VisibiliteOnglets } from '../core/types';
import type { NatureCirculation } from '../core/types';
import { horsGrille, ORDRE_GARES } from '../core/types';
import {
  LIBELLE_ROLE,
  ONGLETS,
  ROLES,
  motifOngletVerrouille,
  ongletsVisibles,
  plafondOnglets,
} from '../core/roles';
import { heureVersSecondes, origineReelle, sectionComplete, terminusReel } from '../core/horaires';
import type { FormeCourse } from '../core/train-sup';
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
  // L'ANNÉE en fait partie : la barre du jour et les confirmations doivent
  // désigner une date sans ambiguïté possible (un exploitant prépare la
  // saison suivante en consultant la précédente).
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ============================================================================
// Ordre d'affichage des rotations (onglet Circulations)
// ============================================================================

/**
 * Heure de départ d'un train à son ORIGINE, en secondes depuis minuit, ou
 * `null` si elle est indéterminable — passages absents (journée non ouverte),
 * ou premier passage sans heure.
 *
 * On lit le premier passage et lui seul : c'est le départ de la course, celui
 * qui situe la rotation dans la journée. Les heures sont THÉORIQUES, comme
 * partout dans ce tableau — un retard ne déplace pas une ligne, il s'affiche
 * dans sa colonne.
 *
 * Le paramètre est typé `PassageGrille`, c'est-à-dire CE QUE L'APPELANT PASSE
 * (`montee.passages`). La forme anonyme `{ a?, d? }` qu'il portait d'abord
 * était plus étroite que la réalité : elle refusait un passage complet, donc
 * les cas d'essai réalistes — or c'est justement une course entière qui a
 * attrapé la mutation « lire le dernier passage plutôt que le premier ».
 */
export function departOrigine(
  passages: readonly PassageGrille[] | null | undefined,
): number | null {
  const premier = passages?.[0];
  const heure = premier?.d ?? premier?.a;
  if (heure === undefined) return null;
  const secondes = heureVersSecondes(heure);
  return Number.isFinite(secondes) ? secondes : null;
}

/** Une rotation à ranger : son numéro de MONTÉE, et l'heure de ce départ. */
export interface RotationAOrdonner {
  /** Numéro de la MONTÉE — c'est le rang de la rotation entière. */
  numero: number;
  /** Départ de la montée à son origine ; `null` = indéterminable. */
  depart_s: number | null;
}

/**
 * Numéros de montée, dans l'ordre où l'onglet Circulations doit les rendre.
 *
 * DÉFAUT CORRIGÉ LE 11/09/2026, relevé à la recette : le tableau était
 * construit en DEUX blocs concaténés — toute la grille, puis les trains hors
 * grille. Un renfort de 17 h se rangeait donc après le dernier train du soir,
 * et un train spécial de 10 h 30 aussi. Ce n'est pas le train spécial qui l'a
 * introduit : les renforts étaient affichés ainsi depuis toujours.
 *
 * Trois propriétés, et chacune a sa raison :
 *
 *  - le rang appartient à la ROTATION, pas à la ligne. Une descente ne se
 *    trie jamais pour elle-même : elle suit sa montée, sans quoi l'appariement
 *    — qui est la lecture même de ce tableau — se défait au premier renfort ;
 *  - à heure égale, le NUMÉRO départage. Les trains de grille sont déjà
 *    chronologiques et numérotés dans cet ordre : leur ordre relatif actuel
 *    est ainsi reproduit exactement, sans dépendre de la stabilité du tri ;
 *  - heure indéterminable → EN FIN de liste. Un tableau qui ne s'affiche pas
 *    est pire qu'un train mal placé.
 */
export function ordreRotations(rotations: readonly RotationAOrdonner[]): number[] {
  return [...rotations]
    .sort((a, b) => {
      const ha = a.depart_s ?? Number.POSITIVE_INFINITY;
      const hb = b.depart_s ?? Number.POSITIVE_INFINITY;
      return ha === hb ? a.numero - b.numero : ha - hb;
    })
    .map((r) => r.numero);
}

// ============================================================================
// Train SPÉCIAL — création (docs/01 §2.9)
// ============================================================================

/**
 * Formes proposées selon la nature. Un RENFORT ne connaît que l'aller-retour :
 * il existe pour doubler une rotation de la grille, et l'exploitant n'a jamais
 * demandé autre chose. Les trois formes sont la décision du 10/09/2026 sur le
 * train SPÉCIAL — un groupe qu'on monte et qui redescend par ses propres
 * moyens, un train affrété qui attend en haut plusieurs heures.
 */
export function formesPossibles(nature: NatureCirculation): FormeCourse[] {
  return nature === 'special' ? ['rotation', 'aller-simple', 'stationnement'] : ['rotation'];
}

export interface ChampsFormulaireCourse {
  /** Le choix de forme n'a de sens que quand il y en a plusieurs. */
  forme: boolean;
  /** Battement : seulement quand l'heure de la descente est ESTIMÉE. */
  battement: boolean;
  /** Heure de départ de la descente : seulement pour un stationnement long. */
  departDescente: boolean;
  /** Desserte de la descente : pas de descente, pas de desserte. */
  garesDescente: boolean;
  /** Commanditaire : le spécial, et lui seul. */
  commanditaire: boolean;
  /**
   * Express et vélos : RÉGLAGES GARDÉS pour le spécial (décision du
   * 10/09/2026). Un renfort ne les a jamais eus — il double une rotation de
   * la grille et suit sa desserte.
   */
  express: boolean;
  velos: boolean;
}

/**
 * Quels champs le formulaire montre. PURE, parce que c'est la seule façon de
 * verrouiller qu'un aller simple ne demande pas de battement et qu'un renfort
 * ne demande pas de commanditaire — deux champs qui, laissés visibles,
 * seraient remplis et ignorés.
 */
export function champsFormulaireCourse(
  nature: NatureCirculation,
  forme: FormeCourse,
): ChampsFormulaireCourse {
  const avecDescente = forme !== 'aller-simple';
  return {
    forme: formesPossibles(nature).length > 1,
    battement: avecDescente && forme !== 'stationnement',
    departDescente: avecDescente && forme === 'stationnement',
    garesDescente: avecDescente,
    commanditaire: nature === 'special',
    express: nature === 'special',
    velos: nature === 'special',
  };
}

/**
 * Terminus hors de ce que la journée dessert : AVERTISSEMENT, jamais refus.
 *
 * Décision de l'exploitant du 10/09/2026 : un train spécial n'a pas de limite
 * de terminus, l'agent choisit. Mais se taire serait pire que refuser — il
 * doit savoir ce que l'écran annoncera. On dit donc les deux cas où le train
 * ne sera pas affiché comme il l'imagine, et on laisse passer.
 */
export function avertissementTerminusCourse(e: {
  terminus: GareId;
  gareDebut: GareId;
  gareFin: GareId;
  /** La bascule « terminus Bellevue » est-elle active ce jour ? */
  terminusBellevue: boolean;
  /** Noms officiels, qui viennent de la grille — jamais écrits en dur ici. */
  nomGare: (g: GareId) => string;
}): string | null {
  const rang = (g: GareId): number => ORDRE_GARES.indexOf(g);
  if (rang(e.terminus) > rang(e.gareFin) || rang(e.terminus) < rang(e.gareDebut)) {
    return (
      `Terminus hors de la section exploitée aujourd'hui (${e.nomGare(e.gareDebut)} → ` +
      `${e.nomGare(e.gareFin)}). Les gares situées au-delà affichent « Ligne fermée » : ` +
      `ce train n'y sera pas annoncé.`
    );
  }
  if (e.terminusBellevue && rang(e.terminus) > rang('bellevue')) {
    return (
      'La journée est limitée à Bellevue : ce train sera signalé « à traiter » en supervision, ' +
      "et l'écran du Nid d'Aigle reste en « tronçon fermé »."
    );
  }
  return null;
}

// ============================================================================
// Onglet « Places » : quelle journée, et peut-on encore la déclarer
// (docs/01 §2.8)
// ============================================================================

/**
 * Ce que la liste des places montre pour la date affichée.
 *
 * AUJOURD'HUI, elle ne montre que ce sur quoi on peut encore agir : un train
 * parti n'a plus de places à vendre. Sur TOUTE AUTRE date, il n'existe pas
 * d'heure courante à laquelle se comparer — la caisse qui prépare le
 * lendemain doit voir la journée entière, sans quoi elle ne verrait rien à
 * partir du milieu de l'après-midi.
 */
export type PorteeAffluence = 'departs-restants' | 'tous-les-trains';

export interface EnTeteAffluence {
  portee: PorteeAffluence;
  /** « Aujourd'hui — départs restants », « mardi 15 septembre 2026 — tous les trains ». */
  titre: string;
  /** Vrai le jour même : la liste se périme toute seule, minute par minute. */
  aujourdhui: boolean;
}

/** Titre de la carte « Places » et portée de sa liste, pour la date affichée. */
export function enTeteAffluence(date: string, aujourdhui: string): EnTeteAffluence {
  const cEstAujourdhui = date === aujourdhui;
  const portee: PorteeAffluence = cEstAujourdhui ? 'departs-restants' : 'tous-les-trains';
  // « Aujourd'hui » plutôt que la date : c'est le mot que l'agent cherche
  // pour vérifier d'un coup d'œil qu'il n'est pas resté sur la veille.
  //
  // Majuscule initiale posée ICI, et pas par `text-transform: capitalize` :
  // la règle CSS en mettait une à chaque mot, ce qui donnait « Tous Les
  // Trains » dès que le titre a cessé d'être une date seule.
  const enLettres = dateEnToutesLettres(date);
  const jour = cEstAujourdhui
    ? "Aujourd'hui"
    : enLettres.charAt(0).toLocaleUpperCase('fr') + enLettres.slice(1);
  return {
    portee,
    titre: `${jour} — ${cEstAujourdhui ? 'départs restants' : 'tous les trains'}`,
    aujourdhui: cEstAujourdhui,
  };
}

/**
 * Bandeau affiché quand la caisse ne peut PAS déclarer : la journée n'est pas
 * ouverte. Le texte dit qui l'ouvre, parce que la caisse n'en a pas le droit
 * (RLS : « roles: jours ecriture » est réservée à la supervision).
 */
export const BANDEAU_JOURNEE_NON_OUVERTE =
  "Journée pas encore ouverte par l'exploitation — les places ne peuvent pas " +
  "encore être déclarées pour cette date. Demandez à la supervision d'ouvrir la journée.";

/** Même journée non ouverte, mais vue par quelqu'un qui PEUT l'ouvrir. */
export const BANDEAU_JOURNEE_A_OUVRIR =
  'Journée pas encore ouverte — ouvrez-la dans l’onglet Circulations pour ' +
  'pouvoir déclarer le remplissage.';

/** Date passée : on consulte ce qui a été déclaré, on ne le réécrit pas. */
export const BANDEAU_JOURNEE_PASSEE = 'Journée passée — consultation seulement.';

export interface SaisieAffluence {
  /** Les trois boutons sont-ils actifs ? */
  saisie: boolean;
  /** Pourquoi pas, en une phrase — `null` quand la saisie est ouverte. */
  bandeau: string | null;
}

/**
 * La saisie du remplissage est-elle ouverte pour la date affichée ?
 *
 * Trois refus, dans cet ordre :
 *  1. une date PASSÉE ne se réécrit pas — pour personne, pas même la
 *     supervision : ce serait réécrire ce qui s'est passé ;
 *  2. une journée pas encore OUVERTE n'a pas de ligne dans `jours`, et
 *     `affluence` ne s'y raccroche pas ;
 *  3. HORS SAISON, il n'y a aucun train — l'appelant affiche alors son état
 *     vide, ce cas ne passe pas par ici.
 *
 * PURE, et c'est ce qui compte : le refus se calcule ici, l'interface ne fait
 * que le poser. Le vrai verrou reste RLS — la caisse ne peut de toute façon
 * pas écrire dans `jours`, et un bouton resté cliquable n'écrirait rien.
 */
export function saisieAffluence(e: {
  date: string;
  aujourdhui: string;
  enregistre: boolean;
  /** L'agent a-t-il `circulations` ou `journee.reinitialiser` ? */
  peutOuvrirLaJournee: boolean;
}): SaisieAffluence {
  if (e.date < e.aujourdhui) return { saisie: false, bandeau: BANDEAU_JOURNEE_PASSEE };
  if (!e.enregistre) {
    return {
      saisie: false,
      bandeau: e.peutOuvrirLaJournee ? BANDEAU_JOURNEE_A_OUVRIR : BANDEAU_JOURNEE_NON_OUVERTE,
    };
  }
  return { saisie: true, bandeau: null };
}

/**
 * Liste vide : le dire dans les termes de la date affichée. « Plus aucun
 * départ aujourd'hui » sur une journée à venir serait faux — il n'y a pas
 * d'heure de référence, et la journée entière est devant.
 */
export function messageAucunDepart(
  date: string,
  aujourdhui: string,
  nomGare: string | null,
): string {
  if (date === aujourdhui) {
    return nomGare === null
      ? 'Plus aucun départ aujourd’hui.'
      : `Plus aucun départ de ${nomGare} aujourd’hui.`;
  }
  return nomGare === null ? 'Aucun train ce jour.' : `Aucun train au départ de ${nomGare} ce jour.`;
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
  /**
   * La montée de la rotation est-elle DÉJÀ arrivée à son terminus ? Tant
   * qu'elle ne l'est pas, il n'y a aucun départ à constater — le bouton
   * n'apparaît pas.
   */
  monteeArrivee?: boolean;
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
    monteeArrivee,
  } = e;
  const n = c.numero;
  const verrou = lectureSeule ? ' disabled' : '';
  const montee = sens === 'montee';

  // --- Train SUPPLÉMENTAIRE : le terminus vient des passages, jamais de la
  //     colonne. Montée → son terminus ; descente → sa gare de départ, qui
  //     n'est pas forcément Le Fayet (un renfort peut ne pas redescendre en bas).
  if (horsGrille(c)) {
    const source =
      passagesEffectifs && passagesEffectifs.length > 0 ? { passages: passagesEffectifs } : c;
    const gare = montee ? terminusReel(source) : origineReelle(source);
    const libelle = gare === null ? '—' : nomGare(gare);
    const texte = montee ? libelle : `Départ de ${libelle}`;
    const fixe = `<span class="term-fixe" title="${echapper(AIDE_TERMINUS_SUP)}">${echapper(texte)}</span>`;
    if (montee) return fixe;

    // DESCENTE de renfort : son heure de départ du terminus n'est qu'une
    // ESTIMATION tant que l'agent ne l'a pas constatée. Le bouton n'apparaît
    // qu'une fois la montée arrivée — avant, il n'y a rien à constater.
    const constate = (c.depart_reel ?? '').trim();
    const parti =
      constate === ''
        ? ''
        : `<span class="depart-constate">parti à ${echapper(constate.slice(0, 5))}</span>`;
    const bouton = monteeArrivee
      ? `<button class="leger" data-action="depart-sup" data-numero="${n}"${verrou}>${
          constate === '' ? 'Le train est reparti' : "Corriger l'heure de départ"
        }</button>`
      : '';
    return `${fixe}${parti}${bouton}`;
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

// ---------------------------------------------------------------------------
// Routage des circulations à la publication
// ---------------------------------------------------------------------------

/** Rotation supplémentaire à INSÉRER : les deux lignes vont ensemble. */
export interface CreationSup {
  montee: Circulation;
  descente: Circulation;
}

export interface RoutageCirculations {
  /** Rotations sup NEUVES → `creerTrainSup()` (insert des deux lignes). */
  creations: CreationSup[];
  /** Tout le reste → `saveCirculations()` (upsert sur date + numéro). */
  misesAJour: Circulation[];
}

/**
 * Aiguillage des circulations en attente entre création et mise à jour.
 *
 * BUG du 04/09/2026 : le tri se faisait sur `c.supplementaire && sens ===
 * 'montee'`, qui ne distingue PAS une création d'une modification. Modifier la
 * rame d'un renfort déjà en base routait sa montée vers `creerTrainSup()`, qui
 * exige la descente dans le même brouillon — or la rame est portée par la
 * montée seule. La publication échouait donc systématiquement, et l'échec
 * conservait tout le brouillon de la date.
 *
 * La nouveauté est désormais MARQUÉE (`brouillonSupNeufs`), jamais devinée :
 * seule la création d'un train sup y inscrit un numéro. Tout le reste part par
 * `saveCirculations()`, qui gère déjà `passages` et `supplementaire` en
 * upsertant les objets complets.
 *
 * @throws si une montée marquée neuve n'a pas sa descente dans le brouillon :
 *         c'est une incohérence INTERNE (les deux lignes sont mises en attente
 *         ensemble), pas une erreur d'exploitation, et le message le dit.
 */
export function routageCirculations(
  enAttente: readonly Circulation[],
  neufs: ReadonlySet<number> = new Set(),
): RoutageCirculations {
  const creations: CreationSup[] = [];
  const consommes = new Set<number>();

  for (const c of enAttente) {
    if (!horsGrille(c) || c.sens !== 'montee' || !neufs.has(c.numero)) continue;
    const descente = enAttente.find((x) => x.numero === c.numero + 1);
    if (!descente) {
      throw new Error(
        `Incohérence interne : le train supplémentaire ${c.numero} est marqué comme neuf ` +
          `mais sa descente ${c.numero + 1} est absente du brouillon. ` +
          `Rechargez la page et recréez le train.`,
      );
    }
    creations.push({ montee: c, descente });
    consommes.add(c.numero);
    consommes.add(descente.numero);
  }

  return { creations, misesAJour: enAttente.filter((c) => !consommes.has(c.numero)) };
}

// ---------------------------------------------------------------------------
// Résumé de la journée affichée (barre du jour, onglet Circulations)
// ---------------------------------------------------------------------------

export type EtatJournee = 'enregistree' | 'apercu' | 'hors-saison';

export interface ResumeJournee {
  /** « jeudi 4 septembre 2026 » — le format ISO seul fait travailler sur le mauvais jour. */
  jourEnLettres: string;
  /** NOM du service seul — « Petit service ». */
  service: string;
  /**
   * Périodes de validité, en jj/mm. Rendues en GRIS et séparées du nom : elles
   * répondent à une question qu'on se pose rarement, la date à celle qu'on se
   * pose toujours. Collées au nom, elles faisaient de l'étiquette l'élément le
   * plus lourd du rang, devant la date.
   */
  servicePeriodes: string;
  etat: EtatJournee;
  etatLibelle: string;
  /** Trains facultatifs : on compte les CIRCULATIONS, comme le bouton d'action groupée. */
  facultatifsActifs: number;
  facultatifsTotal: number;
  facultatifsLibelle: string;
  /** Rotations supplémentaires du jour (une rotation = une montée + sa descente). */
  sups: number;
  supsLibelle: string;
  sectionRestreinte: boolean;
  terminusActif: boolean;
}

/**
 * Libellés et compteurs de la barre du jour. PURE : la barre ne fait que
 * poser ces chaînes, et les tests couvrent les cas d'exploitation réels
 * (journée non enregistrée, petit service à deux périodes, section
 * restreinte, aucun facultatif, plusieurs renforts).
 */
export function resumeJournee(
  jour: Jour,
  service: Pick<Grille, 'libelle' | 'periodes'> | null,
): ResumeJournee {
  const facultatifs = jour.circulations.filter((c) => c.facultatif);
  const actifs = facultatifs.filter((c) => c.facultatif_actif).length;
  // Les RENFORTS seulement : un train spécial n'est pas un renfort, et le
  // compteur de la barre du jour annonce « renfort(s) ».
  const sups = jour.circulations.filter(
    (c) => c.nature === 'supplementaire' && c.sens === 'montee',
  ).length;

  const etat: EtatJournee =
    jour.hors_saison === true
      ? 'hors-saison'
      : jour.enregistre === false
        ? 'apercu'
        : 'enregistree';

  return {
    jourEnLettres: dateEnToutesLettres(jour.date),
    // LE NOM SEUL. Les périodes de validité étaient collées ici, ce qui
    // faisait de l'étiquette de service l'élément le plus lourd du rang —
    // devant la date, qui est pourtant ce qu'on vient lire. Elles ont
    // maintenant leur propre champ, rendu en gris.
    service: service
      ? (service.libelle.split('—')[0]?.trim() ?? '')
      : 'Hors saison / service hiver',
    // Périodes en jj/mm : le petit service en a DEUX, et les écrire en entier
    // doublerait la longueur sans rien apprendre.
    servicePeriodes: service
      ? service.periodes
          .map((p) => `${p.du.slice(8)}/${p.du.slice(5, 7)}→${p.au.slice(8)}/${p.au.slice(5, 7)}`)
          .join(' · ')
      : '',
    etat,
    etatLibelle:
      etat === 'hors-saison'
        ? 'aucun service ne circule'
        : etat === 'apercu'
          ? 'aperçu théorique — non enregistrée, lecture seule'
          : 'journée enregistrée',
    facultatifsActifs: actifs,
    facultatifsTotal: facultatifs.length,
    facultatifsLibelle:
      facultatifs.length === 0 ? 'aucun ce jour' : `${actifs} activés sur ${facultatifs.length}`,
    sups,
    // Vide quand il n'y en a pas : un « (0 ce jour) » permanent est du bruit.
    supsLibelle: sups === 0 ? '' : `${sups} ce jour`,
    sectionRestreinte: !sectionComplete(jour),
    terminusActif: jour.terminus_bellevue !== false,
  };
}

// ---------------------------------------------------------------------------
// Barre de publication : trois états (canevas 1d)
// ---------------------------------------------------------------------------

const HEURE_PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** « HH:MM » d'un horodatage ISO, ou null s'il est absent ou illisible. */
export function heureCourte(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? HEURE_PARIS.format(new Date(t)) : null;
}

export type EtatBarrePublication = 'publie' | 'en-cours' | 'echec';

export interface BarrePublication {
  etat: EtatBarrePublication;
  /**
   * Contenu de la pastille : « ✓ », le compte, ou « ! ». Elle est TOUJOURS
   * présente — c'est l'un des trois signaux redondants qui distinguent les
   * états à deux mètres, avec le liseré et la hauteur de barre.
   */
  pastille: string;
  /** Compteur numérique, null quand il n'y a rien à compter. */
  compteur: number | null;
  titre: string;
  /**
   * CE QUI A CHANGÉ, en une ligne (état 2 seulement). C'est `resumeEcarts()`,
   * déjà calculé côté code : l'agent doit pouvoir relire ce qu'il s'apprête à
   * publier sans quitter la barre.
   */
  resume: string;
  /** Ce que les écrans affichent MAINTENANT — l'information qui manquait. */
  detail: string;
  libelleBouton: string;
  boutonActif: boolean;
}

/**
 * État de la barre de publication, PUR et testable.
 *
 * Le vocabulaire est celui du canevas et il n'est pas cosmétique : « en
 * attente de publication » décrivait le brouillon, « pas encore sur les
 * écrans » décrit ce que voient les voyageurs. Même fait, formulé du point de
 * vue du guichet — et c'est ce point de vue qui compte quand on se demande si
 * ce qu'on lit à l'écran est bien en gare.
 *
 * La ligne de détail répond toujours à la même question : « ce que je vois
 * est-il en gare ? ». Elle remplace la phrase fixe qui prétendait que les
 * modifications s'appliquaient immédiatement — ce qui était faux depuis
 * l'introduction du brouillon.
 */
export function barrePublication(etat: {
  modifs: number;
  /** Modifications restées en attente après une publication incomplète. */
  echecs: number;
  /** Horodatage ISO de la dernière publication réussie. */
  derniereISO: string | null;
  /** Horodatage ISO de la tentative incomplète, s'il y en a eu une. */
  echecISO?: string | null;
  /** `resumeEcarts()` : ce qui a changé, pour l'état 2. */
  resume?: string;
}): BarrePublication {
  const heure = heureCourte(etat.derniereISO);
  // « les 6 gares » n'est pas une approximation : c'est le périmètre exact de
  // la publication, et le bouton porte le même nombre.
  const publieA = heure
    ? `Les 6 gares affichent l’état publié à ${heure}.`
    : 'Les 6 gares affichent le dernier état publié.';

  if (etat.echecs > 0) {
    const h = heureCourte(etat.echecISO ?? null);
    const n = etat.echecs;
    return {
      etat: 'echec',
      pastille: '!',
      compteur: n,
      titre:
        `Publication incomplète${h ? ` à ${h}` : ''} — ` +
        `${n} modification${n > 1 ? 's ne sont pas' : ' n’est pas'} en gare`,
      resume: '',
      // La CAUSE est dans son encart juste au-dessus ; cette ligne dit que le
      // message ne s'effacera pas tout seul. C'est ce que l'agent a besoin de
      // savoir pour aller chercher de l'aide sans craindre de le perdre.
      detail: 'Ce message reste affiché jusqu’à la prochaine publication réussie.',
      libelleBouton: 'Réessayer la publication',
      boutonActif: true,
    };
  }

  if (etat.modifs > 0) {
    const n = etat.modifs;
    return {
      etat: 'en-cours',
      pastille: String(n),
      compteur: n,
      titre: `${n} modification${n > 1 ? 's' : ''} pas encore sur les écrans`,
      resume: etat.resume ?? '',
      detail: heure
        ? `Les 6 gares affichent toujours l’état publié à ${heure}.`
        : 'Les 6 gares affichent toujours le dernier état publié.',
      libelleBouton: 'Publier sur les 6 gares',
      boutonActif: true,
    };
  }

  return {
    etat: 'publie',
    // Le SEUL vert de la barre : il ne sert qu'à dire « rien à faire ».
    pastille: '✓',
    compteur: null,
    titre: 'Tout est publié',
    resume: '',
    detail: publieA,
    libelleBouton: 'Publier sur les 6 gares',
    boutonActif: false,
  };
}

// ---------------------------------------------------------------------------
// Barre de navigation : deux groupes, une seule rangée (canevas 1b)
// ---------------------------------------------------------------------------

/**
 * Onglets d'ADMINISTRATION : ceux qui ouvrent quelque chose qu'on règle une
 * fois pour toutes, ou qu'on consulte après coup. Tout le reste est de
 * l'EXPLOITATION — ce qui sert en cours de journée.
 *
 * L'appartenance est fixe et vit dans le CODE ; la VISIBILITÉ, elle, est une
 * donnée (`onglets_par_role`). Les deux ne se confondent pas : masquer
 * « Journal » à un rôle ne le fait pas changer de groupe, cela le retire de
 * la barre.
 *
 * Ce n'est PAS une notion de droits : aucun onglet n'est ouvert ni fermé par
 * son groupe. C'est de la mise en page.
 */
const ONGLETS_ADMINISTRATION: readonly Onglet[] = ['parametres', 'utilisateurs', 'journal'];

export interface GroupesNavigation {
  exploitation: Onglet[];
  administration: Onglet[];
}

/**
 * Répartit les onglets VISIBLES en deux groupes, dans l'ordre de la barre.
 *
 * ⚠ La liste d'onglets est réglable en exploitation : la barre doit rester
 * juste pour n'importe quel sous-ensemble, de huit entrées à deux. D'où le
 * contrat que respecte l'appelant : un groupe VIDE n'est pas rendu — ni son
 * intitulé, ni son filet. Sans cela, un « Administration » suivi de rien
 * flotterait à droite d'une barre de quatre onglets.
 */
export function groupesNavigation(visibles: readonly Onglet[]): GroupesNavigation {
  return {
    exploitation: visibles.filter((o) => !ONGLETS_ADMINISTRATION.includes(o)),
    administration: visibles.filter((o) => ONGLETS_ADMINISTRATION.includes(o)),
  };
}

/** Un onglet relève-t-il du groupe d'administration ? (rendu de la barre) */
export function estOngletAdministration(onglet: Onglet): boolean {
  return ONGLETS_ADMINISTRATION.includes(onglet);
}

// ---------------------------------------------------------------------------
// Carte « Onglets visibles par rôle » (onglet Utilisateurs)
// ---------------------------------------------------------------------------

/** Libellés de la barre de navigation, dans son ordre. */
const LIBELLE_ONGLET: Record<Onglet, string> = {
  circulations: 'Circulations',
  // UN MOT, comme Bandeau, Médias, Écrans. « Remplissage » ou « Trains
  // complets » tiendraient dans la barre, mais pas au téléphone, où les neuf
  // onglets défilent horizontalement.
  affluence: 'Places',
  horaires: 'Horaires',
  bandeau: 'Bandeau',
  medias: 'Médias',
  ecrans: 'Écrans',
  parametres: 'Paramètres',
  utilisateurs: 'Utilisateurs',
  journal: 'Journal',
};

/**
 * Grille rôles × onglets de la carte de réglage. PURE, donc testable sans DOM.
 *
 * ⚠ Une case DÉCOCHÉE et une case GRISÉE ne disent pas la même chose :
 *  - décochée : le rôle a le droit, l'exploitant a choisi de masquer l'onglet ;
 *  - grisée : le rôle n'a AUCUN droit dessus — la cocher n'ouvrirait rien, et
 *    le front ignorerait la ligne de toute façon (l'intersection de
 *    `ongletsVisibles()`).
 * Une case cochable mais qui enfermerait tout le monde dehors est grisée elle
 * aussi, avec son propre motif : la base la refuserait, autant le dire avant.
 */
export function grilleOngletsHtml(visibilite: VisibiliteOnglets): string {
  const entetes = ONGLETS.map((o) => `<th>${echapper(LIBELLE_ONGLET[o])}</th>`).join('');
  const lignes = ROLES.map((role) => {
    const vus = ongletsVisibles([role], visibilite);
    const cases = ONGLETS.map((onglet) => {
      const coche = vus.includes(onglet);
      // Motif calculé sur l'état APRÈS décochage : c'est ce geste-là que l'on
      // veut empêcher, pas l'état courant.
      const apres = { ...(visibilite ?? {}), [role]: vus.filter((o) => o !== onglet) };
      const motif = motifOngletVerrouille(role, onglet, apres);
      // Un onglet hors plafond est toujours verrouillé ; un onglet déjà masqué
      // doit rester recochable, le motif d'enfermement ne s'applique qu'au
      // décochage.
      const horsPlafond = !plafondOnglets(role).includes(onglet);
      const bloque = horsPlafond || (coche && motif !== null);
      const titre = bloque && motif ? ` title="${echapper(motif)}"` : '';
      return (
        `<td><input type="checkbox" data-role="${echapper(role)}" ` +
        `data-onglet="${echapper(onglet)}"${coche ? ' checked' : ''}` +
        `${bloque ? ' disabled' : ''}${titre} /></td>`
      );
    }).join('');
    return `<tr><th scope="row">${echapper(LIBELLE_ROLE[role])}</th>${cases}</tr>`;
  }).join('');
  return `<table class="onglets-roles"><thead><tr><th></th>${entetes}</tr></thead><tbody>${lignes}</tbody></table>`;
}

/**
 * Phrase d'état sous la grille. Elle doit dire franchement quand le réglage
 * n'est PAS lu depuis la base : sans cela, un technique croirait avoir masqué
 * un onglet alors que la table est injoignable et que rien n'est appliqué.
 */
export function etatVisibiliteOnglets(visibilite: VisibiliteOnglets): string {
  if (visibilite === null) {
    return (
      'Réglage indisponible : chaque rôle voit tout ce que ses droits ouvrent. ' +
      'C’est le comportement de repli — la table n’a pas encore été créée, ou elle est injoignable.'
    );
  }
  const sansReglage = ROLES.filter((r) => (visibilite[r] ?? []).length === 0);
  if (sansReglage.length === 0) return '';
  return (
    `Aucun réglage pour : ${sansReglage.map((r) => LIBELLE_ROLE[r]).join(', ')} — ` +
    'ces rôles voient tout ce que leurs droits ouvrent.'
  );
}
