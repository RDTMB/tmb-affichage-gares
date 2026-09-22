// Le site publié a deux moitiés, et elles ne doivent RIEN partager.
//
// CE QUE CE FICHIER PROTÈGE. Depuis le 21/09/2026, un seul déploiement Pages
// publie `main` à la racine — ce que lisent les six écrans en gare — et `dev`
// sous `/preview/`, branchée sur la base de TEST. Les deux moitiés sortent du
// même workflow, à quelques lignes d'écart, avec les mêmes commandes. Deux
// erreurs y sont possibles, et aucune ne se verrait avant d'être en ligne :
//
//   — INVERSER LES BASES. La gare lirait la base de test (horaires d'essai sur
//     les six écrans), ou la préversion lirait la production (un message
//     publié « pour voir » partirait en gare pour de bon).
//   — INVERSER LES CHEMINS DE BASE. Une page dont le `--base` est faux ne
//     charge tout simplement pas ses scripts.
//
// COMMENT. On LIT le workflow livré, on en extrait le bloc de chaque étape, et
// on compare les deux jeux. Chercher une chaîne dans tout le fichier ne
// prouverait rien : `VITE_SUPABASE_URL` et `PREVERSION_SUPABASE_URL` y sont
// tous les deux, c'est justement l'affaire — ce qui compte est de savoir
// laquelle est dans QUELLE étape.
//
// NON prouvé ici : que GitHub exécute bien ce qu'on lit. Cela reste dans la
// recette, après fusion — ouvrir `/preview/` et la racine, et regarder les
// pastilles (docs/mise-en-service.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Normalisé en LF : le poste travaille en CRLF, le coureur d'intégration en
// LF, et un repère de texte qui dépend de la fin de ligne ne prouve rien.
const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/deploy.yml', import.meta.url)),
  'utf-8',
).replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// Découpe du YAML par l'indentation. Pas de dépendance : le fichier est
// régulier, et une dépendance de plus pour lire quarante lignes serait un
// mauvais marché.
// ---------------------------------------------------------------------------

function retrait(ligne: string): number {
  return /^ */.exec(ligne)![0].length;
}

/** Le bloc qui commence à la première ligne reconnue, jusqu'au prochain dérétrait. */
function bloc(source: string, motif: RegExp): string {
  const lignes = source.split('\n');
  const debut = lignes.findIndex((l) => motif.test(l));
  if (debut < 0) throw new Error(`bloc introuvable : ${motif}`);
  const marge = retrait(lignes[debut]!);
  const fin = lignes.findIndex(
    (l, i) => i > debut && l.trim() !== '' && retrait(l) <= marge && !l.trimStart().startsWith('#'),
  );
  return lignes.slice(debut, fin < 0 ? lignes.length : fin).join('\n');
}

/** Le corps d'un job, `nom:` compris. */
function job(nom: string): string {
  return bloc(WORKFLOW, new RegExp(`^  ${nom}:$`));
}

/** Les étapes d'un job, une entrée de liste par élément. */
function etapes(corpsDuJob: string): string[] {
  const lignes = bloc(corpsDuJob, /^ *steps:$/)
    .split('\n')
    .slice(1);
  const marge = Math.min(...lignes.filter((l) => /^ *- /.test(l)).map(retrait));
  const liste: string[] = [];
  for (const ligne of lignes) {
    if (/^ *- /.test(ligne) && retrait(ligne) === marge) liste.push(ligne);
    else if (liste.length > 0) liste[liste.length - 1] += `\n${ligne}`;
  }
  return liste;
}

/** L'étape dont le `name:` contient ce fragment. Une seule, sinon on se trompe de cible. */
function etape(corpsDuJob: string, fragment: string): string {
  const trouvees = etapes(corpsDuJob).filter((e) =>
    new RegExp(`^ *- name: .*${fragment}`, 'm').test(e),
  );
  if (trouvees.length !== 1) {
    throw new Error(`${trouvees.length} étape(s) pour « ${fragment} », il en faut exactement une`);
  }
  return trouvees[0]!;
}

