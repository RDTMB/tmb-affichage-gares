// Non-régression du bug exploitant du 25/08/2026 : une modification sur une
// date dont la journée n'existe pas encore doit CRÉER la journée puis
// persister — et une écriture qui n'affecte aucune ligne doit échouer
// bruyamment (PostgREST répond « succès » avec 0 ligne).
import { beforeEach, describe, expect, it, vi } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import { ORDRE_GARES } from '../core/types';
import type { Grille } from '../core/types';

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
    for (const gare of ORDRE_GARES) {
      await provider.declareEcran({ id: `${gare}-ecran-1`, gare, type: 'ecran' });
    }
    notifications = 0; // la déclaration, elle, est une écriture d'exploitation
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
    await provider.declareEcran({ id: 'le-fayet-ecran-1', gare: 'le-fayet', type: 'ecran' });
    await provider.declareEcran({ id: 'le-fayet-grille-1', gare: 'le-fayet', type: 'grille' });
    await provider.heartbeat({ id: 'le-fayet-ecran-1', gare: 'le-fayet', type: 'ecran' });
    await provider.heartbeat({ id: 'le-fayet-grille-1', gare: 'le-fayet', type: 'grille' });
    const ecrans = await provider.listEcrans();
    expect(ecrans).toHaveLength(2);
    expect(ecrans.map((e) => e.id).sort()).toEqual(['le-fayet-ecran-1', 'le-fayet-grille-1']);

    // La cible du rechargement est vérifiée : seul l'écran visé est marqué
    await provider.demanderRechargement('le-fayet-grille-1');
    const brut = JSON.parse(stockage.get('tmb-mock-ecrans') ?? '{}') as Record<
      string,
      { recharger_demande_at?: string | null }
    >;
    expect(brut['le-fayet-grille-1']?.recharger_demande_at).toBeTruthy();
    expect(brut['le-fayet-ecran-1']?.recharger_demande_at).toBeFalsy();
    await expect(provider.demanderRechargement('inconnu-1')).rejects.toThrow(/inconnu/);
  });

  it('le heartbeat conserve la preuve de fraîcheur (donnees_maj, date_affichee)', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const maj = new Date('2026-08-25T09:30:00Z').toISOString();
    await provider.declareEcran({ id: 'motivon-ecran-1', gare: 'motivon', type: 'ecran' });
    await provider.heartbeat({
      id: 'motivon-ecran-1',
      gare: 'motivon',
      type: 'ecran',
      donnees_maj: maj,
      date_affichee: '2026-08-25',
    });
    const ecran = (await provider.listEcrans()).find((e) => e.id === 'motivon-ecran-1');
    expect(ecran?.donnees_maj).toBe(maj);
    expect(ecran?.date_affichee).toBe('2026-08-25');
    expect(ecran?.derniere_vue).toBeTruthy(); // horodaté par le provider
  });

  it('un écran obsolète peut être oublié (poste fantôme après changement d’identifiant)', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'le-fayet-1', gare: 'le-fayet', type: 'ecran' }); // ancien format
    await provider.heartbeat({ id: 'le-fayet-1', gare: 'le-fayet', type: 'ecran' });
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
        ordre: 100,
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

