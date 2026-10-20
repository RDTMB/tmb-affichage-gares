// Parseur des nouveautes/*.md (src/core/nouveautes.ts). Il tourne AU BUILD :
// chaque refus ci-dessous est un build qui échoue en nommant le fichier.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { dateNouveaute, grouperParDate, lireNouveaute, lireNouveautes } from './nouveautes';

const valide = `---
date: 2026-10-20
pour: tous # tous | admin
---
- La Supervision affiche son numéro de version en haut de page.
- Nouvel onglet « Version » (administration) : version en ligne et nouveautés.
`;

describe('lireNouveaute', () => {
  it('lit l’en-tête et les puces, commentaire d’en-tête toléré', () => {
    expect(lireNouveaute('2026-10-20-version.md', valide)).toEqual({
      fichier: '2026-10-20-version.md',
      date: '2026-10-20',
      pour: 'tous',
      puces: [
        'La Supervision affiche son numéro de version en haut de page.',
        'Nouvel onglet « Version » (administration) : version en ligne et nouveautés.',
      ],
    });
  });

  it('fins de ligne CRLF et puce sur deux lignes', () => {
    const texte =
      '---\r\ndate: 2026-10-20\r\npour: admin\r\n---\r\n- Une puce\r\n  qui continue.\r\n';
    expect(lireNouveaute('2026-10-20-x.md', texte).puces).toEqual(['Une puce qui continue.']);
  });

  const refus: [string, string, string, RegExp][] = [
    ['en-tête manquant', '2026-10-20-a.md', '- puce\n', /en-tête manquant/],
    ['en-tête non refermé', '2026-10-20-a.md', '---\ndate: 2026-10-20\n- puce\n', /non refermé/],
    ['date manquante', '2026-10-20-a.md', '---\npour: tous\n---\n- puce\n', /« date » manquant/],
    [
      'date invalide',
      '2026-02-30-a.md',
      '---\ndate: 2026-02-30\npour: tous\n---\n- puce\n',
      /date invalide/,
    ],
    [
      'date ≠ nom de fichier',
      '2026-10-21-a.md',
      '---\ndate: 2026-10-20\npour: tous\n---\n- puce\n',
      /diffère/,
    ],
    [
      '« pour » inconnu',
      '2026-10-20-a.md',
      '---\ndate: 2026-10-20\npour: caisse\n---\n- puce\n',
      /« pour » inconnu/,
    ],
    ['« pour » manquant', '2026-10-20-a.md', '---\ndate: 2026-10-20\n---\n- puce\n', /« pour »/],
    [
      'champ inconnu',
      '2026-10-20-a.md',
      '---\ndate: 2026-10-20\npour: tous\ntitre: x\n---\n- puce\n',
      /champ d'en-tête inconnu/,
    ],
    ['aucune puce', '2026-10-20-a.md', '---\ndate: 2026-10-20\npour: tous\n---\n', /aucune puce/],
    [
      'quatre puces',
      '2026-10-20-a.md',
      '---\ndate: 2026-10-20\npour: tous\n---\n- a\n- b\n- c\n- d\n',
      /3 au plus/,
    ],
    ['nom de fichier', 'Version.md', valide, /nom de fichier/],
  ];

  it.each(refus)('%s : refusé, et le message nomme le fichier', (_cas, fichier, texte, motif) => {
    expect(() => lireNouveaute(fichier, texte)).toThrow(motif);
    expect(() => lireNouveaute(fichier, texte)).toThrow(`nouveautes/${fichier}`);
  });
});

describe('lireNouveautes et grouperParDate', () => {
  const entree = (date: string, pour = 'tous') =>
    `---\ndate: ${date}\npour: ${pour}\n---\n- quelque chose\n`;

  it('de la plus récente à la plus ancienne, groupées par date', () => {
    const liste = lireNouveautes({
      '/nouveautes/2026-09-01-a.md': entree('2026-09-01'),
      '/nouveautes/2026-10-16-b.md': entree('2026-10-16', 'admin'),
      '/nouveautes/2026-10-16-c.md': entree('2026-10-16'),
    });
    expect(liste.map((n) => n.fichier)).toEqual([
      '2026-10-16-c.md',
      '2026-10-16-b.md',
      '2026-09-01-a.md',
    ]);
    expect(grouperParDate(liste).map((g) => [g.date, g.entrees.length])).toEqual([
      ['2026-10-16', 2],
      ['2026-09-01', 1],
    ]);
  });

  it('un seul fichier fautif fait échouer toute la lecture', () => {
    expect(() =>
      lireNouveautes({ '2026-10-16-b.md': entree('2026-10-16'), '2026-10-17-z.md': '- x\n' }),
    ).toThrow('nouveautes/2026-10-17-z.md');
  });

  it('date affichée en jj/mm/aaaa', () => {
    expect(dateNouveaute('2026-10-20')).toBe('20/10/2026');
  });
});

// Le dossier RÉEL : ce que le build lira. Le même parseur, sur les vrais
// fichiers — un fichier fautif rougit la suite avant de casser le build.
describe('nouveautes/ du dépôt', () => {
  const dossier = fileURLToPath(new URL('../../nouveautes/', import.meta.url));
  const fichiers = Object.fromEntries(
    readdirSync(dossier)
      .filter((nom) => nom.endsWith('.md'))
      .map((nom) => [nom, readFileSync(dossier + nom, 'utf8')]),
  );

  it('tous les fichiers sont lisibles', () => {
    expect(Object.keys(fichiers).length).toBeGreaterThan(0);
    expect(() => lireNouveautes(fichiers)).not.toThrow();
  });
});
