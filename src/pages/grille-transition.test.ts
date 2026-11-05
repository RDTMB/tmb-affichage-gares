// La transformation du train entre « à quai » (le rond) et « en route » (la
// flèche) : la DÉCISION d'animer, les images clés, le temps écoulé, et les
// garde-fous CSS / source qui tiennent ce que la mesure au navigateur a établi.
// Vitest n'a pas de DOM : la pose des éléments se mesure à la main (voir la PR).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  COURBE_TRANSITION,
  DUREE_TRANSITION_MS,
  ecartMaxS,
  imagesCles,
  mouvement,
  optionsAnimation,
  tempsEcoule,
  trajetPossible,
  type EtatTrain,
} from './grille-transition';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string): string => readFileSync(join(RACINE, f), 'utf-8').replace(/\r\n/g, '\n');

const quai = (ligne: number, col = 3): EtatTrain => ({ etat: 'quai', ligne, saut: 0, col });
const route = (ligne: number, saut = 1, col = 3): EtatTrain => ({
  etat: 'route',
  ligne,
  saut,
  col,
});
/** Un rendu par seconde, tolérance de la grille. */
const MAX = ecartMaxS(1000);

describe('mouvement — quand jouer la transformation', () => {
  it('départ : à quai sur la ligne L, puis en route depuis L', () => {
    expect(mouvement(quai(2), route(2), 1, MAX)).toBe('depart');
    expect(mouvement(quai(0), route(0), 1, MAX)).toBe('depart'); // première ligne
  });

  it('départ d’un express : le saut peut être de plusieurs lignes', () => {
    expect(mouvement(quai(2), route(2, 3), 1, MAX)).toBe('depart');
  });

  it('arrivée : en route de L vers L + saut, puis à quai sur L + saut', () => {
    expect(mouvement(route(1), quai(2), 1, MAX)).toBe('arrivee');
    expect(mouvement(route(2, 3), quai(5), 1, MAX)).toBe('arrivee'); // express
    expect(mouvement(route(4), quai(5), 1, MAX)).toBe('arrivee'); // dernière ligne
  });

  it('premier affichage : rien avant, rien d’animé', () => {
    expect(mouvement(undefined, route(2), 1, MAX)).toBeNull();
    expect(mouvement(undefined, quai(2), 1, MAX)).toBeNull();
    expect(mouvement(undefined, undefined, 1, MAX)).toBeNull();
  });

  it('train qui disparaît (terminus, supprimé) : rien à jouer', () => {
    expect(mouvement(quai(2), undefined, 1, MAX)).toBeNull();
    expect(mouvement(route(2), undefined, 1, MAX)).toBeNull();
  });

  it('position inchangée : rien', () => {
    expect(mouvement(quai(2), quai(2), 1, MAX)).toBeNull();
    expect(mouvement(route(2), route(2), 1, MAX)).toBeNull();
    expect(mouvement(route(2, 3), route(2, 3), 1, MAX)).toBeNull();
  });

  it('plusieurs états d’un coup : position finale directe, sans animation', () => {
    // à quai en L, puis à quai en L + 1 : le train est parti ET arrivé entre deux rendus
    expect(mouvement(quai(2), quai(3), 1, MAX)).toBeNull();
    // en route de L, puis en route d’une autre ligne
    expect(mouvement(route(1), route(2), 1, MAX)).toBeNull();
    // départ vu d’une autre ligne que celle qui portait le rond
    expect(mouvement(quai(2), route(3), 1, MAX)).toBeNull();
    // arrivée ailleurs que sur la ligne visée (trop tôt, trop tard, ou en arrière)
    expect(mouvement(route(1), quai(1), 1, MAX)).toBeNull();
    expect(mouvement(route(1), quai(3), 1, MAX)).toBeNull();
    expect(mouvement(route(2, 3), quai(4), 1, MAX)).toBeNull();
    expect(mouvement(route(2, 3), quai(6), 1, MAX)).toBeNull();
  });

  it('colonne différente : le tableau a été retrié, ce n’est pas le même train au même endroit', () => {
    expect(mouvement(quai(2, 3), route(2, 1, 4), 1, MAX)).toBeNull();
    expect(mouvement(route(1, 1, 3), quai(2, 2), 1, MAX)).toBeNull();
  });

  it('heure qui saute ou qui recule (simulation, reprise après veille, minuit) : rien', () => {
    expect(mouvement(quai(2), route(2), 3, MAX)).toBeNull();
    expect(mouvement(quai(2), route(2), 600, MAX)).toBeNull();
    expect(mouvement(quai(2), route(2), -1, MAX)).toBeNull();
    expect(mouvement(quai(2), route(2), -86_000, MAX)).toBeNull();
    expect(mouvement(quai(2), route(2), Number.NaN, MAX)).toBeNull(); // pas de rendu avant
    expect(mouvement(route(1), quai(2), 3, MAX)).toBeNull();
  });

  it('les bornes de l’écart sont incluses : 0 (rendu supplémentaire) et le maximum', () => {
    expect(mouvement(quai(2), route(2), 0, MAX)).toBe('depart');
    expect(mouvement(quai(2), route(2), MAX, MAX)).toBe('depart');
    expect(mouvement(quai(2), route(2), MAX + 0.001, MAX)).toBeNull();
  });
});