describe('Bibliothèque de messages préenregistrés', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('fournit les 12 modèles validés par l’exploitant, bilingues et ordonnés', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const liste = await provider.getModelesMessages();
    expect(liste).toHaveLength(12);
    for (const m of liste) {
      expect(m.texte_fr.trim()).not.toBe('');
      expect(m.texte_en.trim()).not.toBe(''); // bibliothèque livrée bilingue
      expect(m.categorie.trim()).not.toBe('');
    }
    // Ordonnée
    const ordres = liste.map((m) => m.ordre);
    expect([...ordres].sort((a, b) => a - b)).toEqual(ordres);
    // Catégories attendues
    expect(new Set(liste.map((m) => m.categorie))).toEqual(
      new Set(['Réservation', 'Sécurité', 'Météo', 'Exploitation', 'Confort', 'Travaux']),
    );
  });

  it('ajout, modification, désactivation et suppression', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.saveModeleMessage({
      id: '',
      titre: 'Chien tenu en laisse',
      categorie: 'Sécurité',
      ordre: 45,
      texte_fr: 'Les chiens doivent être tenus en laisse.',
      texte_en: 'Dogs must be kept on a lead.',
      actif: true,
    });
    let liste = await provider.getModelesMessages();
    expect(liste).toHaveLength(13);
    const ajoute = liste.find((m) => m.titre === 'Chien tenu en laisse');
    if (!ajoute) throw new Error('modèle ajouté introuvable');
    // L'ordre place le modèle entre 40 et 50
    expect(liste.indexOf(ajoute)).toBe(4);

    await provider.saveModeleMessage({ ...ajoute, actif: false });
    liste = await provider.getModelesMessages();
    expect(liste.find((m) => m.id === ajoute.id)?.actif).toBe(false);

    await provider.deleteModeleMessage(ajoute.id);
    expect(await provider.getModelesMessages()).toHaveLength(12);
    await expect(provider.deleteModeleMessage(ajoute.id)).rejects.toThrow(/introuvable/);
  });

  it('le paramètre de vitesse du bandeau est fourni et modifiable', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    expect((await provider.getParams()).vitesse_ticker_px_s).toBe(90);
    await provider.saveParams({ vitesse_ticker_px_s: 130 });
    expect((await provider.getParams()).vitesse_ticker_px_s).toBe(130);
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

describe('Écriture groupée des facultatifs et courses à vide', () => {
  beforeEach(() => stockage.clear());

  it('saveCirculations crée la journée et persiste TOUS les trains d’un coup', async () => {
    const provider = new MockProvider();
    const date = '2026-07-22';
    const avant = await provider.getJour(date);
    expect(avant.enregistre).toBe(false);

    const facultatifs = avant.circulations.filter((c) => c.facultatif);
    expect(facultatifs.length).toBeGreaterThan(1);
    await provider.saveCirculations(facultatifs.map((c) => ({ ...c, facultatif_actif: true })));

    const apres = await provider.getJour(date);
    expect(apres.enregistre).toBe(true);
    for (const c of facultatifs) {
      expect(apres.circulations.find((x) => x.numero === c.numero)?.facultatif_actif).toBe(true);
    }
  });

  it('une écriture groupée coûte UNE écriture, pas une par train', async () => {
    // Le stub localStorage émet `storage` dans le même contexte (fidélité
    // voulue ailleurs) : on compare donc au coût d'une écriture UNITAIRE
    // plutôt qu'à un nombre absolu.
    const provider = new MockProvider();
    const jour = await provider.getJour('2026-07-23');
    const t1 = jour.circulations[0];
    if (!t1) throw new Error('journée vide');

    let unitaire = 0;
    let stop = provider.onChange(() => (unitaire += 1));
    await provider.saveCirculation({ ...t1, motif: 'Météo' });
    stop();

    const facultatifs = jour.circulations.filter((c) => c.facultatif);
    expect(facultatifs.length).toBeGreaterThan(1);
    let groupee = 0;
    stop = provider.onChange(() => (groupee += 1));
    await provider.saveCirculations(facultatifs.map((c) => ({ ...c, facultatif_actif: true })));
    stop();

    expect(unitaire).toBeGreaterThan(0);
    expect(groupee).toBe(unitaire); // et surtout PAS unitaire × facultatifs.length
  });

  it('le drapeau « sans voyageurs » persiste et n’est pas emporté par l’action groupée', async () => {
    const provider = new MockProvider();
    const date = '2026-07-24';
    const jour = await provider.getJour(date);
    const facultatifs = jour.circulations.filter((c) => c.facultatif);
    const cible = facultatifs[0];
    if (!cible) throw new Error('aucun facultatif');

    await provider.saveCirculation({ ...cible, sans_voyageurs: true });
    // Action groupée : elle ne réécrit que facultatif_actif, à partir de l'état relu
    const relu = await provider.getJour(date);
    expect(relu.circulations.find((c) => c.numero === cible.numero)?.sans_voyageurs).toBe(true);
    await provider.saveCirculations(
      relu.circulations.filter((c) => c.facultatif).map((c) => ({ ...c, facultatif_actif: true })),
    );

    const apres = await provider.getJour(date);
    const apresCible = apres.circulations.find((c) => c.numero === cible.numero);
    expect(apresCible?.sans_voyageurs).toBe(true);
    expect(apresCible?.facultatif_actif).toBe(true);
  });

  it('saveCirculations sur une liste vide n’écrit rien et ne notifie personne', async () => {
    const provider = new MockProvider();
    let notifications = 0;
    const stop = provider.onChange(() => (notifications += 1));
    await provider.saveCirculations([]);
    stop();
    expect(notifications).toBe(0);
  });
});

describe('Écrans pré-déclarés (correctifs Security Advisors)', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('un écran NON déclaré ne s’inscrit pas tout seul et le dit', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await expect(
      provider.heartbeat({ id: 'pirate-1', gare: 'le-fayet', type: 'ecran' }),
    ).rejects.toThrow(/non déclaré/);
    expect(await provider.listEcrans()).toHaveLength(0);
  });

  it('une fois déclaré, le même écran met à jour sa dernière vue', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'bellevue-ecran-1', gare: 'bellevue', type: 'ecran' });
    const avant = (await provider.listEcrans())[0];
    expect(avant?.derniere_vue).toBeFalsy(); // déclaré, pas encore vu

    await provider.heartbeat({ id: 'bellevue-ecran-1', gare: 'bellevue', type: 'ecran' });
    const apres = (await provider.listEcrans())[0];
    expect(apres?.derniere_vue).toBeTruthy();
    expect(apres?.gare).toBe('bellevue');
  });

  it('une déclaration en double est refusée', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'motivon-ecran-1', gare: 'motivon', type: 'ecran' });
    await expect(
      provider.declareEcran({ id: 'motivon-ecran-1', gare: 'motivon', type: 'ecran' }),
    ).rejects.toThrow(/déjà déclaré/);
  });

  it('le signal de vie ne touche PAS l’ordre de rechargement ni l’identité du poste', async () => {
    // Reflet applicatif des GRANT de colonnes : anon n'a la main que sur
    // derniere_vue / donnees_maj / date_affichee / version_app / reseau.
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'voza-ecran-1', gare: 'col-de-voza', type: 'ecran' });
    await provider.demanderRechargement('voza-ecran-1');
    const ordre = (await provider.listEcrans())[0]?.recharger_demande_at;
    expect(ordre).toBeTruthy();

    // Un écran qui tenterait de se réattribuer une autre gare/type échoue :
    // ces champs viennent de la déclaration, pas du battement.
    await provider.heartbeat({ id: 'voza-ecran-1', gare: 'le-fayet', type: 'grille' });
    const apres = (await provider.listEcrans())[0];
    expect(apres?.gare).toBe('col-de-voza');
    expect(apres?.type).toBe('ecran');
    // …et l'ordre de rechargement est intact : l'écran ne peut pas l'effacer.
    expect(apres?.recharger_demande_at).toBe(ordre);
  });

  it('un écran oublié ne réapparaît pas de lui-même', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'nid-daigle-ecran-1', gare: 'nid-daigle', type: 'ecran' });
    await provider.oublierEcran('nid-daigle-ecran-1');
    await expect(
      provider.heartbeat({ id: 'nid-daigle-ecran-1', gare: 'nid-daigle', type: 'ecran' }),
    ).rejects.toThrow(/non déclaré/);
    expect(await provider.listEcrans()).toHaveLength(0);
  });
});

