// Adaptation de l'ÉCRAN DE GARE aux formats de moniteur — verrouillage du
// TEXTE de src/styles/ecran.css, sur le modèle de demarrage-ecrans.test.ts.
//
// Ce que ces tests protègent : le 16:9 de Saint-Gervais (en service) ne doit
// JAMAIS bouger. La feuille dimensionne les textes en vh et les colonnes en
// vw ; mesurée au navigateur le 06/09/2026, elle tient jusqu'à 4:3 inclus et
// casse en dessous (statut coupé sous r ≈ 1,32, heure de départ hors de sa
// colonne sous r ≈ 1,26, logo sur le nom de gare sous r ≈ 1,07, portrait
// illisible). La correction est UN bloc `@media (max-aspect-ratio: 4/3)` qui
// remplace l'unité verticale par 0,75 vw — égale à 1 vh exactement au seuil —
// et reprend, déclaration par déclaration, les coefficients de la feuille de
// base. On vérifie ici que ce bloc reste une TRANSCRIPTION et ne devient pas
// une seconde feuille de style.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8');
}

/** Feuille sans commentaires : un « 2.8vh » cité en commentaire fausserait tout. */
const css = source('src/styles/ecran.css').replace(/\/\*[\s\S]*?\*\//g, '');

const debutMedia = css.indexOf('@media');
/** Tout ce qui précède le bloc étroit : la feuille telle que la voit le 16:9. */
const base = css.slice(0, debutMedia);
const media = css.slice(debutMedia);
const enTeteMedia = /@media\s*\(([^)]*)\)\s*\{/.exec(media);
/** Intérieur du bloc `@media`. */
const bloc = media.slice(enTeteMedia?.[0].length ?? 0, media.lastIndexOf('}'));

/** Règles « feuilles » d'un texte CSS : sélecteur normalisé → déclarations. */
function regles(texte: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of texte.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selecteur = m[1].trim().replace(/\s+/g, ' ');
    const declarations = m[2]
      .split(';')
      .map((d) => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    map.set(selecteur, [...(map.get(selecteur) ?? []), ...declarations]);
  }
  return map;
}

const reglesBase = regles(base);
const reglesBloc = regles(bloc);

/** « calc(5.6 * var(--u)) » → « 5.6vh » : le bloc, relu dans l'unité de base. */
function deconvertie(declaration: string): string {
  return declaration.replace(/calc\((-?\d*\.?\d+) \* var\(--u\)\)/g, '$1vh');
}

const VH = /-?\d*\.?\d+vh\b/;

/** Calques centrés laissés VOLONTAIREMENT en vh : sans `nowrap`, ils passent à
 *  la ligne et se centrent (mesurés sans débordement en portrait), et un
 *  message centré gagne à rester grand sur un écran haut. */
const CALQUES_CENTRES = ['.veille', '.neutre', '.horloge-neutre', '.plein-ecran', '.erreur-config'];

/**
 * Les SEULES règles du bloc étroit qui ne sont pas une transcription.
 *
 * Elles ne redimensionnent rien : elles retirent des éléments, parce que la
 * colonne Destination d'un écran plus carré que 4/3 ne peut pas tenir la
 * pastille d'affluence, le picto express et le nom de gare ensemble
 * (mesuré le 10/09/2026 : 68 à 82 px de débordement — voir le commentaire de
 * la règle dans ecran.css, qui porte les chiffres des quatre options
 * essayées). Un choix d'affichage, donc, pas un coefficient — et c'est
 * pourquoi il ne peut pas se déduire de la feuille de base.
 *
 * Cette liste est EXPLICITE et doit le rester : toute autre règle du bloc
 * qui n'est pas une transcription est un oubli, pas un choix.
 */
const CHOIX_DAFFICHAGE_ETROIT = new Map<string, string[]>([
  ['.dest .pill-affluence + img.motrice-dest', ['display: none']],
  ['.dest .pill-affluence.limite small', ['display: none']],
  // L'alignement de colonne du 16/9 (badge et nom de gare à largeur fixe,
  // pour que la pastille commence toujours au même endroit) est ABANDONNÉ
  // ici : il réserve la largeur du plus long terminus sur chaque rangée, et
  // à 1024×768 la colonne ne l'a pas — « DERNIÈRES PLACES » y coupe déjà.
  ['.badge-train, .r-dest .dest .nom-dest', ['min-width: 0']],
]);

describe('ecran.css — le 16:9 de Saint-Gervais ne bouge pas', () => {
  it('la taille du badge de train reste 2.8vh dans la feuille de base', () => {
    // Estimation en cours de validation par observation SUR PLACE : elle ne se
    // change pas depuis un navigateur.
    expect(base).toMatch(/\.badge-train\s*\{[^}]*font-size:\s*2\.8vh/);
  });

  it('la feuille de base ignore l’unité du bloc étroit', () => {
    // Si `--u` remontait dans la base, le 16:9 dépendrait d'une variable ; il
    // n'en dépend d'aucune.
    expect(base).not.toContain('var(--u)');
    expect(base).not.toContain('--u:');
  });

  it('aucun padding sur `body`, dans la base comme dans le bloc', () => {
    // demarreAntiBurnIn() applique un `transform` à `body` ; un ancêtre
    // transformé devient le bloc conteneur des descendants `position: fixed`.
    expect(css).not.toMatch(/(^|[\s,}])body(\.[\w-]+)*\s*\{[^}]*padding/);
  });

  it('le bloc étroit est le DERNIER texte de la feuille', () => {
    // À spécificité égale, c'est l'ordre de source qui tranche : placé plus
    // haut, le bloc perdrait contre la base et ne corrigerait rien.
    expect(debutMedia).toBeGreaterThan(-1);
    expect(media.slice(media.lastIndexOf('}') + 1).trim()).toBe('');
  });
});

