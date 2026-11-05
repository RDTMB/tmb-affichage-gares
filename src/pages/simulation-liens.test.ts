import { describe, expect, it } from 'vitest';
import {
  heureSimulationNormalisee,
  jourSimulationValide,
  liensSimulation,
  suffixeSimulation,
  type ReglageSimulation,
} from './supervision-logique';
import { ORDRE_GARES } from '../core/types';

const R: ReglageSimulation = {
  jour: '2026-12-12',
  heure: '08:29:30',
  sansJour: false,
  sansHeure: false,
};

describe('jourSimulationValide', () => {
  it('format strict ET date réelle', () => {
    expect(jourSimulationValide('2026-12-12')).toBe(true);
    expect(jourSimulationValide('2028-02-29')).toBe(true);
    expect(jourSimulationValide('2026-02-29')).toBe(false);
    expect(jourSimulationValide('2026-06-31')).toBe(false);
    expect(jourSimulationValide('2026-13-01')).toBe(false);
    expect(jourSimulationValide('2026-12-1')).toBe(false);
    // Année à deux chiffres : Date.UTC la ramène à 19xx, seule l'année le trahit.
    expect(jourSimulationValide('0050-01-01')).toBe(false);
    expect(jourSimulationValide('2026-12-12x')).toBe(false);
    expect(jourSimulationValide('x2026-12-12')).toBe(false);
    expect(jourSimulationValide('')).toBe(false);
  });
});

describe('heureSimulationNormalisee', () => {
  it('garde les secondes et complète HH:MM', () => {
    expect(heureSimulationNormalisee('08:29:30')).toBe('08:29:30');
    expect(heureSimulationNormalisee('08:29')).toBe('08:29:00');
    expect(heureSimulationNormalisee('23:59:59')).toBe('23:59:59');
    expect(heureSimulationNormalisee('00:00:00')).toBe('00:00:00');
  });
  it('refuse l’invalide', () => {
    for (const h of ['', '8:29', '24:00', '12:60', '12:00:60', 'ab:cd', '12:00:00:00']) {
      expect(heureSimulationNormalisee(h), h).toBeNull();
    }
  });
});

describe('suffixeSimulation', () => {
  it('jour et heure', () => {
    expect(suffixeSimulation(R)).toBe('&jour=2026-12-12&simule=08:29:30');
  });
  it('l’heure saisie sans secondes est complétée dans le lien', () => {
    expect(suffixeSimulation({ ...R, heure: '08:29' })).toBe('&jour=2026-12-12&simule=08:29:00');
  });
  it('« Ne pas simuler » retire le paramètre', () => {
    expect(suffixeSimulation({ ...R, sansJour: true })).toBe('&simule=08:29:30');
    expect(suffixeSimulation({ ...R, sansHeure: true })).toBe('&jour=2026-12-12');
    expect(suffixeSimulation({ ...R, sansJour: true, sansHeure: true })).toBe('');
  });
  it('un champ invalide mais décoché n’empêche rien', () => {
    expect(suffixeSimulation({ ...R, jour: 'n’importe quoi', sansJour: true })).toBe(
      '&simule=08:29:30',
    );
    expect(suffixeSimulation({ ...R, heure: '', sansHeure: true })).toBe('&jour=2026-12-12');
  });
  it('un champ simulé invalide ne produit rien', () => {
    expect(suffixeSimulation({ ...R, jour: '2026-06-31' })).toBeNull();
    expect(suffixeSimulation({ ...R, jour: '' })).toBeNull();
    expect(suffixeSimulation({ ...R, heure: '25:00' })).toBeNull();
    expect(suffixeSimulation({ ...R, heure: '' })).toBeNull();
  });
});

describe('liensSimulation', () => {
  const fin = '&jour=2026-12-12&simule=08:29:30';

  it('date invalide : aucun lien', () => {
    expect(liensSimulation({ ...R, jour: '2026-02-30' }, false)).toBeNull();
    expect(liensSimulation({ ...R, heure: 'x' }, true)).toBeNull();
  });

  it('chaque groupe, dans l’ordre de la ligne', () => {
    const liens = liensSimulation(R, false)!;
    expect(liens).toHaveLength(ORDRE_GARES.length * 3 + 2);
    for (const groupe of ['ecran', 'grille', 'embed-gare'] as const) {
      expect(liens.filter((l) => l.groupe === groupe).map((l) => l.gare)).toEqual([...ORDRE_GARES]);
    }
    expect(liens.filter((l) => l.groupe === 'embed-general').map((l) => l.vue)).toEqual([
      'departs',
      'jour',
    ]);
  });

  it('URL exactes, relatives, simulation en dernier', () => {
    const liens = liensSimulation(R, false)!;
    const href = (g: string, gare: string | null) =>
      liens.find((l) => l.groupe === g && l.gare === gare)!.href;
    expect(href('ecran', 'col-de-voza')).toBe(`ecran.html?gare=col-de-voza&apercu=1${fin}`);
    expect(href('grille', 'le-fayet')).toBe(`grille.html?gare=le-fayet&apercu=1${fin}`);
    expect(href('embed-gare', 'nid-daigle')).toBe(`embed.html?gare=nid-daigle${fin}`);
    expect(liens.find((l) => l.vue === 'departs')!.href).toBe(
      'embed.html?jour=2026-12-12&simule=08:29:30',
    );
    expect(liens.find((l) => l.vue === 'jour')!.href).toBe(`embed.html?vue=jour${fin}`);
    for (const l of liens) expect(l.href.startsWith('/') || l.href.includes('://')).toBe(false);
  });

  it('apercu=1 sur écran et grille, JAMAIS sur l’embed', () => {
    for (const l of liensSimulation(R, true)!) {
      expect(l.href.includes('apercu=1'), l.href).toBe(
        l.groupe === 'ecran' || l.groupe === 'grille',
      );
    }
  });

  it('demo=1 seulement sans configuration Supabase, en fin d’URL', () => {
    expect(liensSimulation(R, false)!.some((l) => l.href.includes('demo=1'))).toBe(false);
    for (const l of liensSimulation(R, true)!) expect(l.href.endsWith('&demo=1')).toBe(true);
  });

  it('embed général sans aucun champ simulé : ni « ? » orphelin ni « & » en tête', () => {
    const sans = { ...R, sansJour: true, sansHeure: true };
    const liens = liensSimulation(sans, false)!;
    expect(liens.find((l) => l.vue === 'departs')!.href).toBe('embed.html');
    expect(liens.find((l) => l.vue === 'jour')!.href).toBe('embed.html?vue=jour');
    const demo = liensSimulation(sans, true)!;
    expect(demo.find((l) => l.vue === 'departs')!.href).toBe('embed.html?demo=1');
  });

  it('« Ne pas simuler » retire le paramètre de TOUS les liens', () => {
    for (const l of liensSimulation({ ...R, sansHeure: true }, false)!) {
      expect(l.href.includes('simule=')).toBe(false);
      expect(l.href.includes('jour=2026-12-12')).toBe(true);
    }
    for (const l of liensSimulation({ ...R, sansJour: true }, false)!) {
      expect(l.href.includes('jour=2026')).toBe(false);
      expect(l.href.includes('simule=08:29:30')).toBe(true);
    }
  });
});
