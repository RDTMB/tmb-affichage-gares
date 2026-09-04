// BUG de production du 04/09/2026 : modifier un train supplémentaire déjà
// enregistré (sa rame, par exemple) échouait SYSTÉMATIQUEMENT avec
// « Publication incomplète — resté(e) en attente : circulations du <date> ».
//
// Le tri de publier() se faisait sur `c.supplementaire && c.sens === 'montee'`,
// qui ne distingue pas une création d'une modification. Une montée sup
// modifiée partait donc vers `creerTrainSup()`, qui exige sa descente dans le
// même brouillon — or la rame est portée par la MONTÉE seule, et c'est le cas
// normal. La nouveauté se MARQUE désormais, elle ne se devine plus.
import { describe, expect, it } from 'vitest';

import type { Circulation, PassageGrille } from '../core/types';
import { routageCirculations } from './supervision-logique';

const DATE = '2026-09-04';

function circulation(partiel: Partial<Circulation> = {}): Circulation {
  return {
    date: DATE,
    numero: 1,
    sens: 'montee',
    express: false,
    facultatif: false,
    facultatif_actif: false,
    velos: false,
    rame: 'Marie',
    terminus: 'nid-daigle',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    sans_voyageurs: false,
    supplementaire: false,
    ...partiel,
  };
}

const PASSAGES_MONTEE: PassageGrille[] = [
  { gare: 'le-fayet', d: '11:20:00' },
  { gare: 'col-de-voza', a: '12:00:00' },
];
const PASSAGES_DESCENTE: PassageGrille[] = [
  { gare: 'col-de-voza', d: '12:05:00' },
  { gare: 'le-fayet', a: '12:44:00' },
];

/** La rotation supplémentaire 101/102, telle que le formulaire la met en attente. */
function rotationSup(): { montee: Circulation; descente: Circulation } {
  return {
    montee: circulation({ numero: 101, supplementaire: true, passages: PASSAGES_MONTEE }),
    descente: circulation({
      numero: 102,
      sens: 'descente',
      supplementaire: true,
      passages: PASSAGES_DESCENTE,
    }),
  };
}

const numeros = (liste: readonly Circulation[]): number[] => liste.map((c) => c.numero);

// ---------------------------------------------------------------------------

describe('Création d’un train supplémentaire', () => {
  it('montée MARQUÉE neuve + sa descente → une création, aucune mise à jour', () => {
    const { montee, descente } = rotationSup();
    const r = routageCirculations([montee, descente], new Set([101]));
    expect(r.creations).toHaveLength(1);
    expect(r.creations[0]?.montee.numero).toBe(101);
    expect(r.creations[0]?.descente.numero).toBe(102);
    expect(r.misesAJour).toEqual([]);
  });

  it('la rotation entière est consommée, quel que soit l’ordre du brouillon', () => {
    const { montee, descente } = rotationSup();
    const r = routageCirculations([descente, montee], new Set([101]));
    expect(r.creations).toHaveLength(1);
    expect(r.misesAJour).toEqual([]);
  });

  it('deux rotations neuves : deux créations appariées', () => {
    const { montee, descente } = rotationSup();
    const m2 = { ...montee, numero: 103 };
    const d2 = { ...descente, numero: 104 };
    const r = routageCirculations([montee, descente, m2, d2], new Set([101, 103]));
    expect(r.creations.map((c) => c.montee.numero)).toEqual([101, 103]);
    expect(r.creations.map((c) => c.descente.numero)).toEqual([102, 104]);
    expect(r.misesAJour).toEqual([]);
  });
});

