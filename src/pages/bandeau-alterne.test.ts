// Le bandeau ALTERNE : le message important, puis les autres (docs/01 §2.11).
//
// CE QUE CES TESTS PROTÈGENT. Deux défauts relevés à la recette du 09/09/2026,
// et qui se ressemblent : dans les deux cas l'écran montrait MOINS que ce qui
// lui avait été confié, sans jamais le dire.
//
//  1. un seul message « importante » ÉCARTAIT tous les autres du bandeau ;
//  2. un message important trop long était TRONQUÉ en silence par
//     `overflow: hidden` — le voyageur lisait « Circulation interrompue entre
//     Col de Voza et Bellevue — service de substitution par route depuis Sa »
//     et croyait savoir. Mesuré au navigateur : 1 645,8 px de débordement.
//
// Le §7.1 (« rien n'est écarté ») vit dans `affichage-commun.test.ts`, à côté
// des autres tests de `contenuTicker`. Ici : la composition du cycle, sa durée,
// sa STABILITÉ, l'oracle de largeur, et l'accord entre l'aperçu de la
// supervision et les écrans.
//
// PAS DE jsdom dans ce projet. Les fonctions qui touchent au rendu sont donc
// éprouvées sur un élément FACTICE dont la géométrie est calibrée sur des
// mesures réelles (voir `elementFactice`), et non sur une mise en page
// imaginaire.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../core/types';
import { dureeDefilementS, VITESSE_TICKER_DEFAUT } from '../core/ticker';
import {
  BUDGET_BANDEAU_MIN_EM,
  contenuTicker,
  creeTicker,
  cycleBandeau,
  debordeBandeau,
  dureePhaseS,
  largeurBandeau,
  messageEnCours,
  signatureCycle,
} from './affichage-commun';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

function message(id: string, fr: string, priorite: Message['priorite'] = 'normale'): Message {
  return { id, texte_fr: fr, texte_en: `${fr} (en)`, cible_type: 'toutes', priorite, actif: true };
}

// ---------------------------------------------------------------------------
// Un élément de rendu FACTICE, calibré sur le navigateur
// ---------------------------------------------------------------------------
// Le modèle « largeur = rembourrage + texte » n'est pas une commodité : il a
// été VÉRIFIÉ sur `ecran.html` à 1920 × 1080 le 12/09/2026.
//
//   immobile : offsetWidth = 654   = 38,4 (2vw)   + 615,6 de texte
//   défilant : offsetWidth = 4739  = 1920 (100vw) + 2819 de texte
//
// C'est aussi ce modèle qui rend l'élément factice capable de FAIRE ÉCHOUER un
// test si la règle change : une géométrie constante ne prouverait rien.

const PX_PAR_CARACTERE = 10;
const PAD_DEFILE = 1920;
const PAD_FIXE = 38.4;

interface ElementFactice {
  readonly el: HTMLElement;
  readonly poses: { html: string; fixe: boolean; duree: string }[];
}

function elementFactice(largeurOfferte: number): ElementFactice {
  const classes = new Set<string>();
  const poses: { html: string; fixe: boolean; duree: string }[] = [];
  let html = '';
  const texteVisible = (): number => html.replace(/<[^>]*>/g, '').length * PX_PAR_CARACTERE;
  const pad = (): number => (classes.has('fixe') ? PAD_FIXE : PAD_DEFILE);
  const el = {
    parentElement: { clientWidth: largeurOfferte },
    style: { animationDuration: '' },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force: boolean) => (force ? classes.add(c) : classes.delete(c)),
    },
    get className(): string {
      return [...classes].join(' ');
    },
    set className(v: string) {
      classes.clear();
      for (const c of v.split(' ').filter(Boolean)) classes.add(c);
    },
    get innerHTML(): string {
      return html;
    },
    set innerHTML(v: string) {
      html = v;
      poses.push({ html: v, fixe: classes.has('fixe'), duree: '' });
    },
    get scrollWidth(): number {
      return pad() + texteVisible();
    },
    get offsetWidth(): number {
      return pad() + texteVisible();
    },
  } as unknown as HTMLElement;
  return { el, poses };
}

