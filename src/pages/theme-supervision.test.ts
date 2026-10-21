// Choix du thème de la Supervision (20/10/2026) — ce que ces tests tiennent :
//
//  1. LE STOCKAGE NE FAIT JAMAIS TOMBER LA PAGE. Absent, inconnu, ou qui lève
//     (navigation privée, stockage bloqué) : Auto, sans erreur.
//  2. LE THÈME EFFECTIF de chaque combinaison choix × appareil.
//  3. LE SCRIPT DE DÉMARRAGE (public/theme-supervision.js, une COPIE, faute de
//     pouvoir faire passer un module par la CSP avant le premier rendu) est
//     EXÉCUTÉ et confronté à l'original, cas par cas.
//  4. UN SEUL JEU DE VALEURS SOMBRES. Les deux déclencheurs (appareil sombre
//     en Auto, Sombre forcé) résolvent les MÊMES valeurs, et ce sont celles de
//     la #73 ; le clair, appareil clair ou Clair forcé, est celui de la #73.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHOIX_THEME,
  CLE_THEME,
  appliqueChoixTheme,
  choixSuivant,
  ecrireChoixTheme,
  libelleChoixTheme,
  lireChoixTheme,
  monteChoixTheme,
  themeEffectif,
  type ChoixTheme,
  type ThemeEffectif,
} from './theme-supervision';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const source = (chemin: string): string =>
  readFileSync(join(RACINE, chemin), 'utf-8').replace(/\r\n/g, '\n');
const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Stockage en mémoire, au contrat de `localStorage`. */
function stockageMemoire(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return {
    valeurs,
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
    removeItem: (cle: string) => void valeurs.delete(cle),
  };
}

/** Stockage qui lève à chaque appel (stockage bloqué, quota). */
const stockageQuiLeve = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** `localStorage` lui-même inaccessible : l'accès lève avant tout appel. */
const accesQuiLeve = (): never => {
  throw new Error('SecurityError: localStorage');
};

describe('lireChoixTheme — tout ce qui n’est pas un choix valide vaut Auto', () => {
  it.each([
    ['clair', 'clair'],
    ['sombre', 'sombre'],
    ['auto', 'auto'],
  ] as const)('« %s » enregistré → %s', (enregistre, attendu) => {
    expect(lireChoixTheme(() => stockageMemoire({ [CLE_THEME]: enregistre }))).toBe(attendu);
  });

  it('rien d’enregistré → Auto (un poste qui n’a jamais choisi)', () => {
    expect(lireChoixTheme(() => stockageMemoire())).toBe('auto');
  });

  it.each(['Sombre', 'dark', 'light', '', ' sombre', 'null'])(
    'valeur inconnue « %s » → Auto',
    (inconnue) => {
      expect(lireChoixTheme(() => stockageMemoire({ [CLE_THEME]: inconnue }))).toBe('auto');
    },
  );

  it('le choix est lu sous SA clé, pas sous une autre', () => {
    expect(lireChoixTheme(() => stockageMemoire({ 'tmb-gare-caisse': 'sombre' }))).toBe('auto');
  });

  it('stockage qui lève → Auto, sans erreur', () => {
    expect(lireChoixTheme(() => stockageQuiLeve)).toBe('auto');
  });

  it('`localStorage` inaccessible → Auto, sans erreur', () => {
    expect(lireChoixTheme(accesQuiLeve)).toBe('auto');
  });

  it('la clé suit le préfixe des clés du poste', () => {
    expect(CLE_THEME).toBe('tmb-theme-supervision');
  });
});

