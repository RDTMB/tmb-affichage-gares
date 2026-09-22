// Les écrans de gare n'embarquent AUCUN octet de l'outillage des grilles.
//
// Le principe est écrit partout (CLAUDE.md, docs/02, les en-têtes de
// lecture-xlsx.ts et ecriture-xlsx.ts) et n'était vérifié nulle part : il
// tenait sur la discipline d'un `import()` dynamique, qu'un `import` ordinaire
// ajouté en passant suffit à défaire — sans erreur, sans test rouge, et sans
// que personne relise la taille du bundle. Un écran de gare tourne 18 h par
// jour sur un Raspberry Pi derrière un réseau de montagne : ce qu'il télécharge
// se compte.
//
// Le contrôle suit les imports STATIQUES depuis chaque page d'écran, en
// ignorant les `import(...)` dynamiques — qui, eux, produisent un chunk à part
// et ne sont chargés que si on les demande.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('../..', import.meta.url));

/** Pages chargées par un écran de gare (ecran.html) et par la grille du jour (grille.html). */
const PAGES_ECRANS = ['src/pages/ecran.ts', 'src/pages/grille.ts'];

/** Modules qui ne doivent JAMAIS être atteints statiquement depuis ces pages. */
const INTERDITS = [
  'src/core/lecture-xlsx.ts',
  'src/core/ecriture-xlsx.ts',
  'src/core/export-grille.ts',
  'src/core/import-grille.ts',
  'src/core/edition-grille.ts',
  'src/core/grilles-periodes.ts',
  'src/pages/correction-grille.ts',
  'src/pages/horaires-onglet.ts',
  'src/pages/onglet-horaires.ts',
  'src/pages/supervision.ts',
];

/** Spécificateurs d'imports STATIQUES relatifs d'un fichier (les `import(...)` sont exclus). */
function importsStatiques(source: string): string[] {
  const sansDynamiques = source.replace(/\bimport\s*\(/g, 'IMPORT_DYNAMIQUE(');
  const specificateurs: string[] = [];
  const motifs = [
    /^\s*import\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /^\s*export\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  ];
  for (const motif of motifs) {
    for (const m of sansDynamiques.matchAll(motif)) {
      if (m[1]?.startsWith('.')) specificateurs.push(m[1]);
    }
  }
  return specificateurs;
}

function resoudre(depuis: string, specificateur: string): string | null {
  const base = resolve(RACINE, dirname(depuis), specificateur);
  for (const candidat of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidat, 'utf8');
      return relative(RACINE, candidat).replace(/\\/g, '/');
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

/** Tous les fichiers atteints par imports statiques depuis `depart`, lui compris. */
function fermetureStatique(depart: string): Set<string> {
  const vus = new Set<string>();
  const aVoir = [depart];
  while (aVoir.length > 0) {
    const fichier = aVoir.pop();
    if (fichier === undefined || vus.has(fichier)) continue;
    vus.add(fichier);
    const source = readFileSync(resolve(RACINE, fichier), 'utf8');
    for (const specificateur of importsStatiques(source)) {
      const cible = resoudre(fichier, specificateur);
      if (cible !== null && !vus.has(cible)) aVoir.push(cible);
    }
  }
  return vus;
}

describe('les pages d’écran n’atteignent pas l’outillage des grilles', () => {
  for (const page of PAGES_ECRANS) {
    it(`${page} : aucun import statique interdit, même indirect`, () => {
      const atteints = fermetureStatique(page);
      expect([...atteints].filter((f) => INTERDITS.includes(f))).toEqual([]);
    });
  }

  it('le contrôle a bien mordu : la supervision, elle, atteint ces modules', () => {
    // Sans cette vérification, une erreur de résolution rendrait les tests
    // ci-dessus verts pour la plus mauvaise des raisons — ils ne verraient rien.
    const atteints = fermetureStatique('src/pages/supervision.ts');
    expect(atteints.has('src/pages/onglet-horaires.ts')).toBe(true);
    expect(atteints.has('src/core/edition-grille.ts')).toBe(true);
    expect(atteints.has('src/pages/correction-grille.ts')).toBe(true);
    expect(atteints.has('src/core/import-grille.ts')).toBe(true);
    // …mais pas le lecteur ni l'écrivain .xlsx : eux restent à la demande.
    expect(atteints.has('src/core/lecture-xlsx.ts')).toBe(false);
    expect(atteints.has('src/core/ecriture-xlsx.ts')).toBe(false);
    expect(atteints.has('src/core/export-grille.ts')).toBe(false);
  });
});
