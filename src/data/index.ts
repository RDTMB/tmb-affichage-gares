// Sélection du fournisseur de données (docs/02 §1) : `window.TMB_CONFIG`
// (public/config.js généré au build, étape 5) désignera Supabase ; tant
// qu'il est vide ou absent, l'application tourne en mode mock.
import { MockProvider, type OptionsMock } from './mock';
import type { DataProvider } from './provider';

declare global {
  interface Window {
    TMB_CONFIG?: { supabaseUrl?: string; supabaseKey?: string };
  }
}

export function creeProvider(optionsMock: OptionsMock = {}): DataProvider {
  const config = window.TMB_CONFIG;
  if (config?.supabaseUrl && config.supabaseKey) {
    // SupabaseProvider arrive à l'étape 5 ; en attendant, on le signale
    // clairement plutôt que d'afficher des horaires faux.
    throw new Error('SupabaseProvider non disponible avant l’étape 5 — retirer config.js.');
  }
  return new MockProvider(optionsMock);
}
