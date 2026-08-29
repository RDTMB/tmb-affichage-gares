// L'écran de gare n'affiche plus l'heure d'ARRIVÉE (docs/01 §3).
//
// Le point délicat : la donnée reste calculée, elle commande l'état « À QUAI ».
// Ces tests verrouillent les deux moitiés — plus rien à l'écran, mais l'état
// se déclenche toujours — et vérifient que la grille du jour, elle, continue
// d'afficher l'arrivée aux terminus, seul endroit où il n'y a pas de départ.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import {
  A_QUAI_ORIGINE_DEFAUT_S,
  compteARebours,
  generationJour,
  heureVersSecondes,
  passagesPourGare,
  trainsDuJour,
} from '../core/horaires';
import type { Grille } from '../core/types';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-07-15';
const h = heureVersSecondes;

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8');
}

describe('ecran.html : plus aucune colonne d’arrivée', () => {
  const html = source('ecran.html');

  it('l’en-tête ne comporte plus « Arrivée / Arrival »', () => {
    expect(html).not.toMatch(/Arriv[ée]e<small>Arrival<\/small>/);
    expect(html).not.toContain('>Arrival<');
  });

  it('l’en-tête décrit exactement les cinq colonnes restantes', () => {
    const entetes = [...html.matchAll(/<div>([^<]+)<small>([^<]+)<\/small><\/div>/g)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    expect(entetes).toEqual([
      'Départ/Departure',
      'Destination/Towards',
      'Train/Tram',
      'Départ dans/Departs in',
      'Statut/Status',
    ]);
  });

  it('la grille CSS compte cinq colonnes, la largeur libérée allant à Destination', () => {
    const css = source('src/styles/ecran.css');
    const regle = css.match(/grid-template-columns:\s*([^;]+);/);
    expect(regle).not.toBeNull();
    const colonnes = (regle?.[1] ?? '').trim().split(/\s+/);
    expect(colonnes).toHaveLength(5);
    // Destination reste la seule colonne élastique : elle absorbe les 8vw
    expect(colonnes.filter((c) => c === '1fr')).toHaveLength(1);
    expect(colonnes[1]).toBe('1fr');
    // Les styles de l'ancienne cellule ont disparu avec elle
    expect(css).not.toMatch(/^\.r-arr\b/m);
  });
});

describe('src/pages/ecran.ts : plus aucune cellule d’arrivée', () => {
  const ts = source('src/pages/ecran.ts');

  it('la cellule .r-arr et son tiret d’origine ont disparu', () => {
    expect(ts).not.toContain('r-arr');
    expect(ts).not.toContain('class="tiret"');
  });

  it('la rangée produit bien cinq cellules', () => {
    const rangee = ts.match(/return `<div class="gridrow rangee[\s\S]*?<\/div>`;/);
    expect(rangee).not.toBeNull();
    // Cellules de premier niveau (indentation de 4 espaces dans le gabarit)
    const cellules = [...(rangee?.[0] ?? '').matchAll(/\n {4}<div/g)];
    expect(cellules).toHaveLength(5);
  });

  it('l’heure d’arrivée n’est plus lue pour l’affichage du tableau', () => {
    const rangee = ts.match(/return `<div class="gridrow rangee[\s\S]*?<\/div>`;/)?.[0] ?? '';
    expect(rangee).not.toContain('arrivee_s');
  });
});

describe('L’arrivée reste calculée : c’est elle qui commande « À QUAI »', () => {
  const jour = generationJour(GRAND, DATE);
  const p = passagesPourGare(GRAND, jour, 'saint-gervais').find((x) => x.numero === 5);

  it('le moteur connaît toujours l’arrivée du TRAIN 5 à Saint-Gervais', () => {
    expect(p?.arrivee_s).toBe(h('09:10:00'));
    expect(p?.depart_s).toBe(h('09:15:00'));
  });

  it('« À QUAI » à 09:10:00, alors que 09:10 n’est plus affiché nulle part', () => {
    const etat = (heure: string): string =>
      compteARebours(p?.depart_s ?? 0, h(heure), p?.arrivee_s ?? null, A_QUAI_ORIGINE_DEFAUT_S)
        .type;
    expect(etat('09:09:59')).toBe('minutes');
    expect(etat('09:10:00')).toBe('quai');
    expect(etat('09:14:29')).toBe('quai');
  });

  it('puis « DÉPART IMMINENT » à 09:14:30', () => {
    const etat = compteARebours(p?.depart_s ?? 0, h('09:14:30'), p?.arrivee_s ?? null);
    expect(etat.type).toBe('imminent');
  });
});

describe('grille.html : l’arrivée reste affichée aux terminus', () => {
  const jour = generationJour(GRAND, DATE);

  /** Ce que la grille du jour met dans une case : le départ, sinon l'arrivée. */
  /** `.at(-1)` demande la lib es2022 : le projet cible plus bas. */
  function dernier<T>(liste: T[] | undefined): T | undefined {
    return liste?.[liste.length - 1];
  }

  function heureCellule(numero: number, gare: string): number | null {
    const train = trainsDuJour(GRAND, jour).find((t) => t.numero === numero);
    const passage = train?.passages.find((x) => x.gare === gare);
    if (!passage) return null;
    return passage.depart_s ?? passage.arrivee_s ?? null;
  }

  it('montée : Le Fayet donne son DÉPART, le Nid d’Aigle son ARRIVÉE', () => {
    expect(heureCellule(1, 'le-fayet')).toBe(h('07:00:00'));
    const sommet = dernier(GRAND.montees.find((m) => m.numero === 1)?.passages);
    expect(sommet?.gare).toBe('nid-daigle');
    expect(sommet?.d).toBeUndefined(); // pas de départ au terminus
    expect(heureCellule(1, 'nid-daigle')).toBe(h(sommet?.a ?? '00:00'));
  });

  it('descente : le Nid d’Aigle donne son DÉPART, Le Fayet son ARRIVÉE', () => {
    const fin = dernier(GRAND.descentes.find((d) => d.numero === 2)?.passages);
    expect(fin?.gare).toBe('le-fayet');
    expect(fin?.d).toBeUndefined();
    expect(heureCellule(2, 'le-fayet')).toBe(h(fin?.a ?? '00:00'));
    // Heure lue dans la grille OFFICIELLE (08:13:30, tronquée à 08:13 à
    // l'affichage) : jamais recopiée à la main dans un test.
    const depart = GRAND.descentes.find((d) => d.numero === 2)?.passages[0];
    expect(depart?.gare).toBe('nid-daigle');
    expect(heureCellule(2, 'nid-daigle')).toBe(h(depart?.d ?? '00:00'));
  });
});
