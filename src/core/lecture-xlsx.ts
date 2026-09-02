// Lecture d'un classeur .xlsx → cellules NEUTRES (tableau de lignes) — PURE.
//
// POURQUOI un lecteur maison plutôt que SheetJS. Un .xlsx n'est qu'une archive
// zip de fichiers XML (Office Open XML) ; nous n'avons besoin que des valeurs
// des cellules de quelques feuilles. `fflate` (dézippage, ~8 Ko compressés,
// sans dépendance) et 150 lignes suffisent, là où la version npm de SheetJS
// (0.18.5, figée depuis 2022, deux vulnérabilités connues, ~130 Ko compressés)
// aurait apporté bien plus que nécessaire. Ce module n'est chargé QUE par la
// boîte de dialogue d'import de la supervision (import dynamique) : aucun
// octet n'atteint les écrans de gare.
//
// Ce qui est lu : nom des feuilles (masquées exclues), valeurs des cellules —
// nombres (les heures Excel sont des fractions de jour), textes (chaînes
// partagées, texte enrichi concaténé, texte en ligne), booléens, erreurs.
// Ce qui est ignoré : styles, formules (leur valeur calculée est lue),
// fusions, images.
import { strFromU8, unzipSync } from 'fflate';

import type { Cellule, FeuilleCellules } from './import-grille';

export { lettreColonne } from './import-grille';

/** Signature d'un ancien classeur binaire .xls (OLE2), qui n'est pas un zip. */
const SIGNATURE_XLS = [0xd0, 0xcf, 0x11, 0xe0];

export function lireClasseur(octets: Uint8Array): FeuilleCellules[] {
  if (SIGNATURE_XLS.every((o, i) => octets[i] === o)) {
    throw new Error(
      'Ce fichier est un ancien classeur .xls : enregistrez-le au format .xlsx (Excel → Enregistrer sous) puis recommencez.',
    );
  }
  let fichiers: Record<string, Uint8Array>;
  try {
    fichiers = unzipSync(octets);
  } catch {
    throw new Error('Ce fichier n’est pas un classeur Excel (.xlsx).');
  }
  const workbook = texte(fichiers, 'xl/workbook.xml');
  if (workbook === null) throw new Error('Classeur Excel incomplet : xl/workbook.xml manque.');

  const relations = lireRelations(texte(fichiers, 'xl/_rels/workbook.xml.rels') ?? '');
  const chaines = lireChainesPartagees(texte(fichiers, 'xl/sharedStrings.xml') ?? '');

  const feuilles: FeuilleCellules[] = [];
  for (const balise of workbook.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const nom = decodeEntites(attribut(balise, 'name') ?? '');
    const etat = attribut(balise, 'state');
    if (etat === 'hidden' || etat === 'veryHidden') continue; // feuille masquée : hors import
    const rId = attribut(balise, 'r:id') ?? '';
    const cible = relations.get(rId);
    if (!cible) continue;
    const chemin = cible.startsWith('/') ? cible.slice(1) : `xl/${cible}`;
    const xml = texte(fichiers, chemin);
    if (xml === null) continue;
    feuilles.push({ nom, lignes: lireFeuille(xml, chaines) });
  }
  return feuilles;
}

function texte(fichiers: Record<string, Uint8Array>, chemin: string): string | null {
  const octets = fichiers[chemin];
  return octets ? strFromU8(octets) : null;
}

function attribut(balise: string, nom: string): string | null {
  const m = new RegExp(`\\s${nom}="([^"]*)"`).exec(balise);
  return m?.[1] ?? null;
}

/** rId → cible (« worksheets/sheet1.xml » ou « /xl/worksheets/sheet1.xml »). */
function lireRelations(xml: string): Map<string, string> {
  const relations = new Map<string, string>();
  for (const balise of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = attribut(balise, 'Id');
    const cible = attribut(balise, 'Target');
    if (id && cible) relations.set(id, cible);
  }
  return relations;
}

/** Chaînes partagées : chaque <si> concatène ses <t> (texte enrichi), sans les <rPh> phonétiques. */
function lireChainesPartagees(xml: string): string[] {
  const chaines: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    chaines.push(texteDesBalisesT(m[1] ?? ''));
  }
  return chaines;
}

function texteDesBalisesT(fragment: string): string {
  const sansPhonetique = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let resultat = '';
  for (const t of sansPhonetique.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    resultat += decodeEntites(t[1] ?? '');
  }
  return resultat;
}

export function decodeEntites(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_tout, code: string) => {
    switch (code) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          code.startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10),
        );
    }
  });
}

/** « G5 » → [ligne 4, colonne 6] (index 0). */
export function decodeReference(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let colonne = 0;
  for (const lettre of m[1] ?? '') colonne = colonne * 26 + (lettre.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, colonne - 1];
}

function lireFeuille(xml: string, chaines: string[]): Cellule[][] {
  const lignes: Cellule[][] = [];
  let ligneCourante = -1;
  for (const rangee of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numero = attribut(rangee[1] ?? '', 'r');
    ligneCourante = numero ? Number(numero) - 1 : ligneCourante + 1;
    let colonneCourante = -1;
    for (const cellule of (rangee[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = cellule[1] ?? '';
      const interieur = cellule[2] ?? '';
      const ref = attribut(attributs, 'r');
      const position = ref ? decodeReference(ref) : null;
      colonneCourante = position ? position[1] : colonneCourante + 1;
      const valeur = valeurCellule(attribut(attributs, 't'), interieur, chaines);
      if (valeur === null) continue;
      const ligne = (lignes[ligneCourante] ??= []);
      ligne[colonneCourante] = valeur;
    }
  }
  // Tableau DENSE : les trous valent null, chaque ligne existe (numéros de
  // ligne des messages d'erreur = index + 1).
  const largeur = Math.max(0, ...lignes.map((l) => l?.length ?? 0));
  const denses: Cellule[][] = [];
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i] ?? [];
    denses.push(Array.from({ length: largeur }, (_, c) => ligne[c] ?? null));
  }
  return denses;
}

function valeurCellule(type: string | null, interieur: string, chaines: string[]): Cellule {
  if (type === 'inlineStr') return texteDesBalisesT(interieur);
  const v = /<v>([\s\S]*?)<\/v>/.exec(interieur)?.[1];
  if (v === undefined) return null;
  switch (type) {
    case 's':
      return chaines[Number(v)] ?? null;
    case 'str': // résultat texte d'une formule
    case 'e': // erreur (#N/A…) : texte, refusé ensuite comme heure
    case 'd': // date ISO : texte, refusé ensuite comme heure
      return decodeEntites(v);
    case 'b':
      return v === '1' ? 'VRAI' : 'FAUX';
    default: {
      const n = Number(v);
      return Number.isFinite(n) ? n : decodeEntites(v);
    }
  }
}
