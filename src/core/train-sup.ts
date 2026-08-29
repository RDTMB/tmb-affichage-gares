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
import type { GareId, Grille, PassageGrille, Sens, TrainGrille } from './types';

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

export interface OptionsRotationSup {
  /** Départ de la première gare de la montée, en secondes depuis minuit. */
  heureDepart_s: number;
  garesMontee: GareId[];
  garesDescente: GareId[];
  /** Temps passé au terminus avant de repartir (défaut 5 min). */
  battement_s?: number;
}

export interface RotationSup {
  montee: PassageGrille[];
  descente: PassageGrille[];
}

/**
 * Rotation complète d'un train supplémentaire : la montée, puis la descente
 * qui repart du terminus de la montée après `battement_s`.
 */
export function construitRotationSup(grille: Grille, options: OptionsRotationSup): RotationSup {
  const battement = options.battement_s ?? 300;
  const montee = calculePassagesSup(grille, 'montee', options.garesMontee, options.heureDepart_s);
  const derniere = montee[montee.length - 1];
  const arriveeTerminus = derniere?.a ?? derniere?.d;
  if (!arriveeTerminus) {
    throw new Error('Montée sans heure d’arrivée au terminus : rotation impossible.');
  }
  const depuis = options.garesDescente[0];
  if (depuis !== derniere?.gare) {
    throw new Error(
      `La descente doit repartir du terminus de la montée (${derniere?.gare}), pas de ${depuis}.`,
    );
  }
  const descente = calculePassagesSup(
    grille,
    'descente',
    options.garesDescente,
    heureVersSecondes(arriveeTerminus) + battement,
  );
  return { montee, descente };
}

/**
 * Premier numéro impair libre ≥ 101 pour la montée d'un train sup. La
 * convention impair = montée / pair = descente est conservée, de sorte que
 * l'appariement de rame existant (descente n+1 hérite de la montée n)
 * fonctionne sans modification.
 */
export function prochainNumeroSup(numerosPris: number[]): number {
  const pris = new Set(numerosPris);
  let numero = NUMERO_SUP_MIN;
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
