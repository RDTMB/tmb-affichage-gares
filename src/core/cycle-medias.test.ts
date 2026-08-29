// Cycle d'affichage des médias : les deux modes, et la règle métier qui prime
// sur tout — jamais de média à quai ni dans les 2 min avant un départ.
import { describe, expect, it } from 'vitest';

import { dureeCycleS, etatInitial, prochainEtat } from './cycle-medias';
import type { EtatCycle, ModeMedias } from './cycle-medias';
import type { Media } from './types';

const HORAIRES_S = 20;

function media(id: string, duree_s: number, ordre: number): Media {
  return { id, nom: `${id}.png`, type: 'image', url: `/${id}.png`, duree_s, ordre, actif: true };
}

/** Les trois médias du scénario de l'exploitant : 8 s, 8 s, 12 s. */
const TROIS = [media('a', 8, 10), media('b', 8, 20), media('c', 12, 30)];

/**
 * Déroule le cycle seconde par seconde et rend la suite des vues traversées,
 * sans jamais répéter deux fois la même d'affilée.
 */
function deroule(
  mode: ModeMedias,
  liste: Media[],
  secondes: number,
  departProcheA: (s: number) => boolean = () => false,
): string[] {
  let etat: EtatCycle = etatInitial(HORAIRES_S, 0);
  const vues: string[] = ['horaires'];
  for (let s = 1; s <= secondes; s += 1) {
    etat = prochainEtat(etat, liste, mode, HORAIRES_S, departProcheA(s), s * 1000);
    const vue = etat.vue.vue === 'horaires' ? 'horaires' : `media:${etat.vue.index}`;
    if (vue !== vues[vues.length - 1]) vues.push(vue);
  }
  return vues;
}