describe('ecartMaxS — tolérance sur l’écart entre deux rendus', () => {
  it('2,5 fois l’intervalle de rendu de la page', () => {
    expect(ecartMaxS(1000)).toBe(2.5); // grille.html : un rendu par seconde
    expect(ecartMaxS(10_000)).toBe(25); // embed : un rendu toutes les 10 s
  });

  it('couvre un rendu retardé, pas un onglet resté en veille', () => {
    expect(ecartMaxS(1000)).toBeGreaterThanOrEqual(2); // un tick manqué sur une machine chargée
    expect(ecartMaxS(1000)).toBeLessThan(5);
  });
});

describe('imagesCles — transform et opacity SEULEMENT, jamais d’abscisse', () => {
  const m = { dy: 20, sx: 1.2, sy: 2 };
  const { fantome, nouveau } = imagesCles(m);

  it('le fantôme part de sa place, pleinement visible, et finit sur celle du nouvel élément, effacé', () => {
    expect(fantome).toHaveLength(2);
    expect(fantome[0]).toEqual({ transform: 'translate(-50%, -50%) scale(1, 1)', opacity: 1 });
    expect(fantome[1]).toEqual({
      transform: 'translate(-50%, calc(-50% + 20px)) scale(1.2, 2)',
      opacity: 0,
    });
  });

  it('le nouvel élément part de la place et de la taille du fantôme, invisible, et finit chez lui', () => {
    expect(nouveau).toHaveLength(2);
    expect(nouveau[0]).toEqual({
      transform: `translate(-50%, calc(-50% + -20px)) scale(${1 / 1.2}, ${1 / 2})`,
      opacity: 0,
    });
    expect(nouveau[1]).toEqual({ transform: 'translate(-50%, -50%) scale(1, 1)', opacity: 1 });
  });

  it('la dernière image du nouvel élément EST son style de base (translate(-50%, -50%))', () => {
    expect(nouveau[1]?.transform).toMatch(/^translate\(-50%, -50%\)/);
    const css = lire('src/styles/grille.css') + lire('src/styles/embed.css');
    expect(css).toContain('transform: translate(-50%, -50%);');
  });

  it('seules propriétés animées : transform et opacity', () => {
    for (const image of [...fantome, ...nouveau]) {
      expect(Object.keys(image).sort()).toEqual(['opacity', 'transform']);
    }
  });

  it('aucun décalage horizontal : le train ne quitte jamais sa voie', () => {
    for (const image of [...fantome, ...nouveau]) {
      expect(String(image.transform)).not.toMatch(/translateX|translate3d/);
      // l'abscisse est toujours « -50% » seul : rien n'y est ajouté
      expect(String(image.transform)).toMatch(/^translate\(-50%, /);
    }
  });

  it('les deux sens du mouvement : dy négatif (la forme monte) et dy nul', () => {
    const haut = imagesCles({ dy: -12.5, sx: 1, sy: 1 });
    expect(haut.fantome[1]?.transform).toBe('translate(-50%, calc(-50% + -12.5px)) scale(1, 1)');
    expect(haut.nouveau[0]?.transform).toBe('translate(-50%, calc(-50% + 12.5px)) scale(1, 1)');
  });

  it('une forme qui grandit pour l’une rétrécit pour l’autre, du même rapport', () => {
    const r = imagesCles({ dy: 0, sx: 4, sy: 0.5 });
    expect(r.fantome[1]?.transform).toContain('scale(4, 0.5)');
    expect(r.nouveau[0]?.transform).toContain('scale(0.25, 2)');
  });
});

describe('tempsEcoule — un rendu qui tombe PENDANT le passage', () => {
  it('rend le temps déjà écoulé, pour rejouer au bon endroit de la course', () => {
    expect(tempsEcoule(1000, 1000)).toBe(0);
    expect(tempsEcoule(1000, 1250)).toBe(250);
    expect(tempsEcoule(1000, 1000 + DUREE_TRANSITION_MS - 1)).toBe(DUREE_TRANSITION_MS - 1);
  });

  it('null une fois la durée atteinte : le passage est fini', () => {
    expect(tempsEcoule(1000, 1000 + DUREE_TRANSITION_MS)).toBeNull();
    expect(tempsEcoule(1000, 99_000)).toBeNull();
  });

  it('null si l’horloge recule : on ne rejoue pas un passage « du futur »', () => {
    expect(tempsEcoule(1000, 999)).toBeNull();
  });
});

describe('trajetPossible — le trajet mesuré est celui d’un train qui roule', () => {
  it('même abscisse (au pixel près), formes mesurables : on joue', () => {
    expect(trajetPossible(0, 18, 18)).toBe(true);
    expect(trajetPossible(1, 18, 18)).toBe(true);
    expect(trajetPossible(-1, 18, 18)).toBe(true);
  });

  it('abscisse qui a changé de plus d’un pixel (mise en page déplacée) : position finale directe', () => {
    expect(trajetPossible(1.01, 18, 18)).toBe(false);
    expect(trajetPossible(-1.01, 18, 18)).toBe(false);
    expect(trajetPossible(40, 18, 18)).toBe(false);
  });

  it('une forme sans largeur ou sans hauteur : jamais de division par zéro', () => {
    expect(trajetPossible(0, 0, 18)).toBe(false);
    expect(trajetPossible(0, 18, 0)).toBe(false);
    expect(trajetPossible(0, 0.1, 0.1)).toBe(true);
  });
});

describe('optionsAnimation — réglages communs aux deux formes', () => {
  it('durée, courbe, remplissage dans les deux sens', () => {
    expect(optionsAnimation(0)).toEqual({
      duration: DUREE_TRANSITION_MS,
      easing: COURBE_TRANSITION,
      delay: -0,
      fill: 'both',
    });
  });

  it('un rendu pendant le passage : le départ est reculé du temps déjà écoulé', () => {
    expect(optionsAnimation(250).delay).toBe(-250);
    expect(optionsAnimation(599).delay).toBe(-599);
  });
});

describe('réglages de la transformation', () => {
  it('courte (0,4 à 0,8 s), donc finie avant le rendu suivant de la grille, et sans rebond', () => {
    expect(DUREE_TRANSITION_MS).toBeGreaterThanOrEqual(400);
    expect(DUREE_TRANSITION_MS).toBeLessThanOrEqual(800);
    expect(DUREE_TRANSITION_MS).toBeLessThan(1000);
    // une courbe de Bézier dont les ordonnées restent dans [0, 1] ne dépasse jamais l’arrivée
    const ordonnees = /cubic-bezier\(([^)]*)\)/
      .exec(COURBE_TRANSITION)?.[1]
      ?.split(',')
      .map(Number);
    expect(ordonnees).toHaveLength(4);
    expect(ordonnees![1]).toBeGreaterThanOrEqual(0);
    expect(ordonnees![3]).toBeLessThanOrEqual(1);
  });
});

