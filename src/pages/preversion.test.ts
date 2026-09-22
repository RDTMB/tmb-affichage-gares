// La préversion se dénonce elle-même.
//
// CE QUE CES TESTS PROTÈGENT. Le site publié a deux moitiés servies par la
// même origine : la racine, qui EST l'affichage en gare, et `/preview/`,
// branchée sur la base de test. Sans marque, les deux sont indiscernables à
// l'œil — mêmes gares, mêmes trains, même charte. Le défaut qu'on ferme ici
// n'est pas un défaut de rendu, c'est une confusion d'exploitation : publier
// un message d'essai en croyant être sur la préversion, ou déclarer qu'un
// correctif est en ligne parce qu'on l'a vu sur `/preview/`.
//
// Comment, sans jsdom (le projet n'en a pas) : `marquePreversion()` prend son
// document et sa base en PARAMÈTRES. On éprouve donc la fonction telle qu'elle
// est livrée, contre un faux document réduit à ce qu'elle touche.
//
// NON prouvé ici : le rendu au navigateur. Il reste dans la recette — ouvrir
// `/preview/ecran.html?gare=saint-gervais` et voir le cadre rouge.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { estPreversion, marquePreversion, prefixeTitre, TEXTE_PREVERSION } from './preversion';

// ---------------------------------------------------------------------------
// Faux document, réduit à ce que `marquePreversion()` touche
// ---------------------------------------------------------------------------

interface ElementFactice {
  className: string;
  id: string;
  textContent: string;
  attributs: Map<string, string>;
  enfants: ElementFactice[];
  setAttribute(nom: string, valeur: string): void;
  appendChild(enfant: ElementFactice): void;
}

function elementFactice(): ElementFactice {
  const el: ElementFactice = {
    className: '',
    id: '',
    textContent: '',
    attributs: new Map(),
    enfants: [],
    setAttribute: (nom, valeur) => void el.attributs.set(nom, valeur),
    appendChild: (enfant) => void el.enfants.push(enfant),
  };
  return el;
}

function documentFactice(titre: string) {
  const classes: string[] = [];
  const corps = elementFactice();
  const doc = {
    title: titre,
    documentElement: { classList: { add: (c: string) => void classes.push(c) } },
    body: corps,
    createElement: () => elementFactice(),
  };
  return { doc: doc as unknown as Document, classes, corps };
}

