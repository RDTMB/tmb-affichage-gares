// Brouillon de publication (chantier « Publier retient les modifications »,
// docs/01 §5.6 révisé le 29/08/2026 par l'exploitant).
//
// Jusqu'ici, chaque saisie (météo, vitesse, message, train...) écrivait en
// base IMMÉDIATEMENT ; « Publier » ne faisait qu'inscrire un résumé dans
// l'historique — il ne bloquait rien, contrairement à ce que son libellé
// laissait croire. L'exploitant a tranché : rien ne doit atteindre les
// écrans tant que « Publier » n'a pas été cliqué.
//
// Ce module retient les modifications en attente (par onglet Bandeau et
// Circulations) et calcule les vues « effectives » (base + brouillon) que
// l'écran de supervision doit afficher pendant que rien n'est encore publié.
// Les écritures elles-mêmes restent dans supervision.ts (provider) : ce
// fichier ne fait que de la fusion pure, testable sans DOM ni réseau.
import type { Circulation, Jour, Message, Params, SectionJour, TerminusFlag } from '../core/types';

/** Une circulation en attente, par date puis par numéro de train. */
export type BrouillonCirculations = Map<string, Map<number, Circulation>>;

/**
 * Trains SUPPLÉMENTAIRES dont la suppression est en attente, par date : on
 * mémorise le numéro de la MONTÉE, la descente appariée suit.
 */
export type BrouillonSupSupprimes = Map<string, Set<number>>;

/** Une bascule « Terminus Bellevue » en attente, par date. */
export type BrouillonTerminus = Map<string, TerminusFlag>;

/** Une section exploitée en attente, par date (travaux). */
export type BrouillonSection = Map<string, SectionJour>;

/**
 * Un message en attente, par identifiant :
 * - identifiant réel existant → Message = modification en attente ;
 * - identifiant réel existant → null = suppression en attente ;
 * - clé `brouillon:<uuid>` → Message dont l'id sera attribué à la
 *   publication (création en attente ; l'id définitif vient de l'insertion).
 */
export type BrouillonMessages = Map<string, Message | null>;

export const PREFIXE_MESSAGE_BROUILLON = 'brouillon:';

export function nouvelIdMessageBrouillon(): string {
  return `${PREFIXE_MESSAGE_BROUILLON}${crypto.randomUUID()}`;
}

export function estIdMessageBrouillon(id: string): boolean {
  return id.startsWith(PREFIXE_MESSAGE_BROUILLON);
}

/** Enregistre (ou remplace) la circulation en attente pour sa date. */
export function stageCirculation(brouillon: BrouillonCirculations, c: Circulation): void {
  let parDate = brouillon.get(c.date);
  if (!parDate) {
    parDate = new Map();
    brouillon.set(c.date, parDate);
  }
  parDate.set(c.numero, c);
}

/** Nombre de circulations en attente, toutes dates confondues. */
export function nbCirculationsEnAttente(brouillon: BrouillonCirculations): number {
  let total = 0;
  for (const parDate of brouillon.values()) total += parDate.size;
  return total;
}

/** Efface les circulations et la bascule Terminus en attente d'UNE date (ex. après réinitialisation). */
export function videDate(
  brouillonCirc: BrouillonCirculations,
  brouillonTerminus: BrouillonTerminus,
  date: string,
  brouillonSection?: BrouillonSection,
): void {
  brouillonCirc.delete(date);
  brouillonTerminus.delete(date);
  brouillonSection?.delete(date);
}

/**
 * Vue effective d'une journée : circulations et bascule Terminus de la base,
 * complétées par le brouillon de la MÊME date. Fonction pure — ne mute pas
 * `jour`, pour rester composable avec le rendu (appelée à chaque
 * chargement/rechargement, avant `rendreCirculations`).
 */
export function appliqueBrouillonJour(
  jour: Jour,
  brouillonCirc: BrouillonCirculations,
  brouillonTerminus: BrouillonTerminus,
  supSupprimes?: BrouillonSupSupprimes,
  brouillonSection?: BrouillonSection,
): Jour {
  const parNumero = brouillonCirc.get(jour.date);
  const terminusEnAttente = brouillonTerminus.get(jour.date);
  const sectionEnAttente = brouillonSection?.get(jour.date);
  const retires = supSupprimes?.get(jour.date);
  if (
    !parNumero &&
    terminusEnAttente === undefined &&
    sectionEnAttente === undefined &&
    !retires?.size
  ) {
    return jour;
  }

  const existants = new Set(jour.circulations.map((c) => c.numero));
  // Un train SUPPLÉMENTAIRE en attente n'a aucune contrepartie dans la
  // journée : il faut l'AJOUTER, là où les autres modifications ne font que
  // remplacer une circulation existante.
  const ajouts = [...(parNumero?.values() ?? [])].filter(
    (c) => c.supplementaire && !existants.has(c.numero),
  );

  const circulations = [...jour.circulations.map((c) => parNumero?.get(c.numero) ?? c), ...ajouts]
    .filter((c) => {
      if (!retires?.size) return true;
      // La suppression vise une rotation : montée impaire et descente n+1.
      const rotation = c.numero % 2 === 0 ? c.numero - 1 : c.numero;
      return !(c.supplementaire && retires.has(rotation));
    })
    .sort((a, b) => a.numero - b.numero);

  return {
    ...jour,
    terminus_bellevue: terminusEnAttente === undefined ? jour.terminus_bellevue : terminusEnAttente,
    ...(sectionEnAttente ?? {}),
    circulations,
  };
}

/**
 * Vue effective de la liste des messages : les modifications/suppressions en
 * attente sont appliquées, et les créations en attente (clés
 * `brouillon:...`) sont ajoutées à la suite. Fonction pure.
 */
export function appliqueBrouillonMessages(
  messages: Message[],
  brouillon: BrouillonMessages,
): Message[] {
  if (brouillon.size === 0) return messages;
  const existants = messages
    // `??` ne distinguerait pas une clé absente d'une suppression en
    // attente (valeur null) : il faut vérifier la présence de la clé.
    .map((m) => (brouillon.has(m.id) ? (brouillon.get(m.id) as Message | null) : m))
    .filter((m): m is Message => m !== null); // suppression en attente = retiré
  const nouveaux: Message[] = [];
  for (const [id, m] of brouillon) {
    if (estIdMessageBrouillon(id) && m !== null) nouveaux.push(m);
  }
  return [...existants, ...nouveaux];
}

/** Vue effective des paramètres : `params` complété par les champs en attente. */
export function appliqueBrouillonParams(params: Params, brouillon: Partial<Params>): Params {
  if (Object.keys(brouillon).length === 0) return params;
  return { ...params, ...brouillon };
}
