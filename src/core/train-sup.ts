// TRAIN SUPPLÉMENTAIRE (« train sup ») — calcul PUR et testé.
//
// Besoin métier : quand trop de clients doivent redescendre par rapport aux
// places disponibles, le chef d'exploitation crée un train de renfort. Il part
// du Fayet à une heure choisie, ne dessert souvent NI Saint-Gervais NI
// Motivon, s'arrête au Col de Voza pour récupérer les voyageurs, et redescend.
// Ce train n'existe dans aucune grille : il porte donc ses propres passages.
//
// Les temps de parcours et d'arrêt sont LUS DANS LA GRILLE en vigueur, jamais
// codés en dur : la grille hiver aura les siens. L'heure est toujours fournie
// par l'appelant — aucun Date.now() ici, comme partout dans src/core/.
import { heureVersSecondes } from './horaires';
import type { Circulation, GareId, Grille, PassageGrille, Sens, TrainGrille } from './types';

/** Premier numéro réservé aux trains supplémentaires. */
export const NUMERO_SUP_MIN = 101;

/** Temps de parcours et d'arrêt d'un sens, extraits de la grille. */
export interface TempsDeGrille {
  /** Temps de parcours en secondes, clé « depuis|vers ». */
  interGares: Map<string, number>;
  /** Temps d'arrêt en secondes, par gare (absent = pas d'arrêt observé). */
  arrets: Map<GareId, number>;
  /** Ordre des gares dans ce sens, tel que la grille le décrit. */
  ordre: GareId[];
}

function cle(depuis: GareId, vers: GareId): string {
  return `${depuis}|${vers}`;
}

/** Le train de référence d'un sens : le premier NON express, qui dessert tout. */
function trainDeReference(grille: Grille, sens: Sens): TrainGrille {
  const liste = sens === 'montee' ? grille.montees : grille.descentes;
  const train = liste.find((t) => !t.express);
  if (!train) {
    throw new Error(
      `Grille « ${grille.version} » : aucun train non express en ${sens} — impossible d'en déduire les temps de parcours.`,
    );
  }
  return train;
}

/**
 * Temps inter-gares et temps d'arrêt du sens demandé, lus sur le premier train
 * non express (celui qui dessert toutes les gares). Ils sont constants dans la
 * grille été 2026, mais rien ne le garantit ailleurs : on les LIT.
 */
export function tempsDeGrille(grille: Grille, sens: Sens): TempsDeGrille {
  const train = trainDeReference(grille, sens);
  const interGares = new Map<string, number>();
  const arrets = new Map<GareId, number>();
  const ordre: GareId[] = train.passages.map((p) => p.gare);

  train.passages.forEach((passage, index) => {
    if (passage.a !== undefined && passage.d !== undefined) {
      arrets.set(passage.gare, heureVersSecondes(passage.d) - heureVersSecondes(passage.a));
    }
    const suivant = train.passages[index + 1];
    if (!suivant) return;
    const depart = passage.d ?? passage.a;
    const arrivee = suivant.a ?? suivant.d;
    if (depart === undefined || arrivee === undefined) {
      throw new Error(
        `Grille « ${grille.version} » : heure manquante entre ${passage.gare} et ${suivant.gare} (TRAIN ${train.numero}).`,
      );
    }
    interGares.set(
      cle(passage.gare, suivant.gare),
      heureVersSecondes(arrivee) - heureVersSecondes(depart),
    );
  });

  return { interGares, arrets, ordre };
}

/**
 * Temps de parcours entre deux gares CONSÉCUTIVES dans le service, en passant
 * par les gares intermédiaires non desservies : on additionne les segments,
 * sans compter leurs temps d'arrêt puisque le train ne s'y arrête pas.
 */
function tempsEntre(temps: TempsDeGrille, depuis: GareId, vers: GareId, grille: Grille): number {
  const iDepuis = temps.ordre.indexOf(depuis);
  const iVers = temps.ordre.indexOf(vers);
  if (iDepuis < 0 || iVers < 0 || iVers <= iDepuis) {
    throw new Error(
      `Grille « ${grille.version} » : ${depuis} → ${vers} n'est pas un trajet valide dans ce sens.`,
    );
  }
  let total = 0;
  for (let i = iDepuis; i < iVers; i += 1) {
    const a = temps.ordre[i];
    const b = temps.ordre[i + 1];
    const segment = a && b ? temps.interGares.get(cle(a, b)) : undefined;
    if (segment === undefined) {
      throw new Error(
        `Grille « ${grille.version} » : temps de parcours ${a} → ${b} introuvable, impossible de calculer un train supplémentaire.`,
      );
    }
    total += segment;
    // Une gare intermédiaire NON desservie ne coûte pas son temps d'arrêt :
    // c'est précisément ce qui fait gagner du temps à un train de renfort.
  }
  return total;
}

