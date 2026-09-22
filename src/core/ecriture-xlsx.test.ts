// L'écriture d'un .xlsx se teste par la LECTURE : le même lecteur que
// l'import, sur le fichier que nous venons d'écrire. Rien n'est vérifié sur
// l'XML lui-même — ce qui compte est qu'il se relise, pas qu'il ressemble.
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { ecarts } from './ecarts-grille';
import { ecritClasseur, nomFeuilleValide } from './ecriture-xlsx';
import { cellulesGrille } from './export-grille';
import { lireClasseur } from './lecture-xlsx';
import { parseClasseur } from './import-grille';
import type { Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;

describe('ecritClasseur', () => {
  it('produit une archive zip dont le lecteur retrouve les feuilles et les valeurs', () => {
    const octets = ecritClasseur([
      {
        nom: 'Essai',
        lignes: [
          ['Titre', null, 0.5],
          [null, 'A', 'texte « accentué » & <balise>'],
        ],
      },
    ]);
    expect(Object.keys(unzipSync(octets)).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const relues = lireClasseur(octets);
    expect(relues).toHaveLength(1);
    expect(relues[0]?.nom).toBe('Essai');
    expect(relues[0]?.lignes[0]?.[0]).toBe('Titre');
    expect(relues[0]?.lignes[0]?.[2]).toBe(0.5);
    expect(relues[0]?.lignes[1]?.[2]).toBe('texte « accentué » & <balise>');
  });

  it('refuse un classeur vide', () => {
    expect(() => ecritClasseur([])).toThrow(/vide/);
  });

  it('plusieurs feuilles, dans l’ordre, aux bons noms', () => {
    const relues = lireClasseur(
      ecritClasseur([
        { nom: 'Petit service', lignes: [['un']] },
        { nom: 'Grand service', lignes: [['deux']] },
      ]),
    );
    expect(relues.map((f) => f.nom)).toEqual(['Petit service', 'Grand service']);
  });

  it('un nom de feuille impossible pour Excel est rendu acceptable', () => {
    expect(nomFeuilleValide('Été 2026 / hiver [v2]', 'Feuille 1')).toBe('Été 2026   hiver  v2');
    expect(nomFeuilleValide('   ', 'Feuille 1')).toBe('Feuille 1');
    expect(nomFeuilleValide('x'.repeat(50), 'Feuille 1')).toHaveLength(31);
    // Deux feuilles ne peuvent pas porter le même nom.
    expect(
      lireClasseur(
        ecritClasseur([
          { nom: 'Service', lignes: [['un']] },
          { nom: 'Service', lignes: [['deux']] },
        ]),
      ).map((f) => f.nom),
    ).toEqual(['Service', 'Service (2)']);
  });
});

describe('LA BOUCLE COMPLÈTE : grille → .xlsx → fichier relu → grille', () => {
  it('l’été 2026 revient sans le moindre écart, les deux services dans un classeur', () => {
    const octets = ecritClasseur([
      cellulesGrille(PETIT, { nomFeuille: 'Petit service', miseAJour: '05/06/2026' }),
      cellulesGrille(GRAND, { nomFeuille: 'Grand service', miseAJour: '05/06/2026' }),
    ]);
    const resultat = parseClasseur(lireClasseur(octets));
    expect(resultat.erreurs).toEqual([]);
    expect(resultat.feuilles.map((f) => f.nom)).toEqual(['Petit service', 'Grand service']);
    for (const [i, attendue] of [PETIT, GRAND].entries()) {
      const feuille = resultat.feuilles[i];
      expect(feuille?.erreurs).toEqual([]);
      expect(feuille?.avertissements).toEqual([]);
      expect(feuille?.periodesProposees).toEqual(attendue.periodes);
      expect(feuille?.miseAJour).toBe('05/06/2026');
      expect(ecarts(attendue, feuille?.grille as Grille).aucun).toBe(true);
    }
  });

  it('la valeur garde ses secondes, même si le format d’affichage est « h:mm »', () => {
    const relu = parseClasseur(lireClasseur(ecritClasseur([cellulesGrille(GRAND)]))).feuilles[0];
    const motivon = relu?.grille?.montees
      .find((m) => m.numero === 5)
      ?.passages.find((p) => p.gare === 'motivon');
    expect(motivon?.a).toBe('09:26:30');
    expect(motivon?.d).toBe('09:27:30');
  });
});

describe('XML : ce qui casserait le fichier sans qu’on le voie', () => {
  it('les caractères de contrôle d’un copier-coller sont retirés, pas écrits', () => {
    // Un caractère de contrôle est INTERDIT en XML 1.0 : écrit tel quel, le
    // classeur entier s’ouvre en erreur. Ils arrivent par un copier-coller
    // depuis un traitement de texte, et ne se voient nulle part à l’écran.
    const sale = `Col de${String.fromCharCode(7)} Voza${String.fromCharCode(1)}`;
    const relues = lireClasseur(ecritClasseur([{ nom: 'Essai', lignes: [[sale]] }]));
    expect(relues[0]?.lignes[0]?.[0]).toBe('Col de Voza');
  });

  it('les entités XML font l’aller-retour sans se dédoubler', () => {
    const texte = 'R & b < ÿ > "guillemets" & &amp; déjà écrit';
    const relues = lireClasseur(ecritClasseur([{ nom: 'Essai', lignes: [[texte]] }]));
    expect(relues[0]?.lignes[0]?.[0]).toBe(texte);
  });
});
