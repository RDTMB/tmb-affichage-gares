// Vitesse du bandeau : la durée de l'animation doit être proportionnelle à la
// longueur du texte à vitesse constante (une durée fixe faisait défiler un
// long message beaucoup plus vite qu'un court).
import { describe, expect, it } from 'vitest';

import {
  dureeDefilementS,
  NIVEAUX_VITESSE_TICKER,
  VITESSE_TICKER_DEFAUT,
  vitesseTickerValide,
} from './ticker';

describe('dureeDefilementS', () => {
  it('durée proportionnelle à la longueur du texte, à vitesse constante', () => {
    const court = dureeDefilementS(1800, 90); // 20 s
    const long = dureeDefilementS(5400, 90); // 60 s
    expect(court).toBeCloseTo(20, 5);
    expect(long).toBeCloseTo(60, 5);
    // Trois fois plus large = trois fois plus long, donc même vitesse de lecture
    expect(long / court).toBeCloseTo(3, 5);
  });

  it('un changement de vitesse change la durée dans le rapport inverse', () => {
    const normal = dureeDefilementS(9000, 90);
    const rapide = dureeDefilementS(9000, 180);
    expect(normal).toBeCloseTo(100, 5);
    expect(rapide).toBeCloseTo(50, 5);
    expect(normal / rapide).toBeCloseTo(2, 5);
  });

  it('les quatre niveaux de l’exploitant donnent des durées décroissantes', () => {
    const durees = NIVEAUX_VITESSE_TICKER.map((n) => dureeDefilementS(9000, n.px_s));
    expect(NIVEAUX_VITESSE_TICKER.map((n) => n.px_s)).toEqual([60, 90, 130, 180]);
    for (let i = 1; i < durees.length; i += 1) {
      expect(durees[i] ?? 0).toBeLessThan(durees[i - 1] ?? 0);
    }
  });

  it('valeur absente ou aberrante : repli sur 90 px/s', () => {
    const reference = dureeDefilementS(9000, 90);
    for (const mauvaise of [undefined, null, '', 'vite', NaN, 0, -50, Infinity]) {
      expect(dureeDefilementS(9000, mauvaise)).toBeCloseTo(reference, 5);
    }
  });

  it('largeur nulle ou invalide : durée plancher, jamais 0 ni NaN', () => {
    for (const largeur of [0, -100, Number.NaN]) {
      const duree = dureeDefilementS(largeur, 90);
      expect(Number.isFinite(duree)).toBe(true);
      expect(duree).toBeGreaterThan(0);
    }
  });
});

describe('vitesseTickerValide', () => {
  it('accepte les niveaux proposés', () => {
    for (const n of NIVEAUX_VITESSE_TICKER) expect(vitesseTickerValide(n.px_s)).toBe(n.px_s);
  });

  it('replie sur 90 px/s toute valeur absente ou non exploitable', () => {
    for (const mauvaise of [undefined, null, '', 'abc', NaN, 0, -1]) {
      expect(vitesseTickerValide(mauvaise)).toBe(VITESSE_TICKER_DEFAUT);
    }
    expect(VITESSE_TICKER_DEFAUT).toBe(90);
  });

  it('borne les valeurs extrêmes (bandeau ni figé ni emballé)', () => {
    expect(vitesseTickerValide(5)).toBeGreaterThanOrEqual(20);
    expect(vitesseTickerValide(100000)).toBeLessThanOrEqual(400);
  });

  it('accepte une valeur numérique en chaîne (lecture depuis un select)', () => {
    expect(vitesseTickerValide('130')).toBe(130);
  });
});
