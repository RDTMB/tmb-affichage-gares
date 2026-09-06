// Vitesse du bandeau : la durée de l'animation doit être proportionnelle à la
// longueur du texte à vitesse constante (une durée fixe faisait défiler un
// long message beaucoup plus vite qu'un court).
import { describe, expect, it } from 'vitest';

import {
  choixVitesseTicker,
  dureeDefilementS,
  NIVEAUX_VITESSE_TICKER,
  VITESSE_PERSONNALISEE,
  VITESSE_TICKER_DEFAUT,
  VITESSE_TICKER_MAX,
  VITESSE_TICKER_MIN,
  vitesseTickerEffective,
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

describe('choixVitesseTicker : niveau ou vitesse LIBRE', () => {
  it('une vitesse qui tombe sur un niveau ne montre pas le champ libre', () => {
    for (const n of NIVEAUX_VITESSE_TICKER) {
      const c = choixVitesseTicker(n.px_s);
      expect(c.selection).toBe(String(n.px_s));
      expect(c.px_s).toBe(n.px_s);
      expect(c.personnalisee).toBe(false);
    }
  });

  it('une vitesse hors niveaux ouvre « Personnaliser » et la CONSERVE', () => {
    // Elle n'est PAS ramenée au niveau le plus proche : l'exploitant a le
    // droit de choisir 105 px/s.
    const c = choixVitesseTicker(105);
    expect(c.selection).toBe(VITESSE_PERSONNALISEE);
    expect(c.px_s).toBe(105);
    expect(c.personnalisee).toBe(true);
  });

  it('une valeur hors bornes est ramenée dans les bornes, en restant libre', () => {
    expect(choixVitesseTicker(5).px_s).toBe(VITESSE_TICKER_MIN);
    expect(choixVitesseTicker(9999).px_s).toBe(VITESSE_TICKER_MAX);
    expect(choixVitesseTicker(9999).personnalisee).toBe(true);
  });

  it('une valeur absente ou illisible retombe sur le niveau « Normal »', () => {
    for (const brut of [undefined, null, '', 'vite', 0, -30, Number.NaN]) {
      const c = choixVitesseTicker(brut);
      expect(c.px_s).toBe(VITESSE_TICKER_DEFAUT);
      // 90 px/s EST un niveau : le champ libre reste fermé.
      expect(c.personnalisee).toBe(false);
    }
  });

  it('une vitesse en TEXTE est acceptée : le <select> ne rend que des chaînes', () => {
    expect(choixVitesseTicker('130')).toEqual({
      selection: '130',
      px_s: 130,
      personnalisee: false,
    });
    expect(choixVitesseTicker('105').personnalisee).toBe(true);
  });

  it('les bornes exactes sont acceptées', () => {
    expect(choixVitesseTicker(VITESSE_TICKER_MIN).px_s).toBe(VITESSE_TICKER_MIN);
    expect(choixVitesseTicker(VITESSE_TICKER_MAX).px_s).toBe(VITESSE_TICKER_MAX);
  });

  it('la vitesse retenue reste cohérente avec la durée de défilement', () => {
    // Le réglage n'a d'intérêt que s'il change vraiment la durée à l'écran.
    const lent = choixVitesseTicker(30).px_s;
    const rapide = choixVitesseTicker(300).px_s;
    expect(dureeDefilementS(3000, lent)).toBeGreaterThan(dureeDefilementS(3000, rapide));
  });
});

describe('vitesseTickerEffective : un poste surcharge, il ne remplace pas', () => {
  it('sans réglage propre, le poste suit le global', () => {
    expect(vitesseTickerEffective(130, null)).toEqual({ px_s: 130, propre: false });
    expect(vitesseTickerEffective(130, undefined)).toEqual({ px_s: 130, propre: false });
  });

  it('avec un réglage propre, c’est LUI qui s’applique', () => {
    expect(vitesseTickerEffective(130, 60)).toEqual({ px_s: 60, propre: true });
  });

  it('un global illisible retombe sur « Normal », le poste garde le sien', () => {
    expect(vitesseTickerEffective(undefined, null).px_s).toBe(VITESSE_TICKER_DEFAUT);
    expect(vitesseTickerEffective('n’importe quoi', 75)).toEqual({ px_s: 75, propre: true });
  });

  it('une surcharge hors bornes est RAMENÉE, pas ignorée', () => {
    // L'ignorer ferait défiler au réglage global sans que personne comprenne
    // pourquoi : l'intention du poste est conservée, bornée.
    expect(vitesseTickerEffective(90, 9999)).toEqual({ px_s: VITESSE_TICKER_MAX, propre: true });
    expect(vitesseTickerEffective(90, 1)).toEqual({ px_s: VITESSE_TICKER_MIN, propre: true });
  });

  it('zéro n’est pas « pas de réglage » : il est borné comme surcharge', () => {
    // Seul `null`/`undefined` veut dire « suit le global ».
    const r = vitesseTickerEffective(90, 0);
    expect(r.propre).toBe(true);
    expect(r.px_s).toBe(VITESSE_TICKER_DEFAUT);
  });

  it('deux écrans peuvent défiler à des vitesses différentes', () => {
    const global = 90;
    const petitEcran = vitesseTickerEffective(global, 60).px_s;
    const grandEcran = vitesseTickerEffective(global, 160).px_s;
    expect(dureeDefilementS(3000, petitEcran)).toBeGreaterThan(dureeDefilementS(3000, grandEcran));
  });
});
