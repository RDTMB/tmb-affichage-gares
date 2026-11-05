// Transformation du train entre « à quai » (le rond) et « en route » (la flèche).
//
// POURQUOI UN MODULE À PART. Les deux pages reconstruisent leur tableau par
// `innerHTML` (la grille à chaque seconde, l'embed toutes les 10 s et à chaque
// clic) : le rond et la flèche d'un rendu ne sont JAMAIS les mêmes nœuds que
// ceux du rendu suivant, et une transition CSS ne se jouerait donc jamais
// (mesuré le 05/11/2026 : un nœud marqué à la main a disparu au tick suivant).
// On ne change PAS cette mécanique — elle porte le tri des colonnes, les trains
// barrés, la colonne éclairée — : on compare, après chaque rendu, l'état de
// chaque train à celui du rendu précédent, et on JOUE le passage de l'un à
// l'autre par-dessus le tableau neuf (technique « FLIP »).
//
// LA TECHNIQUE : un fondu croisé avec échelle, deux formes qui voyagent
// ensemble. L'ancienne forme (un clone, le « fantôme ») est posée là où elle
// était, le nouvel élément est posé là où il est ; le fantôme glisse vers la
// nouvelle position en s'effaçant et en prenant la taille de la nouvelle forme,
// le nouvel élément arrive de l'ancienne position en apparaissant et en partant
// de la taille de l'ancienne. Au regard c'est UNE forme qui descend de la ligne
// de la gare jusqu'à mi-chemin (ou l'inverse) en changeant de silhouette.
// Retenue parce que c'est la seule qui tienne la contrainte du Raspberry Pi :
// `transform` et `opacity` seulement, jamais `top` / `width` / `height`
// (`border-radius`, `clip-path` ou l'interpolation d'un tracé SVG redessinent
// à chaque image).
//
// La DÉCISION d'animer (`mouvement`) et les images clés (`imagesCles`) sont
// pures et testées ; le reste ne fait que lire et poser du DOM.

/** Un train sur la grille, tel que le rendu l'a posé. */
export interface EtatTrain {
  /** `quai` : le rond sur la ligne d'une gare ; `route` : la flèche entre deux lignes. */
  etat: 'quai' | 'route';
  /** Rang de la ligne qui PORTE l'élément (index de la ligne dans le tableau). */
  ligne: number;
  /** 0 à quai ; sinon nombre de lignes jusqu'à la gare suivante (≥ 1). */
  saut: number;
  /** Rang de la colonne du train : une colonne qui change = le tableau a été retrié. */
  col: number;
}

export type Mouvement = 'depart' | 'arrivee';

/**
 * Durée du passage. 0,6 s : assez pour que l'œil suive une forme qui descend
 * d'une demi-ligne, assez court pour être finie bien avant le rendu suivant de
 * la grille (1 s). Sans rebond (courbe d'accélération puis de freinage).
 */
export const DUREE_TRANSITION_MS = 600;
export const COURBE_TRANSITION = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Écart maximal d'heure entre deux rendus pour que le passage soit joué : 2,5
 * fois l'intervalle de rendu de la page. Au-delà, ce n'est plus « un train qui
 * change d'état sous les yeux » : onglet en veille, horloge qui saute,
 * rechargement — la position finale est posée directement.
 */
export function ecartMaxS(intervalleRenduMs: number): number {
  return (intervalleRenduMs * 2.5) / 1000;
}

/**
 * Le train a-t-il changé d'état d'un rendu au suivant, et d'UN SEUL état ?
 *
 * - `depart` : à quai sur la ligne L, puis en route depuis cette même ligne ;
 * - `arrivee` : en route depuis L vers L + saut, puis à quai sur L + saut ;
 * - `null` partout ailleurs : premier affichage (rien avant), position
 *   inchangée, colonne différente, plusieurs états d'un coup (par exemple
 *   d'une gare à une autre), heure qui recule (minuit) ou qui saute.
 */
export function mouvement(
  avant: EtatTrain | undefined,
  apres: EtatTrain | undefined,
  ecart_s: number,
  ecartMax_s: number,
): Mouvement | null {
  if (!avant || !apres) return null;
  if (!(ecart_s >= 0 && ecart_s <= ecartMax_s)) return null;
  if (avant.col !== apres.col) return null;
  if (avant.etat === 'quai' && apres.etat === 'route') {
    return apres.ligne === avant.ligne ? 'depart' : null;
  }
  if (avant.etat === 'route' && apres.etat === 'quai') {
    return apres.ligne === avant.ligne + avant.saut ? 'arrivee' : null;
  }
  return null;
}

export interface MesuresTransition {
  /** Écart vertical (px) du centre du NOUVEL élément par rapport à celui du fantôme. */
  dy: number;
  /** Largeur du nouvel élément / largeur du fantôme. */
  sx: number;
  /** Hauteur du nouvel élément / hauteur du fantôme. */
  sy: number;
}

