// Validation des paramètres d'affichage — PURE et testée (C-01).
//
// POURQUOI CE FICHIER EXISTE. Les paramètres vivent dans la colonne `valeur`
// de la table `params`, de type **jsonb** : la base n'impose aucune forme, et
// le typage TypeScript de `Params` ne vaut qu'à la COMPILATION. Un compte de
// rôle `caisse` — le moins privilégié — peut écrire n'importe quoi dans les
// clés qui lui sont ouvertes (`meteo_sommet`, `vitesse_ticker_px_s`) par
// l'API REST, sans passer par la supervision. Une valeur aberrante traversait
// donc les deux fournisseurs de données jusqu'aux écrans de gare.
//
// RÈGLE. Aucune valeur issue de jsonb n'est crue sur parole : chaque champ est
// coercé, borné, et remplacé par son défaut documenté s'il est inutilisable.
// Cette fonction est le SEUL endroit où cette décision se prend ; elle est
// appliquée en sortie des deux `getParams()` (src/data/), jamais dans les pages.
//
// CE QUI N'EST PAS TRAITÉ ICI. `machines`, `motifs` et `ciels` ne viennent PAS
// du jsonb : ce sont des tables à colonnes typées, lues par `select('*')`. On
// garantit seulement que ce sont des tableaux. En particulier, le format des
// couleurs de rames (injectées dans des attributs `style`) relève d'un autre
// constat d'audit et n'est volontairement pas traité ici.
import { A_QUAI_ORIGINE_DEFAUT_S } from './horaires';
import { VITESSE_TICKER_DEFAUT, vitesseTickerValide } from './ticker';
import type { Ciel, Machine, MeteoSommet, Motif, Params, VeilleNuit } from './types';
import type { ModeMedias } from './cycle-medias';

/** Heure « HH:MM » sur 24 h. */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Température plausible au sommet, en °C. Bornes larges à dessein : il gèle
 * au Nid d'Aigle (−18 °C relevés), et une borne trop serrée rejetterait une
 * valeur légitime — ce qui serait pire que le défaut corrigé.
 */
const T_MIN = -50;
const T_MAX = 50;

/** Longueur maximale d'un libellé de ciel : le pavé météo n'a pas la place. */
const CIEL_MAX = 40;

/**
 * Défauts documentés, appliqués dès qu'une valeur est absente ou inutilisable.
 *
 * `meteo_sommet.t` vaut **NaN**, et surtout PAS 0 : afficher « 0 °C » pour une
 * valeur corrompue serait afficher une information FAUSSE, exactement ce que
 * le cahier des charges interdit. NaN est un `number` (le type de `Params` est
 * donc inchangé) que `Number.isFinite` rejette : le rendu affiche « — ».
 */
export const PARAMS_DEFAUT: Params = {
  meteo_sommet: { t: Number.NaN, ciel_fr: '—', ciel_en: '—' },
  veille_nuit: { debut: '21:00', fin: '06:00' },
  duree_horaires_s: 20,
  duree_cache_min: 15,
  mode_medias: 'alterne',
  a_quai_origine_s: A_QUAI_ORIGINE_DEFAUT_S,
  vitesse_ticker_px_s: VITESSE_TICKER_DEFAUT,
  machines: [],
  motifs: [],
  ciels: [],
};

/**
 * Nombre fini, ou `null`. Volontairement STRICT : `Number(null)`, `Number('')`
 * et `Number([])` valent tous 0 en JavaScript — accepter la coercition nue
 * ferait passer une valeur absente pour un zéro, donc pour une donnée valide.
 */
