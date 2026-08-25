// Non-régression du bug exploitant du 25/08/2026 : une modification sur une
// date dont la journée n'existe pas encore doit CRÉER la journée puis
// persister — et une écriture qui n'affecte aucune ligne doit échouer
// bruyamment (PostgREST répond « succès » avec 0 ligne).
import { beforeEach, describe, expect, it, vi } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import { ORDRE_GARES } from '../core/types';

// --- Environnement navigateur minimal : MockProvider tourne ici sous Node
// localStorage FIDÈLE : setItem émet un événement `storage` comme le fait un
// navigateur pour les AUTRES onglets. Sans cela, le test « un heartbeat ne
// notifie personne » passait même avec le code bogué (le bug était justement
// inter-onglets, via `storage`).
const stockage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (cle: string) => stockage.get(cle) ?? null,
  setItem: (cle: string, valeur: string) => {
    stockage.set(cle, valeur);
    globalThis.window.dispatchEvent({ type: 'storage', key: cle } as unknown as Event);
  },
  removeItem: (cle: string) => void stockage.delete(cle),
  clear: () => stockage.clear(),
});
const sessionStockage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (cle: string) => sessionStockage.get(cle) ?? null,
  setItem: (cle: string, valeur: string) => void sessionStockage.set(cle, valeur),
  removeItem: (cle: string) => void sessionStockage.delete(cle),
  clear: () => sessionStockage.clear(),
});
// Vrai bus d'événements : indispensable pour vérifier qui notifie qui
const ecouteurs = new Map<string, Set<() => void>>();
vi.stubGlobal('window', {
  addEventListener: (type: string, cb: () => void) => {
    const set = ecouteurs.get(type) ?? new Set();
    set.add(cb);
    ecouteurs.set(type, set);
  },
  removeEventListener: (type: string, cb: () => void) => {
    ecouteurs.get(type)?.delete(cb);
  },
  dispatchEvent: (e: { type: string; key?: string }) => {
    for (const cb of ecouteurs.get(e.type) ?? []) (cb as (ev: unknown) => void)(e);
    return true;
  },
  setInterval: () => 0,
  clearTimeout: () => undefined,
  setTimeout: () => 0,
  location: { reload: () => undefined },
});
vi.stubGlobal(
  'Event',
  class {
    constructor(public readonly type: string) {}
  },
);
// FileReader n'existe pas sous Node : substitut minimal pour uploadMedia
class FileReaderStub {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(): void {
    this.result = 'data:image/png;base64,AQID';
    this.onload?.();
  }
}
vi.stubGlobal('FileReader', FileReaderStub);

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

describe('Ouverture d’une date en supervision (amélioration exploitant du 25/08/2026)', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('date à venir en grand service : 26 trains créés d’emblée, modification immédiate', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x'); // session supervision
    const jour = await provider.getJour('2026-08-28');
    expect(jour.enregistre).toBe(true); // créé à l'ouverture, sans action manuelle
    expect(jour.hors_saison).toBeUndefined();
    expect(jour.circulations).toHaveLength(26);

    const t5 = jour.circulations.find((c) => c.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent');
    await provider.saveCirculation({ ...t5, terminus: 'bellevue' });
    expect(
      (await provider.getJour('2026-08-28')).circulations.find((c) => c.numero === 5)?.terminus,
    ).toBe('bellevue');
  });

  it('date à venir en petit service : 16 trains créés', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('supervision@demo', 'x');
    const jour = await provider.getJour('2026-09-05');
    expect(jour.enregistre).toBe(true);
    expect(jour.circulations).toHaveLength(16);
  });

  it('hors saison : aucune circulation, aucune écriture, pas de repli sur une autre grille', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    const jour = await provider.getJour('2026-10-15');
    expect(jour.hors_saison).toBe(true);
    expect(jour.circulations).toHaveLength(0);
    expect(stockage.get('tmb-mock-etat') ?? '').not.toContain('2026-10-15');
  });

  it('date passée sans données : aperçu théorique, aucun historique fabriqué', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    const jour = await provider.getJour('2026-08-01');
    expect(jour.enregistre).toBe(false); // lecture seule côté supervision
    expect(jour.circulations).toHaveLength(26); // aperçu théorique complet
    expect(stockage.get('tmb-mock-etat') ?? '').not.toContain('2026-08-01');
  });

  it('écran anonyme (sans session) : pas de création automatique', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const jour = await provider.getJour('2026-08-28');
    expect(jour.enregistre).toBe(false);
    expect(stockage.get('tmb-mock-etat') ?? '').not.toContain('2026-08-28');
  });

  it('réinitialisation : retour à l’horaire théorique de la grille en vigueur', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    const jour = await provider.getJour('2026-08-28');
    const t5 = jour.circulations.find((c) => c.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent');
    await provider.saveCirculation({ ...t5, statut: 'supprime', motif: 'Technique' });

    await provider.reinitialiseJour('2026-08-28');
    const apres = await provider.getJour('2026-08-28');
    expect(apres.enregistre).toBe(true);
    expect(apres.circulations.find((c) => c.numero === 5)).toMatchObject({
      statut: 'ok',
      motif: null,
    });
  });
});

