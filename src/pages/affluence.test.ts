// Affluence — la JOINTURE (date, numéro) entre les passages et la table.
//
// CE QUE CES TESTS PROTÈGENT. Le remplissage est un axe INDÉPENDANT de la
// ponctualité, porté par une table à part et par une main à part (le guichet).
// Ce qui peut se casser en silence, c'est la jointure : elle ne regarde que le
// NUMÉRO de train, parce qu'un TRAIN 9 complet l'est dans toutes les gares
// qu'il doit encore desservir. Une jointure par gare passerait tous les tests
// d'une seule gare et se verrait le jour où l'agent regarde l'écran suivant.
//
// Le fournisseur de démonstration est éprouvé dans src/data/mock.test.ts, qui
// porte déjà l'environnement navigateur minimal dont il a besoin.
//
// Non prouvé ici : le rendu (mesuré au navigateur, chiffres dans la PR) et le
// refus de la base (recette supabase/tests/roles-rls.sql).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { appliqueAffluence } from './affichage-commun';
import type { Affluence, PassageGare } from '../core/types';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

function passage(numero: number, reste: Partial<PassageGare> = {}): PassageGare {
  return {
    numero,
    sens: numero % 2 === 1 ? 'montee' : 'descente',
    express: false,
    velos: false,
    rame: 'Marie',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    origine: 'le-fayet',
    destination: 'nid-daigle',
    terminusExceptionnel: false,
    supplementaire: false,
    departConfirme: false,
    arrivee_s: null,
    depart_s: 36000,
    arrivee_theorique_s: null,
    depart_theorique_s: 36000,
    ...reste,
  };
}

const AFF = (numero: number, niveau: Affluence['niveau']): Affluence => ({
  date: '2026-07-15',
  numero,
  niveau,
});

describe('appliqueAffluence — la jointure par numéro de train', () => {
  it('recopie le niveau sur le train déclaré, et sur lui seul', () => {
    const rendu = appliqueAffluence([passage(9), passage(11)], [AFF(9, 'complet')]);
    expect(rendu[0]?.affluence).toBe('complet');
    expect(rendu[1]?.affluence).toBe(null);
  });

  it('un train NON déclaré vaut « places disponibles », jamais `undefined`', () => {
    // L'absence de ligne est le cas normal : elle doit produire une valeur
    // franche, pas un trou que l'appelant devra retester.
    const rendu = appliqueAffluence([passage(3)], []);
    expect(rendu[0]?.affluence).toBe(null);
    expect(rendu[0]).toHaveProperty('affluence');
  });

  it('une déclaration sans train correspondant ne casse rien', () => {
    // Le train peut avoir été supprimé de la journée après la déclaration.
    expect(() => appliqueAffluence([passage(3)], [AFF(99, 'complet')])).not.toThrow();
    expect(appliqueAffluence([passage(3)], [AFF(99, 'complet')])[0]?.affluence).toBe(null);
  });

  it('une DESCENTE se déclare comme une montée', () => {
    // Une descente peut être complète : rien dans la jointure ne doit
    // distinguer les deux sens.
    const rendu = appliqueAffluence([passage(10)], [AFF(10, 'limite')]);
    expect(rendu[0]?.sens).toBe('descente');
    expect(rendu[0]?.affluence).toBe('limite');
  });

  it('un niveau INCONNU est ignoré, pas recopié', () => {
    // Base plus récente que le déploiement : mieux vaut une pastille absente
    // qu'une classe CSS inventée dans un attribut `class`.
    const exotique = { date: '2026-07-15', numero: 9, niveau: 'bonde' } as unknown as Affluence;
    expect(appliqueAffluence([passage(9)], [exotique])[0]?.affluence).toBe(null);
  });

  it('ne MUTE pas les passages reçus : le moteur garde les siens intacts', () => {
    const origine = [passage(9)];
    const rendu = appliqueAffluence(origine, [AFF(9, 'complet')]);
    expect(origine[0]?.affluence).toBeUndefined();
    expect(rendu[0]).not.toBe(origine[0]);
  });

  it('la gare n’entre pas dans la jointure', () => {
    // Deux passages du MÊME train, vus depuis deux gares différentes : les
    // deux portent la pastille. C'est le cœur de « par train, pas par gare ».
    const rendu = appliqueAffluence(
      [passage(9, { origine: 'le-fayet' }), passage(9, { origine: 'motivon' })],
      [AFF(9, 'complet')],
    );
    expect(rendu.map((p) => p.affluence)).toEqual(['complet', 'complet']);
  });
});

