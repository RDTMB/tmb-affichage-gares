// C-01 — Aucune valeur issue du jsonb `params.valeur` ne doit atteindre les
// écrans sans avoir été coercée et bornée. Un compte `caisse` peut écrire
// n'importe quoi dans les clés qui lui sont ouvertes.
import { describe, expect, it } from 'vitest';

import { PARAMS_DEFAUT, paramsValides } from './params';

describe('paramsValides — température du sommet (vecteur de C-01)', () => {
  it('neutralise une chaîne contenant du HTML, sans fabriquer de température', () => {
    const p = paramsValides({ meteo_sommet: { t: '<img src=x onerror=alert(1)>' } });
    expect(Number.isFinite(p.meteo_sommet.t)).toBe(false);
    // Surtout PAS 0 : « 0 °C » serait une information fausse affichée en gare.
    expect(p.meteo_sommet.t).not.toBe(0);
  });

  it('conserve une température NÉGATIVE — il gèle au Nid d’Aigle', () => {
    expect(paramsValides({ meteo_sommet: { t: -18 } }).meteo_sommet.t).toBe(-18);
    expect(paramsValides({ meteo_sommet: { t: -3 } }).meteo_sommet.t).toBe(-3);
  });

  it('conserve une décimale : l’arrondi appartient au rendu, pas à la validation', () => {
    expect(paramsValides({ meteo_sommet: { t: 9.5 } }).meteo_sommet.t).toBe(9.5);
  });

  it('rejette null, chaîne vide et tableau — que `Number()` convertirait en 0', () => {
    for (const t of [null, '', [], {}, true, undefined]) {
      expect(Number.isFinite(paramsValides({ meteo_sommet: { t } }).meteo_sommet.t)).toBe(false);
    }
  });

  it('rejette NaN, Infinity et une valeur hors plage plausible', () => {
    for (const t of [Number.NaN, Infinity, -Infinity, 1e9, -300]) {
      expect(Number.isFinite(paramsValides({ meteo_sommet: { t } }).meteo_sommet.t)).toBe(false);
    }
  });

  it('accepte une température transmise en CHAÎNE numérique', () => {
    expect(paramsValides({ meteo_sommet: { t: '12' } }).meteo_sommet.t).toBe(12);
  });
});

describe('paramsValides — libellés de ciel et heure de relevé', () => {
  it('remplace un ciel non textuel par « — »', () => {
    const p = paramsValides({ meteo_sommet: { ciel_fr: { x: 1 }, ciel_en: null } });
    expect(p.meteo_sommet.ciel_fr).toBe('—');
    expect(p.meteo_sommet.ciel_en).toBe('—');
  });

  it('tronque un libellé démesuré qui déborderait du pavé météo', () => {
    expect(
      paramsValides({ meteo_sommet: { ciel_fr: 'a'.repeat(500) } }).meteo_sommet.ciel_fr,
    ).toHaveLength(40);
  });

  it('OMET une heure de relevé non exploitable plutôt que d’en inventer une', () => {
    // `echapper()` appelle .replace : un nombre y lèverait et figerait l'écran.
    for (const h of [915, null, 'hier', '25:99', '']) {
      expect(
        paramsValides({ meteo_sommet: { heure_releve: h } }).meteo_sommet.heure_releve,
      ).toBeUndefined();
    }
    expect(
      paramsValides({ meteo_sommet: { heure_releve: '08:00' } }).meteo_sommet.heure_releve,
    ).toBe('08:00');
  });
});