describe('Résilience du cache de grilles (audit du 26/08/2026)', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('un échec réseau n’est pas mémorisé : la synchro suivante retente et réussit', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const fetchOk = globalThis.fetch;
    vi.stubGlobal('fetch', async () => {
      throw new Error('réseau indisponible');
    });
    await expect(provider.getGrilles()).rejects.toThrow('réseau indisponible');

    // Retour du réseau : une promesse rejetée mémorisée figerait l'écran neutre
    vi.stubGlobal('fetch', fetchOk);
    const grilles = await provider.getGrilles();
    expect(grilles).toHaveLength(2);
  });

  it('la libération du terminus rétablit le Nid d’Aigle quand on décoche la bascule', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    await provider.setTerminusBellevue('2026-08-28', { a_partir_du_train: 19 });
    expect(
      (await provider.getJour('2026-08-28')).circulations.find((c) => c.numero === 19)?.terminus,
    ).toBe('bellevue');

    await provider.setTerminusBellevue('2026-08-28', false);
    const apres = await provider.getJour('2026-08-28');
    expect(apres.terminus_bellevue).toBe(false);
    for (const c of apres.circulations.filter((x) => x.sens === 'montee')) {
      expect(c.terminus).toBe('nid-daigle');
    }
  });

  it('rétrécir la plage libère les rotations qui en sortent', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    await provider.setTerminusBellevue('2026-08-28', { a_partir_du_train: 11 });
    await provider.setTerminusBellevue('2026-08-28', { a_partir_du_train: 21 });
    const jour = await provider.getJour('2026-08-28');
    expect(jour.circulations.find((c) => c.numero === 11)?.terminus).toBe('nid-daigle');
    expect(jour.circulations.find((c) => c.numero === 21)?.terminus).toBe('bellevue');
  });

  it('un média désactivé reste visible en supervision (listMedias) mais disparaît des écrans', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    const fichier = new File([new Uint8Array([1, 2, 3])], 'affiche.png', { type: 'image/png' });
    await provider.uploadMedia(fichier, { nom: 'affiche.png', type: 'image', duree_s: 8 });

    const media = (await provider.listMedias())[0];
    if (!media) throw new Error('média absent');
    await provider.saveMedia({ ...media, actif: false });

    expect(await provider.listMedias()).toHaveLength(1); // toujours gérable
    expect(await provider.getMedias('le-fayet')).toHaveLength(0); // retiré des écrans
  });
});

describe('Heartbeats et médias (reliquat d’audit du 26/08/2026)', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('un heartbeat ne notifie AUCUN abonné (pas de resynchro en boucle)', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    let notifications = 0;
    provider.onChange(() => {
      notifications += 1;
    });

    // 6 écrans × 2 battements : aucune notification ne doit partir
    for (let tour = 0; tour < 2; tour += 1) {
      for (const gare of ORDRE_GARES) {
        await provider.heartbeat({ id: `${gare}-ecran-1`, gare, type: 'ecran' });
      }
    }
    expect(notifications).toBe(0);

    // …alors qu'une écriture d'exploitation notifie bien
    await provider.saveMessage({
      id: '',
      texte_fr: 'test',
      texte_en: 'test',
      cible_type: 'toutes',
      priorite: 'normale',
      actif: true,
    });
    expect(notifications).toBeGreaterThan(0);
  });

  it('les écrans restent distincts par type et « Recharger » vise le bon poste', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.heartbeat({ id: 'le-fayet-ecran-1', gare: 'le-fayet', type: 'ecran' });
    await provider.heartbeat({ id: 'le-fayet-grille-1', gare: 'le-fayet', type: 'grille' });
    const ecrans = await provider.listEcrans();
    expect(ecrans).toHaveLength(2);
    expect(ecrans.map((e) => e.id).sort()).toEqual(['le-fayet-ecran-1', 'le-fayet-grille-1']);

    // La cible du rechargement est vérifiée : seul l'écran visé est marqué
    await provider.demanderRechargement('le-fayet-grille-1');
    const brut = JSON.parse(stockage.get('tmb-mock-ecrans') ?? '{}') as Record<
      string,
      { recharger?: boolean }
    >;
    expect(brut['le-fayet-grille-1']?.recharger).toBe(true);
    expect(brut['le-fayet-ecran-1']?.recharger).not.toBe(true);
    await expect(provider.demanderRechargement('inconnu-1')).rejects.toThrow(/inconnu/);
  });

  it('un écran obsolète peut être oublié (poste fantôme après changement d’identifiant)', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.heartbeat({ id: 'le-fayet-1', gare: 'le-fayet', type: 'ecran' }); // ancien format
    expect(await provider.listEcrans()).toHaveLength(1);
    await provider.oublierEcran('le-fayet-1');
    expect(await provider.listEcrans()).toHaveLength(0);
    await expect(provider.oublierEcran('le-fayet-1')).rejects.toThrow(/inconnu/);
  });

  it('saveMedia sur un identifiant inconnu échoue bruyamment (pas de faux succès)', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await expect(
      provider.saveMedia({
        id: 'fantome',
        nom: 'x.png',
        type: 'image',
        url: '',
        duree_s: 8,
        actif: true,
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it('gares ciblées et expiration d’un média sont modifiables après création', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.signIn('admin@demo', 'x');
    const fichier = new File([new Uint8Array([1])], 'affiche.png', { type: 'image/png' });
    await provider.uploadMedia(fichier, { nom: 'affiche.png', type: 'image', duree_s: 8 });

    const media = (await provider.listMedias())[0];
    if (!media) throw new Error('média absent');
    const expire = new Date('2026-08-30T21:00:00Z').toISOString();
    await provider.saveMedia({ ...media, gares: ['motivon'], expire_at: expire });

    const maj = (await provider.listMedias())[0];
    expect(maj?.gares).toEqual(['motivon']);
    expect(maj?.expire_at).toBe(expire);
    // Ciblage effectif côté écrans
    expect(await provider.getMedias('motivon')).toHaveLength(1);
    expect(await provider.getMedias('le-fayet')).toHaveLength(0);
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