describe('la collision pastille × picto express, en 16/9', () => {
  // MESURÉE le 10/09/2026 : « Nid d'Aigle » + « DERNIÈRES PLACES / Few seats »
  // + picto débordait de 62 à 82 px de la colonne Destination.
  //
  // La première réponse masquait le picto ; l'exploitant l'a ÉCARTÉE le même
  // jour — il veut ce repère sur tous les express, la mention écrite en
  // dessous ne le remplace pas à distance. La réponse retenue met la pastille
  // longue sur DEUX LIGNES : rien n'est retiré, c'est sa forme qui cède.
  //
  // Ce qui est verrouillé ici, c'est donc l'inverse de ce qui l'était : que
  // le picto NE disparaisse PAS, et que le mécanisme qui lui rend la place
  // reste en vigueur.
  const css = source('src/styles/ecran.css');
  const base = css.slice(0, css.indexOf('@media'));

  it('le picto n’est JAMAIS masqué en 16/9, quel que soit le niveau', () => {
    // Décision de l'exploitant du 10/09/2026 : un express se reconnaît de
    // loin à son picto, sur toute ligne où il circule.
    expect(base).not.toMatch(/img\.motrice-dest \{[^}]*display: none/);
  });

  // `.pill-affluence.limite` apparaît DEUX fois dans la feuille — la couleur
  // d'abord, la mise en forme ensuite. On réunit les deux corps plutôt que de
  // se fier à la première occurrence, qui ne porte que le fond.
  const corpsLimite = [...base.matchAll(/\.pill-affluence\.limite \{([^}]*)\}/g)]
    .map((m) => m[1])
    .join('\n');

  it('la pastille LONGUE passe sur deux lignes : c’est ce qui rend la place', () => {
    expect(corpsLimite, 'règle `.pill-affluence.limite` absente').not.toBe('');
    expect(corpsLimite).toContain('flex-direction: column');
  });

  it('les deux marges resserrées à 0.7vw restent en place', () => {
    // Sans elles, la réserve avant troncature tombait de 30,1 à 14,4 px à
    // 1920×1080, et de 20,2 à 9,6 px à 1280×720 (pire cas T17, le badge le
    // plus large). `.txt` est `flex: 0 1 auto` : quand cette réserve est
    // épuisée, l'ellipse de `.dest` emporte le picto ENTIER.
    const corpsPastille = /^\.pill-affluence \{([^}]*)\}/m.exec(base)?.[1] ?? '';
    expect(corpsPastille, 'règle `.pill-affluence` absente').not.toBe('');
    expect(corpsPastille).toContain('margin-left: 0.7vw');
    const voisin = /\.dest \.pill-affluence \+ img\.motrice-dest \{([^}]*)\}/.exec(base)?.[1] ?? '';
    expect(voisin, 'la marge du picto voisin a disparu').toContain('margin-left: 0.7vw');
    // `.r-dest` EN TÊTE, et ce n'est pas décoratif : sans lui, le sélecteur
    // pèse autant que `.r-dest .dest img.motrice-dest` déclaré plus bas, et
    // c'est l'ordre du fichier qui gagne — la marge repasse à 1,4vw et la
    // réserve perd 13,4 px sans que rien ne le dise. Constaté le 10/09/2026.
    expect(base, 'le préfixe `.r-dest` qui donne la priorité a disparu').toContain(
      '.r-dest .dest .pill-affluence + img.motrice-dest',
    );
  });

  it('la marge est COMMUNE aux deux niveaux : c’est ce qui les aligne', () => {
    // Tant que « COMPLET » gardait 1,4vw et « DERNIÈRES PLACES » 0,7vw, les
    // deux pastilles démarraient 13,4 px l'une de l'autre — visible dès
    // qu'on descend la colonne. Une marge propre à `.limite` la rétablirait.
    expect(corpsLimite).not.toContain('margin-left');
  });

  it('le badge et le nom de gare ont une largeur PLANCHER, en `em`', () => {
    // Les deux autres sources du balancement mesuré (86,5 px au total) : le
    // badge « T9 » contre « T11 » (17,5 px) et « Le Fayet » contre « Nid
    // d'Aigle » (55,7 px). En `em`, le bloc ≤ 4/3 n'a rien à transcrire —
    // il les neutralise, faute de place à cette largeur.
    const badge = /^\.badge-train \{([^}]*)\}/m.exec(base)?.[1] ?? '';
    expect(badge, 'règle `.badge-train` absente').not.toBe('');
    expect(badge).toMatch(/min-width: [\d.]+em/);
    // Ancré en début de ligne : `.rangee.supprime .r-dest .dest .nom-dest`
    // (le barré) figure plus haut dans la feuille et serait pris à sa place.
    const nom = /^\.r-dest \.dest \.nom-dest \{([^}]*)\}/m.exec(base)?.[1] ?? '';
    expect(nom, 'règle `.nom-dest` absente').not.toBe('');
    expect(nom).toMatch(/min-width: [\d.]+em/);
    // Plus de `display: inline-block` : le nom est un ITEM FLEX depuis que la
    // ligne Destination est une rangée. Il porte en revanche sa propre
    // ellipse, `text-overflow` ne s'appliquant pas à un conteneur flex.
    expect(nom).not.toContain('display: inline-block');
    expect(nom).toContain('text-overflow: ellipsis');
  });

  it('la ligne Destination est une RANGÉE centrée, pas une suite de `vertical-align`', () => {
    // Décision de l'exploitant du 10/09/2026 : badge, nom, pastille et picto
    // sur le même axe. Mesuré avant : badge 5,2 px sous le centre du nom,
    // pastille empilée 19,5 px sous, picto 0,8 px au-dessus. Ces trois écarts
    // venaient de calages `vertical-align` indépendants ; les remettre
    // rouvrirait le sujet valeur par valeur.
    const dest = /^\.r-dest \.dest \{([^}]*)\}/m.exec(base)?.[1] ?? '';
    expect(dest, 'règle `.r-dest .dest` absente').not.toBe('');
    expect(dest).toContain('display: flex');
    expect(dest).toContain('align-items: center');
    for (const regle of ['.badge-train', '.pill-affluence', 'img.motrice-dest']) {
      const corps =
        new RegExp(`^\\.r-dest \\.dest ${regle.replace(/\./g, '\\.')} \\{([^}]*)\\}`, 'm').exec(
          base,
        )?.[1] ?? '';
      expect(corps + dest, `${regle} : un vertical-align est revenu`).not.toContain(
        'vertical-align',
      );
    }
    // Les trois repères ne se compriment pas ; seul le nom peut céder.
    expect(base).toMatch(
      /\.r-dest \.dest \.badge-train,\s*\.r-dest \.dest \.pill-affluence,\s*\.r-dest \.dest img\.motrice-dest \{\s*flex: none;/,
    );
  });

  it('les tailles internes sont en `em`, pour que le bloc ≤ 4/3 n’ait rien à transcrire', () => {
    // Invariant de responsive-ecran.test.ts : toute règle de base en `vh`
    // doit être reprise dans le bloc étroit. En `em`, la pastille suit la
    // police — déjà redéclarée là-bas — et le bloc reste inchangé.
    expect(corpsLimite).not.toMatch(/-?\d*\.?\d+vh\b/);
  });

  it('la pastille COURTE reste sur une seule ligne', () => {
    // « T9 Nid d'Aigle [COMPLET Full] [picto] » tient déjà (0 px mesuré).
    // Une règle qui viserait `.pill-affluence` sans `.limite` la changerait.
    expect(base).not.toMatch(/^\.pill-affluence \{[^}]*flex-direction/m);
  });

  it('sous 4/3, le picto s’efface toujours derrière les DEUX niveaux', () => {
    // Bloc INCHANGÉ par ce correctif : là, la colonne est bien plus étroite
    // et même « COMPLET » ne tient pas (68 à 80 px de débordement).
    const media = css.slice(css.indexOf('@media'));
    expect(media).toMatch(/\.dest \.pill-affluence \+ img\.motrice-dest \{\s*display: none;/);
  });
});