describe('Veille propre à un écran et heure du relevé météo', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('un écran neuf suit le réglage global : le signal de vie ne renvoie rien', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'bellevue-ecran-1', gare: 'bellevue', type: 'ecran' });
    const veille = await provider.heartbeat({
      id: 'bellevue-ecran-1',
      gare: 'bellevue',
      type: 'ecran',
    });
    expect(veille).toBeNull();
  });

  it('une veille propre est rendue au poste par son signal de vie', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'bellevue-ecran-1', gare: 'bellevue', type: 'ecran' });
    await provider.saveVeilleEcran('bellevue-ecran-1', '19:00', '06:30');

    const veille = await provider.heartbeat({
      id: 'bellevue-ecran-1',
      gare: 'bellevue',
      type: 'ecran',
    });
    expect(veille).toEqual({ debut: '19:00', fin: '06:30' });
    // …et les autres postes ne sont pas touchés
    await provider.declareEcran({ id: 'motivon-ecran-1', gare: 'motivon', type: 'ecran' });
    expect(
      await provider.heartbeat({ id: 'motivon-ecran-1', gare: 'motivon', type: 'ecran' }),
    ).toBeNull();
  });

  it('le retour au réglage global efface les deux bornes', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'voza-ecran-1', gare: 'col-de-voza', type: 'ecran' });
    await provider.saveVeilleEcran('voza-ecran-1', '19:00', '06:30');
    await provider.saveVeilleEcran('voza-ecran-1', null, null);
    const ecran = (await provider.listEcrans())[0];
    expect(ecran?.veille_debut).toBeNull();
    expect(ecran?.veille_fin).toBeNull();
  });

  it('la veille d’un écran inconnu échoue bruyamment', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await expect(provider.saveVeilleEcran('fantome-1', '19:00', '06:30')).rejects.toThrow(
      /inconnu/,
    );
  });

  it('l’heure du relevé météo est enregistrée et relue', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.saveParams({
      meteo_sommet: { t: -3, ciel_fr: 'Neige', ciel_en: 'Snow', heure_releve: '09:15' },
    });
    const params = await provider.getParams();
    expect(params.meteo_sommet).toMatchObject({ t: -3, heure_releve: '09:15' });
  });
});

