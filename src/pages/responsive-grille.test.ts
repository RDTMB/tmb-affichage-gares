// Grille du jour — adaptation aux AUTRES formats de moniteur.
//
// `grille.html` est un affichage de KIOSQUE, frère de l'écran de gare :
// docs/01 §1 la documente « Écran public optionnel (22", totem…) », elle
// porte son propre identifiant de poste (`type: 'grille'`, grille.ts) et
// n'est ouverte que depuis le portail de test et « Aperçu écrans ». Sa
// feuille est écrite en vh pour un PAYSAGE 16:9 ; les règles verrouillées
// ici sont celles qui l'adaptent aux formats MESURÉS comme dégradés le
// 06/09/2026 (portrait, paysage plus étroit que 4:3) — et rien d'autre : un
// 16:9 de 390 px comme de 1920 px doit garder les valeurs de la maquette.
//
// Verrouillage du TEXTE de la feuille, comme demarrage-ecrans.test.ts : la
// page n'est pas importable dans Vitest (DOM dès le chargement, pas de jsdom).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8');
}

/** Feuille sans commentaires : un exemple cité en commentaire fausserait les tests. */
const css = source('src/styles/grille.css').replace(/\/\*[\s\S]*?\*\//g, '');

interface BlocMedia {
  requete: string;
  corps: string;
}

interface Regle {
  selecteurs: string[];
  declarations: string;
}

/** Sépare les règles hors `@media` des blocs `@media` (accolades appariées). */
function decoupe(feuille: string): { horsMedia: string; medias: BlocMedia[] } {
  const medias: BlocMedia[] = [];
  let horsMedia = '';
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
    medias.push({
      requete: feuille.slice(debut + '@media'.length, ouvre).trim(),
      corps: feuille.slice(ouvre + 1, j - 1),
    });
    i = j;
  }
  return { horsMedia, medias };
}

/** Règles `sélecteurs { déclarations }` d'un fragment sans `@media` imbriqué. */
function regles(fragment: string): Regle[] {
  const out: Regle[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const selecteurs = (m[1] ?? '')
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    out.push({ selecteurs, declarations: m[2] ?? '' });
  }
  return out;
}

/** Valeur d'une propriété dans un bloc de déclarations, ou null. */
function valeur(declarations: string, propriete: string): string | null {
  const m = new RegExp(`(?:^|;|\\s)${propriete.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`).exec(
    declarations,
  );
  return m ? (m[1] ?? '').trim() : null;
}

/** Règles d'un fragment portant `propriete`, indexées par sélecteur individuel. */
function parSelecteur(fragment: string, propriete: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const regle of regles(fragment)) {
    const v = valeur(regle.declarations, propriete);
    if (v === null) continue;
    for (const s of regle.selecteurs) index.set(s, v);
  }
  return index;
}

const { horsMedia, medias } = decoupe(css);
const portrait = medias.find((b) => b.requete === '(orientation: portrait)');
const paysage = medias.filter((b) => b.requete.includes('orientation: landscape'));

describe('grille.css — les @media ne visent que l’orientation et le rapport d’aspect', () => {
  it('un bloc portrait et des blocs paysage étroit existent', () => {
    expect(portrait).toBeDefined();
    expect(paysage.length).toBeGreaterThanOrEqual(2);
    expect(medias).toHaveLength(paysage.length + 1);
  });

  it('AUCUNE requête par largeur ou hauteur : le 16:9 de 390 px garde les valeurs du 16:9 de 1920 px', () => {
    // Les cinq largeurs 1440/1280/1024/768/390 en 16:9 ont été mesurées à
    // 0 débordement AVANT toute correction : un seuil en pixels y changerait
    // des valeurs qui n'ont rien demandé.
    for (const b of medias) {
      expect(b.requete, b.requete).toMatch(/orientation|aspect-ratio/);
      expect(b.requete, b.requete).not.toMatch(/(min-|max-)?(width|height|resolution)\b/);
    }
  });

  it('les blocs paysage sont bornés SOUS le 4:3 inclus — jamais le 16:10 ni le 16:9', () => {
    // 16:10 (1,6) et 4:3 (1,333) tiennent ; à 4:3 la colonne des gares n'a
    // que 0,5 px de marge, d'où un seuil INCLUSIF qui s'arrête là.
    for (const b of paysage) {
      expect(b.requete).not.toContain('min-aspect-ratio');
      const m = /max-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/.exec(b.requete);
      expect(m, `${b.requete} sans max-aspect-ratio`).not.toBeNull();
      const ratio = Number(m?.[1]) / Number(m?.[2]);
      expect(ratio).toBeLessThanOrEqual(4 / 3 + 1e-9);
      expect(ratio).toBeLessThan(1.6);
    }
  });
});