describe('Mode alterné : le comportement historique', () => {
  it('horaires → 1 média → horaires → média suivant', () => {
    expect(deroule('alterne', TROIS, 100)).toEqual([
      'horaires', // 0 → 20 s
      'media:0', // 20 → 28 s (8 s)
      'horaires', // 28 → 48 s
      'media:1', // 48 → 56 s (8 s)
      'horaires', // 56 → 76 s
      'media:2', // 76 → 88 s (12 s)
      'horaires', // 88 → 108 s
    ]);
  });

  it('la liste boucle sur le premier média après le dernier', () => {
    // On regarde l'ORDRE des médias traversés, pas la longueur de la trace :
    // 0, 1, 2, puis de nouveau 0 — aucun média n'est sauté ni répété.
    const indices = deroule('alterne', TROIS, 200)
      .filter((v) => v.startsWith('media:'))
      .map((v) => Number(v.slice(6)));
    expect(indices.slice(0, 7)).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('un tour complet dure horaires × N + somme des durées', () => {
    expect(dureeCycleS(TROIS, 'alterne', HORAIRES_S)).toBe(3 * 20 + 28);
  });
});

describe('Mode série : tous les médias à la suite', () => {
  it('horaires 20 s, puis 8 + 8 + 12, puis retour aux horaires', () => {
    expect(deroule('serie', TROIS, 100)).toEqual([
      'horaires', // 0 → 20 s
      'media:0', // 20 → 28 s
      'media:1', // 28 → 36 s
      'media:2', // 36 → 48 s
      'horaires', // 48 → 68 s
      'media:0', // le tour recommence
      'media:1',
      'media:2',
      'horaires',
    ]);
  });

  it('un tour complet dure horaires + somme des durées : 48 s', () => {
    expect(dureeCycleS(TROIS, 'serie', HORAIRES_S)).toBe(20 + 8 + 8 + 12);
  });
});

describe('Un départ proche prime sur tout', () => {
  it('retour IMMÉDIAT aux horaires, même au milieu d’une série', () => {
    // Départ proche à partir de la 30ᵉ seconde : on est alors sur media:1
    const vues = deroule('serie', TROIS, 40, (s) => s >= 30 && s < 35);
    expect(vues).toEqual(['horaires', 'media:0', 'media:1', 'horaires']);
  });

  it('la série reprend au média SUIVANT, jamais au premier', () => {
    // Sans cela, un média placé juste avant un départ serait toujours sauté.
    let etat: EtatCycle = { vue: { vue: 'media', index: 1 }, finMs: 60_000, reprendreA: 1 };
    etat = prochainEtat(etat, TROIS, 'serie', HORAIRES_S, true, 30_000);
    expect(etat.vue).toEqual({ vue: 'horaires' });
    expect(etat.reprendreA).toBe(2);

    // Le départ passé, les horaires s'achèvent et on reprend au 3ᵉ média
    etat = prochainEtat(etat, TROIS, 'serie', HORAIRES_S, false, etat.finMs);
    expect(etat.vue).toEqual({ vue: 'media', index: 2 });
  });

  it('déjà sur les horaires, un départ proche ne relance pas le minuteur', () => {
    const etat: EtatCycle = { vue: { vue: 'horaires' }, finMs: 20_000, reprendreA: 0 };
    const suivant = prochainEtat(etat, TROIS, 'serie', HORAIRES_S, true, 25_000);
    expect(suivant).toBe(etat); // le MÊME objet : rien à re-rendre
  });

  it('aucun média ne démarre tant que le départ est proche', () => {
    // Les horaires devraient céder à 20 s, mais la contrainte court jusqu'à
    // 45 s : le premier média n'apparaît qu'ensuite.
    let etat: EtatCycle = etatInitial(HORAIRES_S, 0);
    for (let s = 1; s <= 45; s += 1) {
      etat = prochainEtat(etat, TROIS, 'alterne', HORAIRES_S, s >= 15, s * 1000);
      expect(etat.vue.vue).toBe('horaires');
    }
    etat = prochainEtat(etat, TROIS, 'alterne', HORAIRES_S, false, 46_000);
    expect(etat.vue).toEqual({ vue: 'media', index: 0 });
  });
});

describe('Cas limites', () => {
  it('liste vide : toujours les horaires', () => {
    expect(deroule('serie', [], 120)).toEqual(['horaires']);
    expect(deroule('alterne', [], 120)).toEqual(['horaires']);
    expect(dureeCycleS([], 'serie', HORAIRES_S)).toBe(HORAIRES_S);
  });

  it('un média désactivé en cours de route ne fait pas planter', () => {
    // On diffuse le 3ᵉ média, puis la liste tombe à un seul élément
    const etat: EtatCycle = { vue: { vue: 'media', index: 2 }, finMs: 60_000, reprendreA: 2 };
    const suivant = prochainEtat(etat, [TROIS[0] as Media], 'serie', HORAIRES_S, false, 40_000);
    expect(suivant.vue).toEqual({ vue: 'horaires' });
    expect(suivant.reprendreA).toBe(0);
  });

  it('une reprise hors bornes retombe sur le premier média', () => {
    const etat: EtatCycle = { vue: { vue: 'horaires' }, finMs: 0, reprendreA: 7 };
    const suivant = prochainEtat(etat, TROIS, 'serie', HORAIRES_S, false, 1000);
    expect(suivant.vue).toEqual({ vue: 'media', index: 0 });
  });

  it('un seul média : la série se comporte comme l’alterné', () => {
    const un = [media('a', 8, 10)];
    expect(deroule('serie', un, 100)).toEqual(deroule('alterne', un, 100));
    expect(dureeCycleS(un, 'serie', HORAIRES_S)).toBe(dureeCycleS(un, 'alterne', HORAIRES_S));
  });

  it('rien à faire = le MÊME objet, pour n’avoir rien à re-rendre', () => {
    const etat = etatInitial(HORAIRES_S, 0);
    expect(prochainEtat(etat, TROIS, 'serie', HORAIRES_S, false, 5000)).toBe(etat);
  });
});
