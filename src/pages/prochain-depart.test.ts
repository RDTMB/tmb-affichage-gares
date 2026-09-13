// La colonne éclairée de la grille du jour, et l'anneau de la pastille.
//
// DEUX DÉFAUTS relevés par l'exploitant le 13/09/2026, tous deux de RENDU :
//   • la colonne éclairée suivait le prochain départ de l'ORIGINE de la ligne,
//     pas de la gare de l'écran. À 14 h 05 à Saint-Gervais, elle désignait un
//     train d'une heure plus tard que celui que le voyageur pouvait prendre ;
//   • l'anneau de Marguerite manquait sur la pastille de position, alors qu'il
//     était présent dans la légende, à quelques centimètres sur le même écran.
//
// Les heures viennent de la grille RÉELLE de référence
// (docs/grilles-historique/2026-ete-grand-service.json), pas de valeurs
// inventées : c'est elle qui sert d'oracle au reste du dépôt.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { departLocal_s, indexProchainDepart, type ColonneCandidate } from './grille-logique';
import { styleRame } from './affichage-commun';
import type { GareId, PassageTrain } from '../core/types';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const h = (hhmm: string): number => {
  const [a, b] = hhmm.split(':').map(Number);
  return (a ?? 0) * 3600 + (b ?? 0) * 60;
};

/** Un passage : `null` pour une heure absente (origine sans arrivée, terminus sans départ). */
const p = (gare: GareId, arrivee: string | null, depart: string | null): PassageTrain => ({
  gare,
  arrivee_s: arrivee === null ? null : h(arrivee),
  depart_s: depart === null ? null : h(depart),
});

function colonne(
  numero: number,
  passages: PassageTrain[],
  o: { retard_min?: number; supprime?: boolean; passe?: boolean } = {},
): ColonneCandidate {
  const decalage = (o.retard_min ?? 0) * 60;
  const premier = passages[0];
  return {
    train: { numero, passages },
    decalage,
    departReel_s: (premier?.depart_s ?? premier?.arrivee_s ?? 0) + decalage,
    supprime: o.supprime ?? false,
    passe: o.passe ?? false,
  };
}

// --- La journée d'été de référence, montées ---------------------------------
// TRAIN 19 : Le Fayet 14:00 → Saint-Gervais 14:15 → … → Nid d'Aigle 15:05 (arrivée seule)
const T19 = colonne(19, [
  p('le-fayet', null, '14:00'),
  p('saint-gervais', '14:10', '14:15'),
  p('motivon', '14:26', '14:27'),
  p('col-de-voza', '14:40', '14:42'),
  p('bellevue', '14:47', '14:49'),
  p('nid-daigle', '15:05', null),
]);
// TRAIN 21 : Le Fayet 15:00 → Saint-Gervais 15:15 → …
const T21 = colonne(21, [
  p('le-fayet', null, '15:00'),
  p('saint-gervais', '15:10', '15:15'),
  p('motivon', '15:26', '15:27'),
  p('col-de-voza', '15:40', '15:42'),
  p('bellevue', '15:47', '15:49'),
  p('nid-daigle', '16:05', null),
]);
// TRAIN 13 : parti à 12:00, passé à Saint-Gervais à 12:15 — derrière nous à 14:05
const T13 = colonne(13, [
  p('le-fayet', null, '12:00'),
  p('saint-gervais', '12:10', '12:15'),
  p('nid-daigle', '13:05', null),
]);
// EXPRESS 9 : ne dessert NI le Col de Voza NI Bellevue — aucun passage pour eux
const EXPRESS9 = colonne(9, [
  p('le-fayet', null, '10:30'),
  p('saint-gervais', '10:40', '10:45'),
  p('motivon', '10:56', '10:57'),
  p('nid-daigle', '11:30', null),
]);

const MONTEES = [T13, T19, T21];

// ---------------------------------------------------------------------------
// §3.1 — LE TEST DU DÉFAUT
// ---------------------------------------------------------------------------