describe('ecrireChoixTheme', () => {
  it('Clair et Sombre sont retenus ; Auto EFFACE la clé', () => {
    const s = stockageMemoire();
    ecrireChoixTheme(() => s, 'sombre');
    expect(s.valeurs.get(CLE_THEME)).toBe('sombre');
    ecrireChoixTheme(() => s, 'clair');
    expect(s.valeurs.get(CLE_THEME)).toBe('clair');
    ecrireChoixTheme(() => s, 'auto');
    expect(s.valeurs.has(CLE_THEME)).toBe(false);
  });

  it('ce qui est écrit se relit tel quel', () => {
    for (const choix of CHOIX_THEME) {
      const s = stockageMemoire();
      ecrireChoixTheme(() => s, choix);
      expect(lireChoixTheme(() => s)).toBe(choix);
    }
  });

  it('stockage qui lève ou inaccessible : aucune erreur', () => {
    for (const choix of CHOIX_THEME) {
      expect(() => ecrireChoixTheme(() => stockageQuiLeve, choix)).not.toThrow();
      expect(() => ecrireChoixTheme(accesQuiLeve, choix)).not.toThrow();
    }
  });
});

describe('themeEffectif — les six combinaisons', () => {
  it.each([
    ['auto', false, 'clair'],
    ['auto', true, 'sombre'],
    ['clair', false, 'clair'],
    ['clair', true, 'clair'],
    ['sombre', false, 'sombre'],
    ['sombre', true, 'sombre'],
  ] as const)('choix %s, appareil sombre = %s → %s', (choix, appareil, attendu) => {
    expect(themeEffectif(choix, appareil)).toBe(attendu);
  });
});

describe('choixSuivant — le clic fait tourner Auto → Clair → Sombre → Auto', () => {
  it.each([
    ['auto', 'clair'],
    ['clair', 'sombre'],
    ['sombre', 'auto'],
  ] as const)('%s → %s', (choix, attendu) => {
    expect(choixSuivant(choix)).toBe(attendu);
  });
});

describe('libelleChoixTheme — l’état choisi, puis l’effet du clic', () => {
  it.each([
    ['auto', 'Thème : Auto (suit le réglage de l’appareil) — cliquer pour passer en Clair'],
    ['clair', 'Thème : Clair — cliquer pour passer en Sombre'],
    ['sombre', 'Thème : Sombre — cliquer pour passer en Auto'],
  ] as const)('%s', (choix, attendu) => {
    expect(libelleChoixTheme(choix)).toBe(attendu);
  });
});

/** Élément minimal : attributs, classes, enfants, écouteurs. */
class FauxElement {
  attributs = new Map<string, string>();
  classes = new Set<string>();
  enfants: FauxElement[] = [];
  ecouteurs = new Map<string, (() => void)[]>();
  dataset: Record<string, string> = {};
  innerHTML = '';
  title = '';
  type = '';
  src = '';
  classList = { add: (c: string) => void this.classes.add(c) };
  setAttribute(nom: string, valeur: string): void {
    this.attributs.set(nom, valeur);
  }
  getAttribute(nom: string): string | null {
    return this.attributs.get(nom) ?? null;
  }
  removeAttribute(nom: string): void {
    this.attributs.delete(nom);
  }
  replaceChildren(): void {
    this.enfants = [];
  }
  append(e: FauxElement): void {
    this.enfants.push(e);
  }
  addEventListener(type: string, f: () => void): void {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), f]);
  }
  click(): void {
    for (const f of this.ecouteurs.get('click') ?? []) f();
  }
}

describe('appliqueChoixTheme — `data-theme` sur <html>', () => {
  it('Clair / Sombre posent l’attribut, Auto le retire', () => {
    const racine = new FauxElement();
    appliqueChoixTheme(racine as unknown as HTMLElement, 'sombre');
    expect(racine.getAttribute('data-theme')).toBe('sombre');
    appliqueChoixTheme(racine as unknown as HTMLElement, 'clair');
    expect(racine.getAttribute('data-theme')).toBe('clair');
    appliqueChoixTheme(racine as unknown as HTMLElement, 'auto');
    expect(racine.getAttribute('data-theme')).toBeNull();
  });
});