describe('le câblage : ce que la mesure a établi et qu’un nettoyage ne doit pas défaire', () => {
  const source = lire('src/pages/grille-transition.ts');
  const grille = lire('src/pages/grille.ts');
  const embed = lire('src/pages/embed.ts');

  it('grille.html et l’embed jouent la transformation après CHAQUE rendu, avec leur propre intervalle', () => {
    expect(grille).toContain('creeAnimateur(INTERVALLE_RENDU_MS)');
    expect(grille).toContain('animateur.apres(document, maintenant)');
    expect(embed).toContain('creeAnimateur(INTERVALLE_RENDU_MS)');
    expect(embed).toContain('animateur.apres(conteneur, heure.maintenantS())');
  });

  it('retour d’un onglet en veille : l’état précédent est oublié, rien n’est joué', () => {
    expect(grille).toMatch(/visibilitychange', \(\) => animateur\.oublie\(\)/);
    expect(embed).toMatch(/animateur\.oublie\(\); \/\/ retour d'onglet/);
  });

  it('mouvement réduit : aucun fantôme n’est créé', () => {
    expect(source).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(source).toMatch(/const peutJouer = !mouvementReduit\(\)/);
    expect(source).toMatch(/if \(!peutJouer\) continue;/);
  });

  it('jamais d’animation de top, left, width ni height, et jamais de will-change', () => {
    expect(source).not.toMatch(/will-change/);
    expect(source).not.toMatch(/\b(top|left|width|height)\s*:\s*[`'"]/);
    // les clés animées sont fixées par `imagesCles` (transform, opacity) : testées plus haut
    expect(lire('src/styles/grille.css')).not.toContain('will-change');
    expect(lire('src/styles/embed.css')).not.toContain('will-change');
  });

  it('le fantôme n’est jamais compté comme un train, ni lu par un lecteur d’écran', () => {
    expect(source).toContain("el.removeAttribute('data-train')");
    expect(source).toContain("el.setAttribute('aria-hidden', 'true')");
  });

  it('le pulse du rond est coupé pendant la transformation, et reprend à l’opacité 1 après', () => {
    const grilleCss = lire('src/styles/grille.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(grilleCss).toMatch(/\.train-pos\[data-transition\] \{\s*animation: none;\s*\}/);
    // l'attribut est retiré à la fin du passage : le pulse repart de zéro (opacité 1)
    expect(source).toContain("el.removeAttribute('data-transition')");
  });

  it('la flèche ne pulse toujours pas', () => {
    const grilleCss = lire('src/styles/grille.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(grilleCss).not.toMatch(/\.train-fleche[^{]*\{[^}]*animation/);
  });

  it('grille.html ne réécrit un tableau que s’il a changé (le pulse ne repart plus chaque seconde)', () => {
    expect(grille).toContain('if (derniersTableaux.get(el) === html) return;');
    expect(grille).toContain("poseTableau('tab-montee'");
    expect(grille).toContain("poseTableau('tab-descente'");
    expect(grille).not.toMatch(/\$\('tab-(montee|descente)'\)\.innerHTML/);
  });
});
