// Jetons CSS — aucun alias ne doit se référencer lui-même.
//
// POURQUOI CE FICHIER EXISTE. Le 10/09/2026, `supervision.css` a été livré
// avec `--rouge: var(--rouge);`. La cause est bête et se reproduira : un
// remplacement en masse de `var(--tmb-rouge)` par `var(--rouge)`, passé sur
// TOUT le fichier, avait aussi frappé la ligne qui DÉFINIT l'alias.
//
// Une variable cyclique est invalide : elle ne vaut pas sa valeur précédente,
// elle ne vaut RIEN. Tout `background: var(--rouge)` devient donc transparent
// — le bouton « Publier », « Se connecter », la pastille « complet ». Et rien
// ne bronche : ni TypeScript, ni Prettier, ni la construction, ni les 1 513
// tests de la suite. Le défaut n'a été vu qu'à l'œil, sur l'écran.
//
// Ce contrôle est de la même famille que le reste des tests de feuilles : il
// lit le TEXTE. Il ne remplace pas le rendu, il attrape la faute que le
// rendu seul révélait.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOSSIER = fileURLToPath(new URL('../styles/', import.meta.url));
const FEUILLES = readdirSync(DOSSIER).filter((f) => f.endsWith('.css'));

function css(fichier: string): string {
  // Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF.
  return readFileSync(`${DOSSIER}${fichier}`, 'utf-8').replace(/\r\n/g, '\n');
}

/** `--nom: valeur;` → paires, commentaires retirés. */
function declarations(texte: string): [string, string][] {
  const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...sansCommentaires.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => [
    m[1] as string,
    (m[2] as string).trim(),
  ]);
}

describe('feuilles de style — les jetons ne tournent pas en rond', () => {
  it('il y a bien des feuilles à contrôler', () => {
    // Un dossier vide ferait passer tout le reste sans rien contrôler.
    expect(FEUILLES.length).toBeGreaterThan(3);
  });

  for (const fichier of FEUILLES) {
    it(`${fichier} : aucun jeton ne se référence lui-même`, () => {
      for (const [nom, valeur] of declarations(css(fichier))) {
        expect(
          valeur.includes(`var(${nom})`),
          `« ${nom}: ${valeur} » est cyclique : la variable devient INVALIDE, ` +
            `et tout ce qui l'utilise perd sa couleur sans le dire`,
        ).toBe(false);
      }
    });
  }

  it('tout `var(--x)` vise un jeton réellement défini quelque part', () => {
    // Une faute de frappe (`var(--tmb-roug)`) produit le même symptôme
    // silencieux qu'un cycle : la déclaration est simplement ignorée.
    const definis = new Set<string>();
    for (const fichier of FEUILLES) {
      for (const [nom] of declarations(css(fichier))) definis.add(nom);
    }
    for (const fichier of FEUILLES) {
      const texte = css(fichier).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of texte.matchAll(/var\((--[\w-]+)(\s*,[^)]*)?\)/g)) {
        // Un `var(--x, repli)` porte sa propre valeur de secours : il ne
        // disparaît pas si le jeton manque.
        if (m[2]) continue;
        expect(
          definis.has(m[1] as string),
          `${fichier} : « ${m[1]} » n'est défini nulle part`,
        ).toBe(true);
      }
    }
  });
});
