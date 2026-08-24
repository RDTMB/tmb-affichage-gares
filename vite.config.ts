import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-pages : quatre entrées HTML indépendantes (portail de test, écran de
// gare, grille du jour, supervision). Les écrans tournent sur Raspberry Pi en
// kiosque : tout est auto-hébergé, aucune ressource externe.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        ecran: fileURLToPath(new URL('ecran.html', import.meta.url)),
        grille: fileURLToPath(new URL('grille.html', import.meta.url)),
        supervision: fileURLToPath(new URL('supervision.html', import.meta.url)),
      },
    },
  },
});