/** Les variables de dépôt (`vars.X`) citées dans un bloc. */
function variablesDeDepot(texte: string): string[] {
  return [...texte.matchAll(/vars\.([A-Z0-9_]+)/g)].map((m) => m[1]!).sort();
}

/** Le `--base=` passé au build dans un bloc. */
function cheminDeBase(texte: string): string {
  const trouve = /--base=(\S+)/.exec(texte);
  if (!trouve) throw new Error('aucun --base= dans ce bloc');
  return trouve[1]!;
}

const SITE = job('site');
const RACINE_CONFIG = etape(SITE, 'Variables de PRODUCTION');
const RACINE_BUILD = etape(SITE, 'Construit la racine');
const APERCU_EXAMEN = etape(SITE, 'La préversion est-elle constructible');
const APERCU_BUILD = etape(SITE, 'Construit la préversion');

describe('les deux moitiés ne partagent pas leurs VARIABLES', () => {
  it('la racine ne connaît que les variables de production', () => {
    expect(variablesDeDepot(RACINE_CONFIG)).toEqual([
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_URL',
    ]);
  });

  it('la préversion ne connaît que les variables de la base de test', () => {
    for (const bloc of [APERCU_EXAMEN, APERCU_BUILD]) {
      expect(variablesDeDepot(bloc)).toEqual([
        'PREVERSION_SUPABASE_PUBLISHABLE_KEY',
        'PREVERSION_SUPABASE_URL',
      ]);
    }
  });

  it('aucune variable n’est citée des DEUX côtés', () => {
    // La garantie tient à ça et à rien d'autre : deux ensembles disjoints. Une
    // variable commune serait un aiguillage silencieux entre les deux bases.
    const production = new Set(variablesDeDepot(RACINE_CONFIG));
    const apercu = new Set([...variablesDeDepot(APERCU_EXAMEN), ...variablesDeDepot(APERCU_BUILD)]);
    expect([...production].filter((v) => apercu.has(v))).toEqual([]);
    expect(production.size).toBe(2);
    expect(apercu.size).toBe(2);
  });

  it('les deux noms de la préversion disent de quoi il s’agit', () => {
    // Le nommage fait la moitié du travail : personne ne pose par distraction
    // l'URL de la gare dans une variable qui s'appelle PREVERSION_.
    for (const nom of [...new Set(variablesDeDepot(APERCU_BUILD))]) {
      expect(nom.startsWith('PREVERSION_')).toBe(true);
    }
  });

  it('un garde-fou compare l’URL à la référence du projet de production', () => {
    // Le nommage ne peut pas empêcher une inversion, seulement la rendre
    // improbable. Ce qui l'empêche, c'est la comparaison à
    // REF_PROJET_PRODUCTION (src/data/config.ts), des DEUX côtés — et lue dans
    // le code, pas recopiée dans le workflow.
    for (const bloc of [RACINE_CONFIG, APERCU_EXAMEN]) {
      expect(bloc).toContain('REF_PROJET_PRODUCTION');
      expect(bloc).toContain('src/data/config.ts');
    }
  });
});

describe('les deux moitiés ne partagent pas leur CHEMIN DE BASE', () => {
  it('la racine se construit sur le nom du dépôt, sans /preview/', () => {
    expect(cheminDeBase(RACINE_BUILD)).toBe('/$DEPOT/');
  });

  it('la préversion se construit sous /preview/', () => {
    expect(cheminDeBase(APERCU_BUILD)).toBe('/$DEPOT/preview/');
  });

  it('les deux chemins diffèrent', () => {
    expect(cheminDeBase(RACINE_BUILD)).not.toBe(cheminDeBase(APERCU_BUILD));
  });

  it('`DEPOT` vient du nom réel du dépôt, pas d’une chaîne écrite à la main', () => {
    expect(bloc(SITE, /^ {4}env:$/)).toContain('DEPOT: ${{ github.event.repository.name }}');
  });

  it('l’artefact est relu avant publication : base et base de données', () => {
    // Les deux vérifications portent sur les fichiers CONSTRUITS. C'est la
    // seule preuve qui ne dépende d'aucune intention.
    const verdict = etape(SITE, "Vérifie l'artefact avant publication");
    expect(verdict).toContain('"$SITE/config.js"');
    expect(verdict).toContain('"$SITE/ecran.html"');
    expect(verdict).toContain('"$SITE/preview/config.js"');
    expect(verdict).toContain('"$SITE/preview/ecran.html"');
  });
});

