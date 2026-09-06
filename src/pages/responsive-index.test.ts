// Adaptation toutes tailles — le PORTAIL DE TEST au téléphone.
//
// `index.ts` n'est pas importable dans Vitest : il accède au DOM dès le
// chargement du module, et la suite tourne en environnement Node sans jsdom.
// On verrouille donc son TEXTE, comme le fait src/pages/demarrage-ecrans.test.ts.
//
// Ce que ces tests protègent : le portail sert à rebrancher un boîtier en gare,
// téléphone à la main. Ses liens doivent rester TAPABLES (≥ 44 px) à 390 px, et
// ses ajustements doivent vivre dans une feuille PROPRE — base.css est partagé
// par les quatre surfaces, et ce lot n'y a pas touché.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Fins de ligne normalisées : le dépôt est en CRLF sous Windows. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/** Code seul : un commentaire mentionnant l'import fausserait les tests. */
function codeSeul(chemin: string): string {
  return source(chemin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('portail de test — la feuille index.css est câblée, et au bon rang', () => {
  const code = codeSeul('src/pages/index.ts');

  it('index.ts importe la feuille propre au portail', () => {
    expect(code).toContain("import '../styles/index.css';");
  });

  it('…APRÈS ./commun, qui charge base.css : la cascade fait le reste', () => {
    // Le 6 septembre, des règles correctes à la lecture étaient écrasées par
    // une règle plus spécifique déclarée plus bas. À spécificité égale, seul
    // l'ordre de déclaration tranche : la feuille du portail doit venir après.
    const commun = code.indexOf("from './commun'");
    const feuille = code.indexOf("import '../styles/index.css'");
    expect(commun).toBeGreaterThan(-1);
    expect(feuille).toBeGreaterThan(commun);
  });

  it('aucune AUTRE surface n’importe index.css', () => {
    // C'est une feuille du portail, pas un second base.css.
    for (const page of ['src/pages/ecran.ts', 'src/pages/grille.ts', 'src/pages/supervision.ts']) {
      expect(codeSeul(page), `${page} importe index.css`).not.toContain('styles/index.css');
    }
  });
});

describe('portail de test — les liens se tapent au doigt', () => {
  const css = codeSeul('src/styles/index.css');

  it('cible tactile ≥ 44 px sur les liens, à toute largeur', () => {
    // Mesuré avant correction : 19,2 px de haut à 390 px comme à 1440 px.
    expect(css).toMatch(/\.liens-portail a\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.liens-portail a\s*\{[^}]*display:\s*inline-flex/);
  });

  it('la police des liens et des noms de gare n’est jamais réduite', () => {
    // Lisible à bout de bras : les 16 px hérités du corps restent la taille
    // des liens, et le nom de gare garde ses 1,15 rem de base.css.
    const blocsLiens = css.match(/\.liens-portail a[^{]*\{[^}]*\}/g) ?? [];
    expect(blocsLiens.length).toBeGreaterThan(0);
    for (const bloc of blocsLiens) expect(bloc).not.toContain('font-size');
    const blocsNom = css.match(/\.nom-gare[^{]*\{[^}]*\}/g) ?? [];
    for (const bloc of blocsNom) expect(bloc).not.toContain('font-size');
  });

  it('au téléphone, les largeurs réservées par base.css sont levées', () => {
    // 11 rem + 5,5 rem de `min-width`, plus deux liens : à 390 px, base.css
    // repliait proprement mais gaspillait la ligne. Sous 600 px, le nom et
    // l'altitude ne réservent plus rien.
    const media = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(media.length).toBeGreaterThan(0);
    expect(media).toMatch(
      /\.liens-portail \.nom-gare,\s*\.liens-portail \.altitude\s*\{[^}]*min-width:\s*0/,
    );
    // Grille à deux colonnes égales : la place des boutons ne dépend plus de la
    // longueur du nom de gare (en flex, « Écran » se glissait derrière les noms
    // courts et « Grille » partait seul sur sa ligne).
    expect(media).toMatch(/\.liens-portail li\s*\{[^}]*display:\s*grid/);
    expect(media).toMatch(/grid-template-columns:\s*1fr 1fr/);
    // « Poste de supervision », seul lien de sa ligne, prend toute la largeur.
    expect(media).toMatch(/\.liens-portail a:only-child\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  it('gagne par la cascade, jamais par la force', () => {
    // Un !important ici et la prochaine règle de base.css ne pourrait plus
    // s'exprimer sur le portail.
    expect(css).not.toContain('!important');
  });

  it('ne redéfinit aucun jeton de la charte', () => {
    // tokens.css est intouchable, y compris par écrasement.
    expect(css).not.toMatch(/--tmb-[a-z-]+\s*:/);
    expect(css).not.toMatch(/--police-[a-z-]+\s*:/);
    expect(css).not.toContain(':root');
  });
});

describe('base.css — partagé par les quatre surfaces, ce lot ne l’a pas touché', () => {
  const base = source('src/styles/base.css');

  it('les blocs du portail y sont EXACTEMENT ceux d’avant', () => {
    expect(base).toContain(
      [
        '.liens-portail li {',
        '  background: rgba(255, 255, 255, 0.06);',
        '  border-left: 4px solid var(--tmb-rouge);',
        '  padding: 10px 16px;',
        '  display: flex;',
        '  align-items: baseline;',
        '  gap: 16px;',
        '  flex-wrap: wrap;',
        '}',
      ].join('\n'),
    );
    expect(base).toContain(
      [
        '.liens-portail .nom-gare {',
        '  font-family: var(--police-titres);',
        '  font-size: 1.15rem;',
        '  min-width: 11rem;',
        '}',
      ].join('\n'),
    );
    expect(base).toContain(
      [
        '.liens-portail .altitude {',
        '  color: var(--tmb-bleu-clair);',
        '  font-size: 0.85rem;',
        '  min-width: 5.5rem;',
        '}',
      ].join('\n'),
    );
  });

  it('aucune règle tactile ni aucun @media n’y a glissé', () => {
    expect(base).not.toContain('@media');
    expect(base).not.toMatch(/\.liens-portail a\b/);
    expect(base).not.toContain('min-height: 44px');
  });
});
