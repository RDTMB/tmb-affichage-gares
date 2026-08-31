// Choix de la SOURCE de données d'une page (C-02).
//
// POURQUOI CE FICHIER EXISTE. `creeProvider()` retombait silencieusement sur
// le fournisseur de DÉMONSTRATION dès que `window.TMB_CONFIG` était absent ou
// incomplet. Or le mock peint une journée de démo — retard inventé sur le
// TRAIN 11, TRAIN 16 supprimé, trains facultatifs activés — par-dessus les
// VRAIES grilles officielles : l'affichage est parfaitement crédible et
// pourtant faux. Le cas s'est produit (variables de dépôt mal nommées).
//
// RÈGLE. Le mode démonstration ne s'applique JAMAIS implicitement à une page
// vue par un voyageur. Sans configuration et sans `?demo=1` explicite, une
// page d'affichage ne construit aucun fournisseur : elle montre l'écran
// neutre. Un horaire faux est pire qu'une absence d'horaire.

declare global {
  interface Window {
    TMB_CONFIG?: { supabaseUrl?: string; supabaseKey?: string };
  }
}

export type ModeDonnees = 'reel' | 'demo' | 'aucune';

/**
 * `window.TMB_CONFIG` est-il exploitable ? Les deux valeurs sont exigées :
 * la panne réelle observée était une variable de dépôt MAL NOMMÉE, donc une
 * configuration à moitié remplie.
 */
export function configSupabasePresente(): boolean {
  const config = window.TMB_CONFIG;
  return Boolean(config?.supabaseUrl?.trim() && config.supabaseKey?.trim());
}

/**
 * Démonstration demandée EXPLICITEMENT. Strictement `?demo=1` : toute autre
 * écriture (`?demo`, `?demo=true`, `?demo=0`) retombe sur l'écran neutre.
 * Une faute de frappe ne doit jamais ouvrir la porte aux horaires fictifs.
 */
export function estModeDemo(parametres: URLSearchParams): boolean {
  return parametres.get('demo') === '1';
}

/**
 * Source retenue pour une page d'affichage voyageurs.
 *
 * La configuration Supabase GAGNE toujours : `?demo=1` n'active la
 * démonstration que faute de source réelle. Un paramètre d'URL ne doit jamais
 * pouvoir substituer des horaires fictifs à des horaires réels sur un écran
 * qui dispose de la vraie source.
 */
export function modeDonnees(configPresente: boolean, demoDemandee: boolean): ModeDonnees {
  if (configPresente) return 'reel';
  return demoDemandee ? 'demo' : 'aucune';
}