/** `debordeBandeau` lit le rembourrage par `getComputedStyle` : on le fournit. */
function avecStylesFactices<T>(f: () => T): T {
  vi.stubGlobal('getComputedStyle', (e: { classList: { contains(c: string): boolean } }) => ({
    paddingLeft: `${e.classList.contains('fixe') ? PAD_FIXE : PAD_DEFILE}px`,
  }));
  try {
    return f();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ===========================================================================
// §4 — PLUSIEURS messages importants
// ===========================================================================
describe('plusieurs importants : chacun son créneau, le cycle s’allonge', () => {
  const cinq = [
    message('i1', 'Un.', 'importante'),
    message('i2', 'Deux.', 'importante'),
    message('i3', 'Trois.', 'importante'),
    message('i4', 'Quatre.', 'importante'),
    message('i5', 'Cinq.', 'importante'),
    message('n1', 'Vélos.'),
  ];

  it('AUCUN n’est plafonné ni écarté — ce serait recréer le défaut réparé', () => {
    const phases = cycleBandeau(cinq);
    expect(phases.filter((p) => p.nature === 'important')).toHaveLength(5);
    expect(phases.flatMap((p) => p.messages.map((m) => m.id))).toEqual([
      'i1',
      'i2',
      'i3',
      'i4',
      'i5',
      'n1',
    ]);
  });

  it('ils ne se PARTAGENT pas un créneau : un seul message par créneau', () => {
    // Cinq messages d'urgence dans un même créneau, c'est cinq messages lus à
    // un cinquième — donc aucun des cinq.
    for (const p of cycleBandeau(cinq).filter((x) => x.nature === 'important')) {
      expect(p.messages).toHaveLength(1);
    }
  });

  it('le cycle s’ALLONGE : le coût d’un abus de priorité est visible', () => {
    const cout = (n: number): number =>
      cycleBandeau([
        ...Array.from({ length: n }, (_, i) => message(`i${i}`, 'Urgent.', 'importante')),
        message('n', 'Vélos.'),
      ]).reduce((s, p) => s + p.parts, 0);
    // 2 parts par important + 1 pour les normaux.
    expect(cout(1)).toBe(3);
    expect(cout(5)).toBe(11);
    expect(cout(5), 'le cycle ne s’allonge pas').toBeGreaterThan(cout(1));
  });

  it('sans aucun message normal, les importants tournent quand même entre eux', () => {
    const phases = cycleBandeau([
      message('i1', 'Un.', 'importante'),
      message('i2', 'Deux.', 'importante'),
    ]);
    expect(phases.map((p) => p.nature)).toEqual(['important', 'important']);
  });

  it('sans aucun important, le bandeau d’avant ce lot : UN créneau qui défile', () => {
    const phases = cycleBandeau([message('a', 'Un.'), message('b', 'Deux.')]);
    expect(phases).toHaveLength(1);
    expect(phases[0]?.nature).toBe('normaux');
    expect(phases[0]?.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('aucun message du tout : aucun créneau, pas un créneau vide', () => {
    expect(cycleBandeau([])).toEqual([]);
  });
});

// ===========================================================================
// La durée d'un créneau — deux tiers, et JAMAIS un passage coupé
// ===========================================================================
describe('dureePhaseS : l’unité est un passage COMPLET', () => {
  it('un créneau normal dure exactement un passage', () => {
    expect(
      dureePhaseS({ nature: 'normaux', passageS: 12, passageNormauxS: 12, defile: true }),
    ).toBe(12);
  });

  it('un important IMMOBILE dure deux passages des normaux (les deux tiers)', () => {
    const d = dureePhaseS({ nature: 'important', passageS: 5, passageNormauxS: 12, defile: false });
    expect(d).toBe(24);
    expect(d / (d + 12), 'la part de l’important n’est plus 2/3').toBeCloseTo(2 / 3, 6);
  });

  it('un important qui DÉFILE fait un nombre ENTIER de passages : rien n’est coupé', () => {
    // 2 × 12 = 24 visés, passage de 10 → 2 passages (20 s), le plus proche.
    // Un arrondi PAR EXCÈS donnerait 3 passages, soit 30 s contre 12 : 71 %
    // du cycle au lieu des deux tiers décidés (mesuré : 112 s contre 30 s sur
    // le jeu réel de la recette).
    const d = dureePhaseS({ nature: 'important', passageS: 10, passageNormauxS: 12, defile: true });
    expect(d).toBe(20);
    expect(d % 10, 'le créneau coupe un passage en cours').toBe(0);
  });

  it('jamais zéro passage, même pour un message très long', () => {
    const d = dureePhaseS({ nature: 'important', passageS: 90, passageNormauxS: 3, defile: true });
    expect(d).toBe(90);
  });

  it('sans messages normaux, l’important se mesure sur LUI-MÊME', () => {
    expect(
      dureePhaseS({ nature: 'important', passageS: 8, passageNormauxS: null, defile: false }),
    ).toBe(16);
  });
});

// ===========================================================================
// §3 — l'oracle de largeur : UN seul, celui du rendu
// ===========================================================================
describe('debordeBandeau : le seul oracle de « ça tient »', () => {
  it('rend faux quand le texte tient dans la place offerte', () => {
    const { el } = elementFactice(1000);
    el.classList.add('fixe');
    el.innerHTML = 'x'.repeat(50); // 500 px de texte
    expect(avecStylesFactices(() => debordeBandeau(el))).toBe(false);
  });

  it('rend vrai dès que le texte dépasse, d’un seul pixel', () => {
    const { el } = elementFactice(499);
    el.classList.add('fixe');
    el.innerHTML = 'x'.repeat(50); // 500 px
    expect(avecStylesFactices(() => debordeBandeau(el))).toBe(true);
  });

  it('le rembourrage de défilement est RETIRÉ : sans quoi tout déborderait', () => {
    // `padding-left: 100vw` vaut à lui seul 1920 px. S'il comptait, un texte
    // vide serait déclaré trop long.
    const { el } = elementFactice(1424);
    el.innerHTML = '';
    expect(avecStylesFactices(() => debordeBandeau(el))).toBe(false);
  });

  it('les balises ne comptent PAS : c’est le texte rendu qui est mesuré', () => {
    const { el } = elementFactice(1000);
    el.classList.add('fixe');
    el.innerHTML = contenuTicker([{ texte_fr: 'Bonjour', texte_en: 'Hello' }]);
    // 7 + 1 (séparateur) + 5 = 13 caractères visibles, soit 130 px.
    expect(el.scrollWidth - PAD_FIXE).toBe(130);
  });

  it('LARGEUR NON MESURABLE : on répond « déborde », jamais « ça tient »', () => {
    // Onglet masqué, feuille absente : clientWidth = 0. Répondre « ça tient »
    // accorderait le mode immobile à n'importe quelle longueur — la troncature
    // silencieuse par la porte de derrière.
    const { el } = elementFactice(0);
    el.classList.add('fixe');
    el.innerHTML = 'x';
    expect(largeurBandeau(el)).toBe(0);
    expect(avecStylesFactices(() => debordeBandeau(el))).toBe(true);
  });
});

// ===========================================================================
// Le rendu : le mode immobile n'est accordé qu'à ce qui TIENT
// ===========================================================================
describe('creeTicker : aucune troncature silencieuse', () => {
  const important = (texte: string): Message => message('u', texte, 'importante');

  it('un important COURT est immobile', () => {
    const { el } = elementFactice(1424);
    avecStylesFactices(() => creeTicker(el)([important('x'.repeat(20))]));
    expect(el.classList.contains('fixe')).toBe(true);
  });

  it('un important TROP LONG DÉFILE — il n’est plus coupé au bord de l’écran', () => {
    // C'est le second constat de la recette : 1 645,8 px de texte perdus, et
    // la moitié anglaise jamais affichée.
    const { el } = elementFactice(1424);
    avecStylesFactices(() => creeTicker(el)([important('x'.repeat(400))]));
    expect(el.classList.contains('fixe'), 'un message tronqué est resté figé').toBe(false);
    expect(el.style.animationDuration).not.toBe('');
  });

  it('un message NORMAL ne devient jamais immobile, même très court', () => {
    // Le mode fixe est la marque visuelle de l'urgence : un message ordinaire
    // qui s'y installerait la banaliserait.
    const { el } = elementFactice(1424);
    avecStylesFactices(() => creeTicker(el)([message('a', 'x')]));
    expect(el.classList.contains('fixe')).toBe(false);
  });

  it('les deux langues sont posées, pas seulement le français', () => {
    const { el } = elementFactice(1424);
    avecStylesFactices(() => creeTicker(el)([important('Trafic interrompu.')]));
    expect(el.innerHTML).toContain('class="en"');
  });

  it('un jeu VIDE efface le bandeau et retire le mode immobile', () => {
    const { el } = elementFactice(1424);
    const maj = creeTicker(el);
    avecStylesFactices(() => maj([important('x')]));
    expect(el.classList.contains('fixe')).toBe(true);
    avecStylesFactices(() => maj([]));
    expect(el.innerHTML).toBe('');
    expect(el.classList.contains('fixe')).toBe(false);
  });
});

// ===========================================================================
// Le piège du lot : le bandeau est rafraîchi 1×/s
// ===========================================================================
describe('le cycle ne REDÉMARRE pas à chaque rafraîchissement', () => {
  it('la signature ne dépend que du CONTENU, jamais du créneau en cours', () => {
    const jeu = [message('u', 'Urgent.', 'importante'), message('a', 'Vélos.')];
    const s1 = signatureCycle(cycleBandeau(jeu));
    const s2 = signatureCycle(cycleBandeau(jeu));
    expect(s1).toBe(s2);
    // …et elle bouge dès que le contenu bouge, sinon elle ne verrouille rien.
    expect(signatureCycle(cycleBandeau([...jeu, message('b', 'Neige.')]))).not.toBe(s1);
    expect(
      signatureCycle(cycleBandeau([message('u', 'Urgent CORRIGÉ.', 'importante'), jeu[1]!])),
    ).not.toBe(s1);
    expect(
      signatureCycle(cycleBandeau([message('u', 'Urgent.'), jeu[1]!])),
      'un changement de priorité passe inaperçu',
    ).not.toBe(s1);
  });

  it('rappelé 60 fois avec le MÊME jeu, le bandeau n’est posé qu’une fois', () => {
    // Une minute de rafraîchissements. Si la signature suivait le créneau, le
    // cycle repartirait à zéro chaque seconde et le voyageur ne verrait jamais
    // que le premier créneau — le défaut réparé, reconstitué.
    const { el, poses } = elementFactice(1424);
    const maj = creeTicker(el);
    const jeu = [message('u', 'Urgent.', 'importante'), message('a', 'Vélos.')];
    avecStylesFactices(() => {
      for (let i = 0; i < 60; i++) maj(jeu, VITESSE_TICKER_DEFAUT);
    });
    // Une seule pose : celle du premier créneau. (La mesure hors écran des
    // normaux en ajoute une, plus sa restitution — d'où « au plus trois ».)
    expect(poses.length).toBeLessThanOrEqual(3);
  });

  it('un changement de CONTENU, lui, repose le bandeau', () => {
    const { el, poses } = elementFactice(1424);
    const maj = creeTicker(el);
    avecStylesFactices(() => {
      maj([message('a', 'Vélos.')], VITESSE_TICKER_DEFAUT);
      const avant = poses.length;
      maj([message('a', 'Vélos.'), message('b', 'Neige.')], VITESSE_TICKER_DEFAUT);
      expect(poses.length).toBeGreaterThan(avant);
    });
  });
});

// ===========================================================================
// L'alternance elle-même, minuteries sous contrôle
// ===========================================================================
describe('l’alternance tourne, dans l’ordre et dans les proportions décidées', () => {
  it('important → normaux → important, et les durées sont 2 pour 1', () => {
    vi.useFakeTimers();
    const { el } = elementFactice(1424);
    const maj = creeTicker(el);
    const normal = message('a', 'x'.repeat(120));
    const jeu = [message('u', 'Urgent.', 'importante'), normal];

    // Durée d'un passage des NORMAUX, recalculée ici depuis la géométrie du
    // rendu — jamais recopiée du code éprouvé : c'est ce qui rend le test
    // capable de tomber si la règle change.
    const largeurNormaux =
      PAD_DEFILE + contenuTicker([normal]).replace(/<[^>]*>/g, '').length * PX_PAR_CARACTERE;
    const passageNormauxS = dureeDefilementS(largeurNormaux, VITESSE_TICKER_DEFAUT);
    expect(passageNormauxS).toBeGreaterThan(1);

    avecStylesFactices(() => {
      maj(jeu, VITESSE_TICKER_DEFAUT);
      expect(el.classList.contains('fixe'), 'l’important court devrait être immobile').toBe(true);

      // Le créneau important vaut DEUX passages des normaux (les deux tiers).
      vi.advanceTimersByTime(2 * passageNormauxS * 1000 - 100);
      expect(el.classList.contains('fixe'), 'le créneau important a été écourté').toBe(true);
      vi.advanceTimersByTime(200);
      expect(el.classList.contains('fixe'), 'le créneau important ne rend pas la main').toBe(false);
      expect(el.innerHTML).toContain('x'.repeat(20));

      // Puis le créneau normal, d'UN passage, rend la main à l'important.
      vi.advanceTimersByTime(passageNormauxS * 1000 - 300);
      expect(el.classList.contains('fixe'), 'le créneau normal a été écourté').toBe(false);
      vi.advanceTimersByTime(400);
      expect(el.classList.contains('fixe'), 'le cycle ne revient pas à l’important').toBe(true);
    });
  });

  it('UN SEUL créneau : aucune minuterie — le bandeau d’avant ce lot, intact', () => {
    vi.useFakeTimers();
    const { el, poses } = elementFactice(1424);
    avecStylesFactices(() => {
      creeTicker(el)([message('a', 'Vélos.'), message('b', 'Neige.')], VITESSE_TICKER_DEFAUT);
      const avant = poses.length;
      vi.advanceTimersByTime(10 * 60 * 1000); // dix minutes
      expect(poses.length, 'une minuterie tourne pour rien').toBe(avant);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un nouveau jeu ARRÊTE la minuterie du précédent (18 h d’affichage par jour)', () => {
    vi.useFakeTimers();
    const { el } = elementFactice(1424);
    const maj = creeTicker(el);
    avecStylesFactices(() => {
      maj([message('u', 'Urgent.', 'importante'), message('a', 'Vélos.')], VITESSE_TICKER_DEFAUT);
      expect(vi.getTimerCount()).toBe(1);
      maj([message('a', 'Vélos.')], VITESSE_TICKER_DEFAUT); // plus d'important : un seul créneau
      expect(vi.getTimerCount(), 'la minuterie du cycle précédent survit').toBe(0);
    });
  });
});

// ===========================================================================
// §6 — l'aperçu de la supervision ne contredit plus les écrans
// ===========================================================================
describe('l’aperçu de la supervision appelle LA MÊME fonction que les écrans', () => {
  const sup = source('src/pages/supervision.ts');

  it('il passe par `creeTicker`, et non par une concaténation à lui', () => {
    expect(sup).toContain("creeTicker($('apercu-ticker'))");
    // L'ancienne règle, qui montrait un bandeau qu'aucun écran n'affichait.
    expect(sup, 'l’aperçu recompose encore le texte tout seul').not.toContain("join(' ◆ ')");
  });

  it('il respecte l’EXPIRATION, comme les écrans', () => {
    expect(sup).toContain('messageEnCours(m, Date.now())');
  });

  it('les trois pages appellent `creeTicker` : une seule règle d’affichage', () => {
    for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts', 'src/pages/supervision.ts']) {
      expect(source(page), `${page} n’appelle pas creeTicker`).toContain('creeTicker(');
    }
  });

  it('l’aperçu est REMESURÉ à l’ouverture de son onglet, qui est « bandeau »', () => {
    // Un onglet masqué a une largeur nulle ; le remesurage visait `parametres`,
    // où l'aperçu n'a jamais été. Il ne s'est donc jamais déclenché.
    expect(sup).toContain("b.dataset.t === 'bandeau' && params");
    expect(sup).not.toContain("b.dataset.t === 'parametres' && params");
  });

  it('l’aperçu suit l’ajout et le retrait d’un message', () => {
    const corps = /function rendreMessages\(\)[\s\S]*?\n}\n/.exec(sup)?.[0] ?? '';
    expect(corps, 'rendreMessages introuvable').not.toBe('');
    expect(corps).toContain('majApercuTicker(');
  });
});

describe('l’aperçu est un MODÈLE RÉDUIT de l’écran le plus étroit', () => {
  const css = source('src/styles/supervision.css');

  it('sa largeur en em EST la constante mesurée — les deux ne peuvent pas diverger', () => {
    const bloc = /\.apercu-ticker \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(bloc, 'bloc .apercu-ticker introuvable').not.toBe('');
    const largeur = /width:\s*([\d.]+)em/.exec(bloc)?.[1];
    expect(largeur, '.apercu-ticker n’est plus dimensionné en em').toBeDefined();
    expect(Number(largeur)).toBe(BUDGET_BANDEAU_MIN_EM);
  });

  it('la constante reste SOUS le minimum mesuré au navigateur', () => {
    // Mesures du 12/09/2026 sur ecran.html — les deux régimes de `ecran.css` :
    const mesures = [
      { vp: '1920×1080', em: 45.47 },
      { vp: '1366×768', em: 45.48 },
      { vp: '1280×1024', em: 30.96 },
      { vp: '1024×768', em: 30.94 },
      { vp: '800×600', em: 30.98 },
    ];
    const mini = Math.min(...mesures.map((m) => m.em));
    expect(mini).toBe(30.94);
    // Arrondi VERS LE BAS : l'erreur doit annoncer « défilera » à tort, jamais
    // « ça tient » à tort — sans quoi un message serait figé et tronqué en gare.
    expect(BUDGET_BANDEAU_MIN_EM).toBeLessThanOrEqual(mini);
    expect(BUDGET_BANDEAU_MIN_EM, 'la borne s’est éloignée de la mesure').toBeGreaterThan(mini - 1);
  });

  it('il ne se rétracte pas sous la pression du flex', () => {
    const bloc = /\.apercu-ticker \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    // `flex: 0 1 …` ou un `max-width` en pixels ramènerait l'aperçu à une
    // largeur quelconque, et son verdict deviendrait faux sans rien annoncer.
    expect(bloc).toContain('flex: 0 0 auto');
    expect(bloc).not.toMatch(/max-width:\s*\d+px/);
  });

  it('il porte les mêmes règles typographiques qu’en gare : l’anglais en 400', () => {
    // Deux graisses, deux largeurs. Sans cette règle, l'aperçu mesurerait tout
    // en 700 et annoncerait « défilera » pour des messages qui tiennent.
    expect(css).toMatch(/\.apercu-ticker-inner \.en \{[^}]*font-weight:\s*400/);
    expect(source('src/styles/ecran.css')).toMatch(/\.ticker-inner \.en \{[^}]*font-weight:\s*400/);
  });

  it('il sait rendre le mode IMMOBILE, sinon il ne montrerait jamais le créneau important', () => {
    expect(css).toMatch(/\.apercu-ticker-inner\.fixe \{[^}]*animation:\s*none/);
  });

  it('la sonde de largeur est rendue HORS CHAMP, jamais `display: none`', () => {
    // `display: none` donne scrollWidth = 0 : la sonde répondrait « ça tient »
    // pour n'importe quelle longueur.
    const bloc = /\.sonde-ticker \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(bloc, 'bloc .sonde-ticker introuvable').not.toBe('');
    expect(bloc).toContain('visibility: hidden');
    expect(bloc).not.toContain('display: none');
    expect(source('supervision.html')).toContain('id="sonde-ticker"');
  });
});

// ===========================================================================
// §5 — la supervision INFORME sur la largeur, elle ne REFUSE rien
// ===========================================================================
describe('le champ dit « tient » ou « défilera », et ne bloque jamais la saisie', () => {
  const sup = source('src/pages/supervision.ts');
  const corps = /function majVerdictLargeur\(\)[\s\S]*?\n}\n/.exec(sup)?.[0] ?? '';

  it('le verdict existe et s’appuie sur LE même oracle', () => {
    expect(corps, 'majVerdictLargeur introuvable').not.toBe('');
    expect(corps).toContain('debordeBandeau(sonde)');
  });

  it('il n’y a AUCUN refus : ni désactivation du bouton, ni message d’erreur', () => {
    expect(corps).not.toContain('disabled');
    expect(corps).not.toContain('Refus');
    // Le bouton d'ajout ne regarde pas la largeur : un message long n'est pas
    // une faute de saisie.
    const ajout = /\$\('btn-msg'\)\.addEventListener[\s\S]*?\n  \}\);\n/.exec(sup)?.[0] ?? '';
    expect(ajout, 'le gestionnaire du bouton est introuvable').not.toBe('');
    expect(ajout).not.toContain('debordeBandeau');
    expect(ajout).not.toContain('majVerdictLargeur');
  });

  it('mesure IMPOSSIBLE : il se TAIT plutôt que d’inventer un verdict', () => {
    expect(corps).toContain('clientWidth === 0');
  });

  it('il suit la frappe dans les DEUX langues, et la traduction différée', () => {
    expect(sup).toContain("$('msg-fr').addEventListener('input', majVerdictLargeur)");
    const trad = /function lanceTraduction\(\)[\s\S]*?\n}\n/.exec(sup)?.[0] ?? '';
    expect(trad).toContain('majVerdictLargeur()');
  });

  it('le formulaire ne promet plus un « bandeau fixe » qu’il ne peut pas tenir', () => {
    const html = source('supervision.html');
    expect(html, 'la promesse d’un bandeau fixe inconditionnel est revenue').not.toContain(
      'Priorité importante (bandeau fixe)',
    );
    expect(html).toContain('2 temps sur 3');
  });
});

// ===========================================================================
// `messageEnCours` — extrait, mais sans rien changer aux écrans
// ===========================================================================
describe('messageEnCours', () => {
  it('un message inactif ne passe pas', () => {
    expect(messageEnCours({ ...message('a', 'x'), actif: false }, 1_000)).toBe(false);
  });

  it('un message expiré ne passe pas', () => {
    const m = { ...message('a', 'x'), expire_at: new Date(500).toISOString() };
    expect(messageEnCours(m, 1_000)).toBe(false);
    expect(messageEnCours(m, 400)).toBe(true);
  });

  it('sans expiration, il passe', () => {
    expect(messageEnCours(message('a', 'x'), Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
