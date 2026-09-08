// Média injoignable : l'écran ne doit JAMAIS devenir un rectangle noir
// (M-02 et F-13, deux entrées du rapport pour un seul défaut).
//
// CE QUE CE TEST PROUVE, ET COMMENT. `ecran.ts` touche au DOM dès le
// chargement du module et le projet n'a pas de jsdom (l'ajouter serait une
// dépendance et un réglage pour trois lignes de correctif). On applique donc
// le précédent des deux PR précédentes, d'un cran plus petit : `rendMedia()`
// est DÉCOUPÉE du fichier, compilée par `transformWithEsbuild` de Vite, puis
// exécutée contre un faux DOM. Ce n'est pas une réécriture du rendu qui est
// éprouvée, c'est la fonction telle qu'elle sera livrée.
//
// Non prouvé : le rendu réel du navigateur. Le faux DOM imite ce dont la
// fonction dépend — `classList` de `body`, un conteneur dont `innerHTML`
// fabrique un élément, et les événements `load` / `loadeddata` / `error` /
// `ended`. La mesure au navigateur reste dans la recette.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Media } from '../core/types';
import { echapper } from './affichage-commun';

const CHEMIN = 'src/pages/ecran.ts';
const MAINTENANT_MS = 1_780_000_000_000;

function sourceEcran(): string {
  const url = new URL(`../../${CHEMIN}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

/** `function rendMedia(...) { … }`, accolades appariées. */
function decoupeRendMedia(src: string): string {
  const debut = src.indexOf('function rendMedia(');
  if (debut === -1) throw new Error('rendMedia() introuvable dans ecran.ts');
  const ouvre = src.indexOf('{', debut);
  let profondeur = 1;
  let i = ouvre + 1;
  while (i < src.length && profondeur > 0) {
    if (src[i] === '{') profondeur++;
    else if (src[i] === '}') profondeur--;
    i++;
  }
  return src.slice(debut, i);
}

// ---------------------------------------------------------------------------
// Faux DOM, réduit à ce dont rendMedia() a besoin
// ---------------------------------------------------------------------------

type NomEvenement = 'load' | 'loadeddata' | 'error' | 'ended';

class ElementFactice {
  readonly ecouteurs = new Map<string, (() => void)[]>();
  /** Vidéo : 2 = HAVE_CURRENT_DATA, une image est décodée. */
  readyState = 0;
  /** Image : vrai dès que le chargement est terminé, succès OU échec. */
  complete = false;
  /** Image : 0 après un échec, c'est ce qui distingue les deux cas. */
  naturalWidth = 0;

  constructor(readonly balise: 'img' | 'video') {}

  addEventListener(nom: string, fn: () => void): void {
    const liste = this.ecouteurs.get(nom) ?? [];
    liste.push(fn);
    this.ecouteurs.set(nom, liste);
  }

  /** Joue un événement du navigateur. Lève si personne ne l'écoute. */
  declenche(nom: NomEvenement): void {
    const liste = this.ecouteurs.get(nom);
    if (!liste || liste.length === 0) {
      throw new Error(`aucun écouteur « ${nom} » sur <${this.balise}>`);
    }
    for (const fn of liste) fn();
  }

  ecoute(nom: NomEvenement): boolean {
    return (this.ecouteurs.get(nom) ?? []).length > 0;
  }
}

class ConteneurFactice {
  private html = '';
  private enfant: ElementFactice | null = null;

  /**
   * État à appliquer au prochain élément créé — un média DÉJÀ en cache est
   * décodé avant que `rendMedia()` ne pose son écouteur, et c'est ce cas que
   * les garde-fous `complete` / `naturalWidth` / `readyState` couvrent.
   */
  dejaCharge: { readyState?: number; complete?: boolean; naturalWidth?: number } = {};

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(v: string) {
    this.html = v;
    // Le navigateur construit l'élément et lance le chargement : ici on ne
    // garde que la balise, les attributs restant lisibles dans `innerHTML`.
    if (v.includes('<video')) this.enfant = new ElementFactice('video');
    else if (v.includes('<img')) this.enfant = new ElementFactice('img');
    else this.enfant = null;
    if (this.enfant) Object.assign(this.enfant, this.dejaCharge);
  }

  querySelector(selecteur: string): ElementFactice | null {
    return this.enfant && this.enfant.balise === selecteur ? this.enfant : null;
  }

  /** L'élément courant, pour lui envoyer des événements. */
  get element(): ElementFactice | null {
    return this.enfant;
  }
}

interface Banc {
  rendMedia(media: Media | null, suivant: Media | null): void;
  conteneur: ConteneurFactice;
  /** Classes posées sur `document.body`. */
  classes: Set<string>;
  etatCycle(): { finMs: number } | null;
  avertissements: string[];
  /** URLs préchargées par `new Image()`. */
  prechargees: string[];
}

/**
 * Compile `rendMedia()` et l'exécute contre le faux DOM.
 *
 * `etatCycle` est initialisé sur une vue média qui se termine dans dix
 * secondes : c'est l'état réel au moment où la fonction est appelée, et c'est
 * ce `finMs` qu'un abandon doit ramener à l'instant présent pour rendre la
 * main aux horaires.
 */
async function banc(): Promise<Banc> {
  const { code } = await transformWithEsbuild(decoupeRendMedia(sourceEcran()), 'rend-media.ts', {
    loader: 'ts',
    target: 'es2022',
  });

  const conteneur = new ConteneurFactice();
  const classes = new Set<string>();
  const avertissements: string[] = [];
  const prechargees: string[] = [];

  const fabrique = new Function(
    '$',
    'heure',
    'echapper',
    'document',
    'console',
    'Image',
    `let mediaAffiche = null;
     let etatCycle = { vue: { vue: 'media', index: 0 }, finMs: ${MAINTENANT_MS + 10_000} };
     ${code}
     return { rendMedia, etatCycle: () => etatCycle };`,
  ) as (...args: unknown[]) => { rendMedia: Banc['rendMedia']; etatCycle: Banc['etatCycle'] };

  const api = fabrique(
    (id: string) => {
      if (id !== 'media-plein') throw new Error(`identifiant inattendu : ${id}`);
      return conteneur;
    },
    { maintenantMs: () => MAINTENANT_MS },
    echapper,
    {
      body: {
        classList: {
          add: (c: string) => void classes.add(c),
          remove: (c: string) => void classes.delete(c),
        },
      },
    },
    { warn: (m: string) => void avertissements.push(m) },
    class {
      set src(v: string) {
        prechargees.push(v);
      }
    },
  );

  return { ...api, conteneur, classes, avertissements, prechargees };
}

function media(complement: Partial<Media> = {}): Media {
  return {
    id: 'm1',
    nom: 'Affiche été 2026',
    type: 'image',
    url: 'https://exemple.test/affiche.png',
    duree_s: 8,
    ordre: 10,
    actif: true,
    ...complement,
  };
}

describe('le média ne couvre l’écran QU’APRÈS décodage', () => {
  let b: Banc;

  beforeEach(async () => {
    b = await banc();
  });

  it('rien n’est posé tant que l’image n’est pas chargée', () => {
    // LE défaut : `mode-media` était posé avant tout chargement, donc l'écran
    // devenait noir immédiatement, pour toute la durée annoncée.
    b.rendMedia(media(), null);
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.innerHTML).toContain('<img');
  });

  it('l’image chargée couvre l’écran', () => {
    b.rendMedia(media(), null);
    b.conteneur.element?.declenche('load');
    expect(b.classes.has('mode-media')).toBe(true);
  });

  it('la vidéo attend `loadeddata`, pas `canplay`', () => {
    // `canplay` arrive plus tôt mais sans garantie d'image décodée : l'écran
    // pourrait couvrir les horaires avec du noir pendant un instant.
    b.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.element?.ecoute('loadeddata')).toBe(true);
    b.conteneur.element?.declenche('loadeddata');
    expect(b.classes.has('mode-media')).toBe(true);
  });
});

describe('média injoignable — la main revient aux horaires tout de suite', () => {
  let b: Banc;

  beforeEach(async () => {
    b = await banc();
  });

  it('une image en erreur ne laisse ni classe ni contenu', () => {
    b.rendMedia(media(), null);
    b.conteneur.element?.declenche('error');
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.innerHTML).toBe('');
  });

  it('une image en erreur CLÔT la vue : le cycle repart', () => {
    // C'est ce qui remplace l'attente de la durée annoncée. `finMs` ramené à
    // l'instant présent fait avancer `prochainEtat()` au tour suivant —
    // exactement ce que fait la fin normale d'une vidéo.
    b.rendMedia(media(), null);
    expect(b.etatCycle()?.finMs).toBe(MAINTENANT_MS + 10_000);
    b.conteneur.element?.declenche('error');
    expect(b.etatCycle()?.finMs).toBe(MAINTENANT_MS);
  });

  it('une vidéo en erreur se comporte pareil', () => {
    b.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    b.conteneur.element?.declenche('error');
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.innerHTML).toBe('');
    expect(b.etatCycle()?.finMs).toBe(MAINTENANT_MS);
  });

  it('l’échec est DIT, avec le nom du média', () => {
    // Une panne muette se répète : c'est cette ligne qui dira à l'exploitant
    // de désactiver la ligne `medias` plutôt que d'envoyer quelqu'un en gare.
    b.rendMedia(media(), null);
    b.conteneur.element?.declenche('error');
    expect(b.avertissements).toHaveLength(1);
    expect(b.avertissements[0]).toContain('Affiche été 2026');
    expect(b.avertissements[0]).toContain('injoignable');
  });
});

describe('média DÉJÀ chargé avant la pose de l’écouteur', () => {
  // Cache du service worker, média rejoué : le navigateur peut avoir terminé
  // avant que `rendMedia()` n'attache quoi que ce soit. Sans ces garde-fous,
  // le média ne passerait jamais — l'écran resterait figé sur les horaires.
  let b: Banc;

  beforeEach(async () => {
    b = await banc();
  });

  it('une image déjà décodée couvre l’écran sans attendre d’événement', () => {
    b.conteneur.dejaCharge = { complete: true, naturalWidth: 1920 };
    b.rendMedia(media(), null);
    expect(b.classes.has('mode-media')).toBe(true);
    expect(b.avertissements).toEqual([]);
  });

  it('une image déjà terminée SANS image est abandonnée tout de suite', () => {
    // `complete` vaut VRAI après un échec aussi : c'est `naturalWidth` qui
    // distingue une image décodée d'une image manquante. Confondre les deux
    // rendrait le noir plein écran par un autre chemin.
    b.conteneur.dejaCharge = { complete: true, naturalWidth: 0 };
    b.rendMedia(media(), null);
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.innerHTML).toBe('');
    expect(b.etatCycle()?.finMs).toBe(MAINTENANT_MS);
    expect(b.avertissements).toHaveLength(1);
  });

  it('une vidéo déjà décodée (readyState 2) couvre l’écran sans attendre', () => {
    b.conteneur.dejaCharge = { readyState: 2 };
    b.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    expect(b.classes.has('mode-media')).toBe(true);
  });

  it('une vidéo à readyState 1 attend : il n’y a pas encore d’image', () => {
    // HAVE_METADATA : la durée est connue, pas la première image.
    b.conteneur.dejaCharge = { readyState: 1 };
    b.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    expect(b.classes.has('mode-media')).toBe(false);
  });
});

describe('ce qui existait déjà, préservé', () => {
  let b: Banc;

  beforeEach(async () => {
    b = await banc();
  });

  it('une vidéo plus courte que sa durée annoncée rend la main', () => {
    b.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    b.conteneur.element?.declenche('loadeddata');
    b.conteneur.element?.declenche('ended');
    expect(b.etatCycle()?.finMs).toBe(MAINTENANT_MS);
  });

  it('rendMedia(null) retire la classe et vide le conteneur', () => {
    b.rendMedia(media(), null);
    b.conteneur.element?.declenche('load');
    b.rendMedia(null, null);
    expect(b.classes.has('mode-media')).toBe(false);
    expect(b.conteneur.innerHTML).toBe('');
  });

  it('le média suivant est préchargé quand c’est une image', () => {
    b.rendMedia(media(), media({ id: 'm2', url: 'https://exemple.test/suivant.png' }));
    expect(b.prechargees).toEqual(['https://exemple.test/suivant.png']);
  });

  it('l’URL reste échappée dans l’attribut', () => {
    b.rendMedia(media({ url: 'https://exemple.test/a"b.png' }), null);
    expect(b.conteneur.innerHTML).toContain('&quot;');
    expect(b.conteneur.innerHTML).not.toContain('a"b.png');
  });
});

describe('crossorigin — la réponse cesse d’être opaque', () => {
  it('les deux balises portent crossorigin="anonymous"', async () => {
    // Supabase Storage renvoie `Access-Control-Allow-Origin: *` sur les
    // objets publics. Sans cet attribut, le statut de la réponse est
    // illisible et un 404 ne se distingue pas d'un succès. C'est aussi la
    // moitié du correctif de M-06 (le service worker met en cache
    // définitivement les réponses opaques, erreurs comprises).
    const b = await banc();
    b.rendMedia(media(), null);
    expect(b.conteneur.innerHTML).toContain('crossorigin="anonymous"');
    const b2 = await banc();
    b2.rendMedia(media({ type: 'video', url: 'https://exemple.test/clip.mp4' }), null);
    expect(b2.conteneur.innerHTML).toContain('crossorigin="anonymous"');
  });
});
