// Sélection du fournisseur de données (docs/02 §1) : `window.TMB_CONFIG`
// (public/config.js généré au déploiement depuis les variables de dépôt)
// désigne Supabase ; vide ou absent → mode mock (démo, tests, hors ligne).
import { MockProvider, type OptionsMock } from './mock';
import type { DataProvider } from './provider';
import { SupabaseProvider } from './supabase';

declare global {
  interface Window {
    TMB_CONFIG?: { supabaseUrl?: string; supabaseKey?: string };
  }
}

export function creeProvider(optionsMock: OptionsMock = {}): DataProvider {
  const config = window.TMB_CONFIG;
  if (config?.supabaseUrl && config.supabaseKey) {
    return new SupabaseProvider(config.supabaseUrl, config.supabaseKey);
  }
  return new MockProvider(optionsMock);
}
