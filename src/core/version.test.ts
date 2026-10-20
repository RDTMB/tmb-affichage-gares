// Libellé de version de la Supervision (src/core/version.ts) : les quatre
// formes demandées par l'exploitant le 20/10/2026, et le refus de fabriquer
// une date.
import { describe, expect, it } from 'vitest';

import {
  VERSION_LOCALE,
  dateMiseEnLigne,
  libelleVersion,
  lienCommit,
  lienPr,
  lireVersionApp,
} from './version';

const prod = { date: '2026.10.16', heure: '14:32:05', sha: 'dace137', pr: '56', branche: 'main' };

describe('libelleVersion', () => {
  it('prod avec PR : date + numéro de PR', () => {
    expect(libelleVersion(lireVersionApp(prod))).toBe('v2026.10.16 · #56');
  });

  it('prod sans PR : date + sha, jamais un numéro inventé', () => {
    expect(libelleVersion(lireVersionApp({ ...prod, pr: null }))).toBe('v2026.10.16 · dace137');
    expect(libelleVersion(lireVersionApp({ ...prod, pr: '' }))).toBe('v2026.10.16 · dace137');
  });

  it('préversion : branche + sha, sans date', () => {
    expect(libelleVersion(lireVersionApp({ ...prod, branche: 'dev', sha: '1a2b3c4' }))).toBe(
      'préversion · dev · 1a2b3c4',
    );
  });

  it('local : « version locale »', () => {
    expect(libelleVersion(VERSION_LOCALE)).toBe('version locale');
    expect(libelleVersion(lireVersionApp({ branche: 'local' }))).toBe('version locale');
  });
});

describe('lireVersionApp : une valeur douteuse retombe sur « locale »', () => {
  it.each([undefined, null, 'v1', 42, {}])('%s', (brut) => {
    expect(lireVersionApp(brut)).toEqual(VERSION_LOCALE);
  });

  it('une version déployée sans sha n’est pas une version', () => {
    expect(lireVersionApp({ ...prod, sha: null })).toEqual(VERSION_LOCALE);
    expect(lireVersionApp({ ...prod, sha: 'pas un sha' })).toEqual(VERSION_LOCALE);
  });

  it('une date mal formée est écartée, pas affichée', () => {
    const v = lireVersionApp({ ...prod, date: '16/10/2026' });
    expect(v.date).toBeNull();
    expect(libelleVersion(v)).toBe('#56 · dace137');
  });

  it('un numéro de PR qui n’est pas un nombre est écarté', () => {
    expect(lireVersionApp({ ...prod, pr: '#56' }).pr).toBeNull();
  });
});

describe('détail de l’onglet Version', () => {
  it('liens vers le dépôt public', () => {
    const v = lireVersionApp(prod);
    expect(lienCommit(v)).toBe('https://github.com/RDTMB/tmb-affichage-gares/commit/dace137');
    expect(lienPr(v)).toBe('https://github.com/RDTMB/tmb-affichage-gares/pull/56');
    expect(lienCommit(VERSION_LOCALE)).toBeNull();
    expect(lienPr(lireVersionApp({ ...prod, pr: null }))).toBeNull();
  });

  it('date de mise en ligne lisible, heure de Paris telle que posée au déploiement', () => {
    expect(dateMiseEnLigne(lireVersionApp(prod))).toBe('16/10/2026 à 14:32');
    expect(dateMiseEnLigne(lireVersionApp({ ...prod, heure: null }))).toBe('16/10/2026');
    expect(dateMiseEnLigne(VERSION_LOCALE)).toBeNull();
  });
});