describe('Journal d’exploitation : trace permanente de chaque écriture', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  it('8 → 12 → 8 : DEUX écritures au journal, même si l’écart net est nul', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const meteo = (t: number) => ({
      meteo_sommet: { t, ciel_fr: 'Dégagé', ciel_en: 'Clear', heure_releve: '08:00' },
    });
    await provider.saveParams(meteo(12));
    await provider.saveParams(meteo(8));

    const journal = await provider.listJournal({});
    const surT = journal.filter((e) => e.cle === 'meteo_sommet' && e.champ === 't');
    expect(surT).toHaveLength(2);
    // Antéchronologique : le retour à 8 en premier
    expect(surT[0]).toMatchObject({ avant: '12', apres: '8' });
    expect(surT[1]).toMatchObject({ avant: '9', apres: '12' }); // 9 = valeur de démo
  });

  it('un retard posé puis retiré laisse deux entrées', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const date = '2026-08-25';
    const jour = await provider.getJour(date);
    const t5 = jour.circulations.find((c) => c.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent');

    await provider.saveCirculation({ ...t5, statut: 'retard', retard_min: 10 });
    await provider.saveCirculation({ ...t5, statut: 'ok', retard_min: 0 });

    const surStatut = (await provider.listJournal({})).filter((e) => e.champ === 'statut');
    expect(surStatut).toHaveLength(2);
    expect(surStatut[0]).toMatchObject({ avant: 'retard', apres: 'ok', cle: '2026-08-25 5' });
    expect(surStatut[1]).toMatchObject({ avant: 'ok', apres: 'retard' });
    // La journée d'exploitation concernée est renseignée
    expect(surStatut[0]?.date_service).toBe(date);
  });

  it('une seule ligne par CHAMP réellement modifié', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    const jour = await provider.getJour('2026-08-25');
    const t5 = jour.circulations.find((c) => c.numero === 5);
    if (!t5) throw new Error('TRAIN 5 absent');

    await provider.saveCirculation({ ...t5, statut: 'retard', retard_min: 10, motif: 'Météo' });
    const journal = await provider.listJournal({});
    expect(journal.map((e) => e.champ).sort()).toEqual(['motif', 'retard_min', 'statut']);

    // Réécrire la MÊME valeur n'ajoute rien
    await provider.saveCirculation({ ...t5, statut: 'retard', retard_min: 10, motif: 'Météo' });
    expect(await provider.listJournal({})).toHaveLength(3);
  });

  it('un signal de vie n’écrit RIEN au journal', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'le-fayet-ecran-1', gare: 'le-fayet', type: 'ecran' });
    const apresDeclaration = (await provider.listJournal({})).length;
    expect(apresDeclaration).toBeGreaterThan(0); // la déclaration, elle, est tracée

    for (let i = 0; i < 5; i += 1) {
      await provider.heartbeat({
        id: 'le-fayet-ecran-1',
        gare: 'le-fayet',
        type: 'ecran',
        donnees_maj: new Date().toISOString(),
        date_affichee: '2026-08-25',
      });
    }
    expect(await provider.listJournal({})).toHaveLength(apresDeclaration);
  });

  it('la veille propre à un écran est tracée, pas sa dernière vue', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.declareEcran({ id: 'bellevue-ecran-1', gare: 'bellevue', type: 'ecran' });
    await provider.saveVeilleEcran('bellevue-ecran-1', '19:00', '06:30');
    const champs = (await provider.listJournal({ table_cible: 'ecrans' })).map((e) => e.champ);
    expect(champs).toContain('veille_debut');
    expect(champs).toContain('veille_fin');
    expect(champs).not.toContain('derniere_vue');
    expect(champs).not.toContain('donnees_maj');
  });

  it('les filtres et la pagination fonctionnent', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.saveMotif({ fr: 'Vent', en: 'Wind' });
    await provider.saveMachine({ nom: 'Marie', couleur: '#000000', en_service: true });

    // Création : le déclencheur consigne chaque champ renseigné (OLD est vide)
    const surMotifs = await provider.listJournal({ table_cible: 'motifs' });
    expect(surMotifs.map((e) => e.champ).sort()).toEqual(['en', 'fr']);
    expect(await provider.listJournal({ table_cible: 'machines' })).not.toHaveLength(0);
    expect(await provider.listJournal({ table_cible: 'messages' })).toHaveLength(0);
    // Pagination : une page d'une seule ligne
    const page1 = await provider.listJournal({ limite: 1, depuis: 0 });
    expect((await provider.listJournal({})).length).toBeGreaterThan(1);
    const page2 = await provider.listJournal({ limite: 1, depuis: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it('une publication ne touche pas au journal des écritures', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-08-25' });
    await provider.saveMotif({ fr: 'Vent', en: 'Wind' });
    const avant = (await provider.listJournal({})).length;
    await provider.logPublication('1 modification(s) : motif Vent — → Wind');
    expect(await provider.listJournal({})).toHaveLength(avant);
    expect(await provider.dernierePublication()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Grilles en base (chantier import des horaires, étape 1) : le mock se
// comporte comme la table `grilles` — versions jamais réécrites, la plus
// récente l'emporte, désactiver = retour arrière, tout est journalisé.
// ---------------------------------------------------------------------------
describe('MockProvider — grilles : import, activation, retour arrière', () => {
  beforeEach(() => {
    stockage.clear();
    sessionStockage.clear();
  });

  const GRAND = grandServiceJson as unknown as Grille;
  const PETIT = petitServiceJson as unknown as Grille;

  it('listGrilles renvoie les deux grilles de référence, actives et datées du document', async () => {
    const provider = new MockProvider();
    const grilles = await provider.listGrilles();
    expect(grilles.map((g) => g.version)).toEqual([
      '2026-ete-grand-service',
      '2026-ete-petit-service',
    ]);
    expect(grilles.every((g) => g.actif === true && typeof g.cree_le === 'string')).toBe(true);
    expect(await provider.getGrilles()).toHaveLength(2);
  });

  it('saveGrille : une grille plus récente l’emporte sur ses dates ; la désactiver redonne la main', async () => {
    const provider = new MockProvider();
    await provider.signIn('admin@demo', 'x');
    const v2: Grille = {
      ...GRAND,
      version: '2026-ete-grand-service-v2',
      libelle: 'Grand service — été 2026 (v2)',
    };
    await provider.saveGrille(v2, { commentaire: 'heures corrigées' });

    expect((await provider.getJour('2026-07-15')).grille_version).toBe('2026-ete-grand-service-v2');
    expect((await provider.listGrilles()).find((g) => g.version === v2.version)).toMatchObject({
      actif: true,
      cree_par: 'admin@demo',
      commentaire: 'heures corrigées',
    });

    await provider.setGrilleActive(v2.version, false);
    expect((await provider.getJour('2026-07-15')).grille_version).toBe('2026-ete-grand-service');
    expect((await provider.getGrilles()).map((g) => g.version)).not.toContain(v2.version);
    expect((await provider.listGrilles()).find((g) => g.version === v2.version)?.actif).toBe(false);

    await provider.setGrilleActive(v2.version, true);
    expect((await provider.getJour('2026-07-15')).grille_version).toBe('2026-ete-grand-service-v2');
  });

  it('une version existante n’est jamais écrasée', async () => {
    const provider = new MockProvider();
    await expect(provider.saveGrille(GRAND)).rejects.toThrow(/existe déjà/);
    expect(await provider.listGrilles()).toHaveLength(2);
  });

  it('désactiver une grille sans remplaçante : hors saison, jamais de repli sur une autre grille', async () => {
    const provider = new MockProvider();
    await provider.setGrilleActive('2026-ete-petit-service', false);
    expect((await provider.getJour('2026-06-20')).hors_saison).toBe(true);
    expect((await provider.getJour('2026-07-15')).hors_saison).toBeUndefined();
    await provider.setGrilleActive('2026-ete-petit-service', true);
    expect((await provider.getJour('2026-06-20')).hors_saison).toBeUndefined();
  });

  it('une grille enregistrée inactive n’a aucun effet tant qu’elle n’est pas activée', async () => {
    const provider = new MockProvider();
    await provider.saveGrille({ ...PETIT, version: 'petit-v2' }, { actif: false });
    expect((await provider.getJour('2026-06-20')).grille_version).toBe('2026-ete-petit-service');
    await provider.setGrilleActive('petit-v2', true);
    expect((await provider.getJour('2026-06-20')).grille_version).toBe('petit-v2');
  });

  it('listJoursGeneres ne renvoie que les journées existantes de la plage, triées', async () => {
    const provider = new MockProvider({ aujourdhui: '2026-07-01' });
    await provider.genererJour('2026-07-20');
    await provider.genererJour('2026-07-10');
    await provider.genererJour('2026-08-05');
    expect(await provider.listJoursGeneres('2026-07-01', '2026-07-31')).toEqual([
      '2026-07-10',
      '2026-07-20',
    ]);
    expect(await provider.listJoursGeneres('2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('import et activation laissent une trace au journal d’exploitation, jamais le contenu', async () => {
    const provider = new MockProvider();
    await provider.signIn('admin@demo', 'x');
    await provider.saveGrille({ ...PETIT, version: 'petit-v3' });
    await provider.setGrilleActive('petit-v3', false);
    const journal = await provider.listJournal({ table_cible: 'grilles' });
    expect(journal.map((e) => e.champ).sort()).toEqual(['actif', 'actif', 'libelle', 'periodes']);
    expect(
      journal.some(
        (e) =>
          e.cle === 'petit-v3' && e.champ === 'actif' && e.avant === 'true' && e.apres === 'false',
      ),
    ).toBe(true);
    expect(journal.every((e) => e.qui === 'admin@demo')).toBe(true);
  });
});