function formatHms(secondes: number): string {
  const s = ((secondes % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Passages d'un train supplémentaire.
 *
 * @param gares liste ORDONNÉE des gares desservies, dans le sens de la ligne.
 *              La première n'a qu'un départ, la dernière qu'une arrivée.
 * @returns le format des grilles JSON, directement stockable en base.
 */
export function calculePassagesSup(
  grille: Grille,
  sens: Sens,
  gares: GareId[],
  heureDepart_s: number,
): PassageGrille[] {
  if (gares.length < 2) {
    throw new Error('Un train supplémentaire dessert au moins deux gares (origine et terminus).');
  }
  const temps = tempsDeGrille(grille, sens);
  // Les gares doivent être dans l'ordre du sens : sinon le calcul n'a aucun sens.
  const rangs = gares.map((g) => temps.ordre.indexOf(g));
  rangs.forEach((rang, i) => {
    const precedent = rangs[i - 1];
    if (rang < 0 || (precedent !== undefined && rang <= precedent)) {
      throw new Error(
        `Gares hors ordre pour une ${sens} : ${gares.join(' → ')} (grille « ${grille.version} »).`,
      );
    }
  });

  const passages: PassageGrille[] = [];
  let instant = heureDepart_s;
  gares.forEach((gare, index) => {
    const premiere = index === 0;
    const derniere = index === gares.length - 1;
    if (premiere) {
      passages.push({ gare, d: formatHms(instant) });
      return;
    }
    const precedente = gares[index - 1];
    if (!precedente) return;
    instant += tempsEntre(temps, precedente, gare, grille);
    if (derniere) {
      passages.push({ gare, a: formatHms(instant) });
      return;
    }
    const arret = temps.arrets.get(gare) ?? 0;
    passages.push({ gare, a: formatHms(instant), d: formatHms(instant + arret) });
    instant += arret;
  });
  return passages;
}

/**
 * FORME d'une course hors grille (décision de l'exploitant du 10/09/2026) :
 *
 *  - `rotation`      : montée puis descente, la descente repartant du terminus
 *                      après un BATTEMENT estimé. La seule forme qu'un renfort
 *                      connaisse.
 *  - `aller-simple`  : la montée seule. Le train ne redescend pas en service.
 *  - `stationnement` : montée puis descente, mais l'heure de départ de la
 *                      descente est SAISIE — le train attend en haut, parfois
 *                      des heures, et cette heure-là est convenue avec
 *                      l'affréteur, pas déduite d'un battement.
 */
export type FormeCourse = 'rotation' | 'aller-simple' | 'stationnement';

export interface OptionsCourse {
  /** Départ de la première gare de la montée, en secondes depuis minuit. */
  heureDepart_s: number;
  garesMontee: GareId[];
  /** ABSENT = aller simple : il n'y a pas de descente à construire. */
  garesDescente?: GareId[];
  /** Temps passé au terminus avant de repartir (défaut 5 min). */
  battement_s?: number;
  /**
   * Heure de départ de la descente, SAISIE — stationnement long. Prioritaire
   * sur `battement_s` : c'est l'heure convenue, pas une estimation.
   */
  departDescente_s?: number;
}

export interface RotationSup {
  montee: PassageGrille[];
  /** `null` pour un ALLER SIMPLE. */
  descente: PassageGrille[] | null;
}

/**
 * Course hors grille : la montée, et la descente s'il y en a une.
 *
 * GÉNÉRALISÉE le 11/09/2026 pour les trois formes du train spécial. Un seul
 * chemin, et c'est voulu : les trois ne diffèrent que par la présence d'une
 * descente et par la façon dont son heure de départ est obtenue. Deux
 * fonctions auraient dupliqué le contrôle « la descente repart bien du
 * terminus de la montée », qui vaut pour les deux formes qui en ont une.
 *
 * Le CONTRÔLE D'ORDRE est nouveau : jusqu'ici un battement négatif produisait
 * en silence une descente partant avant l'arrivée de la montée. Personne ne
 * pouvait le saisir tant que le formulaire ne demandait qu'une durée ; le
 * stationnement long, qui demande une HEURE, le rend atteignable.
 */
export function construitCourse(grille: Grille, options: OptionsCourse): RotationSup {
  const montee = calculePassagesSup(grille, 'montee', options.garesMontee, options.heureDepart_s);
  const derniere = montee[montee.length - 1];
  const arriveeTerminus = derniere?.a ?? derniere?.d;
  if (!arriveeTerminus) {
    throw new Error('Montée sans heure d’arrivée au terminus : course impossible.');
  }
  // ALLER SIMPLE : rien d'autre à construire. Le numéro pair reste RÉSERVÉ
  // malgré tout — voir `prochainNumeroHorsGrille()`.
  if (options.garesDescente === undefined) return { montee, descente: null };

  const depuis = options.garesDescente[0];
  if (depuis !== derniere?.gare) {
    throw new Error(
      `La descente doit repartir du terminus de la montée (${derniere?.gare}), pas de ${depuis}.`,
    );
  }
  const arrivee_s = heureVersSecondes(arriveeTerminus);
  const depart_s = options.departDescente_s ?? arrivee_s + (options.battement_s ?? 300);
  if (depart_s < arrivee_s) {
    throw new Error(
      `Descente à ${formatHms(depart_s).slice(0, 5)} alors que la montée arrive au terminus à ` +
        `${formatHms(arrivee_s).slice(0, 5)} : le train ne peut pas repartir avant d'être arrivé.`,
    );
  }
  const descente = calculePassagesSup(grille, 'descente', options.garesDescente, depart_s);
  return { montee, descente };
}

/** Premier numéro d'une course SPÉCIALE (décision du 10/09/2026). */
export const NUMERO_SPECIAL_MIN = 201;

/**
 * Premier numéro impair libre de la série demandée, pour la MONTÉE d'une
 * course hors grille. Séries distinctes (renforts ≥ 101, spéciaux ≥ 201) :
 * mélangées, « SUP 2 » deviendrait ambigu.
 *
 * La convention impair = montée / pair = descente vaut dans TOUTES les plages.
 * 201 est impair, elle tient.
 *
 * LE NUMÉRO PAIR EST RÉSERVÉ MÊME POUR UN ALLER SIMPLE, et ce n'est pas de la
 * prudence décorative : `private.sync_rame_descente()` (schema.sql) recopie la
 * rame de toute MONTÉE dans la ligne `numero + 1`, sans vérifier qu'elle
 * appartient au même train. Deux allers simples numérotés 201 et 202 : le
 * premier écraserait la rame du second. Les numéros ne coûtent rien,
 * l'appariement si.
 */
export function prochainNumeroHorsGrille(
  numerosPris: number[],
  nature: 'supplementaire' | 'special',
): number {
  const pris = new Set(numerosPris);
  let numero = nature === 'special' ? NUMERO_SPECIAL_MIN : NUMERO_SUP_MIN;
  while (pris.has(numero) || pris.has(numero + 1)) numero += 2;
  return numero;
}

/**
 * Gares NON desservies entre l'origine et le terminus d'un train sup, dans
 * l'ordre de la ligne. Sert à la mention « SANS ARRÊT » de l'écran de gare —
 * vide si le train dessert tout.
 */
export function garesSautees(grille: Grille, sens: Sens, gares: GareId[]): GareId[] {
  const temps = tempsDeGrille(grille, sens);
  const premiere = gares[0];
  const derniere = gares[gares.length - 1];
  if (!premiere || !derniere) return [];
  const debut = temps.ordre.indexOf(premiere);
  const fin = temps.ordre.indexOf(derniere);
  if (debut < 0 || fin < 0) return [];
  return temps.ordre.slice(debut + 1, fin).filter((g) => !gares.includes(g));
}

// ---------------------------------------------------------------------------
// DÉPART RÉEL depuis le terminus (descente d'une rotation supplémentaire)
// ---------------------------------------------------------------------------

/** Au-delà, l'heure saisie est dans le FUTUR : on constate un départ, on ne le programme pas. */
export const AVANCE_MAX_S = 2 * 60;
/** Au-delà, l'écart avec l'estimation ressemble à une faute de frappe : on avertit. */
export const ECART_AVERTISSEMENT_S = 30 * 60;

export interface ControleDepartSup {
  /** Message de REFUS, ou null si l'heure est recevable. */
  refus: string | null;
  /** Avertissement NON bloquant (écart important avec l'estimation). */
  avertissement: string | null;
  /** Écart signé avec l'heure estimée, en secondes (positif = plus tard). */
  ecart_s: number;
  /** Heure estimée d'origine (départ du terminus tel que calculé à la création). */
  estime_s: number | null;
  /** Arrivée de la montée au terminus. */
  arrivee_s: number | null;
}

/**
 * Contrôles d'une heure de départ constatée. PURE, et séparée du recalcul :
 * la confirmation doit pouvoir AFFICHER refus et avertissement en direct,
 * sans attraper d'exception à chaque frappe.
 *
 * `maintenant_s` est injectée comme partout dans src/core/.
 */
export function controleDepartSup(options: {
  montee: Pick<Circulation, 'passages'>;
  descente: Pick<Circulation, 'passages'>;
  departReel_s: number;
  maintenant_s: number;
}): ControleDepartSup {
  const { montee, descente, departReel_s, maintenant_s } = options;
  const heureDe = (p: PassageGrille | undefined): number | null => {
    const brut = p?.a ?? p?.d;
    return brut === undefined ? null : heureVersSecondes(brut);
  };
  const passagesMontee = montee.passages ?? [];
  const arrivee_s = heureDe(passagesMontee[passagesMontee.length - 1]);
  const premier = (descente.passages ?? [])[0];
  const estime_s = premier?.d === undefined ? null : heureVersSecondes(premier.d);
  const ecart_s = estime_s === null ? 0 : departReel_s - estime_s;

  // Un train ne peut pas repartir avant d'être arrivé. On donne les DEUX
  // heures : sans elles, l'agent ne sait pas de combien il s'est trompé.
  if (arrivee_s !== null && departReel_s < arrivee_s) {
    return {
      refus:
        `Départ à ${formatHms(departReel_s).slice(0, 5)} alors que la montée arrive au ` +
        `terminus à ${formatHms(arrivee_s).slice(0, 5)} : le train ne peut pas repartir ` +
        `avant d'être arrivé.`,
      avertissement: null,
      ecart_s,
      estime_s,
      arrivee_s,
    };
  }

  // Cette commande CONSTATE un départ, elle ne le programme pas : accepter
  // une heure future ferait mentir la mention « horaire confirmé ».
  if (departReel_s > maintenant_s + AVANCE_MAX_S) {
    return {
      refus:
        `Départ à ${formatHms(departReel_s).slice(0, 5)}, soit dans ` +
        `${Math.round((departReel_s - maintenant_s) / 60)} min : cette commande constate un ` +
        `départ, elle ne le programme pas.`,
      avertissement: null,
      ecart_s,
      estime_s,
      arrivee_s,
    };
  }

  const avertissement =
    Math.abs(ecart_s) > ECART_AVERTISSEMENT_S && estime_s !== null
      ? `Écart de ${Math.round(Math.abs(ecart_s) / 60)} min avec l'horaire estimé ` +
        `(${formatHms(estime_s).slice(0, 5)}) : vérifiez l'heure saisie.`
      : null;

  return { refus: null, avertissement, ecart_s, estime_s, arrivee_s };
}

/**
 * Passages RECALCULÉS d'une descente supplémentaire à partir de son heure de
 * départ réelle. PURE.
 *
 * La desserte est relue dans les passages EXISTANTS : l'agent l'a choisie à
 * la création (un renfort saute souvent des gares), la réinventer reviendrait
 * à décider à sa place. Seules les heures bougent, et les temps inter-gares
 * comme les temps d'arrêt viennent de la grille, exactement comme à la
 * création.
 *
 * Corriger deux fois de suite repart donc toujours des mêmes GARES, et de la
 * nouvelle heure — jamais de l'estimation d'origine.
 */
export function recalculeDescenteSup(
  grille: Grille,
  descente: Pick<Circulation, 'passages'>,
  departReel_s: number,
): PassageGrille[] {
  const gares = (descente.passages ?? []).map((p) => p.gare);
  if (gares.length < 2) {
    throw new Error(
      'Descente supplémentaire sans desserte enregistrée : impossible de recalculer ses horaires.',
    );
  }
  return calculePassagesSup(grille, 'descente', gares, departReel_s);
}

export interface DepartSupPrepare {
  controle: ControleDepartSup;
  /** Passages recalculés, null quand l'heure est refusée. */
  passages: PassageGrille[] | null;
}

/**
 * Contrôle PUIS recalcul, pour la fenêtre de confirmation : elle affiche le
 * récapitulatif gare par gare en direct, et n'active « Confirmer » que si
 * `controle.refus` est null.
 */
export function prepareDepartSup(
  grille: Grille,
  options: {
    montee: Pick<Circulation, 'passages'>;
    descente: Pick<Circulation, 'passages'>;
    departReel_s: number;
    maintenant_s: number;
  },
): DepartSupPrepare {
  const controle = controleDepartSup(options);
  if (controle.refus !== null) return { controle, passages: null };
  return {
    controle,
    passages: recalculeDescenteSup(grille, options.descente, options.departReel_s),
  };
}
