/// <reference types="vite/client" />

// Logos officiels inlinés au build (data URI base64) — voir vite.config.ts.
declare const __LOGO_ROND__: string;
declare const __LOGO_ROND_BLANC__: string;
/** Version du cache du service worker, changée à chaque build (vite.config.ts). */
declare const __VERSION_CACHE__: string;
/** Version du code en ligne, posée par le déploiement (vite.config.ts, src/core/version.ts). */
declare const __VERSION_APP__: unknown;
declare const __LOGO_LONG__: string;
declare const __MOTRICE_BLANC__: string;
declare const __MOTRICE_MARINE__: string;

// Icône d'onglet (monogramme TMB) — voir src/pages/favicon.ts.
declare const __FAVICON_SVG__: string;
declare const __FAVICON_PNG__: string;
declare const __FAVICON_TACTILE__: string;

// Nouveautés lues et validées AU BUILD (vite.config.ts, docs/nouveautes.md).
declare module 'virtual:nouveautes' {
  const nouveautes: import('./core/nouveautes').Nouveaute[];
  export default nouveautes;
}