describe('monteChoixTheme — le bouton rond', () => {
  afterEach(() => vi.unstubAllGlobals());

  function monte(initial: Record<string, string>, appareilSombre: boolean) {
    vi.stubGlobal('document', { createElement: () => new FauxElement() });
    const conteneurs = [new FauxElement(), new FauxElement()];
    const racine = new FauxElement();
    const s = stockageMemoire(initial);
    const media = Object.assign(new FauxElement(), { matches: appareilSombre });
    const vus: ThemeEffectif[] = [];
    monteChoixTheme({
      conteneurs: conteneurs as unknown as HTMLElement[],
      racine: racine as unknown as HTMLElement,
      stockage: () => s,
      appareilSombre: media as unknown as MediaQueryList,
      surChangement: (t) => vus.push(t),
    });
    const bouton = (i: number): FauxElement => conteneurs[i]!.enfants[0]!;
    /** Le choix que CHAQUE bouton affiche et annonce. */
    const affiches = (): ChoixTheme[] =>
      conteneurs.map((c) => {
        const b = c.enfants[0]!;
        const choix = b.dataset.choix as ChoixTheme;
        expect(b.getAttribute('aria-label')).toBe(libelleChoixTheme(choix));
        expect(b.title).toBe(libelleChoixTheme(choix));
        expect(b.innerHTML).toMatch(/^<svg [^>]*aria-hidden="true"[^>]*>.+<\/svg>$/);
        return choix;
      });
    return { conteneurs, racine, s, media, vus, bouton, affiches };
  }

  it('UN bouton par conteneur, de type button, dans un conteneur `.choix-theme`', () => {
    const { conteneurs } = monte({}, false);
    for (const c of conteneurs) {
      expect(c.classes.has('choix-theme')).toBe(true);
      expect(c.enfants).toHaveLength(1);
      expect(c.enfants[0]!.type).toBe('button');
    }
  });

  it('une icône différente par choix', () => {
    const { bouton } = monte({}, false);
    const icones = new Set<string>();
    for (let i = 0; i < 3; i++) {
      icones.add(bouton(0).innerHTML);
      bouton(0).click();
    }
    expect(icones.size).toBe(3);
  });

  it('un conteneur déjà garni est VIDÉ : un seul bouton', () => {
    vi.stubGlobal('document', { createElement: () => new FauxElement() });
    const conteneur = new FauxElement();
    conteneur.append(new FauxElement());
    monteChoixTheme({
      conteneurs: [conteneur] as unknown as HTMLElement[],
      racine: new FauxElement() as unknown as HTMLElement,
      stockage: () => stockageMemoire(),
      appareilSombre: Object.assign(new FauxElement(), {
        matches: false,
      }) as unknown as MediaQueryList,
      surChangement: () => {},
    });
    expect(conteneur.enfants).toHaveLength(1);
  });

  it('au montage : le choix retenu est affiché, annoncé, posé, et le thème effectif transmis', () => {
    const { racine, vus, affiches } = monte({ [CLE_THEME]: 'sombre' }, false);
    expect(affiches()).toEqual(['sombre', 'sombre']);
    expect(racine.getAttribute('data-theme')).toBe('sombre');
    expect(vus).toEqual(['sombre']);
  });

  it('poste neuf : Auto, pas d’attribut, le thème suit l’appareil', () => {
    const { racine, vus, affiches } = monte({}, true);
    expect(affiches()).toEqual(['auto', 'auto']);
    expect(racine.getAttribute('data-theme')).toBeNull();
    expect(vus).toEqual(['sombre']);
  });

  it('chaque clic passe au choix suivant, le retient, le pose, et met LES DEUX boutons à jour', () => {
    const { racine, s, vus, bouton, affiches } = monte({}, true);
    bouton(1).click(); // sous la carte de connexion : Auto → Clair
    expect(affiches()).toEqual(['clair', 'clair']);
    expect(racine.getAttribute('data-theme')).toBe('clair');
    expect(s.valeurs.get(CLE_THEME)).toBe('clair');
    bouton(0).click(); // dans l'en-tête : Clair → Sombre
    expect(affiches()).toEqual(['sombre', 'sombre']);
    expect(racine.getAttribute('data-theme')).toBe('sombre');
    expect(s.valeurs.get(CLE_THEME)).toBe('sombre');
    bouton(0).click(); // Sombre → Auto : la clé est effacée
    expect(affiches()).toEqual(['auto', 'auto']);
    expect(racine.getAttribute('data-theme')).toBeNull();
    expect(s.valeurs.has(CLE_THEME)).toBe(false);
    expect(vus).toEqual(['sombre', 'clair', 'sombre', 'sombre']);
  });

  it('en Auto, l’appareil qui bascule met le thème effectif à jour en direct', () => {
    const { media, vus } = monte({}, false);
    media.matches = true;
    for (const f of media.ecouteurs.get('change') ?? []) f();
    expect(vus).toEqual(['clair', 'sombre']);
  });

  it('forcé, l’appareil qui bascule ne change rien', () => {
    const { media, vus } = monte({ [CLE_THEME]: 'clair' }, false);
    media.matches = true;
    for (const f of media.ecouteurs.get('change') ?? []) f();
    expect(vus).toEqual(['clair', 'clair']);
  });
});

