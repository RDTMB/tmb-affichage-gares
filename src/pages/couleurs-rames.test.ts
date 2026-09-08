// Couleurs de rame : validées à la forme, pas seulement échappées (F-08).
//
// Les couleurs de pastille sont paramétrables en supervision et finissent dans
// un attribut `style=""` construit par concaténation, sur les six écrans de
// gare, la grille du jour et la supervision. `echapper()` empêche de sortir de
// l'attribut, mais laisse passer une injection CSS : c'est la forme
// hexadécimale qui ferme le trou.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { anneauSur, couleurSure, echapper } from './affichage-commun';

/** Bleu-gris de la charte 2026, repli de `couleurSure()`. */
const BLEU_GRIS = '#708DA4';

/**
 * La charge qui a motivé le correctif : une couleur qui ne sort PAS de
 * l'attribut — donc invisible pour `echapper()` — mais qui déborde de la
 * déclaration CSS et couvre l'écran.
 */
const CHARGE_CSS = 'red;position:fixed;inset:0;z-index:9999';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

describe('couleurSure() — la forme hexadécimale, ou le repli de la charte', () => {
  it('laisse passer les quatre couleurs de rames de la charte', () => {
    // Marie, Anne, Jeanne, Marguerite (blanc cerclé rouge).
    for (const c of ['#2E74B5', '#7FA51E', '#C2447A', '#FFFFFF', '#E52A23']) {
      expect(couleurSure(c), c).toBe(c);
    }
  });

  it('accepte les minuscules : la base ne normalise pas la casse', () => {
    expect(couleurSure('#2e74b5')).toBe('#2e74b5');
    expect(couleurSure('#aAbBcC')).toBe('#aAbBcC');
  });

  it('REFUSE la charge qui couvre l’écran, et rend le bleu-gris', () => {
    // Le cœur du correctif. Cette valeur passe `echapper()` sans une
    // modification — aucun des cinq caractères remplacés n'y figure — et
    // transformerait une pastille d'un centimètre en rectangle plein écran
    // masquant le tableau des départs.
    expect(echapper(CHARGE_CSS)).toBe(CHARGE_CSS);
    expect(couleurSure(CHARGE_CSS)).toBe(BLEU_GRIS);
  });

  it('refuse tout ce qui n’est pas six chiffres hexadécimaux', () => {
    const refuses = [
      '', // vide
      '#fff', // trois chiffres : la charte n'en utilise pas, et le refuser
      // garde UNE seule forme à raisonner
      '#12345', // cinq
      '#1234567', // sept
      '123456', // sans dièse
      '#12345g', // caractère hors hexadécimal
      'red', // nom CSS
      'rgb(255,0,0)', // fonction CSS
      'var(--rouge)', // variable, qui pourrait pointer ailleurs
      '#708DA4 ', // espace en fin : la base accepte, l'attribut aussi
      ' #708DA4', // espace en tête
      '#708DA4;', // point-virgule seul, début de toute injection
      'url(https://exemple.test/i.png)', // requête réseau depuis un écran
      // de gare, qui doit démarrer sans internet
      'expression(alert(1))', // vieux IE, mais gratuit à refuser
    ];
    for (const v of refuses) expect(couleurSure(v), JSON.stringify(v)).toBe(BLEU_GRIS);
  });

  it('refuse null et undefined — une machine peut arriver incomplète du cache', () => {
    expect(couleurSure(null)).toBe(BLEU_GRIS);
    expect(couleurSure(undefined)).toBe(BLEU_GRIS);
  });

  it('le repli est réglable, et lui aussi rendu tel quel', () => {
    expect(couleurSure(CHARGE_CSS, '#E52A23')).toBe('#E52A23');
  });
});

describe('anneauSur() — l’absence d’anneau veut dire quelque chose', () => {
  it('rend la couleur d’anneau valide', () => {
    expect(anneauSur('#E52A23')).toBe('#E52A23');
  });

  it('rend null quand il n’y a pas d’anneau, SANS repli', () => {
    // Seule Marguerite porte un anneau (charte 2026). Un repli comme celui de
    // `couleurSure()` dessinerait un anneau bleu-gris autour de Marie, Anne et
    // Jeanne : un faux, là où l'on corrige justement les faux.
    expect(anneauSur(null)).toBeNull();
    expect(anneauSur(undefined)).toBeNull();
    expect(anneauSur('')).toBeNull();
  });

  it('traite une valeur mal formée comme une absence, pas comme une couleur', () => {
    // Pas d'anneau vaut mieux qu'un anneau inventé — et surtout mieux qu'un
    // `box-shadow` détourné, qui accepte lui aussi plusieurs déclarations.
    expect(anneauSur(CHARGE_CSS)).toBeNull();
    expect(anneauSur('red')).toBeNull();
    expect(anneauSur('#fff')).toBeNull();
  });
});

describe('les onze sites de construction passent par les validateurs', () => {
  // Le relevé du prompt en comptait sept, tous sur `couleur`. `cercle` est
  // injecté de la même façon dans quatre autres, et un `box-shadow` détourné
  // couvre l'écran aussi bien qu'un `background`. D'où onze.
  const FICHIERS = ['src/pages/ecran.ts', 'src/pages/grille.ts', 'src/pages/supervision.ts'];

  it('plus AUCUNE couleur brute concaténée dans les trois pages', () => {
    // Le verrou qui compte : une huitième construction ajoutée demain sans
    // validateur retomberait dans le trou, et rien ne le dirait.
    for (const fichier of FICHIERS) {
      const src = source(fichier);
      expect(src, `${fichier} : couleur concaténée telle quelle`).not.toMatch(
        /\$\{[^}]*\.couleur\}/,
      );
      expect(src, `${fichier} : cercle concaténé tel quel`).not.toMatch(/\$\{[^}]*\.cercle[\s?}]/);
    }
  });

  it('chaque page importe les deux validateurs', () => {
    for (const fichier of FICHIERS) {
      const src = source(fichier);
      expect(src, fichier).toMatch(/couleurSure/);
      expect(src, fichier).toMatch(/anneauSur/);
    }
  });

  it('les deux champs de saisie de la supervision sont validés aussi', () => {
    // Ils affichent la valeur ENREGISTRÉE : sans validation, ouvrir l'onglet
    // Paramètres suffirait à déclencher la charge, avant même qu'un écran de
    // gare la reçoive.
    const src = source('src/pages/supervision.ts');
    expect(src).toContain('value="${couleurSure(m.couleur)}"');
    expect(src).toContain('value="${anneauSur(m.cercle) ?? \'#ffffff\'}"');
  });

  it('le repli de la charte est le même partout : une seule valeur à connaître', () => {
    // `RAME_INCONNUE` des deux pages d'affichage et le défaut de
    // `couleurSure()` doivent coïncider, sinon une rame absente et une rame
    // mal réglée n'auraient pas la même couleur — deux pannes qui se
    // ressemblent et ne se distinguent plus.
    expect(couleurSure(null)).toBe(BLEU_GRIS);
    for (const fichier of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
      expect(source(fichier), fichier).toContain(`couleur: '${BLEU_GRIS}'`);
    }
  });
});
