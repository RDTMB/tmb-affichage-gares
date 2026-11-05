// SupabaseProvider — suppression d'une grille et cache de contenu.
//
// Le fournisseur réel est EXÉCUTÉ (pas lu comme du texte) sur un faux client en
// mémoire qui note chaque requête : ce que le code demande à la base est ce
// qu'on vérifie. Ce que ce test ne peut pas prouver — que la base accepte ou
// refuse réellement le delete selon le rôle — l'est par la recette RLS
// (supabase/tests/roles-rls.sql), jouée sur la base de TEST.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import type { Grille } from '../core/types';
import { SupabaseProvider } from './supabase';

interface LigneGrille {
  version: string;
  libelle: string;
  actif: boolean;
  cree_le: string;
  contenu: unknown;
  periodes: unknown;
  source: string | null;
  cree_par: string | null;
  commentaire: string | null;
}
interface LigneJour {
  date: string;
  grille_version: string;
}
interface Requete {
  table: string;
  op: 'select' | 'delete';
  colonnes: string;
  filtres: string[];
}

const GRAND = grandServiceJson as unknown as Grille;

/** Un contenu reconnaissable : le nombre de montées dit lequel est servi. */
function contenu(montees: number): unknown {
  return { ...GRAND, montees: GRAND.montees.slice(0, montees) };
}

function ligne(version: string, creeLe: string, montees: number, actif = false): LigneGrille {
  return {
    version,
    libelle: GRAND.libelle,
    actif,
    cree_le: creeLe,
    contenu: contenu(montees),
    periodes: GRAND.periodes,
    source: null,
    cree_par: null,
    commentaire: null,
  };
}

/** Faux client PostgREST : eq / in / gte / order / select / delete / maybeSingle sur deux tables. */
function fauxClient(etat: {
  grilles: LigneGrille[];
  jours: LigneJour[];
  droitDeSupprimer: boolean;
}) {
  const requetes: Requete[] = [];
  function table(nom: 'grilles' | 'jours') {
    const lignes = (): Record<string, unknown>[] =>
      (nom === 'grilles' ? etat.grilles : etat.jours) as unknown as Record<string, unknown>[];
    function constructeur(op: 'select' | 'delete', colonnes: string) {
      const req: Requete = { table: nom, op, colonnes, filtres: [] };
      requetes.push(req);
      const tests: ((l: Record<string, unknown>) => boolean)[] = [];
      let retour = op === 'select';
      let tri: string | null = null;
      const executer = () => {
        let sel = lignes().filter((l) => tests.every((t) => t(l)));
        if (op === 'delete') {
          // RLS : une politique qui refuse FILTRE, elle ne lève pas.
          if (!etat.droitDeSupprimer) sel = [];
          const supprimees = new Set(sel);
          if (nom === 'grilles')
            etat.grilles = etat.grilles.filter((l) => !supprimees.has(l as never));
        }
        if (tri) sel = [...sel].sort((a, b) => String(a[tri!]).localeCompare(String(b[tri!])));
        const cols = (req.colonnes || '*').split(',').map((c) => c.trim());
        const projetees = retour
          ? sel.map((l) =>
              cols[0] === '*' ? l : Object.fromEntries(cols.map((c) => [c, l[c]] as const)),
            )
          : [];
        return { data: retour ? projetees : null, error: null };
      };
      const b = {
        eq(col: string, v: unknown) {
          req.filtres.push(`${col}=${String(v)}`);
          tests.push((l) => l[col] === v);
          return b;
        },
        in(col: string, vs: unknown[]) {
          req.filtres.push(`${col} in ${vs.join('|')}`);
          tests.push((l) => vs.includes(l[col]));
          return b;
        },
        gte(col: string, v: string) {
          req.filtres.push(`${col}>=${v}`);
          tests.push((l) => String(l[col]) >= v);
          return b;
        },
        order(col: string) {
          tri = col;
          return b;
        },
        select(cols?: string) {
          retour = true;
          if (cols !== undefined) req.colonnes = cols;
          return b;
        },
        maybeSingle() {
          const r = executer();
          return Promise.resolve({ data: r.data?.[0] ?? null, error: null });
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(executer()).then(res, rej);
        },
      };
      return b;
    }
    return {
      select: (cols: string) => constructeur('select', cols),
      delete: () => constructeur('delete', ''),
    };
  }
  return { client: { from: (nom: 'grilles' | 'jours') => table(nom) }, requetes };
}