/**
 * Images clés des deux éléments. Le CSS pose `translate(-50%, -50%)` pour centrer
 * l'élément sur sa voie : les images clés le REPRENNENT (une animation par script
 * remplace `transform` en entier) et n'y ajoutent qu'un décalage vertical et une
 * échelle. Rien d'horizontal : le train ne quitte jamais sa voie.
 *
 * Le fantôme part de sa place et glisse jusqu'à celle du nouvel élément en
 * s'effaçant ; le nouvel élément part de la place du fantôme et arrive à la
 * sienne en apparaissant. Les deux opacités se complètent à chaque instant.
 */
export function imagesCles(m: MesuresTransition): { fantome: Keyframe[]; nouveau: Keyframe[] } {
  const centre = 'translate(-50%, -50%)';
  const decale = (dy: number): string => `translate(-50%, calc(-50% + ${dy}px))`;
  return {
    fantome: [
      { transform: `${centre} scale(1, 1)`, opacity: 1 },
      { transform: `${decale(m.dy)} scale(${m.sx}, ${m.sy})`, opacity: 0 },
    ],
    nouveau: [
      { transform: `${decale(-m.dy)} scale(${1 / m.sx}, ${1 / m.sy})`, opacity: 0 },
      { transform: `${centre} scale(1, 1)`, opacity: 1 },
    ],
  };
}

/**
 * Temps déjà écoulé d'un passage en cours (ms), ou `null` s'il est fini. Un
 * rendu qui tombe PENDANT le passage reconstruit le tableau — et donc les deux
 * éléments : on les rejoue au bon endroit de la course plutôt que de les voir
 * disparaître ou repartir de zéro.
 */
export function tempsEcoule(debutMs: number, maintenantMs: number): number | null {
  const ecoule = maintenantMs - debutMs;
  return ecoule >= 0 && ecoule < DUREE_TRANSITION_MS ? ecoule : null;
}

/**
 * Le trajet mesuré est-il celui d'un train qui roule ? Une abscisse qui change
 * de plus d'un pixel n'en est pas un : la mise en page a bougé (fenêtre
 * redimensionnée entre deux rendus). Une forme sans taille non plus : elle
 * ferait diviser par zéro l'échelle. Dans les deux cas, position finale directe.
 */
export function trajetPossible(
  dx: number,
  largeurFantome: number,
  hauteurFantome: number,
): boolean {
  return Math.abs(dx) <= 1 && largeurFantome > 0 && hauteurFantome > 0;
}

/**
 * Réglages des deux animations. `delay` NÉGATIF : un rendu qui tombe pendant le
 * passage rejoue l'animation déjà avancée de `ecoule` ms. `fill: both` : la
 * première image est tenue avant le démarrage (le nouvel élément est invisible,
 * sinon il clignoterait à pleine opacité), la dernière jusqu'à `cancel()`.
 */
export function optionsAnimation(ecoule: number): KeyframeAnimationOptions {
  return {
    duration: DUREE_TRANSITION_MS,
    easing: COURBE_TRANSITION,
    delay: -ecoule,
    fill: 'both',
  };
}

// ---------------------------------------------------------------------------
// Partie DOM : lit les états après chaque rendu, joue les passages.
// ---------------------------------------------------------------------------

interface Instantane {
  cle: string;
  etat: EtatTrain;
  /** Le balisage de l'élément tel que le rendu l'a posé (avant toute animation). */
  html: string;
}

interface Passage {
  mouvement: Mouvement;
  debutMs: number;
  /** L'état d'ARRIVÉE : un passage n'est rejoué que tant que le train y est. */
  vers: EtatTrain;
  /** Ancien élément : où il était (ligne) et à quoi il ressemblait. */
  ligneAvant: number;
  htmlAvant: string;
}

export interface Animateur {
  /** À appeler juste APRÈS chaque rendu du tableau (même si rien n'a changé). */
  apres(racine: ParentNode, maintenant_s: number): void;
  /** Oublie l'état précédent : le prochain rendu ne jouera rien (retour d'onglet). */
  oublie(): void;
}

function lit(racine: ParentNode): Map<string, Instantane> {
  const instantanes = new Map<string, Instantane>();
  racine.querySelectorAll<HTMLElement>('[data-train]').forEach((el) => {
    const cle = el.dataset['train'];
    const ligne = el.closest('tr');
    const cellule = el.closest('td');
    if (!cle || !ligne || !cellule) return;
    const route = el.classList.contains('train-fleche');
    instantanes.set(cle, {
      cle,
      html: el.outerHTML,
      etat: {
        etat: route ? 'route' : 'quai',
        ligne: ligne.sectionRowIndex,
        saut: route ? Number.parseInt(el.style.getPropertyValue('--saut'), 10) || 1 : 0,
        col: cellule.cellIndex,
      },
    });
  });
  return instantanes;
}

