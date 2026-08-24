// Non-régression du bug exploitant du 25/08/2026 : une modification sur une
// date dont la journée n'existe pas encore doit CRÉER la journée puis
// persister — et une écriture qui n'affecte aucune ligne doit échouer
// bruyamment (PostgREST répond « succès » avec 0 ligne).
import { beforeEach, describe, expect, it, vi } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';

// --- Environnement navigateur minimal : MockProvider tourne ici sous Node
const stockage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (cle: string) => stockage.get(cle) ?? null,
  setItem: (cle: string, valeur: string) => void stockage.set(cle, valeur),
  removeItem: (cle: string) => void stockage.delete(cle),
  clear: () => stockage.clear(),
});
vi.stubGlobal('sessionStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
});
vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  setInterval: () => 0,
  clearTimeout: () => undefined,
  setTimeout: () => 0,
  location: { reload: () => undefined },
});
vi.stubGlobal(
  'fetch',
  async (url: string | URL) =>
    new Response(
      JSON.stringify(String(url).includes('petit') ? petitServiceJson : grandServiceJson),
    ),
);

const { MockProvider } = await import('./mock');
const { exigeLignes } = await import('./supabase');

describe('MockProvider — écritures sur une date non générée', () => {
  beforeEach(() => stockage.clear());

  it('saveCirculation enregistre la journée puis la modification persiste', async () => {
    const provider = new MockProvider();
    const date = '2026-07-20';
    const avant = await provider.getJour(date);
    expect(avant.enregistre).toBe(false); // aperçu théorique

    const t5 = avant.circulations.find((c) => c.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent du jour généré');
    await provider.saveCirculation({ ...t5, statut: 'retard', retard_min: 15, motif: 'Météo' });

    const apres = await provider.getJour(date);
    expect(apres.enregistre).toBe(true);
    expect(apres.circulations.find((c) => c.numero === 5)).toMatchObject({
      statut: 'retard',
      retard_min: 15,
      motif: 'Météo',
    });
  });

  it('setTerminusBellevue enregistre la journée et pré-remplit les rotations', async () => {
    const provider = new MockProvider();
    const date = '2026-07-21';
    await provider.setTerminusBellevue(date, { a_partir_du_train: 19 });

    const jour = await provider.getJour(date);
    expect(jour.enregistre).toBe(true);
    expect(jour.terminus_bellevue).toEqual({ a_partir_du_train: 19 });
    expect(jour.circulations.find((c) => c.numero === 19)?.terminus).toBe('bellevue');
    expect(jour.circulations.find((c) => c.numero === 15)?.terminus).toBe('nid-daigle');
  });
});

describe('exigeLignes — échec bruyant des écritures sans effet', () => {
  it('lève une erreur explicite quand 0 ligne est affectée', () => {
    expect(() => exigeLignes({ data: [], error: null }, 'journée absente en base')).toThrow(
      /Modification non enregistrée — journée absente en base/,
    );
    expect(() => exigeLignes({ data: null, error: null }, 'journée absente en base')).toThrow(
      /Modification non enregistrée/,
    );
  });

  it('relaie l’erreur PostgREST et laisse passer les écritures effectives', () => {
    expect(() => exigeLignes({ data: null, error: { message: 'RLS refus' } }, 'x')).toThrow(
      'RLS refus',
    );
    expect(() => exigeLignes({ data: [{}], error: null }, 'x')).not.toThrow();
  });
});
