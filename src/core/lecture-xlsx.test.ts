// Lecteur .xlsx maison : validé contre l'extraction SheetJS du même fichier
// (src/core/__fixtures__/2026-ete-exploit-v1.cellules.json) et contre les
// grilles officielles via parseClasseur.
import { readFileSync } from 'node:fs';
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