describe('3.1 — à 14 h 05 à Saint-Gervais, c’est le TRAIN 19 qui est éclairé', () => {
  it('la colonne éclairée est celle du train de 14 h 00, et non celle de 15 h 00', () => {
    // VÉRIFIÉ ROUGE SUR LE CODE D'AVANT : la règle d'origine écartait le
    // TRAIN 19 (parti du Fayet à 14 h 00, donc avant 14 h 05) et rendait
    // l'index de la colonne du TRAIN 21 — qui ne passe à Saint-Gervais qu'à
    // 15 h 15. Le voyageur avait dix minutes pour prendre le sien.
    const i = indexProchainDepart(MONTEES, 'saint-gervais', h('14:05'));
    expect(MONTEES[i]?.train.numero).toBe(19);
  });

  it('… et il part bien d’ici à 14 h 15, pas à 14 h 00', () => {
    expect(departLocal_s(T19, 'saint-gervais')).toBe(h('14:15'));
    expect(departLocal_s(T19, 'le-fayet')).toBe(h('14:00'));
  });

  it('ce que faisait l’ancienne règle, écrit noir sur blanc', () => {
    // Le témoin : à la même seconde, lu depuis l'ORIGINE, la réponse est
    // toujours le TRAIN 21. Le défaut n'était pas une erreur de calcul, c'était
    // la mauvaise question posée — et ce test tombe si l'on prétend
    // « corriger » l'ancienne règle au lieu de la remplacer.
    const i = indexProchainDepart(MONTEES, null, h('14:05'));
    expect(MONTEES[i]?.train.numero).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// §3.2 — Le cas qui marchait déjà ne doit pas casser
// ---------------------------------------------------------------------------

describe('3.2 — au Fayet, à la même seconde, c’est toujours le TRAIN 21', () => {
  it('la gare d’origine donne la même réponse qu’avant', () => {
    const i = indexProchainDepart(MONTEES, 'le-fayet', h('14:05'));
    expect(MONTEES[i]?.train.numero).toBe(21);
  });

  it('et à 13 h 50, au Fayet, c’est le TRAIN 19 : rien n’est décalé d’un cran', () => {
    const i = indexProchainDepart(MONTEES, 'le-fayet', h('13:50'));
    expect(MONTEES[i]?.train.numero).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// §3.3 — Le retard continue de compter
// ---------------------------------------------------------------------------

describe('3.3 — un retard reprend la première place quand il la mérite', () => {
  it('un TRAIN 13 retardé de 115 min repasse devant le TRAIN 19', () => {
    // Passage théorique à Saint-Gervais 12 h 15, plus 115 min → 14 h 10, donc
    // AVANT le TRAIN 19 (14 h 15) et après l'instant lu (14 h 05). Le voyageur
    // de Saint-Gervais prendra bien celui-là : « un gros retard peut inverser
    // l'ordre des colonnes », et il doit continuer de le pouvoir.
    const T13tard = colonne(13, T13.train.passages as PassageTrain[], { retard_min: 115 });
    expect(departLocal_s(T13tard, 'saint-gervais')).toBe(h('14:10'));
    const liste = [T13tard, T19, T21];
    const i = indexProchainDepart(liste, 'saint-gervais', h('14:05'));
    expect(liste[i]?.train.numero).toBe(13);
  });

  it('à égalité de seconde, le plus petit numéro l’emporte — et ne change plus', () => {
    // 12 h 15 + 120 min = 14 h 15, la seconde même du TRAIN 19. Sans règle de
    // départage, les deux colonnes s'échangeraient la lumière d'un rendu à
    // l'autre, une fois par seconde.
    const T13egal = colonne(13, T13.train.passages as PassageTrain[], { retard_min: 120 });
    expect(departLocal_s(T13egal, 'saint-gervais')).toBe(departLocal_s(T19, 'saint-gervais'));
    const liste = [T13egal, T19];
    expect(liste[indexProchainDepart(liste, 'saint-gervais', h('14:05'))]?.train.numero).toBe(13);
    // …quel que soit l'ordre des colonnes dans le tableau.
    const inverse = [T19, T13egal];
    expect(inverse[indexProchainDepart(inverse, 'saint-gervais', h('14:05'))]?.train.numero).toBe(
      13,
    );
  });

  it('le retard s’applique à l’heure de CETTE gare, pas à celle de l’origine', () => {
    // Le piège du passage à l'heure locale : reprendre `departReel_s` (origine
    // + retard) comparerait des heures de deux gares différentes.
    const T19tard = colonne(19, T19.train.passages as PassageTrain[], { retard_min: 10 });
    expect(departLocal_s(T19tard, 'saint-gervais')).toBe(h('14:25'));
    expect(T19tard.departReel_s).toBe(h('14:10'));
  });

  it('supprimé et passé restent hors du choix', () => {
    const supprime = colonne(19, T19.train.passages as PassageTrain[], { supprime: true });
    const passe = colonne(19, T19.train.passages as PassageTrain[], { passe: true });
    for (const ecarte of [supprime, passe]) {
      const liste = [ecarte, T21];
      const i = indexProchainDepart(liste, 'saint-gervais', h('14:05'));
      expect(liste[i]?.train.numero).toBe(21);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.4 — Les deux cas tranchés au §2
// ---------------------------------------------------------------------------

describe('3.4a — un train qui ne dessert pas cette gare n’est jamais éclairé', () => {
  it('un EXPRESS n’est pas un prochain train pour un écran de Bellevue', () => {
    // Il n'a aucun passage là-bas : sa colonne existe et affiche « | », ce qui
    // est exactement ce qu'elle doit dire. L'éclairer enverrait le voyageur de
    // Bellevue vers un train qui lui passe devant sans s'arrêter.
    expect(departLocal_s(EXPRESS9, 'bellevue')).toBeNull();
    const liste = [EXPRESS9, T19];
    const i = indexProchainDepart(liste, 'bellevue', h('10:00'));
    expect(liste[i]?.train.numero).toBe(19);
  });

  it('… alors qu’il l’est pour un écran de Motivon, qu’il dessert', () => {
    // Le contre-épreuve : la règle écarte l'express de Bellevue parce qu'il n'y
    // passe pas, pas parce qu'il est express.
    const liste = [EXPRESS9, T19];
    const i = indexProchainDepart(liste, 'motivon', h('10:00'));
    expect(liste[i]?.train.numero).toBe(9);
  });

  it('un TERMINUS n’est pas un départ : au Nid d’Aigle, aucune montée n’est éclairée', () => {
    // Mesuré dans la grille de référence : le dernier passage d'une montée
    // porte une arrivée et PAS de départ. On n'y monte pas.
    expect(departLocal_s(T19, 'nid-daigle')).toBeNull();
    expect(indexProchainDepart(MONTEES, 'nid-daigle', h('14:05'))).toBe(-1);
  });
});

describe('3.4b — quand plus rien ne part d’ici, aucune colonne n’est éclairée', () => {
  it('après le dernier départ, la grille n’en désigne aucune', () => {
    // En éclairer une par défaut désignerait un train qu'on ne peut pas
    // prendre : ce serait le défaut qu'on répare, sous une autre forme.
    expect(indexProchainDepart(MONTEES, 'saint-gervais', h('23:30'))).toBe(-1);
  });

  it('sur une gare que la journée ne dessert plus, non plus', () => {
    // Section restreinte : le train n'a plus de passage à cette gare.
    const tronque = colonne(19, [
      p('le-fayet', null, '14:00'),
      p('saint-gervais', '14:10', '14:15'),
    ]);
    expect(indexProchainDepart([tronque], 'bellevue', h('14:05'))).toBe(-1);
  });

  it('une liste vide ne lève pas et n’éclaire rien', () => {
    expect(indexProchainDepart([], 'saint-gervais', h('14:05'))).toBe(-1);
    expect(indexProchainDepart([], null, h('14:05'))).toBe(-1);
  });
});

describe('3.4c — sans `?gare=`, la règle reste celle de l’origine, par choix', () => {
  it('la page sans paramètre garde le comportement d’avant', () => {
    // Hors d'une gare, « d'ici » n'a pas de sens : la grille se lit comme
    // l'horaire de toute la ligne, et l'heure d'origine est ce qu'une colonne
    // annonce en tête.
    const i = indexProchainDepart(MONTEES, null, h('14:05'));
    expect(MONTEES[i]?.train.numero).toBe(21);
  });

  it('grille.ts passe bien SA gare, celle de `?gare=`', () => {
    // Sans cette ligne, tout ce qui précède serait vrai et sans effet.
    const src = source('src/pages/grille.ts');
    expect(src).toContain('indexProchainDepart(colonnes, gare, maintenant_s)');
    // …et l'ancienne règle n'est plus nulle part.
    expect(src).not.toContain('c.departReel_s <= maintenant_s');
  });
});

// ---------------------------------------------------------------------------
// §3.5 — L'anneau : le même pour la légende et la pastille de position
// ---------------------------------------------------------------------------

describe('3.5 — la pastille de position et la légende dessinent le MÊME anneau', () => {
  const MARGUERITE = { couleur: '#FFFFFF', cercle: '#E52A23' };
  const MARIE = { couleur: '#2E74B5', cercle: null };

  it('les deux pastilles de la grille sont construites par la même fonction', () => {
    // C'était le défaut : chacune écrivait son propre `box-shadow`, et l'une
    // des deux l'avait oublié. Une seule source, donc plus d'écart possible.
    const src = source('src/pages/grille.ts');
    expect(src).toContain('class="train-pos" style="${styleRame(machineDe(c.train.rame))}"');
    expect(src).toContain('class="rame-dot" style="${styleRame(m)}"');
    // Et plus aucun `box-shadow` écrit à la main dans la page.
    expect(src).not.toContain('box-shadow');
  });

  it('l’écran de gare passe par la MÊME fonction : trois sites, une seule règle', () => {
    // SURVIVANTE DE LA CAMPAGNE DE MUTATION : reconstruire la pastille de
    // l'écran à la main (`background:${couleurSure(...)}`) ne faisait rougir
    // que `tsc`, au titre d'un import devenu inutile — et plus rien du tout si
    // l'import partait avec. La pastille perdrait alors `--anneau`, le repli
    // CSS s'appliquerait, et Marguerite reperdrait son anneau : le défaut du
    // 13/09, déplacé sur la surface la plus vue du projet. Une protection qui
    // dépend du compilateur n'en est pas une.
    const src = source('src/pages/ecran.ts');
    expect(src).toContain('class="pastille" style="${styleRame(machine)}"');
    expect(src, 'la pastille de l’écran reconstruit un style à la main').not.toMatch(
      /class="pastille" style="background:/,
    );
  });

  it('Marguerite porte la variable d’anneau, les trois autres rames non', () => {
    expect(styleRame(MARGUERITE)).toContain('--anneau:#E52A23;');
    expect(styleRame(MARIE)).not.toContain('--anneau');
  });

  it('une couleur d’anneau mal formée n’en dessine aucun', () => {
    // Pas d'anneau vaut mieux qu'un anneau inventé — et un anneau bleu-gris
    // autour de Marie serait un faux, là où l'on corrige les faux.
    expect(styleRame({ couleur: '#2E74B5', cercle: 'red' })).not.toContain('--anneau');
    expect(styleRame({ couleur: '#2E74B5', cercle: '#fff' })).not.toContain('--anneau');
  });

  it('chaque pastille compose sa propre géométrie autour de `var(--anneau, …)`', () => {
    // La COULEUR vient d'un seul endroit, la TAILLE reste là où elle se lit :
    // 2 px dans la légende, 2 px plus un halo sur la pastille de position,
    // 0,4 vh sur l'écran de gare.
    const grille = source('src/styles/grille.css');
    expect(grille).toContain('box-shadow: 0 0 0 2px var(--anneau, transparent);');
    expect(grille).toContain('0 0 0 2px var(--anneau, rgba(24, 44, 66, 0.75)),');
    expect(source('src/styles/ecran.css')).toContain(
      'box-shadow: 0 0 0 0.4vh var(--anneau, rgba(255, 255, 255, 0.14));',
    );
  });

  it('le HALO blanc de la pastille de position survit à l’anneau', () => {
    // C'est pour lui que la variable a été préférée à un `box-shadow` en
    // ligne : celui-ci aurait écrasé le liseré ET le halo, c'est-à-dire réparé
    // l'anneau en effaçant ce qui détache la pastille de la cellule.
    const grille = source('src/styles/grille.css');
    const debut = grille.indexOf('.train-pos {');
    const corps = grille.slice(debut, grille.indexOf('\n}\n', debut));
    expect(corps).toContain('var(--anneau,');
    expect(corps).toContain('0 0 0.9vh rgba(255, 255, 255, 0.9)');
  });
});
