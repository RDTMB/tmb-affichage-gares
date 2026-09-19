// Le 19/09/2026, `CLAUDE.md` a été coupé en cinq : ce qui est vrai pour TOUT
// lot est resté, le reste est parti dans `.claude/regles-*.md` et
// `.claude/charte-graphique.md`. Le seul risque d'un tel déménagement est
// qu'une règle tombe entre deux cartons — et elle ne manquerait à personne
// avant le jour où elle manquerait beaucoup.
//
// Ce test lit l'ANCIEN fichier, figé tel quel dans
// `.claude/_ancien-claude-md.txt`, en extrait chaque règle et vérifie qu'elle
// se retrouve — à la ponctuation et au retour à la ligne près — dans
// EXACTEMENT un des fichiers d'arrivée. « Exactement un » n'est pas du zèle :
// deux copies d'une même règle divergent, et on ne sait plus laquelle fait foi.
//
// Le fichier de référence n'est pas de la dette : il est la preuve. Il pourra
// être retiré, avec ce test, le jour où on le décidera explicitement.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function lit(chemin: string): string {
  // Fins de ligne normalisées : le poste de développement est en CRLF, le
  // coureur d'intégration continue en LF, et les règles ci-dessous sont
  // découpées ligne à ligne.
  return readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const ANCIEN = '.claude/_ancien-claude-md.txt';

/** Les fichiers où une règle de l'ancien `CLAUDE.md` a le droit d'avoir atterri. */
const ARRIVEES = [
  'CLAUDE.md',
  '.claude/regles-horaires.md',
  '.claude/regles-affichage.md',
  '.claude/regles-courses-libres.md',
  '.claude/charte-graphique.md',
];

// Les trois documents longs étaient annoncés par une puce « à lire avant de
// coder » — c'est précisément ce que ce lot remplace par la table
// d'aiguillage. Ces trois puces-là ne sont donc pas déplacées mais
// REFORMULÉES ; le test vérifie à la place, plus bas, que les trois documents
// restent cités.
const REFORMULEES = [
  'docs/01-spec-fonctionnelle.md',
  'docs/02-spec-technique.md',
  'docs/03-plan-de-developpement.md',
];

/**
 * Découpe un Markdown en puces de premier niveau. Une puce commence par « - »
 * en colonne 0 et se poursuit sur les lignes indentées de deux espaces.
 */
function puces(markdown: string): string[] {
  const lignes = markdown.split('\n');
  const trouvees: string[] = [];
  let courante: string[] | null = null;
  for (const ligne of lignes) {
    if (ligne.startsWith('- ')) {
      if (courante) trouvees.push(courante.join('\n'));
      courante = [ligne];
    } else if (courante && ligne.startsWith('  ')) {
      courante.push(ligne);
    } else if (courante) {
      trouvees.push(courante.join('\n'));
      courante = null;
    }
  }
  if (courante) trouvees.push(courante.join('\n'));
  return trouvees;
}

/**
 * « À la ponctuation près » : on ne garde que lettres et chiffres, en
 * minuscules. Une règle ré-enveloppée sur des lignes plus courtes, ou dont un
 * tiret cadratin a changé de forme, reste la même règle ; une règle amputée
 * d'une phrase, non.
 */
function normalise(texte: string): string {
  return texte.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Premiers mots d'une puce, pour que l'échec dise DE QUELLE règle il parle. */
function titre(puce: string): string {
  return puce.split('\n')[0].slice(0, 70);
}

const ancien = lit(ANCIEN);
const toutes = puces(ancien);
const regles = toutes.filter((p) => p.startsWith('- **'));
const autres = toutes.filter(
  (p) => !p.startsWith('- **') && !REFORMULEES.some((doc) => p.includes(doc)),
);
const arrivees = ARRIVEES.map((chemin) => ({ chemin, texte: normalise(lit(chemin)) }));

function ouEstElle(puce: string): string[] {
  const cible = normalise(puce);
  return arrivees.filter((f) => f.texte.includes(cible)).map((f) => f.chemin);
}

describe('le déménagement de CLAUDE.md n’a perdu aucune règle', () => {
  it('l’ancien fichier est bien là, et il porte les règles attendues', () => {
    // Un garde-fou contre le test qui se vide : si l'extraction cassait, la
    // boucle ci-dessous passerait sur zéro règle, en vert.
    expect(regles).toHaveLength(24);
    expect(autres).toHaveLength(20);
  });

  it.each(regles.map((r) => [titre(r), r] as const))(
    'la règle « %s » se retrouve dans un et un seul fichier',
    (_titre, puce) => {
      expect(ouEstElle(puce)).toHaveLength(1);
    },
  );

  it.each(autres.map((r) => [titre(r), r] as const))(
    'la puce « %s » se retrouve dans un et un seul fichier',
    (_titre, puce) => {
      expect(ouEstElle(puce)).toHaveLength(1);
    },
  );

  it('les trois documents longs restent cités, sans « à lire avant de coder »', () => {
    const nouveau = lit('CLAUDE.md');
    for (const doc of REFORMULEES) expect(nouveau).toContain(doc);
    expect(nouveau).not.toContain('à lire avant de coder');
  });

  it('la table d’aiguillage mène à chacun des fichiers sortis', () => {
    const nouveau = lit('CLAUDE.md');
    for (const fichier of ARRIVEES.filter((f) => f !== 'CLAUDE.md')) {
      expect(nouveau).toContain(fichier);
    }
  });

  it('la section Sécurité est restée dans CLAUDE.md, en entier', () => {
    // Exception assumée au principe d'économie : une règle qu'on ne doit
    // jamais manquer ne peut pas vivre derrière une lecture conditionnelle.
    const sectionAncienne = ancien.split('## Sécurité — règles absolues')[1].split('\n## ')[0];
    const nouveau = lit('CLAUDE.md');
    for (const puce of puces(sectionAncienne)) {
      expect(normalise(nouveau)).toContain(normalise(puce));
    }
  });
});