describe('ecran.css — un seul point de rupture, en RAPPORT et non en largeur', () => {
  it('exactement un `@media`, sur `max-aspect-ratio: 4/3`', () => {
    // Le 4:3 a été mesuré sans coupure ni chevauchement : c'est le dernier
    // format qui tient, donc le seuil.
    expect((css.match(/@media/g) ?? []).length).toBe(1);
    expect(enTeteMedia?.[1].replace(/\s+/g, '')).toBe('max-aspect-ratio:4/3');
  });

  it('aucun seuil en pixels : un `max-width` toucherait le 16:9', () => {
    expect(css).not.toMatch(/@media[^{]*(max|min)-(width|height)/);
    expect(css).not.toMatch(/@media[^{]*orientation/);
  });

  it('l’unité vaut exactement 1vh au seuil : la bascule est continue', () => {
    // max-aspect-ratio: A/B → au seuil, 1vh = (B/A) vw. Un autre coefficient
    // ferait SAUTER toutes les tailles en passant le seuil.
    const [, a, b] = /(\d+)\s*\/\s*(\d+)/.exec(enTeteMedia?.[1] ?? '') ?? [];
    expect(a).toBeDefined();
    const coefficient = Number(b) / Number(a);
    expect(reglesBloc.get(':root')).toEqual([`--u: ${coefficient}vw`]);
  });
});

describe('ecran.css — le bloc étroit est une TRANSCRIPTION, pas une seconde feuille', () => {
  it('chaque déclaration du bloc reprend, coefficient compris, une déclaration de la base', () => {
    for (const [selecteur, declarations] of reglesBloc) {
      if (selecteur === ':root') continue;
      const choix = CHOIX_DAFFICHAGE_ETROIT.get(selecteur);
      if (choix) {
        // Exception recensée : on vérifie qu'elle est bien CE qu'elle dit
        // être — un retrait d'élément, rien d'autre. Une déclaration de
        // taille glissée ici passerait autrement sans contrôle.
        expect(declarations, `« ${selecteur} » : exception recensée, contenu inattendu`).toEqual(
          choix,
        );
        continue;
      }
      const origine = reglesBase.get(selecteur);
      expect(origine, `« ${selecteur} » n'existe pas dans la feuille de base`).toBeDefined();
      for (const d of declarations) {
        expect(d, `« ${selecteur} { ${d} } » ne passe pas par --u`).toContain('var(--u)');
        expect(
          origine,
          `« ${selecteur} { ${d} } » ne correspond à aucune déclaration de base`,
        ).toContain(deconvertie(d));
      }
    }
  });

  it('le bloc ne contient plus aucun `vh` : tout le vertical passe par l’unité', () => {
    expect(bloc).not.toMatch(VH);
  });

  it('toute règle de base en vh est transcrite, sauf les calques centrés', () => {
    // La liste d'exceptions est explicite : une règle en vh qui n'y figure pas
    // et manque au bloc est un oubli, pas un choix.
    for (const [selecteur, declarations] of reglesBase) {
      const enVh = declarations.filter((d) => VH.test(d));
      if (enVh.length === 0) continue;
      if (CALQUES_CENTRES.some((c) => selecteur.startsWith(c))) {
        expect(reglesBloc.has(selecteur), `« ${selecteur} » est centré : à laisser en vh`).toBe(
          false,
        );
        continue;
      }
      const transcrites = (reglesBloc.get(selecteur) ?? []).map(deconvertie);
      for (const d of enVh) {
        expect(transcrites, `« ${selecteur} { ${d} } » manque au bloc étroit`).toContain(d);
      }
    }
  });

  it('les sélecteurs PLUS SPÉCIFIQUES de la base sont surchargés eux aussi', () => {
    // `body.mode-demo header { flex-basis: 19vh }` l'emporte sur `header` par
    // spécificité : sans sa propre surcharge, l'en-tête garderait sa hauteur
    // en vh sous un bandeau converti en vw, et le bandeau le recouvrirait.
    for (const s of [
      'body.mode-demo header',
      'body.mode-simule header',
      'body.mode-simule.mode-demo header',
      'body.mode-demo .badge-cache',
      'body.mode-simule .badge-cache',
      'body.mode-simule.mode-demo .badge-cache',
      'body.mode-simule.mode-demo .bandeau-demo',
    ]) {
      expect(reglesBloc.has(s), `« ${s} » absent du bloc étroit`).toBe(true);
    }
  });

  it('le badge garde son coefficient (2.8) : sa taille RELATIVE est celle observée sur place', () => {
    expect(reglesBloc.get('.badge-train')).toContain('font-size: calc(2.8 * var(--u))');
  });
});
