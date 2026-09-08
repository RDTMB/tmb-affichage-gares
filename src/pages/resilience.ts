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

/**
 * Tolérance sur un instantané POSTDATÉ. L'horloge du Raspberry peut avancer
 * de quelques secondes entre l'écriture et la relecture ; au-delà d'une
 * minute, c'est qu'elle a sauté et l'horodatage ne date plus rien.
 */
const AVANCE_TOLEREE_MS = 60_000;

/** Au-delà, l'instantané n'a plus aucune valeur : mieux vaut l'écran neutre. */
const AGE_MAX_INSTANTANE_MS = 24 * 60 * 60_000;

export interface Synchronisation {
  /** Premier chargement : réseau, sinon instantané local. false = aucune donnée. */
  demarre(): Promise<boolean>;
  /** Tentative silencieuse (échec ignoré : l'affichage garde le dernier état). */
  resynchronise(): void;
  /** Âge de la dernière synchro réussie, null si aucune. */
  ageMs(): number | null;
  /** « HH:MM » (Europe/Paris) de la dernière synchro réussie. */
  heureSync(): string | null;
  /** Horodatage ISO de la dernière synchro réussie (preuve de fraîcheur envoyée au heartbeat). */
  derniereSyncISO(): string | null;
}

export function creeSynchronisation<T>(options: {
  cleSnapshot: string;
  charge: () => Promise<T>;
  applique: (donnees: T) => void;
  /**
   * Assainissement de l'instantané relu depuis localStorage. C'est la
   * TROISIÈME entrée des paramètres, et la seule qui ne passe pas par
   * getParams() : un instantané écrit avant le correctif C-01, ou par une
   * version antérieure, y survit. `JSON.stringify` transforme en outre NaN
   * en `null` — sans cette passe, une température neutralisée reviendrait
   * en `null`. Facultatif : sans lui, l'instantané est appliqué tel quel.
   */
  valide?: (donnees: T) => T;
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
  /**
   * Instantané relu, ou null s'il est INDATABLE. Le transtypage TypeScript
   * s'efface à la compilation : rien ne garantissait que `quand` soit un
   * nombre, ni qu'il soit plausible. Or c'est lui qui décide du badge « données
   * de HH:MM » et de l'écran neutre — un horodatage faux fait passer la
   * journée de la veille pour fraîche.
   *
   * Trois rejets, tous traités comme une ABSENCE d'instantané (écran neutre) :
   * horodatage non numérique, instantané postdaté au-delà de la tolérance, et
   * instantané de plus de 24 h. On n'applique jamais des données dont on ne
   * sait pas dater la fraîcheur.
   */
  const lit = (): { quand: number; donnees: T } | null => {
    try {
      const brut = localStorage.getItem(options.cleSnapshot);
      if (!brut) return null;
      const instantane = JSON.parse(brut) as { quand: unknown; donnees: T };
      const quand = instantane?.quand;
      if (typeof quand !== 'number' || !Number.isFinite(quand)) return null;
      const maintenant = Date.now();
      if (quand > maintenant + AVANCE_TOLEREE_MS) return null;
      if (maintenant - quand > AGE_MAX_INSTANTANE_MS) return null;
      return { quand, donnees: instantane.donnees };
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
        options.applique(options.valide ? options.valide(instantane.donnees) : instantane.donnees);
        derniereSynchroMs = instantane.quand;
        return true;
      }
      return false; // ni réseau ni cache : écran neutre jusqu'au retour
    },
    resynchronise() {
      void synchronise();
    },
    // BORNÉ À ZÉRO : `derniereSynchroMs` et `Date.now()` viennent de la MÊME
    // horloge locale, et le Raspberry n'a pas de pile — au redémarrage sans
    // réseau il repart sur `fake-hwclock`. Si l'horloge a RECULÉ, la
    // soustraction devient négative, donc « très frais » : ni le badge à
    // 2 min ni l'écran neutre à 15 min ne se déclenchaient, et la journée de
    // la veille s'affichait comme si elle venait d'arriver.
    ageMs: () => (derniereSynchroMs === null ? null : Math.max(0, Date.now() - derniereSynchroMs)),
    heureSync: () =>
      derniereSynchroMs === null ? null : FORMAT_HM.format(new Date(derniereSynchroMs)),
    derniereSyncISO: () =>
      derniereSynchroMs === null ? null : new Date(derniereSynchroMs).toISOString(),
  };
}

/**
 * Enregistre le service worker (build uniquement : le dev reste sans cache).
 *
 * La version du cache voyage par la QUERY STRING. `public/sw.js` n'est pas
 * traité par Vite — il est recopié tel quel, aucun `define` ne l'atteint —
 * alors que CE fichier l'est : la query string est le seul canal qui traverse
 * la frontière, et le service worker la relit dans `self.location`.
 *
 * Effet de bord voulu : une URL de script différente fait installer un
 * service worker NEUF, donc purge l'ancien cache à chaque déploiement. Si le
 * précache échoue faute de réseau, `install` est rejeté et l'ANCIEN service
 * worker reste en place avec son cache : le démarrage hors ligne n'est jamais
 * sacrifié à une mise à jour.
 */
export function enregistreServiceWorker(): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const url = `${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(__VERSION_CACHE__)}`;
    void navigator.serviceWorker.register(url).catch(() => {});
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
