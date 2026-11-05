// Règle de suppression d'une grille : ce que l'on refuse, et ce que l'on dit.
// Lancer aussi avec TZ=UTC (le coureur de la CI est en UTC, le poste à Paris) :
// `aujourdhuiParis` doit donner le même jour dans les deux.
import { describe, expect, it } from 'vitest';

import {
  aujourdhuiParis,
  listeDates,
  MAX_DATES_CITEES,
  refusRemplacementGrille,
  refusSuppressionGrille,
} from './suppression-grille';

describe('aujourdhuiParis — le jour de Paris, jamais le jour UTC', () => {
  it('hiver (UTC+1) : minuit à Paris est 23:00 UTC', () => {
    expect(aujourdhuiParis(new Date('2026-11-05T22:59:59Z'))).toBe('2026-11-05');
    expect(aujourdhuiParis(new Date('2026-11-05T23:00:00Z'))).toBe('2026-11-06');
  });
  it('été (UTC+2) : minuit à Paris est 22:00 UTC', () => {
    expect(aujourdhuiParis(new Date('2026-07-15T21:59:59Z'))).toBe('2026-07-15');
    expect(aujourdhuiParis(new Date('2026-07-15T22:00:00Z'))).toBe('2026-07-16');
  });
});

describe('listeDates — les 10 premières, puis « et N autres »', () => {
  const dates = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

  it('jusqu’à 10 dates : toutes citées, au format français, sans reste', () => {
    expect(MAX_DATES_CITEES).toBe(10);
    expect(listeDates(dates(2))).toBe('01/07/2026, 02/07/2026');
    expect(listeDates(dates(10)).split(', ')).toHaveLength(10);
    expect(listeDates(dates(10))).not.toContain('autre');
  });
  it('11 dates : 10 citées et « et 1 autre » (singulier)', () => {
    const t = listeDates(dates(11));
    expect(t.split(', ')).toHaveLength(10);
    expect(t.endsWith('10/07/2026 et 1 autre')).toBe(true);
  });
  it('13 dates : « et 3 autres » (pluriel), la 11ᵉ date n’est pas citée', () => {
    const t = listeDates(dates(13));
    expect(t.endsWith(' et 3 autres')).toBe(true);
    expect(t).not.toContain('11/07/2026');
  });
});

describe('refusSuppressionGrille', () => {
  const inactive = { version: 'g-v1', libelle: 'Grand service', actif: false };

  it('grille introuvable : refus nommé', () => {
    expect(refusSuppressionGrille(null, 'g-v9', [])).toBe(
      "Grille « g-v9 » introuvable : rien n'a été supprimé.",
    );
  });
  it('garde-fou 1 : une grille ACTIVE ne se supprime pas', () => {
    expect(refusSuppressionGrille({ ...inactive, actif: true }, 'g-v1', [])).toBe(
      'La grille « Grand service » est active : désactivez-la avant de la supprimer.',
    );
  });
  it('garde-fou 1 passe avant le 2 : active ET référencée → on dit d’abord de désactiver', () => {
    expect(refusSuppressionGrille({ ...inactive, actif: true }, 'g-v1', ['2026-07-15'])).toMatch(
      /est active/,
    );
  });
  it('garde-fou 2 : une journée d’aujourd’hui ou à venir bloque, avec ses dates et la marche à suivre', () => {
    const t = refusSuppressionGrille(inactive, 'g-v1', ['2026-07-15']) ?? '';
    expect(t).toContain("1 journée d'aujourd'hui ou à venir (15/07/2026)");
    expect(t).toContain("Réinitialisez cette journée d'abord");
    expect(t).toContain('« Réinitialiser »');
  });
  it('plusieurs journées : pluriel, et la liste est coupée à 10', () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const t = refusSuppressionGrille(inactive, 'g-v1', dates) ?? '';
    expect(t).toContain('12 journées');
    expect(t).toContain('et 2 autres');
    expect(t).toContain('Réinitialisez ces journées');
  });
  it('désactivée et libre : la suppression est permise', () => {
    expect(refusSuppressionGrille(inactive, 'g-v1', [])).toBeNull();
  });
});

describe('refusRemplacementGrille — le chemin de la correction n’est pas un contournement', () => {
  const ancienne = { version: 'g', libelle: 'Grand service', cree_le: '2026-06-05T08:00:00Z' };
  const successeur = {
    version: 'g-v2',
    libelle: 'Grand service',
    actif: true,
    cree_le: '2026-11-05T09:00:00Z',
  };

  it('une correction réelle : permise, même si l’ancienne est active', () => {
    expect(refusRemplacementGrille(ancienne, successeur, 'g', 'g-v2')).toBeNull();
  });
  it('refuse de se remplacer soi-même', () => {
    expect(refusRemplacementGrille(ancienne, successeur, 'g', 'g')).toMatch(/elle-même/);
  });
  it('refuse une ancienne introuvable', () => {
    expect(refusRemplacementGrille(null, successeur, 'g', 'g-v2')).toMatch(/introuvable/);
  });
  it('refuse un successeur absent ou désactivé (ce serait un trou de service)', () => {
    expect(refusRemplacementGrille(ancienne, null, 'g', 'g-v2')).toMatch(/pas active/);
    expect(refusRemplacementGrille(ancienne, { ...successeur, actif: false }, 'g', 'g-v2')).toMatch(
      /pas active/,
    );
  });
  it('refuse un successeur d’un autre nom : ce n’est pas la même grille', () => {
    expect(
      refusRemplacementGrille(ancienne, { ...successeur, libelle: 'Petit service' }, 'g', 'g-v2'),
    ).toMatch(/autre nom/);
  });
  it('refuse un successeur pas plus récent, ou à la même seconde', () => {
    const memeInstant = { ...successeur, cree_le: ancienne.cree_le };
    expect(refusRemplacementGrille(ancienne, memeInstant, 'g', 'g-v2')).toMatch(/plus récente/);
    const avant = { ...successeur, cree_le: '2026-01-01T00:00:00Z' };
    expect(refusRemplacementGrille(ancienne, avant, 'g', 'g-v2')).toMatch(/plus récente/);
  });
  it('des dates écrites différemment (+00:00 / Z) se comparent comme des instants', () => {
    const s = { ...successeur, cree_le: '2026-06-05T08:00:01+00:00' };
    expect(refusRemplacementGrille(ancienne, s, 'g', 'g-v2')).toBeNull();
  });
});
