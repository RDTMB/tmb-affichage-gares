// Cellules NEUTRES → classeur .xlsx — PUR, et l'exact miroir de
// lecture-xlsx.ts.
//
// POURQUOI un écrivain maison, et POURQUOI du .xlsx plutôt que du CSV. Le
// fichier exporté n'est pas une sortie de données : c'est LE DOCUMENT
// D'EXPLOITATION, imprimé et diffusé au public, puis rechargé dans
// l'application après correction. Trois choses l'interdisent au CSV :
//   — une grille tient en DEUX blocs et une légende sur une même feuille, et
//     un classeur peut en porter plusieurs (petit service, grand service) ;
//     un CSV n'a ni feuilles ni colonnes conservées ;
//   — le séparateur d'un CSV dépend des réglages régionaux du poste, et nos
//     libellés contiennent des points-virgules et des virgules ; ouvert du
//     mauvais côté, le document se répand sur une colonne ;
//   — surtout, une heure CSV est du TEXTE : l'exploitation ne pourrait plus
//     la modifier comme une heure dans Excel, et la boucle
//     « exporter → corriger dans Excel → recharger » y perdrait sa raison
//     d'être.
// L'écriture pèse ~150 lignes sur `fflate`, déjà présent pour la LECTURE, et
// elle est chargée à la demande dans le même chunk : les écrans de gare n'en
// voient jamais un octet.
//
// Ce qui est écrit : une feuille par tableau, textes en ligne (aucune table
// de chaînes partagées à tenir), nombres pour les heures avec le format « h:mm »
// du document — la valeur, elle, garde ses secondes. Ce qui n'est PAS écrit :
// polices, bordures, fusions, largeurs de colonnes, logo. La mise en forme
// d'impression se refait dans Excel ; les VALEURS, elles, sont exactes.
import { strToU8, zipSync } from 'fflate';

import type { Cellule, FeuilleCellules } from './import-grille';
import { lettreColonne } from './import-grille';

function echappeXml(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Les caractères de contrôle sont interdits en XML 1.0 : un copier-coller
      // depuis un traitement de texte en glisse sans qu'on le voie.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}

/** Un nom de feuille Excel : 31 caractères, sans []:*?/\ — sinon le fichier est refusé. */
export function nomFeuilleValide(nom: string, secours: string): string {
  const propre = nom
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31);
  return propre === '' ? secours : propre;
}

const ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Style 0 = ordinaire, style 1 = heure (« h:mm », comme le document imprimé). */
const STYLE_HEURE = 1;

function styles(): string {
  return `${ENTETE_XML}
<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="h:mm"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function cellule(reference: string, valeur: Cellule): string {
  if (valeur === null || valeur === '') return '';
  if (typeof valeur === 'number') {
    if (!Number.isFinite(valeur)) return '';
    return `<c r="${reference}" s="${STYLE_HEURE}"><v>${valeur}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${echappeXml(valeur)}</t></is></c>`;
}

function feuilleXml(feuille: FeuilleCellules): string {
  const lignes = feuille.lignes
    .map((ligne, i) => {
      const cellules = ligne.map((v, c) => cellule(`${lettreColonne(c)}${i + 1}`, v)).join('');
      return cellules === '' ? '' : `<row r="${i + 1}">${cellules}</row>`;
    })
    .join('');
  return `${ENTETE_XML}
<worksheet xmlns="${NS}"><sheetData>${lignes}</sheetData></worksheet>`;
}

/**
 * Classeur .xlsx complet. Les feuilles sont écrites dans l'ordre donné ;
 * chaque nom est rendu acceptable par Excel (`nomFeuilleValide`), sans quoi
 * le fichier s'ouvre en erreur plutôt qu'en tableau.
 */
export function ecritClasseur(feuilles: FeuilleCellules[]): Uint8Array {
  if (feuilles.length === 0) throw new Error('Un classeur ne peut pas être vide.');
  const noms: string[] = [];
  for (const [i, f] of feuilles.entries()) {
    let nom = nomFeuilleValide(f.nom, `Feuille ${i + 1}`);
    // Excel refuse aussi deux feuilles de même nom.
    let n = 2;
    while (noms.includes(nom)) nom = nomFeuilleValide(`${f.nom} (${n++})`, `Feuille ${i + 1}`);
    noms.push(nom);
  }

  const contentTypes = `${ENTETE_XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${feuilles
  .map(
    (_f, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`;

  const relsRacine = `${ENTETE_XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `${ENTETE_XML}
<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>${noms
    .map((nom, i) => `<sheet name="${echappeXml(nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;

  const relsWorkbook = `${ENTETE_XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${noms
  .map(
    (_n, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${noms.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/>
</Relationships>`;

  const fichiers: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(relsRacine),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(relsWorkbook),
    'xl/styles.xml': strToU8(styles()),
  };
  feuilles.forEach((f, i) => {
    fichiers[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(feuilleXml(f));
  });
  return zipSync(fichiers, { level: 6 });
}
