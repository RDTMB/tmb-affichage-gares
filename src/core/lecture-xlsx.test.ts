// Lecteur .xlsx maison : validé contre l'extraction SheetJS du même fichier
// (src/core/__fixtures__/2026-ete-exploit-v1.cellules.json) et contre les
// grilles officielles via parseClasseur.
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import cellulesJson from './__fixtures__/2026-ete-exploit-v1.cellules.json';
import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { parseClasseur, type Cellule, type FeuilleCellules } from './import-grille';
import { decodeEntites, decodeReference, lireClasseur } from './lecture-xlsx';
import type { Grille } from './types';

function octetsFixture(): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(new URL('./__fixtures__/2026-ete-exploit-v1.xlsx', import.meta.url)),
    ),
  );
}

/** Lignes sans les vides de fin, cellules sans les null de fin : même forme quel que soit le lecteur. */
function compacte(lignes: Cellule[][]): Cellule[][] {
  const rognee = lignes.map((l) => {
    const copie = [...l];
    while (copie.length > 0 && copie[copie.length - 1] === null) copie.pop();
    return copie;
  });
  while (rognee.length > 0 && (rognee[rognee.length - 1]?.length ?? 0) === 0) rognee.pop();
  return rognee;
}

describe('lireClasseur sur le document d’exploitation été 2026', () => {
  const feuilles = lireClasseur(octetsFixture());

  it('lit les deux feuilles, dans l’ordre du classeur', () => {
    expect(feuilles.map((f) => f.nom)).toEqual(['Petit service', 'Grand service']);
  });

  it('produit EXACTEMENT les mêmes cellules que SheetJS (nombres, textes multilignes, vides)', () => {
    const reference = cellulesJson.feuilles as FeuilleCellules[];
    for (const [i, f] of feuilles.entries()) {
      expect(compacte(f.lignes)).toEqual(compacte(reference[i]?.lignes ?? []));
    }
  });

  it('garde les numéros de ligne Excel : « HORAIRES DES MONTEES » en ligne 3, descentes en ligne 18', () => {
    const grand = feuilles[1];
    expect(grand?.lignes[2]?.[0]).toBe('HORAIRES DES MONTEES');
    expect(grand?.lignes[17]?.[0]).toBe('HORAIRES DES DESCENTES');
    expect(grand?.lignes[4]?.[6]).toBe('Rÿ'); // G5 : indicateur du TRAIN 9
    expect(grand?.lignes[5]?.[2]).toBeCloseTo(0.2916666666666667, 12); // C6 : 07:00
  });

  it('enchaîné avec parseClasseur : reproduit la grille officielle du grand service', () => {
    const r = parseClasseur(feuilles);
    expect(r.erreurs).toEqual([]);
    const grand = r.feuilles.find((f) => f.nom === 'Grand service')?.grille;
    const oracle = grandServiceJson as unknown as Grille;
    expect(grand?.montees.map((m) => m.passages)).toEqual(oracle.montees.map((m) => m.passages));
    expect(grand?.descentes.map((m) => m.passages)).toEqual(
      oracle.descentes.map((m) => m.passages),
    );
  });
});

describe('fichiers qui ne sont pas des .xlsx', () => {
  it('un ancien .xls (signature OLE2) est refusé avec la marche à suivre', () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => lireClasseur(xls)).toThrow(/ancien classeur \.xls.*Enregistrer sous/);
  });

  it('un fichier quelconque (CSV, PDF…) est refusé', () => {
    expect(() => lireClasseur(new TextEncoder().encode('gare;heure\nLe Fayet;07:00'))).toThrow(
      /n’est pas un classeur Excel/,
    );
  });
});

describe('outils XML', () => {
  it('décode les entités', () => {
    expect(
      decodeEntites('Nid d&apos;Aigle &amp; Bellevue &lt;2380m&gt; &quot;x&quot; &#233;t&#xE9;'),
    ).toBe('Nid d\'Aigle & Bellevue <2380m> "x" été');
  });

  it('décode les références de cellules', () => {
    expect(decodeReference('A1')).toEqual([0, 0]);
    expect(decodeReference('G5')).toEqual([4, 6]);
    expect(decodeReference('AA10')).toEqual([9, 26]);
    expect(decodeReference('5G')).toBeNull();
  });
});

describe('lignes vides omises par Excel (défaut trouvé le 22/09/2026)', () => {
  // Excel n'écrit pas de <row> pour une ligne entièrement vide. La largeur du
  // tableau dense se calculait alors sur un tableau À TROUS, et `Math.max`
  // recevait `undefined` : la feuille entière revenait vide, sans la moindre
  // erreur. Le lecteur maison lisait donc le fichier de référence par chance —
  // ses lignes de séparation portent des cellules mises en forme.
  function classeurAvecLigneVide(): Uint8Array {
    const zip = zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      'xl/workbook.xml': strToU8(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Essai" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      // Ligne 2 absente du fichier : c'est tout le sujet.
      'xl/worksheets/sheet1.xml': strToU8(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>avant</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>apres</t></is></c></row></sheetData></worksheet>`,
      ),
    });
    return zip;
  }

  it('la feuille garde ses valeurs, et la ligne vide reste à sa place', () => {
    const feuille = lireClasseur(classeurAvecLigneVide())[0];
    expect(feuille?.nom).toBe('Essai');
    expect(feuille?.lignes).toEqual([
      ['avant', null],
      [null, null],
      [null, 'apres'],
    ]);
  });
});
