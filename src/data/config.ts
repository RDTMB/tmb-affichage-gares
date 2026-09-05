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

// ---------------------------------------------------------------------------
// Quelle base sert la supervision ?
// ---------------------------------------------------------------------------

/**
 * Référence du projet Supabase de PRODUCTION (supabase/INFOS-PROJET.md). Elle
 * fait partie de l'URL publique, elle n'est donc pas un secret ; elle sert
 * uniquement à distinguer la production d'un projet d'essai à l'écran.
 * À mettre à jour si le projet de production change un jour.
 */
export const REF_PROJET_PRODUCTION = 'csstkdcqdzaiibfqrscv';

export interface BaseServie {
  /** Ce que porte la pastille : « PRODUCTION », « BASE DE TEST », « DÉMONSTRATION ». */
  libelle: string;
  /** Suffixe de classe CSS : `base-prod`, `base-test`, `base-demo`. */
  classe: 'base-prod' | 'base-test' | 'base-demo';
  /** Détail au survol : la référence du projet, ou l'absence de source. */
  detail: string;
}

/** Référence du projet dans une URL Supabase, ou null si elle n'a pas cette forme. */
export function refProjet(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const hote = new URL(url).hostname;
    const ref = hote.split('.')[0] ?? '';
    return ref.length > 0 && hote.includes('supabase') ? ref : null;
  } catch {
    return null;
  }
}

/**
 * Base réellement servie, pour la pastille de l'en-tête de supervision.
 *
 * POURQUOI. Rien à l'écran ne disait jusqu'ici sur quelle base on travaillait.
 * Or la mise au point d'une évolution fait alterner le projet de test et la
 * production (docs/mise-en-service.md §H et §I) : publier un message de test
 * en gare, ou croire tester alors qu'on est en production, ne doit pas tenir à
 * la mémoire de l'agent. Tout ce qui n'est PAS la production est annoncé comme
 * un essai — c'est le sens de prudence utile : une base inconnue n'est jamais
 * présentée comme la vraie.
 */
export function baseServie(url: string | undefined): BaseServie {
  const ref = refProjet(url);
  if (!ref) {
    return {
      libelle: 'DÉMONSTRATION',
      classe: 'base-demo',
      detail: 'Aucune base : les données sont fictives et ne quittent pas ce navigateur.',
    };
  }
  if (ref === REF_PROJET_PRODUCTION) {
    return {
      libelle: 'PRODUCTION',
      classe: 'base-prod',
      detail: `Base de production (${ref}) : tout ce que vous publiez part sur les écrans en gare.`,
    };
  }
  return {
    libelle: 'BASE DE TEST',
    classe: 'base-test',
    detail: `Projet d’essai (${ref}) : aucun écran en gare ne lit cette base.`,
  };
}
