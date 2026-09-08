// Écart entre l'horloge du poste et celle du serveur (lot 5, partie code).
//
// LE CONTEXTE MATÉRIEL, qui n'est pas une hypothèse. Le Raspberry n'a pas de
// pile : à froid il redémarre sur une date fantaisiste, et tant que l'horloge
// est fausse tout HTTPS échoue — certificats « pas encore valides ». Un service
// de correction existe sur le Pi, qui lit l'en-tête `Date` d'une requête HTTPS
// quand le NTP est filtré. Le code, lui, ne savait rien de tout cela : il
// affichait des comptes à rebours calculés sur une horloge qu'il croyait juste.
//
// Le lot 1 a fermé ce qui se traitait sans référence extérieure — l'âge des
// données borné à zéro, un instantané indatable rejeté. Reste la moitié qui
// demande une référence : l'en-tête `Date` de n'importe quelle réponse la
// fournit gratuitement, il n'y a aucune requête supplémentaire à faire.
import { SEUIL_IMMINENT_S } from './horaires';

/**
 * Écart au-delà duquel l'écran le DIT, sans cesser d'afficher : CINQ secondes.
 *
 * En dessous, rien de visible ne change — les heures s'affichent à la minute et
 * l'écart se perd dans l'arrondi. À partir de 5 s, l'horloge affichée et les
 * comptes à rebours commencent à diverger de la réalité, et surtout un poste
 * dont le NTP fonctionne, ou dont le service de correction lit l'en-tête
 * `Date`, n'atteint JAMAIS ce chiffre : le dépasser signifie que la correction
 * a décroché. Le dire pendant qu'il est encore temps d'agir, plutôt que
 * d'attendre que ce soit dangereux.
 */
export const ECART_DIT_MS = 5_000;

/**
 * Écart au-delà duquel l'écran n'affiche PLUS d'horaires : trente secondes,
 * c'est-à-dire exactement la fenêtre des états de quai.
 *
 * `SEUIL_IMMINENT_S` vaut 30 : « À QUAI » court de l'arrivée à D − 30 s, et
 * « DÉPART IMMINENT » de D − 30 s au départ. À 30 s d'écart, ces deux états
 * peuvent donc être décalés d'un cran entier — l'écran affiche « PARTI » pour
 * un train encore à quai, et un voyageur qui lit « PARTI » s'en va. Au-delà,
 * l'écran ne peut plus rien affirmer de ce qui se joue à la seconde, donc il
 * n'affirme plus rien.
 *
 * Un écran noir en gare est une panne, mais un écran qui fait partir quelqu'un
 * est pire. Le seuil est DÉRIVÉ de la constante du moteur et non écrit en
 * chiffre : si la fenêtre de quai change, celui-ci suit.
 */
export const ECART_BLOQUANT_MS = SEUIL_IMMINENT_S * 1000;

export type EtatHorloge = 'juste' | 'ecart-dit' | 'ecart-bloquant';

/**
 * Ce que l'écran fait d'un écart mesuré. PURE.
 *
 * `null` — aucune réponse serveur depuis le chargement — vaut « juste ». Ce
 * n'est pas de l'optimisme : l'absence prolongée de réponse est DÉJÀ traitée
 * par l'âge des données, qui fait passer l'écran en neutre au-delà de
 * `duree_cache_min`. Créer ici un second chemin vers le même écran neutre
 * donnerait deux causes pour une seule situation, et un diagnostic ambigu le
 * jour où il faudra comprendre pourquoi une gare est noire.
 *
 * Le signe ne compte pas : une horloge en avance fausse les comptes à rebours
 * autant qu'une horloge en retard.
 */
export function etatHorloge(ecartMs: number | null): EtatHorloge {
  if (ecartMs === null) return 'juste';
  const ecart = Math.abs(ecartMs);
  if (ecart >= ECART_BLOQUANT_MS) return 'ecart-bloquant';
  if (ecart >= ECART_DIT_MS) return 'ecart-dit';
  return 'juste';
}

/**
 * Écart mesuré sur l'en-tête `Date` d'une réponse, en millisecondes.
 * Positif = l'horloge locale est EN AVANCE sur le serveur.
 *
 * L'instant local retenu est le MILIEU de l'aller-retour, pas l'instant de
 * réception : sans cela, le temps de trajet de la réponse s'ajouterait
 * intégralement à l'écart et une 5G lente passerait pour une horloge fausse.
 *
 * L'en-tête n'a qu'une résolution d'UNE SECONDE (RFC 7231), donc la mesure
 * porte ±0,5 s d'incertitude de quantification, à quoi s'ajoute la moitié de
 * l'asymétrie du trajet. Les deux seuils sont choisis en conséquence : 5 s
 * laisse dix fois cette incertitude, et 30 s soixante fois.
 *
 * Rend `null` si l'en-tête est absent ou illisible : on ne fabrique pas un
 * écart, et l'appelant garde alors la dernière mesure valable.
 */
export function ecartDepuisEntete(
  enteteDate: string | null | undefined,
  envoiMs: number,
  receptionMs: number,
): number | null {
  if (!enteteDate) return null;
  const serveurMs = Date.parse(enteteDate);
  if (!Number.isFinite(serveurMs)) return null;
  // Un aller-retour négatif viendrait d'une horloge qui a sauté PENDANT la
  // requête : la mesure n'a alors aucun sens.
  if (receptionMs < envoiMs) return null;
  return (envoiMs + receptionMs) / 2 - serveurMs;
}