describe('public/theme-supervision.js — la copie qui s’exécute AVANT le premier rendu', () => {
  const SCRIPT = source('public/theme-supervision.js');

  /** Exécute le script dans un bac à sable et rend le `data-theme` posé. */
  function executeScript(stockage: () => unknown): string | null {
    const html = new FauxElement();
    const fenetre = {};
    Object.defineProperty(fenetre, 'localStorage', { get: stockage });
    runInNewContext(SCRIPT, { window: fenetre, document: { documentElement: html } });
    return html.getAttribute('data-theme');
  }

  /** Ce que l'original pose pour le même stockage. */
  function original(stockage: () => ReturnType<typeof stockageMemoire>): string | null {
    const html = new FauxElement();
    appliqueChoixTheme(html as unknown as HTMLElement, lireChoixTheme(stockage));
    return html.getAttribute('data-theme');
  }

  const CAS: [string, Record<string, string>][] = [
    ['rien d’enregistré', {}],
    ['clair', { [CLE_THEME]: 'clair' }],
    ['sombre', { [CLE_THEME]: 'sombre' }],
    ['auto', { [CLE_THEME]: 'auto' }],
    ['valeur inconnue', { [CLE_THEME]: 'Sombre' }],
    ['autre clé', { 'tmb-gare-caisse': 'sombre' }],
  ];

  it.each(CAS)('%s : même data-theme que l’original', (_nom, initial) => {
    const s = stockageMemoire(initial);
    expect(executeScript(() => s)).toBe(original(() => s));
  });

  it('les cas couvrent bien les deux issues', () => {
    expect(executeScript(() => stockageMemoire({ [CLE_THEME]: 'sombre' }))).toBe('sombre');
    expect(executeScript(() => stockageMemoire({ [CLE_THEME]: 'clair' }))).toBe('clair');
    expect(executeScript(() => stockageMemoire())).toBeNull();
  });

  it('stockage qui lève ou inaccessible : rien de posé, aucune erreur', () => {
    expect(executeScript(() => stockageQuiLeve)).toBeNull();
    expect(executeScript(accesQuiLeve)).toBeNull();
  });

  it('script classique, sans module ni dépendance : il doit pouvoir s’exécuter seul', () => {
    expect(SCRIPT).not.toMatch(/^\s*(import|export)\b/m);
  });
});