function nombre(brut: unknown): number | null {
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  if (typeof brut === 'string' && brut.trim() !== '') {
    const n = Number(brut);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Entier borné, ou le défaut si la valeur est inutilisable. */
function entierBorne(brut: unknown, min: number, max: number, defaut: number): number {
  const n = nombre(brut);
  if (n === null) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Chaîne non vide, rognée et tronquée, ou le défaut. */
function texte(brut: unknown, max: number, defaut: string): string {
  if (typeof brut !== 'string') return defaut;
  const t = brut.trim();
  return t === '' ? defaut : t.slice(0, max);
}

function objet(brut: unknown): Record<string, unknown> | null {
  return typeof brut === 'object' && brut !== null && !Array.isArray(brut)
    ? (brut as Record<string, unknown>)
    : null;
}

/**
 * Météo du sommet. La température n'est PAS arrondie ici : 9,5 °C est une
 * valeur légitime, et arrondir dans la couche de validation réécrirait la
 * saisie de l'agent. L'arrondi, lui, appartient au rendu.
 */
function meteoValide(brut: unknown): MeteoSommet {
  const o = objet(brut);
  if (!o) return { ...PARAMS_DEFAUT.meteo_sommet };
  const n = nombre(o.t);
  const valide: MeteoSommet = {
    t: n !== null && n >= T_MIN && n <= T_MAX ? n : Number.NaN,
    ciel_fr: texte(o.ciel_fr, CIEL_MAX, '—'),
    ciel_en: texte(o.ciel_en, CIEL_MAX, '—'),
  };
  // Heure de relevé : conservée seulement si elle est exploitable. Une heure
  // inventée dirait au voyageur que la température est plus fraîche qu'elle
  // ne l'est ; mieux vaut ne rien afficher. (Elle est en outre passée telle
  // quelle à `echapper()`, qui lèverait sur une valeur non textuelle.)
  if (typeof o.heure_releve === 'string' && HHMM.test(o.heure_releve)) {
    valide.heure_releve = o.heure_releve;
  }
  return valide;
}

/**
 * Veille de nuit. Les deux bornes sont reprises ENSEMBLE ou remplacées
 * ensemble : mêler une borne saisie à une borne par défaut produirait une
 * plage que personne n'a décidée. Aucun ordre n'est imposé entre `debut` et
 * `fin` — la veille franchit minuit par construction.
 */
function veilleValide(brut: unknown): VeilleNuit {
  const o = objet(brut);
  const debut = o?.debut;
  const fin = o?.fin;
  if (typeof debut === 'string' && HHMM.test(debut) && typeof fin === 'string' && HHMM.test(fin)) {
    return { debut, fin };
  }
  return { ...PARAMS_DEFAUT.veille_nuit };
}

function tableau<T>(brut: unknown): T[] {
  return Array.isArray(brut) ? (brut as T[]) : [];
}

/**
 * Paramètres sûrs à afficher, quelle que soit la forme des données reçues.
 * N'altère jamais l'objet d'entrée.
 */
export function paramsValides(brut: unknown): Params {
  const o = objet(brut) ?? {};
  return {
    meteo_sommet: meteoValide(o.meteo_sommet),
    veille_nuit: veilleValide(o.veille_nuit),
    duree_horaires_s: entierBorne(o.duree_horaires_s, 5, 600, PARAMS_DEFAUT.duree_horaires_s),
    // Gouverne l'écran neutre : une valeur non numérique le DÉSACTIVAIT
    // (`age > NaN` est toujours faux), laissant des horaires périmés à
    // l'écran indéfiniment. Borne basse à 3 min pour qu'un écran vivant ne
    // bascule pas en neutre sur un simple hoquet réseau ; pour voir l'écran
    // neutre en recette, le paramètre d'URL `?cache=` est prévu pour cela.
    duree_cache_min: entierBorne(o.duree_cache_min, 3, 60, PARAMS_DEFAUT.duree_cache_min),
    mode_medias: (o.mode_medias === 'serie' ? 'serie' : 'alterne') satisfies ModeMedias,
    a_quai_origine_s: entierBorne(o.a_quai_origine_s, 0, 1800, PARAMS_DEFAUT.a_quai_origine_s),
    vitesse_ticker_px_s: vitesseTickerValide(o.vitesse_ticker_px_s),
    machines: tableau<Machine>(o.machines),
    motifs: tableau<Motif>(o.motifs),
    ciels: tableau<Ciel>(o.ciels),
  };
}
