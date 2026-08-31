// Logique PURE du sélecteur d'état du ciel (sans DOM, testée par Vitest).
// L'état du ciel de la météo sommet est choisi dans une LISTE plutôt que saisi
// en texte libre : formulations homogènes et anglais fiable.
import type { Ciel } from '../core/types';

/** Une option du sélecteur météo. */
export interface OptionCiel {
  fr: string;
  en: string;
  /** true = valeur historique hors liste, ajoutée en tête et présélectionnée. */
  ancienne: boolean;
  selected: boolean;
}

/**
 * Liste triée par `ordre` croissant puis `fr` — la MÊME clé que le provider
 * (`.order('ordre').order('fr')`), pour que l'affichage ne dépende pas de la
 * source des données.
 */
export function ordonneCiels(ciels: Ciel[]): Ciel[] {
  return [...ciels].sort((a, b) => a.ordre - b.ordre || a.fr.localeCompare(b.fr, 'fr'));
}

/**
 * Options du sélecteur pour la valeur actuellement affichée en gare
 * (`courantFr` / `courantEn`, extraites de `params.meteo_sommet`). Si cette
 * valeur ne figure PAS dans la liste (état historique retiré depuis), elle est
 * ajoutée EN TÊTE, marquée « (ancienne valeur) » et présélectionnée : ouvrir
 * l'onglet ne doit JAMAIS changer silencieusement la météo affichée.
 */
export function optionsCiel(ciels: Ciel[], courantFr: string, courantEn: string): OptionCiel[] {
  const tries = ordonneCiels(ciels);
  const presente = tries.some((c) => c.fr === courantFr);
  const options: OptionCiel[] = tries.map((c) => ({
    fr: c.fr,
    en: c.en,
    ancienne: false,
    selected: presente && c.fr === courantFr,
  }));
  if (!presente) {
    options.unshift({ fr: courantFr, en: courantEn, ancienne: true, selected: true });
  }
  return options;
}

/**
 * Résout `{ ciel_fr, ciel_en }` depuis la valeur (`fr`) choisie dans le
 * sélecteur : une seule option écrit les DEUX champs de `meteo_sommet`.
 */
export function cielChoisi(
  options: OptionCiel[],
  valeurFr: string,
): { ciel_fr: string; ciel_en: string } {
  const opt = options.find((o) => o.fr === valeurFr);
  return { ciel_fr: valeurFr, ciel_en: opt?.en ?? '' };
}

/**
 * Un état du ciel est « utilisé » s'il est celui actuellement affiché par la
 * météo sommet : sa suppression est alors refusée (elle ferait perdre le libellé
 * anglais de la valeur en cours d'affichage en gare).
 */
export function cielUtilise(fr: string, meteoCielFr: string): boolean {
  return fr === meteoCielFr;
}
