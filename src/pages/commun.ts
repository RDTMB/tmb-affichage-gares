// Socle commun des squelettes : polices auto-hébergées (jamais de CDN — les
// écrans doivent démarrer sans internet), charte et horloge du bandeau.
// L'heure réelle (new Date) n'est autorisée qu'ici, jamais dans src/core/.
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '../styles/tokens.css';
import '../styles/base.css';

export function initBandeau(): void {
  const horloge = document.getElementById('horloge');
  const dateJour = document.getElementById('date-jour');

  const majHorloge = (): void => {
    const maintenant = new Date();
    if (horloge) {
      horloge.textContent = maintenant.toLocaleTimeString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour12: false,
      });
    }
    if (dateJour) {
      dateJour.textContent = maintenant.toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
  };

  majHorloge();
  // Re-rendu 1×/s maximum (contrainte CLAUDE.md — 18 h/jour d'affichage)
  window.setInterval(majHorloge, 1000);
}

/** Lit le paramètre ?gare= de l'URL (identifiant de gare, ex. « saint-gervais »). */
export function parametreGare(): string | null {
  return new URLSearchParams(window.location.search).get('gare');
}