describe('bloc portrait — une unité de conception en vw, les coefficients de la maquette', () => {
  const corps = portrait?.corps ?? '';

  it('définit --u en vw et ne contient plus AUCUN vh', () => {
    // C'est le vh qui, en portrait, rend chaque taille trois fois trop
    // large pour la largeur : une règle portrait en vh réintroduirait le mal.
    expect(corps).toMatch(/--u:\s*0?\.\d+vw/);
    expect(corps).not.toMatch(/[\d.]vh\b/);
  });

  it('hors du bloc portrait, la maquette reste en vh : aucun var(--u)', () => {
    // Les valeurs 16:9 restent celles de maquettes/grille-horaire.html,
    // lisibles telles quelles ; l'unité ne vit que sous l'orientation portrait.
    expect(horsMedia).not.toContain('var(--u)');
    expect(horsMedia).toMatch(/tbody td\s*\{[^}]*font-size:\s*2\.25vh/);
  });

  it('chaque font-size en vh de la maquette a son pendant portrait, AU MÊME COEFFICIENT', () => {
    // Le bloc portrait est une copie en regard : une taille ajoutée plus haut
    // sans pendant garderait sa valeur paysage sur le totem — invisible en
    // 16:9, illisible en portrait. Écrans neutre et d'erreur exceptés : texte
    // centré qui se replie sans rien perdre, laissés en vh à dessein.
    const exceptions = /^(\.neutre|\.horloge-neutre|\.erreur-config)/;
    const reference = parSelecteur(horsMedia, 'font-size');
    const miroir = parSelecteur(corps, 'font-size');
    const attendus = [...reference].filter(([s, v]) => v.endsWith('vh') && !exceptions.test(s));
    expect(attendus.length).toBeGreaterThanOrEqual(25);
    for (const [selecteur, v] of attendus) {
      const pendant = miroir.get(selecteur);
      expect(pendant, `${selecteur} : font-size ${v} sans pendant portrait`).toBeDefined();
      const coefficient = /^([\d.]+)vh$/.exec(v)?.[1];
      expect(pendant, selecteur).toBe(`calc(${coefficient} * var(--u))`);
    }
  });

  it('la colonne des gares s’élargit là où elle tronquait « Saint-Gervais »', () => {
    // Mesuré : 10 vw = 108 px en portrait pour 219 px de texte ; 128 px en
    // 5:4 pour 117 px + 18 px de marges. La référence 16:9 garde 10 vw.
    expect(parSelecteur(horsMedia, 'width').get('thead th.col-gare')).toBe('10vw');
    expect(parSelecteur(corps, 'width').get('thead th.col-gare')).toBe('14vw');
    const quatreTiers = paysage.find((b) => /max-aspect-ratio:\s*4\s*\/\s*3/.test(b.requete));
    expect(quatreTiers).toBeDefined();
    expect(parSelecteur(quatreTiers?.corps ?? '', 'width').get('thead th.col-gare')).toBe('12vw');
  });

  it('la légende se replie au lieu de perdre ses dernières entrées', () => {
    // 2294 px de contenu pour 1054 px de large : plus de la moitié perdue
    // derrière overflow: hidden. Chaque entrée reste insécable.
    expect(parSelecteur(corps, 'flex-wrap').get('.legende')).toBe('wrap');
    expect(parSelecteur(corps, 'white-space').get('.legende')).toBe('normal');
    expect(parSelecteur(corps, 'white-space').get('.legende .item')).toBe('nowrap');
    expect(parSelecteur(corps, 'flex-basis').get('.legende')).toBe('auto');
  });

  it('les bandeaux de test s’empilent et l’en-tête leur fait la place — en portrait aussi', () => {
    // Sans cela, `body.mode-demo header { flex-basis: 17vh }` (plus
    // spécifique que `header`) gardait la main sur le bloc portrait : 326 px
    // d'en-tête pour un logo de 63 px. Le piège du 6 septembre.
    expect(parSelecteur(corps, 'flex-direction').get('.bandeau-demo')).toBe('column');
    expect(parSelecteur(corps, 'flex-direction').get('.bandeau-simule')).toBe('column');
    for (const s of [
      'body.mode-demo header',
      'body.mode-simule header',
      'body.mode-simule.mode-demo header',
    ]) {
      expect(parSelecteur(corps, 'flex-basis').get(s), s).toMatch(/var\(--u\)/);
      expect(parSelecteur(corps, 'padding-top').get(s), s).toMatch(/var\(--u\)/);
    }
    expect(parSelecteur(corps, 'top').get('body.mode-simule.mode-demo .bandeau-demo')).toMatch(
      /var\(--u\)/,
    );
  });
});

describe('grille.css — aucun padding sur `body`, dans aucun bloc', () => {
  it('l’anti-burn-in transforme body : la place des bandeaux se prend sur header', () => {
    // Un ancêtre transformé devient le bloc conteneur des descendants
    // `position: fixed` ; un padding sur body ferait glisser écran neutre et
    // bandeaux d'une heure à l'autre. Règle du projet, vérifiée bloc par bloc.
    const fragments = [horsMedia, ...medias.map((b) => b.corps)];
    for (const fragment of fragments) {
      for (const regle of regles(fragment)) {
        const viseBody = regle.selecteurs.some((s) => /(^|\s)body(\.[\w-]+)*$/.test(s));
        if (viseBody)
          expect(regle.declarations, regle.selecteurs.join(', ')).not.toMatch(/padding/);
      }
    }
  });
});

describe('grille.html — page kiosque, inchangée', () => {
  it('porte la méta viewport et aucune feuille propre au mobile', () => {
    const html = source('grille.html');
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/media="[^"]*(max-width|min-width)/);
  });
});
