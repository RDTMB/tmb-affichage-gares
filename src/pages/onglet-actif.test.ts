// Régler la barre de navigation n'est pas naviguer (défaut du 15/09/2026).
//
// LE DÉFAUT. Onglet Utilisateurs → carte « Onglets visibles par rôle » : au
// premier clic sur une case, pour un rôle quelconque — y compris un rôle qui
// n'est pas le sien — la page sautait sur Circulations. Le réglage partait
// bien en base ; c'est l'affichage qui déménageait.
//
// LA CAUSE. `appliqueRoles()` rallumait sans condition `visibles[0]`. Il est
// appelé QUATRE fois : à la connexion, à l'entrée et à la sortie de l'aperçu
// « voir comme », et à chaque case cochée. Seul le premier a le droit de
// choisir l'onglet ouvert.
//
// POURQUOI DEUX COUCHES DE TESTS. La règle seule (`ongletAOuvrir`) aurait été
// VERTE le jour du défaut : la fonction n'existait pas, et le défaut vivait
// dans son absence d'appel. La seconde couche vérifie donc le CÂBLAGE — que
// `appliqueRoles()` emploie bien la règle, aux deux endroits qu'elle commande.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ongletAOuvrir } from './supervision-logique';
import { ongletsVisibles } from '../core/roles';
import type { Onglet } from '../core/types';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/**
 * Le CORPS de `appliqueRoles()`, isolé par comptage d'accolades.
 *
 * Surtout pas une recherche dans les 5 000 lignes du fichier : `visibles[0]`
 * ou `ongletAOuvrir(` ailleurs rendrait le test vert ou rouge pour la mauvaise
 * raison. C'est la fonction qu'on éprouve, pas le fichier.
 */
function corpsAppliqueRoles(): string {
  const src = source('src/pages/supervision.ts');
  const debut = src.indexOf('function appliqueRoles(): void {');
  expect(debut, '`appliqueRoles` est introuvable — a-t-elle été renommée ?').toBeGreaterThan(-1);
  const ouvre = src.indexOf('{', debut);
  let profondeur = 0;
  let i = ouvre;
  for (; i < src.length; i++) {
    if (src[i] === '{') profondeur++;
    else if (src[i] === '}') {
      profondeur--;
      if (profondeur === 0) break;
    }
  }
  expect(profondeur, 'accolades non appariées dans `appliqueRoles`').toBe(0);
  return src.slice(ouvre + 1, i);
}

// ---------------------------------------------------------------------------
// 1 — La règle
// ---------------------------------------------------------------------------

describe('ongletAOuvrir — on garde ce qu’on regarde', () => {
  const TOUS = ongletsVisibles(['technique', 'admin', 'supervision', 'caisse'], null);

  it('garde l’onglet actif tant qu’il reste visible', () => {
    // Le cœur du correctif : cocher une case redessine la barre, elle ne doit
    // pas ramener l'agent ailleurs.
    expect(TOUS).toContain('utilisateurs');
    expect(ongletAOuvrir('utilisateurs', TOUS)).toBe('utilisateurs');
  });

  it('retombe sur le premier visible quand l’actif a DISPARU', () => {
    // Le cas de la caisse : `supervision.html` marque Circulations `on` en dur
    // au chargement, et la caisse ne le voit pas.
    const caisse = ongletsVisibles(['caisse'], null);
    expect(caisse, 'la caisse verrait Circulations : le cas n’est plus éprouvé').not.toContain(
      'circulations',
    );
    expect(ongletAOuvrir('circulations', caisse)).toBe(caisse[0]);
  });

  it('… y compris quand l’agent se masque à LUI-MÊME l’onglet qu’il regarde', () => {
    const restants: Onglet[] = ['circulations', 'bandeau'];
    expect(ongletAOuvrir('utilisateurs', restants)).toBe('circulations');
  });

  it('ouvre le premier visible quand rien n’est encore allumé', () => {
    // Premier rendu : aucun bouton ne porte `on` côté barre.
    expect(ongletAOuvrir(undefined, TOUS)).toBe(TOUS[0]);
    expect(ongletAOuvrir(null, TOUS)).toBe(TOUS[0]);
  });

  it('rend `undefined` quand plus rien n’est visible', () => {
    // L'appelant n'allume alors AUCUN onglet, plutôt que d'en inventer un.
    expect(ongletAOuvrir('circulations', [])).toBeUndefined();
    expect(ongletAOuvrir(undefined, [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2 — Le câblage, là où le défaut vivait
// ---------------------------------------------------------------------------

describe('appliqueRoles — le redessin ne choisit plus l’onglet', () => {
  it('`visibles[0]` ne commande plus aucun rendu', () => {
    // C'est l'écriture qui produisait le défaut. Elle ne doit plus figurer
    // dans cette fonction — ni pour le bouton, ni pour la section.
    const corps = corpsAppliqueRoles();
    expect(corps, '`visibles[0]` rallume encore un onglet').not.toContain('visibles[0]');
  });

  it('la règle est appelée, et sa cible sert aux DEUX rendus', () => {
    // N'en corriger qu'un laisserait la barre annoncer un onglet et la page en
    // montrer un autre.
    const corps = corpsAppliqueRoles();
    expect(corps, 'la règle n’est pas appelée').toContain('ongletAOuvrir(');
    expect(corps, 'le bouton de la barre n’emploie pas la cible').toContain(
      "b.classList.toggle('on', nom === cible)",
    );
    expect(corps, 'la section de contenu n’emploie pas la cible').toContain(
      "o.classList.toggle('on', o.id === `t-${cible}`)",
    );
  });

  it('l’onglet courant est LU dans le DOM, pas gardé dans une variable', () => {
    // Deux mémoires du même fait finissent par diverger : c'est `initOnglets()`
    // qui pose la classe `on` au clic, elle seule sait ce qui est ouvert.
    const corps = corpsAppliqueRoles();
    expect(corps).toContain("document.querySelector<HTMLElement>('nav.tabs button.on')");
  });
});