describe('l’écriture du remplissage ne passe PAS par « Publier »', () => {
  // Exception assumée (CLAUDE.md, docs/01 §2.8). Le risque n'est pas qu'elle
  // disparaisse, c'est qu'on la « range » avec le reste de l'onglet : le
  // remplissage tomberait alors dans le brouillon, et l'écran de gare
  // annoncerait des places libres jusqu'au prochain clic sur Publier.
  const ts = source('src/pages/supervision.ts');
  const corps = /async function changeAffluence\([\s\S]*?\n}/.exec(ts)?.[0] ?? '';

  it('la fonction existe et appelle directement le fournisseur', () => {
    expect(corps, 'changeAffluence introuvable').not.toBe('');
    expect(corps).toContain('await provider.setAffluence(date, numero, niveau)');
  });

  it('elle ne met RIEN en attente de publication', () => {
    for (const interdit of [
      'stageCirculationEtRafraichit',
      'bumpEnAttente',
      'brouillonCirc',
      'bump(',
    ]) {
      expect(corps, `changeAffluence ne doit pas appeler ${interdit}`).not.toContain(interdit);
    }
  });

  it('un échec est dit de façon PERSISTANTE, pas par un toast fugace', () => {
    expect(corps).toContain('afficheEchecPublication(');
    expect(corps).toContain('Remplissage non enregistré');
  });

  it('aucun rendu optimiste : la relecture précède l’affichage', () => {
    // On n'affiche que ce qui est réellement en base. Si le rafraîchissement
    // passait avant l'écriture, un refus laisserait à l'écran une valeur que
    // la base n'a pas.
    const ecriture = corps.indexOf('await provider.setAffluence');
    const relecture = corps.indexOf('await chargeAffluence(date)');
    const rendu = corps.indexOf('rendreCirculations()');
    expect(ecriture).toBeGreaterThan(-1);
    expect(relecture).toBeGreaterThan(ecriture);
    expect(rendu).toBeGreaterThan(relecture);
  });
});