describe('paramsValides — paramètres qui gouvernent l’affichage', () => {
  it('duree_cache_min : une valeur non numérique DÉSACTIVAIT l’écran neutre', () => {
    // `age > NaN` est toujours faux : des horaires périmés restaient affichés.
    for (const v of ['beaucoup', null, {}, Number.NaN]) {
      expect(paramsValides({ duree_cache_min: v }).duree_cache_min).toBe(15);
    }
  });

  it('duree_cache_min : bornée, 0 exclu (il rendrait l’écran neutre permanent)', () => {
    expect(paramsValides({ duree_cache_min: 0 }).duree_cache_min).toBe(3);
    expect(paramsValides({ duree_cache_min: -5 }).duree_cache_min).toBe(3);
    expect(paramsValides({ duree_cache_min: 99999 }).duree_cache_min).toBe(60);
    expect(paramsValides({ duree_cache_min: 15 }).duree_cache_min).toBe(15);
  });

  it('vitesse du bandeau : négative ou absurde → défaut, sinon bornée', () => {
    expect(paramsValides({ vitesse_ticker_px_s: -40 }).vitesse_ticker_px_s).toBe(90);
    expect(paramsValides({ vitesse_ticker_px_s: 0 }).vitesse_ticker_px_s).toBe(90);
    expect(paramsValides({ vitesse_ticker_px_s: 'vite' }).vitesse_ticker_px_s).toBe(90);
    expect(paramsValides({ vitesse_ticker_px_s: 5 }).vitesse_ticker_px_s).toBe(20);
    expect(paramsValides({ vitesse_ticker_px_s: 100000 }).vitesse_ticker_px_s).toBe(400);
    expect(paramsValides({ vitesse_ticker_px_s: 130 }).vitesse_ticker_px_s).toBe(130);
  });

  it('veille_nuit : les deux bornes ensemble, ou le défaut complet', () => {
    expect(paramsValides({ veille_nuit: { debut: '21:00', fin: '06:00' } }).veille_nuit).toEqual({
      debut: '21:00',
      fin: '06:00',
    });
    // Une borne illisible ne doit pas produire une plage que personne n'a décidée
    expect(paramsValides({ veille_nuit: { debut: '25:99', fin: '06:00' } }).veille_nuit).toEqual(
      PARAMS_DEFAUT.veille_nuit,
    );
    expect(paramsValides({ veille_nuit: 'la nuit' }).veille_nuit).toEqual(
      PARAMS_DEFAUT.veille_nuit,
    );
  });

  it('mode_medias : toute valeur inconnue retombe sur « alterne »', () => {
    expect(paramsValides({ mode_medias: 'serie' }).mode_medias).toBe('serie');
    expect(paramsValides({ mode_medias: 'nawak' }).mode_medias).toBe('alterne');
    expect(paramsValides({ mode_medias: 42 }).mode_medias).toBe('alterne');
  });

  it('durées d’affichage et délai « à quai » : bornés, 0 légitime à quai', () => {
    expect(paramsValides({ duree_horaires_s: 'x' }).duree_horaires_s).toBe(20);
    expect(paramsValides({ duree_horaires_s: 1 }).duree_horaires_s).toBe(5);
    expect(paramsValides({ duree_horaires_s: 99999 }).duree_horaires_s).toBe(600);
    expect(paramsValides({ a_quai_origine_s: 0 }).a_quai_origine_s).toBe(0);
    expect(paramsValides({ a_quai_origine_s: 'x' }).a_quai_origine_s).toBe(300);
    expect(paramsValides({ a_quai_origine_s: 99999 }).a_quai_origine_s).toBe(1800);
  });
});

describe('paramsValides — robustesse générale', () => {
  it('une entrée totalement absente donne les défauts documentés', () => {
    for (const brut of [null, undefined, 'nawak', 42, []]) {
      const p = paramsValides(brut);
      expect(p.duree_cache_min).toBe(15);
      expect(p.mode_medias).toBe('alterne');
      expect(p.veille_nuit).toEqual(PARAMS_DEFAUT.veille_nuit);
      expect(Number.isFinite(p.meteo_sommet.t)).toBe(false);
    }
  });

  it('machines, motifs et ciels : garantis tableaux (tables typées, pas du jsonb)', () => {
    const p = paramsValides({ machines: 'non', motifs: null, ciels: 3 });
    expect(p.machines).toEqual([]);
    expect(p.motifs).toEqual([]);
    expect(p.ciels).toEqual([]);
    // Contenu préservé tel quel quand c'est bien un tableau
    const q = paramsValides({ ciels: [{ fr: 'Dégagé', en: 'Clear', ordre: 10 }] });
    expect(q.ciels).toHaveLength(1);
  });

  it('n’altère JAMAIS l’objet d’entrée', () => {
    const brut = { meteo_sommet: { t: 'x' }, duree_cache_min: 0 };
    const copie = structuredClone(brut);
    paramsValides(brut);
    expect(brut).toEqual(copie);
  });
});