function montage(
  grilles: LigneGrille[],
  jours: LigneJour[] = [],
  maintenant = '2026-11-05T10:00:00Z',
  droitDeSupprimer = true,
) {
  const etat = { grilles, jours, droitDeSupprimer };
  const { client, requetes } = fauxClient(etat);
  const provider = new SupabaseProvider(
    'https://exemple.supabase.co',
    'sb_publishable_essai',
    true,
  );
  const interne = provider as unknown as {
    client: unknown;
    maintenant: () => Date;
    contenus: Map<string, unknown>;
    grilles: unknown;
  };
  interne.client = client;
  interne.maintenant = () => new Date(maintenant);
  return {
    provider,
    etat,
    requetes,
    contenus: () => interne.contenus,
    /** Le signal de changement (realtime / sondage 30 s) : la liste mémorisée est oubliée. */
    signalDeChangement: () => {
      interne.grilles = null;
    },
  };
}

const lectureContenu = (r: Requete): boolean =>
  r.table === 'grilles' && r.op === 'select' && r.colonnes.includes('contenu');

describe('cache de contenu : clé = version ET cree_le', () => {
  it('en régime normal, le contenu n’est lu QU’UNE fois : aucune requête de plus au 2ᵉ passage', async () => {
    const { provider, requetes } = montage([ligne('g', '2026-06-05T08:00:00+00:00', 3, true)]);
    expect((await provider.listGrilles())[0]?.montees).toHaveLength(3);
    expect(requetes.filter(lectureContenu)).toHaveLength(1);
    await provider.listGrilles();
    await provider.listGrilles();
    expect(requetes.filter(lectureContenu)).toHaveLength(1);
  });

  it('charger → supprimer → recréer la MÊME référence avec un autre contenu → relire : le NOUVEAU est servi', async () => {
    const { provider, etat, requetes } = montage([ligne('g', '2026-06-05T08:00:00+00:00', 3)]);
    expect((await provider.listGrilles())[0]?.montees).toHaveLength(3);

    await provider.supprimerGrille('g');
    expect(etat.grilles).toHaveLength(0);
    // Recréation, sous la MÊME référence, par un autre geste (autre date de création).
    etat.grilles.push(ligne('g', '2026-11-05T09:30:00+00:00', 1));

    const relue = await provider.listGrilles();
    expect(relue).toHaveLength(1);
    expect(relue[0]?.montees).toHaveLength(1);
    expect(requetes.filter(lectureContenu)).toHaveLength(2);
  });

  it('même chose quand la suppression et la recréation viennent d’un AUTRE poste (écran resté ouvert)', async () => {
    const { provider, etat, signalDeChangement } = montage([
      ligne('g', '2026-06-05T08:00:00+00:00', 3, true),
    ]);
    expect((await provider.getGrilles())[0]?.montees).toHaveLength(3);
    // Un autre poste supprime puis recrée : notre fournisseur n'en sait rien.
    etat.grilles = [ligne('g', '2026-11-05T09:30:00+00:00', 2, true)];
    signalDeChangement();
    expect((await provider.getGrilles())[0]?.montees).toHaveLength(2);
  });

  it('une date de création identique garde le contenu en mémoire (pas de relecture inutile)', async () => {
    const { provider, requetes } = montage([ligne('g', '2026-06-05T08:00:00+00:00', 3, true)]);
    await provider.getGrilles();
    await provider.getGrilles();
    expect(requetes.filter(lectureContenu)).toHaveLength(1);
  });

  it('seule la version qui a changé est relue, pas les autres', async () => {
    const { provider, etat, requetes, signalDeChangement } = montage([
      ligne('a', '2026-06-05T08:00:00+00:00', 3, true),
      ligne('b', '2026-06-06T08:00:00+00:00', 2, true),
    ]);
    await provider.getGrilles();
    etat.grilles[1] = ligne('b', '2026-11-05T09:00:00+00:00', 1, true);
    signalDeChangement();
    await provider.getGrilles();
    const relectures = requetes.filter(lectureContenu);
    expect(relectures).toHaveLength(2);
    expect(relectures[1]?.filtres).toEqual(['version in b']);
  });

  it('une lecture COMPLÈTE retire du cache les versions qui n’existent plus', async () => {
    const { provider, etat, contenus } = montage([
      ligne('a', '2026-06-05T08:00:00+00:00', 3),
      ligne('b', '2026-06-06T08:00:00+00:00', 2),
    ]);
    await provider.listGrilles();
    expect([...contenus().keys()].sort()).toEqual(['a', 'b']);
    etat.grilles = etat.grilles.filter((l) => l.version !== 'b');
    await provider.listGrilles();
    expect([...contenus().keys()]).toEqual(['a']);
  });

  it('une lecture des grilles ACTIVES ne purge pas les désactivées (pas de va-et-vient coûteux)', async () => {
    const { provider, contenus, requetes } = montage([
      ligne('a', '2026-06-05T08:00:00+00:00', 3, true),
      ligne('b', '2026-06-06T08:00:00+00:00', 2, false),
    ]);
    await provider.listGrilles();
    await provider.getGrilles();
    expect(contenus().has('b')).toBe(true);
    await provider.listGrilles();
    expect(requetes.filter(lectureContenu)).toHaveLength(1);
  });
});