function mouvementReduit(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Un élément à partir de son balisage, prêt à servir de fantôme. `Element` et
 * non `HTMLElement` : la flèche est un `<svg>`, que cette garde écartait (le
 * fantôme de l'arrivée n'était jamais posé — constaté au navigateur).
 */
function fantomeDe(html: string): Element | null {
  const gabarit = document.createElement('template');
  gabarit.innerHTML = html;
  const el = gabarit.content.firstElementChild;
  if (!el) return null;
  el.removeAttribute('data-train'); // jamais compté comme un train
  el.setAttribute('data-fantome', '');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Joue le passage d'UN train sur le tableau qui vient d'être posé. */
function joue(el: HTMLElement, passage: Passage, ecoule: number): void {
  const table = el.closest('table');
  const cellule = el.closest('td');
  const cellAvant = table?.tBodies[0]?.rows[passage.ligneAvant]?.cells[cellule?.cellIndex ?? -1];
  const fantome = fantomeDe(passage.htmlAvant);
  if (!cellAvant || !fantome) return;

  fantome.setAttribute('data-transition', '');
  cellAvant.appendChild(fantome);
  // MESURÉ dans le tableau neuf, fantôme et nouvel élément côte à côte : pas
  // d'hypothèse sur la hauteur des lignes, ni sur ce que le défilement a fait.
  const rf = fantome.getBoundingClientRect();
  const rn = el.getBoundingClientRect();
  const dx = rn.left + rn.width / 2 - (rf.left + rf.width / 2);
  const dy = rn.top + rn.height / 2 - (rf.top + rf.height / 2);
  // Une abscisse qui change n'est pas un train qui roule : la mise en page a
  // bougé (fenêtre redimensionnée). Position finale directe.
  if (!trajetPossible(dx, rf.width, rf.height)) {
    fantome.remove();
    return;
  }
  const images = imagesCles({ dy, sx: rn.width / rf.width, sy: rn.height / rf.height });
  el.setAttribute('data-transition', '');
  const options = optionsAnimation(ecoule);
  const aFantome = fantome.animate(images.fantome, options);
  const aNouveau = el.animate(images.nouveau, options);
  const termine = (): void => {
    fantome.remove();
    el.removeAttribute('data-transition');
    // Plus de remplissage : l'élément reprend son style de base, identique à la
    // dernière image, et le pulse du rond repart de l'opacité 1.
    aFantome.cancel();
    aNouveau.cancel();
  };
  aNouveau.onfinish = termine;
}

export function creeAnimateur(intervalleRenduMs: number): Animateur {
  const ecartMax_s = ecartMaxS(intervalleRenduMs);
  let precedent = new Map<string, Instantane>();
  let dernierTemps_s: number | null = null;
  let passages = new Map<string, Passage>();

  return {
    oublie() {
      precedent = new Map();
      dernierTemps_s = null;
      passages = new Map();
    },
    apres(racine, maintenant_s) {
      const courant = lit(racine);
      const ecart_s = dernierTemps_s === null ? Number.NaN : maintenant_s - dernierTemps_s;
      const maintenantMs = performance.now();
      const peutJouer = !mouvementReduit() && typeof Element.prototype.animate === 'function';

      for (const [cle, apres] of courant) {
        const avant = precedent.get(cle);
        const m = mouvement(avant?.etat, apres.etat, ecart_s, ecartMax_s);
        if (m && avant && !passages.has(cle)) {
          passages.set(cle, {
            mouvement: m,
            debutMs: maintenantMs,
            vers: apres.etat,
            ligneAvant: avant.etat.ligne,
            htmlAvant: avant.html,
          });
        }
      }

      // Un rendu a reconstruit les nœuds : les animations des anciens sont
      // périmées. On les retire, on rejoue chaque passage encore en cours.
      // (Un tableau resté INTACT garde ses nœuds, leur attribut et leur
      // animation : on n'y touche pas, sinon deux fantômes se superposeraient.)
      for (const [cle, passage] of passages) {
        const apres = courant.get(cle);
        const ecoule = tempsEcoule(passage.debutMs, maintenantMs);
        if (
          !apres ||
          ecoule === null ||
          apres.etat.etat !== passage.vers.etat ||
          apres.etat.ligne !== passage.vers.ligne
        ) {
          passages.delete(cle);
          continue;
        }
        if (!peutJouer) continue;
        const el = racine.querySelector<HTMLElement>(`[data-train="${CSS.escape(cle)}"]`);
        if (!el || el.hasAttribute('data-transition')) continue;
        joue(el, passage, ecoule);
      }

      precedent = courant;
      dernierTemps_s = maintenant_s;
    },
  };
}
