import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Logos officiels de public/logos/ inlinés au build en data URI base64
// (docs/02 §4) : l'affichage ne dépend d'aucune requête, même hors ligne.
function logoDataUri(nom: string): string {
  const chemin = fileURLToPath(new URL(`public/logos/${nom}`, import.meta.url));
  return JSON.stringify(`data:image/svg+xml;base64,${readFileSync(chemin).toString('base64')}`);
}

// Multi-pages : quatre entrées HTML indépendantes (portail de test, écran de
// gare, grille du jour, supervision). Les écrans tournent sur Raspberry Pi en
// kiosque : tout est auto-hébergé, aucune ressource externe.
export default defineConfig({
  // fflate n'est importé que dynamiquement (lecteur Excel de la supervision) :
  // sans cette pré-optimisation, le premier clic sur « Charger un fichier
  // Excel… » en `npm run dev` déclenchait un rechargement complet de la page
  // (découverte tardive de la dépendance). Sans effet sur le build.
  optimizeDeps: { include: ['fflate'] },
  define: {
    __LOGO_ROND__: logoDataUri('logo-rond.svg'),
    __LOGO_ROND_BLANC__: logoDataUri('logo-rond-blanc.svg'),
    __MOTRICE_BLANC__: logoDataUri('motrice-direct_blanc_FFFFFF.svg'),
    __MOTRICE_MARINE__: logoDataUri('motrice-direct_marine_213B57.svg'),
  },
  build: {
    // Les logos officiels sont inlinés en base64 dans le JS (démarrage hors
    // ligne) : le budget du projet est en GZIPPÉ (< 400 Ko, largement tenu),
    // le seuil d'avertissement Vite (500 Ko bruts) est donc relevé.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        ecran: fileURLToPath(new URL('ecran.html', import.meta.url)),
        grille: fileURLToPath(new URL('grille.html', import.meta.url)),
        supervision: fileURLToPath(new URL('supervision.html', import.meta.url)),
      },
      output: {
        // supabase-js partagé entre les trois pages (cache commun des écrans)
        manualChunks: { supabase: ['@supabase/supabase-js'] },
      },
    },
  },
});
