// Version du code en ligne, telle que le déploiement l'a calculée (deploy.yml,
// job `site`) et que vite.config.ts l'a figée dans `__VERSION_APP__`.
//
// Ce module est PUR : il reçoit la valeur injectée, il ne la lit pas. Il ne
// fabrique JAMAIS une date : sans les variables du déploiement (build local,
// `npm run dev`, mode démo), la version dit « version locale », et rien de plus.

/** Dépôt public : les liens du détail y pointent. */
export const DEPOT_GITHUB = 'https://github.com/RDTMB/tmb-affichage-gares';

export interface VersionApp {
  /** Date du commit de tête à l'heure de Paris, `AAAA.MM.JJ`. */
  date: string | null;
  /** Heure du même commit à l'heure de Paris, `HH:MM:SS`. */
  heure: string | null;
  /** Sha court du commit construit. */
  sha: string | null;
  /** Numéro de la PR fusionnée, s'il se lit dans le sujet du commit. */
  pr: string | null;
  /** `main` (racine du site), `dev` (préversion) ou `local`. */
  branche: string;
}

export const VERSION_LOCALE: VersionApp = {
  date: null,
  heure: null,
  sha: null,
  pr: null,
  branche: 'local',
};

const FORMAT_DATE = /^\d{4}\.\d{2}\.\d{2}$/;
const FORMAT_HEURE = /^\d{2}:\d{2}:\d{2}$/;
const FORMAT_SHA = /^[0-9a-f]{7,40}$/;
const FORMAT_PR = /^\d+$/;

/**
 * Relit la valeur injectée au build. Un champ mal formé est ÉCARTÉ plutôt
 * qu'affiché : mieux vaut « version locale » qu'un numéro qui ment.
 */
export function lireVersionApp(brut: unknown): VersionApp {
  if (!brut || typeof brut !== 'object') return VERSION_LOCALE;
  const v = brut as Record<string, unknown>;
  const champ = (cle: string, format: RegExp): string | null => {
    const valeur = v[cle];
    return typeof valeur === 'string' && format.test(valeur) ? valeur : null;
  };
  const branche = typeof v.branche === 'string' && v.branche !== '' ? v.branche : 'local';
  const sha = champ('sha', FORMAT_SHA);
  // Une version déployée SANS sha n'en est pas une : on retombe sur « locale ».
  if (branche === 'local' || !sha) return VERSION_LOCALE;
  return {
    date: champ('date', FORMAT_DATE),
    heure: champ('heure', FORMAT_HEURE),
    sha,
    pr: champ('pr', FORMAT_PR),
    branche,
  };
}

/**
 * Libellé court, celui de l'en-tête :
 *  - prod avec PR    : `v2026.10.16 · #56`
 *  - prod sans PR    : `v2026.10.16 · dace137`
 *  - préversion      : `préversion · dev · 1a2b3c4`
 *  - local           : `version locale`
 */
export function libelleVersion(v: VersionApp): string {
  if (v.branche === 'local' || !v.sha) return 'version locale';
  if (v.branche !== 'main') return `préversion · ${v.branche} · ${v.sha}`;
  // Sans date, on ne date pas : le sha seul identifie quand même le code.
  if (!v.date) return v.pr ? `#${v.pr} · ${v.sha}` : v.sha;
  return `v${v.date} · ${v.pr ? `#${v.pr}` : v.sha}`;
}

/** Lien vers le commit construit, ou null en version locale. */
export function lienCommit(v: VersionApp): string | null {
  return v.sha ? `${DEPOT_GITHUB}/commit/${v.sha}` : null;
}

/** Lien vers la PR fusionnée, ou null si elle n'est pas connue. */
export function lienPr(v: VersionApp): string | null {
  return v.pr ? `${DEPOT_GITHUB}/pull/${v.pr}` : null;
}

/** `2026.10.16` + `14:32:05` → `16/10/2026 à 14:32` (heure de Paris). */
export function dateMiseEnLigne(v: VersionApp): string | null {
  if (!v.date) return null;
  const [a, m, j] = v.date.split('.');
  const jour = `${j}/${m}/${a}`;
  return v.heure ? `${jour} à ${v.heure.slice(0, 5)}` : jour;
}