describe('Modification d’un train supplémentaire DÉJÀ enregistré', () => {
  it('montée seule, non marquée neuve → une mise à jour, aucune création', () => {
    // ← LE CAS QUI ÉCHOUAIT : changer la rame d'un renfort en base ne met en
    // attente que sa montée, et l'ancien tri la routait vers creerTrainSup().
    const { montee } = rotationSup();
    const modifiee = { ...montee, rame: 'Anne' };
    const r = routageCirculations([modifiee], new Set());
    expect(r.creations).toEqual([]);
    expect(numeros(r.misesAJour)).toEqual([101]);
    expect(r.misesAJour[0]?.rame).toBe('Anne');
  });

  it('…et cela ne lève AUCUNE exception', () => {
    const { montee } = rotationSup();
    expect(() => routageCirculations([{ ...montee, rame: 'Anne' }], new Set())).not.toThrow();
    // Sans marque du tout (aucune création en attente pour cette date) non plus.
    expect(() => routageCirculations([{ ...montee, rame: 'Anne' }])).not.toThrow();
  });

  it('la marque d’une AUTRE rotation ne contamine pas celle-ci', () => {
    const { montee } = rotationSup();
    const r = routageCirculations([{ ...montee, rame: 'Anne' }], new Set([201]));
    expect(r.creations).toEqual([]);
    expect(numeros(r.misesAJour)).toEqual([101]);
  });

  it('descente sup seule modifiée → mise à jour', () => {
    const { descente } = rotationSup();
    const r = routageCirculations([{ ...descente, statut: 'supprime' }], new Set());
    expect(r.creations).toEqual([]);
    expect(numeros(r.misesAJour)).toEqual([102]);
  });

  it('les deux lignes modifiées sans marque → deux mises à jour', () => {
    const { montee, descente } = rotationSup();
    const r = routageCirculations([montee, descente], new Set());
    expect(r.creations).toEqual([]);
    expect(numeros(r.misesAJour)).toEqual([101, 102]);
  });

  it('les `passages` sont préservés : saveCirculations upserte l’objet complet', () => {
    const { montee } = rotationSup();
    const r = routageCirculations([{ ...montee, rame: 'Anne' }], new Set());
    expect(r.misesAJour[0]?.passages).toEqual(PASSAGES_MONTEE);
    expect(r.misesAJour[0]?.supplementaire).toBe(true);
  });
});

describe('Mélange création et trains de grille', () => {
  it('chacun part sur sa voie', () => {
    const { montee, descente } = rotationSup();
    const t5 = circulation({ numero: 5, statut: 'retard', retard_min: 10 });
    const t6 = circulation({ numero: 6, sens: 'descente' });
    const r = routageCirculations([t5, montee, descente, t6], new Set([101]));
    expect(r.creations.map((c) => c.montee.numero)).toEqual([101]);
    expect(numeros(r.misesAJour)).toEqual([5, 6]);
  });

  it('un train de GRILLE n’est jamais routé vers une création, même marqué', () => {
    // Garde-fou : la marque ne porte que sur des trains supplémentaires.
    const t5 = circulation({ numero: 5 });
    const t6 = circulation({ numero: 6, sens: 'descente' });
    const r = routageCirculations([t5, t6], new Set([5]));
    expect(r.creations).toEqual([]);
    expect(numeros(r.misesAJour)).toEqual([5, 6]);
  });

  it('un train de grille numéroté juste sous une rotation sup neuve reste une mise à jour', () => {
    // 100 n'est pas 101 − 1 dans une rotation sup : rien ne doit l'absorber.
    const { montee, descente } = rotationSup();
    const cent = circulation({ numero: 100, sens: 'descente' });
    const r = routageCirculations([cent, montee, descente], new Set([101]));
    expect(numeros(r.misesAJour)).toEqual([100]);
  });
});

describe('Incohérence INTERNE : montée marquée neuve sans sa descente', () => {
  it('elle lève, et le message la nomme comme telle', () => {
    const { montee } = rotationSup();
    expect(() => routageCirculations([montee], new Set([101]))).toThrow(/Incohérence interne/);
  });

  it('le message nomme les deux numéros et dit quoi faire', () => {
    const { montee } = rotationSup();
    let message = '';
    try {
      routageCirculations([montee], new Set([101]));
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur);
    }
    expect(message).toContain('101');
    expect(message).toContain('102');
    expect(message).toContain('Rechargez la page');
    // Ce n'est PAS une erreur d'exploitation : le vocabulaire doit le dire.
    expect(message).not.toContain('sans descente appariée');
  });
});

describe('Cas dégénérés', () => {
  it('un brouillon vide ne produit rien', () => {
    expect(routageCirculations([], new Set([101]))).toEqual({ creations: [], misesAJour: [] });
  });

  it('l’entrée n’est jamais mutée', () => {
    const { montee, descente } = rotationSup();
    const entree = [montee, descente];
    const copie = JSON.parse(JSON.stringify(entree));
    routageCirculations(entree, new Set([101]));
    expect(JSON.parse(JSON.stringify(entree))).toEqual(copie);
  });
});