describe('supprimerGrille — les deux garde-fous, tenus par le fournisseur', () => {
  const nbDelete = (r: Requete[]): number => r.filter((x) => x.op === 'delete').length;

  it('garde-fou 1 : une grille ACTIVE est refusée, SANS aucune écriture', async () => {
    const { provider, requetes, etat } = montage([ligne('g', '2026-06-05T08:00:00Z', 3, true)]);
    await expect(provider.supprimerGrille('g')).rejects.toThrow(
      'La grille « Grand service — été 2026 » est active : désactivez-la avant de la supprimer.',
    );
    expect(nbDelete(requetes)).toBe(0);
    expect(etat.grilles).toHaveLength(1);
  });

  it('une grille inconnue est refusée', async () => {
    const { provider, requetes } = montage([]);
    await expect(provider.supprimerGrille('x')).rejects.toThrow(/introuvable/);
    expect(nbDelete(requetes)).toBe(0);
  });

  it('garde-fou 2 : une journée d’aujourd’hui ou à venir bloque, SANS écriture, dates listées', async () => {
    const { provider, requetes } = montage(
      [ligne('g', '2026-06-05T08:00:00Z', 3)],
      [
        { date: '2026-11-05', grille_version: 'g' },
        { date: '2026-11-07', grille_version: 'g' },
        { date: '2026-11-06', grille_version: 'autre' },
      ],
    );
    await expect(provider.supprimerGrille('g')).rejects.toThrow(
      /2 journées d'aujourd'hui ou à venir \(05\/11\/2026, 07\/11\/2026\)/,
    );
    expect(nbDelete(requetes)).toBe(0);
  });

  it('la date d’AUJOURD’HUI compte, celle d’HIER non', async () => {
    const jours = [{ date: '2026-11-05', grille_version: 'g' }];
    const aujourdhui = montage(
      [ligne('g', '2026-06-05T08:00:00Z', 3)],
      jours,
      '2026-11-05T10:00:00Z',
    );
    await expect(aujourdhui.provider.supprimerGrille('g')).rejects.toThrow(/05\/11\/2026/);
    const lendemain = montage(
      [ligne('g', '2026-06-05T08:00:00Z', 3)],
      jours,
      '2026-11-06T10:00:00Z',
    );
    await lendemain.provider.supprimerGrille('g');
    expect(lendemain.etat.grilles).toHaveLength(0);
  });

  it('le jour se lit à PARIS : à 22:59 UTC (23:59 l’hiver) le 5 bloque ; à 23:00 UTC (minuit) il ne bloque plus', async () => {
    const jours = [{ date: '2026-11-05', grille_version: 'g' }];
    const avant = montage([ligne('g', '2026-06-05T08:00:00Z', 3)], jours, '2026-11-05T22:59:59Z');
    await expect(avant.provider.supprimerGrille('g')).rejects.toThrow(/05\/11\/2026/);
    const apres = montage([ligne('g', '2026-06-05T08:00:00Z', 3)], jours, '2026-11-05T23:00:00Z');
    await apres.provider.supprimerGrille('g');
    // La requête de lecture a bien demandé « à partir du 6 » (jour de Paris), pas du 5 (UTC).
    const lecture = apres.requetes.find((r) => r.table === 'jours');
    expect(lecture?.filtres).toContain('date>=2026-11-06');
    expect(lecture?.filtres).toContain('grille_version=g');
  });

  it('désactivée et libre : le delete est écrit AVEC la condition « désactivée » (ferme la course)', async () => {
    const { provider, requetes, etat } = montage([ligne('g', '2026-06-05T08:00:00Z', 3)]);
    await provider.supprimerGrille('g');
    expect(etat.grilles).toHaveLength(0);
    const del = requetes.find((r) => r.op === 'delete');
    expect(del?.filtres).toEqual(['version=g', 'actif=false']);
  });

  it('RLS : un delete filtré (0 ligne) n’est PAS pris pour un succès', async () => {
    const { provider, etat } = montage(
      [ligne('g', '2026-06-05T08:00:00Z', 3)],
      [],
      undefined,
      false,
    );
    await expect(provider.supprimerGrille('g')).rejects.toThrow(
      /Modification non enregistrée — .*suppression non autorisée pour vos rôles/,
    );
    expect(etat.grilles).toHaveLength(1);
  });

  it('après une suppression, la liste mémorisée est invalidée', async () => {
    const { provider } = montage([
      ligne('a', '2026-06-05T08:00:00Z', 3, true),
      ligne('b', '2026-06-06T08:00:00Z', 2, false),
    ]);
    expect(await provider.listGrilles()).toHaveLength(2);
    await provider.getGrilles();
    await provider.supprimerGrille('b');
    expect((await provider.getGrilles()).map((g) => g.version)).toEqual(['a']);
    expect((await provider.listGrilles()).map((g) => g.version)).toEqual(['a']);
  });
});

