// Règle PURE de la suppression d'une grille : qui a le droit de disparaître, et
// ce que l'on dit à l'agent quand ce n'est pas le cas. Une seule description,
// lue par les DEUX fournisseurs (SupabaseProvider et MockProvider) : le mock
// « se comporte comme la table `grilles` », et deux textes de refus finiraient
// par ne plus dire la même chose.
//
// Deux garde-fous, et ils vivent côté données, jamais seulement dans
// l'interface (aucune page, aujourd'hui ou demain, ne doit pouvoir les
// contourner) :
//  1. on ne supprime qu'une grille DÉSACTIVÉE — une grille active est celle
//     que lisent les écrans ;
//  2. on ne supprime pas une grille qu'une journée d'AUJOURD'HUI ou À VENIR
//     référence (`jours.grille_version`) : la supprimer laisserait une journée
//     publiée renvoyer à une grille qui n'existe plus. Les journées PASSÉES ne
//     bloquent pas : elles sont figées, personne ne les régénère.

/** Au-delà, la liste des dates refusées est coupée : « … et N autres ». */
export const MAX_DATES_CITEES = 10;

/** Date du jour à Paris (« AAAA-MM-JJ ») — jamais la date UTC, qui avance d'un jour passé 22 h / 23 h. */
export function aujourdhuiParis(maintenant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenant);
}

/** « 2026-11-12 » → « 12/11/2026 » (le message est lu par un agent, pas par une machine). */
function dateFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/** Ce que le refus dit des journées : les 10 premières dates, puis « et N autres ». */
export function listeDates(dates: readonly string[]): string {
  const citees = dates.slice(0, MAX_DATES_CITEES).map(dateFr).join(', ');
  const reste = dates.length - MAX_DATES_CITEES;
  return reste > 0 ? `${citees} et ${reste} autre${reste > 1 ? 's' : ''}` : citees;
}

/**
 * Refus de retirer une grille REMPLACÉE par une correction. Ni le garde-fou
 * « désactivée » ni celui des journées ne s'appliquent ici : la correction est
 * précisément le geste qui remplace la grille d'origine, y compris quand des
 * journées à venir la référencent (elles retombent sur la grille en vigueur à
 * leur date). Le seul filet : le SUCCESSEUR nommé doit exister et être ACTIF,
 * sans quoi la suppression ne remplacerait rien et ouvrirait un trou de service.
 */
export function refusRemplacementGrille(
  ancienne: { version: string; libelle: string } | null,
  successeur: { version: string; actif: boolean } | null,
  version: string,
  par: string,
): string | null {
  if (version === par) return 'Une grille ne peut pas être remplacée par elle-même.';
  if (ancienne === null) return `Grille « ${version} » introuvable : rien n'a été supprimé.`;
  if (successeur === null || !successeur.actif) {
    return `La grille de remplacement « ${par} » n'existe pas ou n'est pas active : la grille « ${ancienne.libelle} » n'a pas été supprimée.`;
  }
  return null;
}

/**
 * Le message de refus, ou `null` si la suppression est permise.
 * `datesBloquantes` : journées générées dont la date est aujourd'hui ou plus
 * tard et qui référencent la grille (triées).
 */
export function refusSuppressionGrille(
  grille: { version: string; libelle: string; actif: boolean } | null,
  version: string,
  datesBloquantes: readonly string[],
): string | null {
  if (grille === null) return `Grille « ${version} » introuvable : rien n'a été supprimé.`;
  if (grille.actif) {
    return `La grille « ${grille.libelle} » est active : désactivez-la avant de la supprimer.`;
  }
  if (datesBloquantes.length > 0) {
    const n = datesBloquantes.length;
    return `La grille « ${grille.libelle} » est encore utilisée par ${n} journée${n > 1 ? 's' : ''} d'aujourd'hui ou à venir (${listeDates(datesBloquantes)}). Réinitialisez ${n > 1 ? 'ces journées' : 'cette journée'} d'abord (Circulations ou Places, bouton « Réinitialiser »), puis supprimez la grille.`;
  }
  return null;
}
