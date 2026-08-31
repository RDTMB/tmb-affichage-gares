// Sélection du fournisseur de données (docs/02 §1) : `window.TMB_CONFIG`
// (public/config.js généré au déploiement depuis les variables de dépôt)
// désigne Supabase.
//
// ATTENTION (C-02) : `creeProvider()` retombe sur le mock quand la
// configuration manque. Ce repli est acceptable pour le portail de test
// (index.html), la supervision et les tests — JAMAIS pour une page vue par un
// voyageur. `ecran.html` et `grille.html` passent donc par `modeDonnees()`
// (./config) et n'appellent le mock que sur `?demo=1` explicite.
import { MockProvider, type OptionsMock } from './mock';
import type { DataProvider } from './provider';
import { SupabaseProvider } from './supabase';
import './config'; // `declare global` de window.TMB_CONFIG

export function creeProvider(optionsMock: OptionsMock = {}): DataProvider {
  const config = window.TMB_CONFIG;
  if (config?.supabaseUrl && config.supabaseKey) {
    return new SupabaseProvider(config.supabaseUrl, config.supabaseKey);
  }
  return new MockProvider(optionsMock);
}

/**
 * Fournisseur RÉEL. Appelé par les pages d'affichage uniquement quand
 * `modeDonnees()` a répondu « reel » : les deux valeurs sont donc présentes.
 */
export function creeProviderReel(url: string, cle: string): DataProvider {
  return new SupabaseProvider(url, cle);
}

/** Fournisseur de DÉMONSTRATION, explicitement demandé (`?demo=1`). */
export function creeProviderDemo(optionsMock: OptionsMock = {}): DataProvider {
  return new MockProvider(optionsMock);
}
