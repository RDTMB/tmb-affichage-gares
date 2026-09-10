// L'écran de gare n'affiche plus l'heure d'ARRIVÉE (docs/01 §3).
//
// Le point délicat : la donnée reste calculée, elle commande l'état « À QUAI ».
// Ces tests verrouillent les deux moitiés — plus rien à l'écran, mais l'état
// se déclenche toujours — et vérifient que la grille du jour, elle, continue
// d'afficher l'arrivée aux terminus, seul endroit où il n'y a pas de départ.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
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
  // Fins de ligne NORMALISÉES : le poste travaille en CRLF, le coureur
  // d'intégration en LF. Un repère de texte qui contient un saut de ligne
  // passe ici et échoue là-bas — c'est arrivé le 07/09/2026.
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
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
      // « Rame », et non plus « Train » : le numéro est passé en badge devant
      // la destination, cette colonne ne contient plus que « Marie ».
      'Rame/Trainset',
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

  it('le badge du numéro suit l’opacité d’un train supprimé, jamais son barré', () => {
    const css = source('src/styles/ecran.css');
    // Une étiquette barrée se lit comme un défaut d'affichage.
    expect(css).toMatch(/\.rangee\.supprime \.badge-train \{\s*text-decoration: none;/);
    // Et l'étiquette reste en Lato : Amaranth est réservé aux noms propres.
    const badge = css.match(/^\.badge-train \{[^}]+\}/m)?.[0] ?? '';
    expect(badge).toContain("font-family: 'Lato'");
    expect(badge).not.toContain('Amaranth');
  });
});

describe('src/pages/ecran.ts : plus aucune cellule d’arrivée', () => {
  const ts = source('src/pages/ecran.ts');

  it('la cellule .r-arr et son tiret d’origine ont disparu', () => {
    expect(ts).not.toContain('r-arr');
    expect(ts).not.toContain('class="tiret"');
  });

  it('le numéro est un badge en TÊTE de .dest, avant le nom de gare', () => {
    // L'ordre compte : le badge doit précéder le nom, pas le suivre.
    // Le nom vit dans un `<span class="nom-dest">` : il porte une largeur
    // FIXE pour que la pastille d'affluence commence toujours au même
    // endroit d'une rangée à l'autre (86,5 px de balancement sans lui).
    expect(ts).toMatch(/<div class="dest">\$\{badge\}<span class="nom-dest">\$\{echapper\(nomGare/);
    // …et le picto motrice de l'express reste le DERNIER élément de la ligne.
    // Entre les deux vient désormais la pastille d'affluence : elle se lit
    // avec le nom, le picto termine (décision de l'exploitant du 09/09/2026).
    expect(ts).toMatch(
      /nomGare\(p\.destination\)\)\}<\/span>\$\{affluenceHtml\}\$\{motrice\}<\/div>/,
    );
  });

  it('la pastille d’affluence ne s’affiche PAS sur un train supprimé', () => {
    // Le train n'existe plus pour le voyageur : « complet » sur une ligne
    // barrée n'a aucun sens. La garde est dans le calcul, pas dans le CSS —
    // masquer par la feuille laisserait le texte dans le DOM.
    const bloc = /const affluenceHtml =([\s\S]*?);\n/.exec(ts)?.[1] ?? '';
    expect(bloc, 'affluenceHtml introuvable').not.toBe('');
    expect(bloc).toContain('supprime');
    expect(bloc).toContain('!p.affluence');
    // Les deux niveaux, et eux seuls, portent leur classe.
    expect(bloc).toContain('pill-affluence complet');
    expect(bloc).toContain('pill-affluence limite');
  });

  it('les deux libellés sont bilingues, l’anglais dans un <small>', () => {
    // Contrat de la page : UI voyageurs FR + EN. L'anglais n'est retiré que
    // sous 4/3, par la feuille de style, et le commentaire y dit pourquoi.
    expect(ts).toContain('Complet <small>Full</small>');
    expect(ts).toContain('Dernières places <small>Few seats</small>');
  });

  it('la mention du départ constaté est NEUTRE, jamais du « retard »', () => {
    // Ce train n'est pas en retard : son heure n'était pas encore ferme. Ni
    // <b> (couleur retard via `.note b`), ni heure barrée, ni classe d'alerte.
    const ligne = /if \(p\.departConfirme\) note \+= ([^;]+);/.exec(ts)?.[1] ?? '';
    expect(ligne).toContain('Horaire confirmé / Departure confirmed');
    expect(ligne).not.toContain('<b>');
    expect(ligne).not.toContain('retard');
    expect(ligne).not.toContain('class=');
    // …et elle est posée AVANT la branche « supprimé », qui remplace la note.
    expect(ts.indexOf('p.departConfirme')).toBeLessThan(ts.indexOf('motif-supprime'));
  });

  it('la colonne Rame ne porte plus le numéro', () => {
    expect(ts).not.toContain('class="num"');
    // Le libellé long reste réservé à la supervision et à la grille du jour.
    expect(ts).not.toContain('libelleTrain(');
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