describe('un train SUPPRIMÉ reste barré', () => {
  // RÉGRESSION du 10/09/2026, et AUCUN test ne l'a vue : en mettant le nom
  // de gare dans son propre `<span class="nom-dest">`, il a cessé d'hériter
  // du barré de `.dest`. `text-decoration` se propage par la boîte, et une
  // boîte à part — inline-block hier, item flex aujourd'hui — coupe la
  // propagation. Mesuré : `textDecorationLine` valait `none` sur le nom d'un
  // train supprimé, qui n'était donc plus barré du tout.
  //
  // Le barré est la SEULE marque qui distingue un train supprimé encore
  // affiché (docs/01 : il reste à l'écran, barré, jusqu'à son heure
  // théorique). Le perdre, c'est annoncer un train qui ne circule pas.
  const css = source('src/styles/ecran.css');
  const base = css.slice(0, css.indexOf('@media'));

  it('le barré est posé sur le NOM, pas seulement sur la ligne', () => {
    expect(base).toMatch(
      /\.rangee\.supprime \.r-dest \.dest \.nom-dest \{\s*text-decoration: line-through;/,
    );
  });

  it('le badge n’est JAMAIS barré', () => {
    // Une étiquette barrée se lit comme un défaut d'affichage, pas comme une
    // suppression. Règle antérieure, à ne pas perdre en chemin.
    expect(base).toMatch(/\.rangee\.supprime \.badge-train \{\s*text-decoration: none;/);
  });

  it('l’heure de départ reste barrée, elle aussi', () => {
    expect(base).toMatch(/\.rangee\.supprime \.r-dep[^{]*\{[^}]*text-decoration: line-through/);
  });

  it('l’atténuation reste sur la ligne entière', () => {
    // L'opacité, elle, se transmet par héritage : elle doit rester sur
    // `.dest` pour couvrir le badge et la pastille comme avant.
    const groupe =
      /\.rangee\.supprime \.r-dep,\s*\.rangee\.supprime \.r-dest \.dest \{([^}]*)\}/.exec(
        base,
      )?.[1] ?? '';
    expect(groupe).toContain('opacity: 0.42');
  });
});