describe('une préversion en panne ne retient jamais la gare', () => {
  it('la construction de la préversion ne fait pas échouer son job', () => {
    expect(APERCU_BUILD).toMatch(/^ +continue-on-error: true$/m);
  });

  it('celle de la production, elle, arrête tout', () => {
    // Symétrie refusée, et c'est voulu : sans variables de production, les
    // écrans de gare n'auraient aucune source de données.
    expect(RACINE_CONFIG).not.toMatch(/^ +continue-on-error: true$/m);
    expect(RACINE_CONFIG).toContain('exit 1');
  });

  it('la publication ne dépend PAS du verdict de la préversion', () => {
    // L'ordre est ce qui rend la règle vraie : `deploy` ne connaît que `site`,
    // et c'est `preversion` qui attend `deploy`. Inverser ces deux `needs`
    // suffirait à ce qu'une préversion mal réglée bloque la gare.
    const publication = job('deploy');
    expect(/^ {4}needs: site$/m.test(publication)).toBe(true);
    expect(publication).not.toContain('preversion');

    const verdict = job('preversion');
    expect(verdict).toContain('needs: [site, deploy]');
  });

  it('mais le run devient ROUGE : une préversion muette ne passe pas pour saine', () => {
    expect(job('preversion')).toContain('exit 1');
  });
});

describe('ce que le workflow dit de lui-même', () => {
  it('l’avertissement sur la reconstruction des DEUX moitiés est en tête', () => {
    // Le piège est contre-intuitif : quelqu'un voudra « n'construire que la
    // branche poussée », et effacera l'autre moitié du site. L'avertissement
    // est la seule chose qui puisse l'arrêter avant qu'il essaie.
    const entete = WORKFLOW.slice(0, WORKFLOW.indexOf('name: Tests'));
    expect(entete).toMatch(/REMPLACE l.artefact ENTIER/);
    expect(entete).toMatch(/RECONSTRUITES À CHAQUE PUBLICATION/);
  });

  it('le contrôle obligatoire des PR ne touche à aucune base', () => {
    // `build` porte le nom exigé par la protection de branche, et il tourne
    // sur des pull requests venues de n'importe où : il ne doit jamais voir
    // une variable de dépôt ni produire de config.js.
    const controle = job('build');
    expect(variablesDeDepot(controle)).toEqual([]);
    expect(controle).not.toContain('> public/config.js');
    expect(controle).toContain('npm test');
    expect(controle).toContain('npm run format:check');
  });

  it('la publication part de `main` ET de `dev`, jamais d’une pull request', () => {
    expect(SITE).toContain("github.ref == 'refs/heads/main'");
    expect(SITE).toContain("github.ref == 'refs/heads/dev'");
    expect(SITE).toContain("github.event_name == 'push'");
  });

  it('la racine se construit toujours depuis `main`, même quand `dev` a bougé', () => {
    // Sinon un push sur `dev` republierait la préversion à la racine : les six
    // écrans en gare passeraient sur la base de test.
    expect(SITE).toMatch(/uses: actions\/checkout@[0-9a-f]+ # v[\d.]+\n +with:\n +ref: main/);
  });

  it('les deux branches font la queue pour publier, sans s’annuler', () => {
    const publication = job('deploy');
    expect(publication).toContain('group: pages-publication');
    expect(publication).toContain('cancel-in-progress: false');
  });
});
