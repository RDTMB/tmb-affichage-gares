// Onglet Version (src/pages/version-onglet.ts) : détail de la version en
// ligne et liste des nouveautés, rendus sans DOM.
import { describe, expect, it } from 'vitest';

import { baseServie } from '../data/config';
import type { Nouveaute } from '../core/nouveautes';
import { VERSION_LOCALE, lireVersionApp } from '../core/version';
import { detailVersionHtml, nouveautesHtml } from './version-onglet';

const prod = lireVersionApp({
  date: '2026.10.16',
  heure: '14:32:05',
  sha: 'dace137',
  pr: '56',
  branche: 'main',
});
const demo = baseServie(undefined);

describe('detailVersionHtml', () => {
  it('version, date de mise en ligne, liens commit et PR, base servie', () => {
    const html = detailVersionHtml(prod, demo);
    expect(html).toContain('v2026.10.16 · #56');
    expect(html).toContain('16/10/2026 à 14:32');
    expect(html).toContain('href="https://github.com/RDTMB/tmb-affichage-gares/commit/dace137"');
    expect(html).toContain('href="https://github.com/RDTMB/tmb-affichage-gares/pull/56"');
    expect(html).toContain('DÉMONSTRATION');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('version locale : aucun lien, aucune date, et on le dit', () => {
    const html = detailVersionHtml(VERSION_LOCALE, demo);
    expect(html).toContain('version locale');
    expect(html).not.toContain('href=');
    expect(html).toContain('ni date ni numéro');
  });
});

describe('nouveautesHtml', () => {
  const n = (date: string, pour: 'tous' | 'admin', puces: string[]): Nouveaute => ({
    fichier: `${date}-x.md`,
    date,
    pour,
    puces,
  });

  it('groupées par date, la plus récente d’abord, les entrées admin marquées « technique »', () => {
    const html = nouveautesHtml([
      n('2026-10-20', 'tous', ['Le numéro de version est affiché.']),
      n('2026-10-20', 'admin', ['Contrôle CI des nouveautés.']),
      n('2026-09-01', 'tous', ['Plus ancien.']),
    ]);
    expect(html.indexOf('20/10/2026')).toBeLessThan(html.indexOf('01/09/2026'));
    expect(html.match(/<h3>/g)).toHaveLength(2);
    expect(html).toContain(
      '<li class="nouveaute-admin"><span class="mention-technique">technique</span> Contrôle CI des nouveautés.</li>',
    );
    expect(html).toContain('<li>Le numéro de version est affiché.</li>');
  });

  it('échappe le texte des puces', () => {
    expect(nouveautesHtml([n('2026-10-20', 'tous', ['<img src=x onerror=1>'])])).not.toContain(
      '<img',
    );
  });

  it('liste vide : une phrase, pas un trou', () => {
    expect(nouveautesHtml([])).toContain('Aucune nouveauté');
  });
});
