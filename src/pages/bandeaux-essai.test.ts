// Grille du jour — la géométrie des bandeaux et le centrage du titre.
//
// LE DÉFAUT, mesuré le 13/09/2026 et laissé hors périmètre par la PR #34 :
// en `?demo=1` le titre centré chevauchait le bandeau de 7 px. La piste
// annoncée était l'écart entre les deux modes — 17vh contre 19vh pour deux
// bandeaux de même hauteur.
//
// CETTE PISTE ÉTAIT LA MOITIÉ DE LA RÉPONSE. L'écart existait bien, mais la
// cause du chevauchement est ailleurs : `.titre-bloc` est `position: absolute`
// avec `top: 50%`, et une boîte absolue se cale sur le PADDING BOX de son
// ancêtre. Elle ignore donc le `padding-top` qui réserve la place du bandeau.
// Preuve : le cas où les DEUX bandeaux sont actifs réservait 24vh — bien plus
// que 17 — et le titre y chevauchait de 23 px.
//
// Ces tests tiennent les trois corrections : le centrage sur l'espace
// disponible, la formule unique « en-tête = 12vh + réserve », et les hauteurs
// de bandeau mesurées.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const brut = source('src/styles/grille.css');
/** Feuille sans commentaires : un exemple cité en commentaire fausserait les règles. */
const css = brut.replace(/\/\*[\s\S]*?\*\//g, '');

/** Sépare les règles hors `@media` du bloc portrait (accolades appariées). */
function decoupe(feuille: string): { horsMedia: string; portrait: string } {
  let horsMedia = '';
  let portrait = '';
  let i = 0;
  while (i < feuille.length) {
    const debut = feuille.indexOf('@media', i);
    if (debut === -1) {
      horsMedia += feuille.slice(i);
      break;
    }
    horsMedia += feuille.slice(i, debut);
    const ouvre = feuille.indexOf('{', debut);
    let profondeur = 1;
    let j = ouvre + 1;
    while (j < feuille.length && profondeur > 0) {
      if (feuille[j] === '{') profondeur++;
      else if (feuille[j] === '}') profondeur--;
      j++;
    }
    if (feuille.slice(debut + 6, ouvre).trim() === '(orientation: portrait)') {
      portrait = feuille.slice(ouvre + 1, j - 1);
    }
    i = j;
  }
  return { horsMedia, portrait };
}

const { horsMedia, portrait } = decoupe(css);

/** Dernière valeur déclarée pour cette propriété — la cascade, pas la première. */
function valeur(declarations: string, propriete: string): string | null {
  const re = new RegExp(`(?:^|;|\\s)${propriete.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`, 'g');
  let m: RegExpExecArray | null;
  let trouve: string | null = null;
  while ((m = re.exec(declarations)) !== null) trouve = (m[1] ?? '').trim();
  return trouve;
}

/**
 * TOUTES les déclarations des blocs portant ce sélecteur, concaténées.
 *
 * Prendre le dernier BLOC ne suffisait pas : depuis le 14/09/2026 la hauteur
 * du cas combiné vit dans une liste (`.bandeau-demo, .bandeau-simule`) et son
 * `top` dans un bloc séparé qui suit. Chercher le dernier bloc rendait
 * `height` introuvable — et un test qui ne trouve rien ne prouve rien.
 */
function bloc(fragment: string, selecteur: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let vu = false;
  let tout = '';
  while ((m = re.exec(fragment)) !== null) {
    const sels = (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (!sels.includes(selecteur)) continue;
    vu = true;
    tout += `${m[2] ?? ''};`;
  }
  expect(vu, `sélecteur « ${selecteur} » introuvable`).toBe(true);
  return tout;
}

/**
 * Valeur d'une propriété pour un sélecteur, en cascade.
 *
 * Parcourt TOUS les blocs qui portent ce sélecteur — seul ou dans une liste —
 * et rend la dernière valeur trouvée. Prendre le dernier BLOC ne suffisait
 * pas : depuis le 14/09/2026 la hauteur du cas combiné vit dans une liste
 * (`.bandeau-demo, .bandeau-simule`) et son `top` dans un bloc séparé qui
 * suit ; chercher le dernier bloc rendait `height` introuvable.
 */
function valeurDe(fragment: string, selecteur: string, propriete: string): string | null {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let vu = false;
  let trouve: string | null = null;
  while ((m = re.exec(fragment)) !== null) {
    const sels = (m[1] ?? '').split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (!sels.includes(selecteur)) continue;
    vu = true;
    const v = valeur(m[2] ?? '', propriete);
    if (v !== null) trouve = v;
  }
  expect(vu, `sélecteur « ${selecteur} » introuvable`).toBe(true);
  return trouve;
}

/** Coefficient d'une valeur `Nvh` (paysage) ou `calc(N * var(--u))` (portrait). */
function coefficient(v: string | null): number | null {
  if (v === null) return null;
  const vh = /^([\d.]+)vh$/.exec(v.trim());
  if (vh) return Number(vh[1]);
  const u = /^calc\(\s*([\d.]+)\s*\*\s*var\(--u\)\s*\)$/.exec(v.trim());
  return u ? Number(u[1]) : null;
}

// ---------------------------------------------------------------------------
// 1 — Le centrage du titre, la vraie cause
// ---------------------------------------------------------------------------

describe('le titre se centre sur l’espace DISPONIBLE, pas sur l’en-tête entier', () => {
  it('`.titre-bloc` compense la réserve du bandeau dans son `top`', () => {
    // Sans cette compensation, `top: 50%` porte sur le padding box : le titre
    // se centre sur la hauteur TOTALE, bandeau compris, et remonte sous lui.
    // Mesuré à 1920×1080 sur quatre géométries : la position suit
    // `hauteur/2 − titre/2` à 5 px près, jamais la formule avec padding.
    const t = valeurDe(horsMedia, '.titre-bloc', 'top');
    expect(t, '`top` a perdu sa compensation').toBe('calc(50% + var(--reserve-bandeau, 0px) / 2)');
  });

  it('le repli de la variable est ZÉRO : le mode nominal ne bouge pas', () => {
    // C'est ce qui rend la correction sûre en production : sans bandeau, la
    // règle vaut exactement `top: 50%`, comme la maquette validée.
    expect(valeurDe(horsMedia, '.titre-bloc', 'top')).toContain('var(--reserve-bandeau, 0px)');
  });

  it('CHAQUE mode qui réserve de la place pose la variable', () => {
    // Un mode qui réserverait sans poser la variable ferait revenir le défaut,
    // et lui seul — exactement ce qui s'est passé jusqu'ici.
    const modes = [
      ['body.mode-demo', 'body.mode-demo header'],
      ['body.mode-simule', 'body.mode-simule header'],
      ['body.mode-horloge', 'body.mode-horloge header'],
      ['body.mode-simule.mode-demo', 'body.mode-simule.mode-demo header'],
    ] as const;
    for (const [porteur, entete] of modes) {
      const reserve = valeur(bloc(horsMedia, porteur), '--reserve-bandeau');
      const padding = valeur(bloc(horsMedia, entete), 'padding-top');
      expect(reserve, `${porteur} ne pose pas --reserve-bandeau`).not.toBeNull();
      // La réserve DOIT valoir le padding : c'est lui que le centrage ignore.
      expect(reserve, `${porteur} : la réserve ne suit pas le padding`).toBe(padding);
    }
  });
});

// ---------------------------------------------------------------------------
// 2 — L'écart entre les deux bandeaux ne doit pas revenir
// ---------------------------------------------------------------------------

describe('les deux bandeaux de test réservent la MÊME place', () => {
  it('démonstration et heure simulée ont la même géométrie', () => {
    // C'était l'écart signalé : 17vh contre 19vh pour deux bandeaux de 5vh.
    // Les 2vh de surplus n'avaient aucune justification écrite, ne réparaient
    // pas le chevauchement, et se prenaient sur la marge du tableau.
    for (const p of ['flex-basis', 'padding-top'] as const) {
      expect(
        valeur(bloc(horsMedia, 'body.mode-demo header'), p),
        `démonstration et heure simulée diffèrent sur ${p}`,
      ).toBe(valeur(bloc(horsMedia, 'body.mode-simule header'), p));
    }
    expect(valeurDe(horsMedia, 'body.mode-demo .badge-cache', 'top')).toBe(
      valeurDe(horsMedia, 'body.mode-simule .badge-cache', 'top'),
    );
  });

  it('l’en-tête vaut TOUJOURS 12vh plus la réserve — aucune exception', () => {
    // 12vh est la hauteur nominale (`header { flex: 0 0 12vh }`). Toute
    // géométrie qui s'en écarte est un nombre que personne ne sait relire :
    // c'est ainsi que le 19vh s'était installé.
    const nominal = valeurDe(horsMedia, 'header', 'flex');
    expect(nominal, 'la hauteur nominale de l’en-tête est introuvable').not.toBeNull();
    expect(coefficient((nominal ?? '').split(' ').pop() ?? null)).toBe(12);
    const modes = [
      'body.mode-demo header',
      'body.mode-simule header',
      'body.mode-horloge header',
      'body.mode-simule.mode-demo header',
    ];
    for (const m of modes) {
      const basis = coefficient(valeur(bloc(horsMedia, m), 'flex-basis'));
      const pad = coefficient(valeur(bloc(horsMedia, m), 'padding-top'));
      expect(basis, `${m} : flex-basis illisible`).not.toBeNull();
      expect(pad, `${m} : padding-top illisible`).not.toBeNull();
      expect(basis, `${m} : ${basis}vh ≠ 12vh + ${pad}vh`).toBe(12 + (pad ?? 0));
    }
  });

  it('le badge de cache suit l’en-tête, à 1,5vh sous lui', () => {
    // Il flotte sous l'en-tête : s'il ne suit pas la géométrie, il se retrouve
    // dans le bandeau ou dans le tableau.
    for (const [entete, badge] of [
      ['body.mode-demo header', 'body.mode-demo .badge-cache'],
      ['body.mode-simule header', 'body.mode-simule .badge-cache'],
      ['body.mode-horloge header', 'body.mode-horloge .badge-cache'],
      ['body.mode-simule.mode-demo header', 'body.mode-simule.mode-demo .badge-cache'],
    ] as const) {
      const basis = coefficient(valeur(bloc(horsMedia, entete), 'flex-basis')) ?? 0;
      const top = coefficient(valeur(bloc(horsMedia, badge), 'top'));
      expect(top, `${badge} : ${top}vh au lieu de ${basis + 1.5}vh`).toBe(basis + 1.5);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 — Les hauteurs posées se déduisent d'une mesure, écrite à côté
// ---------------------------------------------------------------------------

describe('les valeurs se relisent : la mesure est dans la feuille', () => {
  it('le resserrement du cas combiné porte sa mesure', () => {
    // 4vh au lieu de 5 quand les deux bandeaux sont actifs : sans cela, la
    // dernière ligne de la montée est coupée de 10 px — le terminus disparaît,
    // le défaut même que la PR #34 a réparé.
    const combine = bloc(horsMedia, 'body.mode-simule.mode-demo .bandeau-demo');
    expect(coefficient(valeur(combine, 'height'))).toBe(4);
    const note = brut.slice(
      brut.indexOf('ET ILS SE RESSERRENT'),
      brut.indexOf('body.mode-simule.mode-demo .bandeau-demo,'),
    );
    expect(note, 'la mesure du resserrement a disparu').toContain('10 px');
    expect(note).toContain('923 px');
  });

  it('la cause du chevauchement reste écrite à côté du correctif', () => {
    // Un défaut mesuré et non noté est un défaut qu'on remesurera un jour
    // depuis zéro. C'est la raison d'être de ce lot.
    const note = brut.slice(brut.indexOf('LE TITRE SE CENTRE'), brut.indexOf('.titre-bloc {'));
    expect(note.toLowerCase()).toContain('padding box');
    expect(note).toContain('7 px');
    expect(note).toContain('23 px');
    expect(note, 'la piste écartée n’est plus nommée').toContain('17vh / 19vh');
  });

  it('la hauteur des bandeaux en portrait porte sa mesure', () => {
    // 6u était trop court : le contenu en occupe 7,9u, la boîte débordait, et
    // le bandeau de démonstration remontait DANS celui d'heure simulée.
    const note = brut.slice(
      brut.indexOf('Bandeaux de test : leurs deux langues'),
      brut.indexOf('.bandeau-demo,\n  .bandeau-simule'),
    );
    expect(note).toContain('77 px');
    expect(note).toContain('18 px de recouvrement');
  });
});

// ---------------------------------------------------------------------------
// 4 — La correspondance paysage / portrait
// ---------------------------------------------------------------------------

describe('paysage et portrait gardent la même formule', () => {
  it('le portrait applique lui aussi « 12u + réserve »', () => {
    for (const m of [
      'body.mode-demo header',
      'body.mode-horloge header',
      'body.mode-simule.mode-demo header',
    ]) {
      const basis = coefficient(valeur(bloc(portrait, m), 'flex-basis'));
      const pad = coefficient(valeur(bloc(portrait, m), 'padding-top'));
      expect(basis, `${m} (portrait) : ${basis}u ≠ 12u + ${pad}u`).toBe(12 + (pad ?? 0));
    }
  });

  it('chaque mode pose sa réserve en --u, égale à son padding', () => {
    // Poser la réserve en vh dans le bloc portrait décalerait le titre de
    // plusieurs fois la bonne valeur : c'est le mal que --u répare.
    for (const [porteur, entete] of [
      ['body.mode-demo', 'body.mode-demo header'],
      ['body.mode-horloge', 'body.mode-horloge header'],
      ['body.mode-simule.mode-demo', 'body.mode-simule.mode-demo header'],
    ] as const) {
      const reserve = valeur(bloc(portrait, porteur), '--reserve-bandeau');
      expect(reserve, `${porteur} (portrait) sans réserve`).not.toBeNull();
      expect(reserve, `${porteur} (portrait) : réserve ≠ padding`).toBe(
        valeur(bloc(portrait, entete), 'padding-top'),
      );
      expect(reserve, `${porteur} (portrait) : réserve exprimée en vh`).toMatch(/var\(--u\)/);
    }
  });

  it('le bandeau empilé part exactement sous le premier, dans les deux blocs', () => {
    // `top` du second bandeau = hauteur du premier. S'ils divergent, les deux
    // bandeaux se recouvrent — ce qui était le cas en portrait jusqu'au 14/09.
    const hPaysage = coefficient(
      valeurDe(horsMedia, 'body.mode-simule.mode-demo .bandeau-demo', 'height'),
    );
    expect(
      coefficient(valeurDe(horsMedia, 'body.mode-simule.mode-demo .bandeau-demo', 'top')),
    ).toBe(hPaysage);
    const hPortrait = coefficient(valeurDe(portrait, '.bandeau-demo', 'height'));
    expect(coefficient(valeurDe(portrait, 'body.mode-simule.mode-demo .bandeau-demo', 'top'))).toBe(
      hPortrait,
    );
  });

  it('la réserve du cas combiné vaut DEUX bandeaux, dans les deux blocs', () => {
    for (const [fragment, nom] of [
      [horsMedia, 'paysage'],
      [portrait, 'portrait'],
    ] as const) {
      const sel = nom === 'paysage' ? 'body.mode-simule.mode-demo .bandeau-demo' : '.bandeau-demo';
      const h = coefficient(valeur(bloc(fragment, sel), 'height')) ?? 0;
      const reserve = coefficient(
        valeurDe(fragment, 'body.mode-simule.mode-demo', '--reserve-bandeau'),
      );
      expect(reserve, `${nom} : réserve ${reserve} ≠ 2 × ${h}`).toBe(2 * h);
    }
  });
});