describe('supprimerGrilleRemplacee — le chemin de la correction', () => {
  it('retire l’ancienne ACTIVE, même référencée par une journée à venir, quand le successeur est actif, de même nom et plus récent', async () => {
    const { provider, etat } = montage(
      [
        ligne('g', '2026-06-05T08:00:00+00:00', 3, true),
        ligne('g-v2', '2026-11-05T09:00:00+00:00', 2, true),
      ],
      [{ date: '2026-11-07', grille_version: 'g' }],
    );
    await provider.supprimerGrilleRemplacee('g', 'g-v2');
    expect(etat.grilles.map((l) => l.version)).toEqual(['g-v2']);
  });

  it('refuse un successeur désactivé, absent, d’un autre nom ou plus ancien : rien n’est supprimé', async () => {
    const base = [ligne('g', '2026-06-05T08:00:00+00:00', 3, true)];
    const cas: [string, LigneGrille | null, RegExp][] = [
      ['désactivé', ligne('g-v2', '2026-11-05T09:00:00+00:00', 2, false), /pas active/],
      ['absent', null, /pas active/],
      [
        'autre nom',
        { ...ligne('g-v2', '2026-11-05T09:00:00+00:00', 2, true), libelle: 'Petit' },
        /autre nom/,
      ],
      ['plus ancien', ligne('g-v2', '2026-01-01T00:00:00+00:00', 2, true), /plus récente/],
    ];
    for (const [nom, successeur, motif] of cas) {
      const { provider, etat } = montage(successeur ? [...base, successeur] : base);
      await expect(provider.supprimerGrilleRemplacee('g', 'g-v2'), nom).rejects.toThrow(motif);
      expect(
        etat.grilles.some((l) => l.version === 'g'),
        nom,
      ).toBe(true);
    }
  });

  it('RLS : un delete filtré lève, la correction le rapporte à l’agent', async () => {
    const { provider } = montage(
      [
        ligne('g', '2026-06-05T08:00:00+00:00', 3, true),
        ligne('g-v2', '2026-11-05T09:00:00+00:00', 2, true),
      ],
      [],
      undefined,
      false,
    );
    await expect(provider.supprimerGrilleRemplacee('g', 'g-v2')).rejects.toThrow(
      /suppression non autorisée pour vos rôles/,
    );
  });
});