describe('supervision.html — le script de démarrage précède le premier rendu', () => {
  const html = source('supervision.html');
  const tete = html.slice(0, html.indexOf('</head>'));

  it('il est dans le <head>, CLASSIQUE (ni module, ni async, ni defer), servi par la même origine', () => {
    const balise = /<script[^>]*theme-supervision\.js[^>]*><\/script>/.exec(tete)?.[0];
    expect(balise).toBe('<script src="./theme-supervision.js"></script>');
  });

  it("il vient APRÈS la CSP, qui reste `script-src 'self'` sans unsafe-inline", () => {
    expect(tete.indexOf('Content-Security-Policy')).toBeLessThan(
      tete.indexOf('theme-supervision.js'),
    );
    expect(/script-src([^;]*)/.exec(tete)?.[1]?.trim()).toBe("'self'");
  });

  it('aucun script en ligne dans la page', () => {
    for (const [balise] of html.matchAll(/<script\b[^>]*>/g)) {
      expect(balise, balise).toMatch(/\ssrc="/);
    }
  });

  it('le clic et la visibilité des onglets ne visent QUE les onglets (`[data-t]`), pas le bouton du thème', () => {
    const ts = source('src/pages/supervision.ts');
    expect(ts).not.toMatch(/'nav\.tabs button'\)/);
    expect(ts.split("'nav.tabs button[data-t]')").length - 1).toBe(3);
  });

  it('un bouton au bout de la barre d’onglets HORS de tout groupe (tous rôles), un dans la connexion', () => {
    // Pas dans l'en-tête : il le faisait passer sur deux rangs à 1440 px.
    const entete = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    expect(entete).not.toContain('data-choix-theme');
    const barre = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'));
    const finAdministration = barre.indexOf(
      '<button data-t="version">Version</button>\n        </div>',
    );
    expect(finAdministration).toBeGreaterThan(0);
    expect(barre.indexOf('<div id="choix-theme-barre" data-choix-theme></div>')).toBeGreaterThan(
      finAdministration,
    );
    const connexion = html.slice(html.indexOf('id="connexion"'), html.indexOf('<main'));
    expect(connexion).toContain('<div id="choix-theme-connexion" data-choix-theme></div>');
    expect(html.split('data-choix-theme').length - 1).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CSS : un seul jeu de valeurs sombres, deux déclencheurs
// ---------------------------------------------------------------------------

const CSS = sansCommentaires(source('src/styles/supervision.css'));

/** Corps d'une règle de premier niveau, par sélecteur exact. */
function regle(selecteur: string): string | null {
  const debut = CSS.indexOf(`\n${selecteur} {`);
  if (debut < 0) return null;
  const ouvre = CSS.indexOf('{', debut);
  return CSS.slice(ouvre + 1, CSS.indexOf('}', ouvre)).trim();
}

/** Déclarations `nom: valeur` d'un corps de règle. */
function declarations(corps: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const decl of corps
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)) {
    const i = decl.indexOf(':');
    m.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  return m;
}

/** Arguments de premier niveau de `light-dark(a, b)`, ou null. */
function argumentsLightDark(valeur: string): [string, string] | null {
  if (!valeur.startsWith('light-dark(') || !valeur.endsWith(')')) return null;
  const interieur = valeur.slice('light-dark('.length, -1);
  let profondeur = 0;
  for (let i = 0; i < interieur.length; i++) {
    const c = interieur[i];
    if (c === '(') profondeur++;
    if (c === ')') profondeur--;
    if (c === ',' && profondeur === 0) {
      return [interieur.slice(0, i).trim(), interieur.slice(i + 1).trim()];
    }
  }
  return null;
}

/**
 * Alias de :root tels que le navigateur les résout : on applique les règles
 * qui s'appliquent à <html> pour ce `data-theme`, on en tire le
 * `color-scheme` UTILISÉ (`light dark` → l'appareil), et chaque
 * `light-dark()` choisit son argument.
 */
function aliasResolus(choix: ChoixTheme, appareilSombre: boolean): Map<string, string> {
  const decl = new Map(declarations(regle(':root') ?? ''));
  if (choix !== 'auto') {
    for (const [n, v] of declarations(regle(`:root[data-theme='${choix}']`) ?? '')) {
      decl.set(n, v);
    }
  }
  const schema = decl.get('color-scheme');
  const sombre = schema === 'dark' || (schema === 'light dark' && appareilSombre);
  const resolus = new Map<string, string>();
  for (const [n, v] of decl) {
    if (!n.startsWith('--')) continue;
    const ld = argumentsLightDark(v);
    resolus.set(n, ld ? ld[sombre ? 1 : 0] : v);
  }
  return resolus;
}

/**
 * Valeurs de la #73 (`dev` aaa4cde) : [clair, sombre] de chaque alias
 * remappé. Le clair est l'ancienne valeur du `:root`, le sombre celle du bloc
 * `@media (prefers-color-scheme: dark)`, relevées par script et figées ici.
 */
const VALEURS_73: Record<string, [string, string]> = {
  '--fond': ['#f2f5f8', 'var(--sombre-page)'],
  '--carte': ['#ffffff', 'var(--sombre-carte)'],
  '--bord': ['#dce4ec', 'var(--sombre-bord)'],
  '--texte': ['#1e2e3e', 'var(--sombre-texte)'],
  '--sec': ['#64788c', 'var(--sombre-texte-sec)'],
  '--ok': ['#1f8a4c', 'var(--sombre-ok)'],
  '--ok-bg': ['#e7f5ec', 'var(--sombre-ok-bg)'],
  '--retard': ['#b97909', 'var(--sombre-retard)'],
  '--retard-bg': ['#fdf3e0', 'var(--sombre-retard-bg)'],
  '--alerte': ['#c1281e', 'var(--sombre-alerte)'],
  '--alerte-bg': ['#fcebea', 'var(--sombre-alerte-bg)'],
  '--bleu': ['#2e74b5', 'var(--sombre-bleu)'],
  '--bleu-bg': ['#eaf2fa', 'var(--sombre-bleu-bg)'],
  '--titre': ['var(--marine)', 'var(--sombre-titre)'],
  '--accent': ['var(--marine)', 'var(--sombre-accent)'],
  '--sur-accent': ['#fff', 'var(--sombre-sur-accent)'],
  '--accent-survol': ['#17293c', 'var(--sombre-texte)'],
  '--onglet-actif': ['var(--rouge)', 'var(--sombre-accent)'],
  '--rouge-texte': ['var(--rouge)', 'var(--sombre-alerte)'],
  '--lien-discret': ['var(--bleu-gris)', 'var(--sombre-texte-sec)'],
  '--fond-connexion': ['var(--marine)', 'var(--sombre-page)'],
  '--carte-douce': ['#fbfcfe', 'var(--sombre-doux)'],
  '--entete-table': ['#fafbfd', 'var(--sombre-doux)'],
  '--indic-bg': ['#f5f8fb', 'var(--sombre-doux)'],
  '--note-bg': ['#f7f9fb', 'var(--sombre-doux)'],
  '--inactif-bg': ['#fafbfc', 'var(--sombre-page)'],
  '--filet': ['#eef2f6', 'var(--sombre-filet)'],
  '--bord-fort': ['#c9d6e2', 'var(--bleu-gris)'],
  '--bord-survol': ['#b4c4d4', 'var(--bleu-gris)'],
  '--bouton-bg': ['#fff', 'var(--sombre-doux)'],
  '--champ-bg': ['#fff', 'var(--sombre-page)'],
  '--desactive-bg': ['#e7edf3', 'var(--sombre-page)'],
  '--desactive-texte': ['#9fb0c0', 'var(--bleu-gris)'],
  '--hachure': ['#b9c6d4', 'var(--sombre-bord)'],
  '--interrupteur': ['#cbd6e0', 'var(--sombre-bord)'],
  '--prio-normale': ['#c3d0dd', 'var(--bleu-gris)'],
  '--saute': ['#a9b8c6', 'var(--bleu-gris)'],
  '--neutre-bg': ['#eef2f6', 'var(--sombre-relief)'],
  '--neutre-texte': ['#4a6078', 'var(--sombre-texte-sec)'],
  '--sur-etat': ['#fff', 'var(--sombre-page)'],
  '--enregistree-bg': ['#e6f4ec', 'var(--sombre-ok-bg)'],
  '--enregistree': ['#1d6b3f', 'var(--sombre-ok)'],
  '--retard-fonce': ['#7a6017', 'var(--sombre-retard)'],
  '--retard-bord': ['#f0dcb4', 'var(--sombre-retard)'],
  '--edition-bg': ['#fdf8ec', 'var(--sombre-retard-bg)'],
  '--modif-bg': ['#fff3c4', 'var(--sombre-retard-bg)'],
  '--alerte-bord': ['#f2c9c5', 'var(--sombre-alerte)'],
  '--erreur-bg': ['#fff1f1', 'var(--sombre-alerte-bg)'],
  '--bleu-plein': ['var(--bleu)', '#2e74b5'],
  '--alerte-plein': ['var(--alerte)', '#c1281e'],
  '--violet': ['#7c3aed', '#c9b6ff'],
  '--violet-bg': ['#f3e8fd', '#2e2552'],
  '--technique': ['#4a3b7a', 'var(--violet)'],
  '--technique-bg': ['#e8e2f4', 'var(--violet-bg)'],
  '--a-vide-bg': ['#fbf7ff', '#1f2747'],
  '--anneau-rame': ['transparent', 'var(--sombre-anneau)'],
  '--ombre-barre': ['rgba(15, 30, 50, 0.08)', 'rgba(0, 0, 0, 0.5)'],
  '--ombre-toast': ['rgba(0, 0, 0, 0.25)', 'rgba(0, 0, 0, 0.6)'],
  '--ombre-modale': ['rgba(0, 0, 0, 0.3)', 'rgba(0, 0, 0, 0.6)'],
  '--voile': ['rgba(33, 59, 87, 0.45)', 'rgba(0, 0, 0, 0.6)'],
};

describe('supervision.css — un seul jeu de valeurs sombres, deux déclencheurs', () => {
  it('plus aucune requête `prefers-color-scheme` : `color-scheme` est le seul interrupteur', () => {
    expect(CSS).not.toContain('prefers-color-scheme');
    expect(declarations(regle(':root') ?? '').get('color-scheme')).toBe('light dark');
  });

  it('les déclencheurs forcés ne portent QUE `color-scheme` — aucune valeur', () => {
    expect([...declarations(regle(":root[data-theme='sombre']") ?? '')]).toEqual([
      ['color-scheme', 'dark'],
    ]);
    expect([...declarations(regle(":root[data-theme='clair']") ?? '')]).toEqual([
      ['color-scheme', 'light'],
    ]);
  });

  it('aucune autre règle ne redéclare un alias de :root, ni un `--sombre-*` hors `light-dark()`', () => {
    const alias = [...declarations(regle(':root') ?? '').keys()].filter((n) => n.startsWith('--'));
    const horsRacine = CSS.replace(/\n:root \{[^}]*\}/, '');
    for (const nom of alias) {
      expect(horsRacine, nom).not.toMatch(new RegExp(`(^|[\\s{;])${nom}\\s*:`));
    }
    expect(horsRacine).not.toContain('--sombre-');
  });

  it('les deux déclencheurs du sombre résolvent EXACTEMENT les mêmes valeurs', () => {
    const appareil = aliasResolus('auto', true);
    expect(aliasResolus('sombre', false)).toEqual(appareil);
    expect(aliasResolus('sombre', true)).toEqual(appareil);
  });

  it('Clair forcé sur un appareil sombre = appareil clair en Auto', () => {
    const clair = aliasResolus('auto', false);
    expect(aliasResolus('clair', true)).toEqual(clair);
    expect(aliasResolus('clair', false)).toEqual(clair);
  });

  it('les deux thèmes diffèrent bien (sinon les tests ci-dessus ne prouveraient rien)', () => {
    expect(aliasResolus('auto', true).get('--fond')).toBe('var(--sombre-page)');
    expect(aliasResolus('auto', false).get('--fond')).toBe('#f2f5f8');
  });

  it('mode CLAIR inchangé : chaque alias a sa valeur claire de la #73', () => {
    const clair = aliasResolus('auto', false);
    for (const [nom, [valeur]] of Object.entries(VALEURS_73)) {
      expect(clair.get(nom), nom).toBe(valeur);
    }
  });

  it('mode SOMBRE inchangé : chaque alias a sa valeur sombre de la #73', () => {
    const sombre = aliasResolus('auto', true);
    for (const [nom, [, valeur]] of Object.entries(VALEURS_73)) {
      expect(sombre.get(nom), nom).toBe(valeur);
    }
  });

  it('seuls les alias remappés par la #73 portent un `light-dark()` — les autres ne bougent pas', () => {
    for (const [nom, valeur] of declarations(regle(':root') ?? '')) {
      expect(argumentsLightDark(valeur) !== null, nom).toBe(nom in VALEURS_73);
    }
    expect(Object.keys(VALEURS_73)).toHaveLength(60);
  });
});
