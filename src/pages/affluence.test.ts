// Affluence — la JOINTURE (date, numéro) entre les passages et la table.
//
// CE QUE CES TESTS PROTÈGENT. Le remplissage est un axe INDÉPENDANT de la
// ponctualité, porté par une table à part et par une main à part (le guichet).
// Ce qui peut se casser en silence, c'est la jointure : elle ne regarde que le
// NUMÉRO de train, parce qu'un TRAIN 9 complet l'est dans toutes les gares
// qu'il doit encore desservir. Une jointure par gare passerait tous les tests
// d'une seule gare et se verrait le jour où l'agent regarde l'écran suivant.
//
// Le fournisseur de démonstration est éprouvé dans src/data/mock.test.ts, qui
// porte déjà l'environnement navigateur minimal dont il a besoin.
//
// Non prouvé ici : le rendu (mesuré au navigateur, chiffres dans la PR) et le
// refus de la base (recette supabase/tests/roles-rls.sql).
import { describe, expect, it } from 'vitest';

import { appliqueAffluence } from './affichage-commun';
import type { Affluence, PassageGare } from '../core/types';

function passage(numero: number, reste: Partial<PassageGare> = {}): PassageGare {
  return {
    numero,
    sens: numero % 2 === 1 ? 'montee' : 'descente',
    express: false,
    velos: false,
    rame: 'Marie',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    origine: 'le-fayet',
    destination: 'nid-daigle',
    terminusExceptionnel: false,
    supplementaire: false,
    departConfirme: false,
    arrivee_s: null,
    depart_s: 36000,
    arrivee_theorique_s: null,
    depart_theorique_s: 36000,
    ...reste,
  };
}

const AFF = (numero: number, niveau: Affluence['niveau']): Affluence => ({
  date: '2026-07-15',
  numero,
  niveau,
});

describe('appliqueAffluence — la jointure par numéro de train', () => {
  it('recopie le niveau sur le train déclaré, et sur lui seul', () => {
    const rendu = appliqueAffluence([passage(9), passage(11)], [AFF(9, 'complet')]);
    expect(rendu[0]?.affluence).toBe('complet');
    expect(rendu[1]?.affluence).toBe(null);
  });

  it('un train NON déclaré vaut « places disponibles », jamais `undefined`', () => {
    // L'absence de ligne est le cas normal : elle doit produire une valeur
    // franche, pas un trou que l'appelant devra retester.
    const rendu = appliqueAffluence([passage(3)], []);
    expect(rendu[0]?.affluence).toBe(null);
    expect(rendu[0]).toHaveProperty('affluence');
  });

  it('une déclaration sans train correspondant ne casse rien', () => {
    // Le train peut avoir été supprimé de la journée après la déclaration.
    expect(() => appliqueAffluence([passage(3)], [AFF(99, 'complet')])).not.toThrow();
    expect(appliqueAffluence([passage(3)], [AFF(99, 'complet')])[0]?.affluence).toBe(null);
  });

  it('une DESCENTE se déclare comme une montée', () => {
    // Une descente peut être complète : rien dans la jointure ne doit
    // distinguer les deux sens.
    const rendu = appliqueAffluence([passage(10)], [AFF(10, 'limite')]);
    expect(rendu[0]?.sens).toBe('descente');
    expect(rendu[0]?.affluence).toBe('limite');
  });

  it('un niveau INCONNU est ignoré, pas recopié', () => {
    // Base plus récente que le déploiement : mieux vaut une pastille absente
    // qu'une classe CSS inventée dans un attribut `class`.
    const exotique = { date: '2026-07-15', numero: 9, niveau: 'bonde' } as unknown as Affluence;
    expect(appliqueAffluence([passage(9)], [exotique])[0]?.affluence).toBe(null);
  });

  it('ne MUTE pas les passages reçus : le moteur garde les siens intacts', () => {
    const origine = [passage(9)];
    const rendu = appliqueAffluence(origine, [AFF(9, 'complet')]);
    expect(origine[0]?.affluence).toBeUndefined();
    expect(rendu[0]).not.toBe(origine[0]);
  });

  it('la gare n’entre pas dans la jointure', () => {
    // Deux passages du MÊME train, vus depuis deux gares différentes : les
    // deux portent la pastille. C'est le cœur de « par train, pas par gare ».
    const rendu = appliqueAffluence(
      [passage(9, { origine: 'le-fayet' }), passage(9, { origine: 'motivon' })],
      [AFF(9, 'complet')],
    );
    expect(rendu.map((p) => p.affluence)).toEqual(['complet', 'complet']);
  });
});
