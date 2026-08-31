import { describe, expect, it } from 'vitest';

import type { Ciel } from '../core/types';
import { cielChoisi, cielUtilise, optionsCiel, ordonneCiels } from './meteo-ciel';

const LISTE: Ciel[] = [
  { fr: 'Nuageux', en: 'Cloudy', ordre: 30 },
  { fr: 'Dégagé', en: 'Clear', ordre: 10 },
  { fr: 'Averses', en: 'Showers', ordre: 10 },
  { fr: 'Neige', en: 'Snow', ordre: 20 },
];

describe('ordonneCiels : tri par ordre puis fr', () => {
  it('trie par ordre croissant, puis par fr à ordre égal', () => {
    expect(ordonneCiels(LISTE).map((c) => c.fr)).toEqual([
      'Averses', // ordre 10, fr avant « Dégagé »
      'Dégagé', // ordre 10
      'Neige', // ordre 20
      'Nuageux', // ordre 30
    ]);
  });

  it('ne modifie pas le tableau d’entrée', () => {
    const copie = [...LISTE];
    ordonneCiels(LISTE);
    expect(LISTE).toEqual(copie);
  });
});

describe('optionsCiel : valeur hors liste conservée et présélectionnée', () => {
  it('présélectionne la valeur courante quand elle est dans la liste', () => {
    const options = optionsCiel(LISTE, 'Neige', 'Snow');
    const choisie = options.find((o) => o.selected);
    expect(choisie).toEqual({ fr: 'Neige', en: 'Snow', ancienne: false, selected: true });
    expect(options.some((o) => o.ancienne)).toBe(false);
    // triée : Averses, Dégagé, Neige, Nuageux
    expect(options.map((o) => o.fr)).toEqual(['Averses', 'Dégagé', 'Neige', 'Nuageux']);
  });

  it('ajoute EN TÊTE une valeur historique hors liste, marquée et présélectionnée', () => {
    const options = optionsCiel(LISTE, 'Ciel de traîne', 'Clearing skies');
    expect(options[0]).toEqual({
      fr: 'Ciel de traîne',
      en: 'Clearing skies',
      ancienne: true,
      selected: true,
    });
    // une seule sélection, et c'est bien l'ancienne valeur
    expect(options.filter((o) => o.selected)).toHaveLength(1);
    expect(options.filter((o) => o.ancienne)).toHaveLength(1);
    // la liste normale suit, triée
    expect(options.slice(1).map((o) => o.fr)).toEqual(['Averses', 'Dégagé', 'Neige', 'Nuageux']);
  });
});

describe('cielChoisi : le sélecteur écrit les DEUX champs', () => {
  it('résout ciel_fr et ciel_en depuis la valeur choisie', () => {
    const options = optionsCiel(LISTE, 'Dégagé', 'Clear');
    expect(cielChoisi(options, 'Nuageux')).toEqual({ ciel_fr: 'Nuageux', ciel_en: 'Cloudy' });
    expect(cielChoisi(options, 'Neige')).toEqual({ ciel_fr: 'Neige', ciel_en: 'Snow' });
  });

  it('résout aussi la valeur historique hors liste', () => {
    const options = optionsCiel(LISTE, 'Ciel de traîne', 'Clearing skies');
    expect(cielChoisi(options, 'Ciel de traîne')).toEqual({
      ciel_fr: 'Ciel de traîne',
      ciel_en: 'Clearing skies',
    });
  });
});

describe('cielUtilise : suppression refusée si l’état est affiché en gare', () => {
  it('vrai quand l’état est celui de la météo courante', () => {
    expect(cielUtilise('Dégagé', 'Dégagé')).toBe(true);
  });

  it('faux pour un état non affiché', () => {
    expect(cielUtilise('Neige', 'Dégagé')).toBe(false);
  });
});