/** Le code source d'une surface, tel qu'il est livré. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf-8');
}

const BASE_PRODUCTION = '/tmb-affichage-gares/';
const BASE_PREVERSION = '/tmb-affichage-gares/preview/';

describe('quel build est une préversion', () => {
  it('le chemin de base de `/preview/` en est une', () => {
    expect(estPreversion(BASE_PREVERSION)).toBe(true);
  });

  it('celui de la production n’en est pas une', () => {
    // C'est LE cas qui compte : un faux positif poserait un cadre « base de
    // test » sur les six écrans en gare.
    expect(estPreversion(BASE_PRODUCTION)).toBe(false);
  });

  it('ni le serveur de développement, ni un build local', () => {
    expect(estPreversion('/')).toBe(false);
    expect(estPreversion('./')).toBe(false);
    expect(estPreversion('')).toBe(false);
  });

  it('c’est le DERNIER segment qui décide, pas une occurrence quelque part', () => {
    // `/preview/` doit être la racine servie, pas un dossier traversé.
    expect(estPreversion('/tmb-affichage-gares/preview/ecran/')).toBe(false);
    expect(estPreversion('/preview-des-horaires/')).toBe(false);
    // Sans barre finale — Vite normalise, mais rien ne l'y oblige.
    expect(estPreversion('/tmb-affichage-gares/preview')).toBe(true);
  });
});

describe('la marque posée dans la page', () => {
  it('production : la page n’est pas touchée du tout', () => {
    const { doc, classes, corps } = documentFactice('TMB — Écran de gare');
    expect(marquePreversion(doc, BASE_PRODUCTION)).toBe(false);
    expect(classes).toEqual([]);
    expect(corps.enfants).toHaveLength(0);
    expect(doc.title).toBe('TMB — Écran de gare');
  });

  it('préversion : cadre, étiquette et titre', () => {
    const { doc, classes, corps } = documentFactice('TMB — Écran de gare');
    expect(marquePreversion(doc, BASE_PREVERSION)).toBe(true);

    expect(classes).toEqual(['preversion']);
    expect(doc.title).toBe('PRÉVERSION — TMB — Écran de gare');

    expect(corps.enfants).toHaveLength(1);
    const cadre = corps.enfants[0]!;
    expect(cadre.className).toBe('cadre-preversion');
    // Décor : la liseuse d'écran l'ignore, et il n'intercepte aucun clic.
    expect(cadre.attributs.get('aria-hidden')).toBe('true');

    const etiquette = cadre.enfants[0]!;
    expect(etiquette.className).toBe('etiquette-preversion');
    expect(etiquette.textContent).toBe(TEXTE_PREVERSION);
  });

  it('une page qui se RENOMME garde son préfixe', () => {
    // Le défaut mesuré au navigateur : l'écran de gare réécrit son titre dès
    // qu'il connaît sa gare (« TMB — Saint-Gervais »), et le préfixe posé au
    // démarrage disparaissait. L'onglet redevenait celui de la gare.
    expect(prefixeTitre('TMB — Saint-Gervais', BASE_PREVERSION)).toBe(
      'PRÉVERSION — TMB — Saint-Gervais',
    );
    expect(prefixeTitre('TMB — Saint-Gervais', BASE_PRODUCTION)).toBe('TMB — Saint-Gervais');
  });

  it('aucune surface n’écrit `document.title` sans passer par là', () => {
    // C'est la seule façon de ne pas refaire le défaut : un `document.title =`
    // écrit directement rend l'onglet à la gare, en silence.
    for (const chemin of ['./ecran.ts', './grille.ts', './supervision.ts', './index.ts']) {
      for (const ligne of source(chemin).split('\n')) {
        if (!ligne.includes('document.title =')) continue;
        expect(ligne, `${chemin} : ${ligne.trim()}`).toContain('titrePage(');
      }
    }
  });

  it('l’étiquette dit les trois choses qu’il faut, en une lecture', () => {
    // Ce qu'on regarde (une préversion), sur quelles données (la base de
    // test), et ce que ce n'est PAS (l'affichage en gare).
    expect(TEXTE_PREVERSION).toContain('PRÉVERSION');
    expect(TEXTE_PREVERSION).toContain('BASE DE TEST');
    expect(TEXTE_PREVERSION).toContain('GARE');
  });

  it('le texte est POSÉ, jamais interprété comme du HTML', () => {
    // `textContent`, pas `innerHTML` : la règle d'échappement du projet vaut
    // aussi pour un texte écrit en dur, parce qu'elle se relâche autrement.
    const code = source('./preversion.ts');
    expect(code).not.toContain('innerHTML');
    expect(code).toContain('etiquette.textContent = TEXTE_PREVERSION');
  });
});

describe('les QUATRE surfaces la posent', () => {
  // Le vrai risque n'est pas que la marque soit mal dessinée : c'est qu'une
  // page soit oubliée. Une seule surface muette suffit à rendre la confusion
  // possible, et c'est justement l'écran de gare qui trompe le plus.
  const SURFACES = ['./ecran.ts', './grille.ts', './supervision.ts', './index.ts'];

  it.each(SURFACES)('%s appelle poseMarquePreversion()', (chemin) => {
    const code = source(chemin);
    expect(code).toMatch(/import \{ poseMarquePreversion[^}]*\} from '\.\/preversion';/);
    expect(code).toContain('poseMarquePreversion();');
  });

  it('la marque vient du chemin de base du BUILD, pas de l’URL lue à l’exécution', () => {
    // Une URL se recopie, se mandate, s'ouvre à travers un tunnel.
    // `import.meta.env.BASE_URL` est figé par Vite au moment du build : il ne
    // peut ni apparaître dans l'artefact de la production, ni manquer dans
    // celui de la préversion.
    const code = source('./preversion.ts');
    expect(code).toContain('marquePreversion(document, import.meta.env.BASE_URL)');
    expect(code).not.toContain('window.location');
  });
});

describe('la feuille de style', () => {
  const css = source('../styles/preversion.css');

  it('rien ne se peint sans la classe posée par le code', () => {
    // La feuille est chargée par les quatre surfaces, y compris en
    // production : elle doit y être strictement inerte.
    expect(css).toMatch(/\.cadre-preversion \{\s*display: none;\s*\}/);
  });

  it('le cadre passe AU-DESSUS de tout, et ne prend aucun clic', () => {
    // Le plus haut z-index du projet est 100 (médias plein écran, veille,
    // fenêtres de supervision) : un marqueur que le mode veille recouvrirait
    // ne servirait à rien.
    const zIndex = Number(/z-index: (\d+);/.exec(css)?.[1]);
    expect(zIndex).toBeGreaterThan(100);
    expect(css).toContain('pointer-events: none;');
  });

  it('les couleurs sortent des jetons de la charte', () => {
    expect(css).toContain('var(--tmb-rouge)');
    expect(css).toContain('var(--police-titres)');
  });
});
