// Résilience des écrans (docs/01 §7) : instantané localStorage + âge de la
// dernière synchronisation (badge « données de HH:MM » au-delà de 2 min,
// écran neutre au-delà de duree_cache_min), service worker, anti-burn-in.

const FORMAT_HM = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** Badge au-delà de 2 min sans synchro. */
export const SEUIL_BADGE_MS = 2 * 60_000;

export interface Synchronisation {
  /** Premier chargement : réseau, sinon instantané local. false = aucune donnée. */
  demarre(): Promise<boolean>;
  /** Tentative silencieuse (échec ignoré : l'affichage garde le dernier état). */
  resynchronise(): void;
  /** Âge de la dernière synchro réussie, null si aucune. */
  ageMs(): number | null;
  /** « HH:MM » (Europe/Paris) de la dernière synchro réussie. */
  heureSync(): string | null;
}

export function creeSynchronisation<T>(options: {
  cleSnapshot: string;
  charge: () => Promise<T>;
  applique: (donnees: T) => void;
}): Synchronisation {
  let derniereSynchroMs: number | null = null;
  let enCours = false;

  const sauve = (donnees: T): void => {
    try {
      localStorage.setItem(options.cleSnapshot, JSON.stringify({ quand: Date.now(), donnees }));
    } catch {
      // stockage indisponible ou plein : le badge d'âge suffira
    }
  };
  const lit = (): { quand: number; donnees: T } | null => {
    try {
      const brut = localStorage.getItem(options.cleSnapshot);
      return brut ? (JSON.parse(brut) as { quand: number; donnees: T }) : null;
    } catch {
      return null;
    }
  };
  const synchronise = async (): Promise<boolean> => {
    if (enCours) return false;
    enCours = true;
    try {
      const donnees = await options.charge();
      options.applique(donnees);
      derniereSynchroMs = Date.now();
      sauve(donnees);
      return true;
    } catch {
      return false;
    } finally {
      enCours = false;
    }
  };

  return {
    async demarre() {
      if (await synchronise()) return true;
      const instantane = lit();
      if (instantane) {
        options.applique(instantane.donnees);
        derniereSynchroMs = instantane.quand;
        return true;
      }
      return false; // ni réseau ni cache : écran neutre jusqu'au retour
    },
    resynchronise() {
      void synchronise();
    },
    ageMs: () => (derniereSynchroMs === null ? null : Date.now() - derniereSynchroMs),
    heureSync: () =>
      derniereSynchroMs === null ? null : FORMAT_HM.format(new Date(derniereSynchroMs)),
  };
}

/** Enregistre le service worker (build uniquement : le dev reste sans cache). */
export function enregistreServiceWorker(): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

/** Anti-burn-in : décalage du rendu de 1 px toutes les heures (cycle de 4 positions). */
export function demarreAntiBurnIn(): void {
  const positions = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % positions.length;
    const position = positions[index] ?? [0, 0];
    document.body.style.transform = `translate(${position[0]}px, ${position[1]}px)`;
  }, 3_600_000);
}
