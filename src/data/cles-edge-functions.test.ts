// Lecture des clés d'API par les trois Edge Functions.
//
// Historique en deux temps. Le constat S9 demandait de sortir des clés
// « legacy » sans casser l'invitation, la suppression et la traduction : les
// fonctions ont d'abord lu le trousseau JSON avec un REPLI temporaire sur les
// anciennes variables, le temps de la fenêtre entre le déploiement et la
// coupure. Les clés legacy ont été désactivées en production le 07/09/2026 et
// la recette a confirmé que les trois fonctions lisent bien le trousseau —
// aucune ligne `[cles]` dans leurs journaux. Le repli est donc retiré : il ne
// protégeait plus rien et MASQUAIT une régression.
//
// POURQUOI CE TEST EXISTE SOUS CETTE FORME. `tsconfig.include` s'arrête à
// `src` : les Edge Functions ne sont ni compilées ni testées par la chaîne
// d'intégration (constat I-21, chantier à part). Elles tournent sous Deno, pas
// sous Node, et appellent `Deno.serve` dès le chargement du module — on ne peut
// donc pas les importer ici. Alors on fait les deux seules choses qui prouvent
// quelque chose :
//   1. on découpe le bloc de lecture des clés dans les TROIS fichiers et on
//      compare les copies caractère par caractère. C'est une divergence entre
//      les trois qui a produit l'état de septembre : deux fonctions portaient
//      un repli de clé publiable, la troisième non ;
//   2. on COMPILE ce bloc (Vite retire les types par esbuild) et on l'EXÉCUTE
//      avec un faux `Deno.env`. Ce n'est pas une copie du code déployé qui est
//      éprouvée, c'est lui.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// `vite` et non `esbuild` : esbuild n'est qu'une dépendance TRANSITIVE de Vite,
// l'importer directement serait un besoin caché qu'une montée de version de
// Vite pourrait casser sans prévenir. `transformWithEsbuild` est l'API publique
// de Vite pour la même chose.
import { transformWithEsbuild } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';

const FONCTIONS = ['inviter-utilisateur', 'supprimer-utilisateur', 'traduire'] as const;

// Repères cherchés sans leur début de ligne : la borne porte une apostrophe,
// et une constante qui la contiendrait se lirait moins bien que ce décalage.
const DEBUT = 'BLOC IDENTIQUE dans les trois fonctions (début)';
const FIN = 'BLOC IDENTIQUE dans les trois fonctions (fin)';

function source(fonction: string): string {
  const url = new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

/** Le bloc délimité, lignes de bornes comprises. Lève si les bornes manquent. */
function blocDe(fonction: string): string {
  const src = source(fonction);
  const repereDebut = src.indexOf(DEBUT);
  const repereFin = src.indexOf(FIN);
  if (repereDebut === -1 || repereFin === -1 || repereFin < repereDebut) {
    throw new Error(`${fonction} : bloc des clés introuvable ou bornes inversées`);
  }
  const debut = src.lastIndexOf('\n', repereDebut) + 1;
  return src.slice(debut, src.indexOf('\n', repereFin) + 1);
}

/** Le fichier sans ses commentaires : le CODE, pas ce qui l'explique. */
function codeDe(fonction: string): string {
  return source(fonction)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

interface EnvSimule {
  [nom: string]: string | undefined;
}

interface Lecteurs {
  cleApi(nomTrousseau: string): string;
  cleSecrete(): string;
  clePubliable(): string;
  /** Ce qui est parti dans `console.error` : les pannes, toujours dites. */
  journal: string[];
  /**
   * Ce qui est parti dans `console.warn`. Doit rester VIDE : c'est par là que
   * l'ancien repli s'annonçait, et un repli réintroduit se verrait ici.
   */
  alertes: string[];
}

/**
 * Compile le bloc et l'exécute avec l'environnement donné.
 *
 * `console.error` est remplacé par une collecte : le contrat de `cleApi()` est
 * de TOUJOURS journaliser avant de lever, sans quoi la panne serait muette chez
 * un appelant qui transforme l'échec en réponse neutre — c'est le cas de
 * `traduire`. Un test qui ne regarderait que la valeur de retour laisserait
 * passer précisément le défaut qu'on veut interdire.
 */
async function lecteurs(env: EnvSimule): Promise<Lecteurs> {
  const { code: js } = await transformWithEsbuild(blocDe('inviter-utilisateur'), 'bloc-cles.ts', {
    loader: 'ts',
    target: 'es2020',
  });
  const journal: string[] = [];
  const alertes: string[] = [];
  const fabrique = new Function(
    'Deno',
    'console',
    `${js}\nreturn { cleApi, cleSecrete, clePubliable };`,
  ) as (
    deno: { env: { get(nom: string): string | undefined } },
    fausseConsole: { error(message: string): void; warn(message: string): void },
  ) => Omit<Lecteurs, 'journal' | 'alertes'>;
  const api = fabrique(
    { env: { get: (nom: string) => env[nom] } },
    {
      error: (message: string) => void journal.push(message),
      warn: (message: string) => void alertes.push(message),
    },
  );
  return { ...api, journal, alertes };
}

describe('les trois copies du bloc sont identiques', () => {
  it('le bloc est présent et délimité dans les trois fonctions', () => {
    for (const fonction of FONCTIONS) {
      expect(() => blocDe(fonction), fonction).not.toThrow();
    }
  });

  it('caractère par caractère, les trois copies sont le même texte', () => {
    // Aucun module partagé : le tableau de bord déploie une fonction en collant
    // UN fichier. La duplication est donc voulue — et vérifiée ici plutôt que
    // promise en commentaire. C'est cet invariant qui la rend acceptable.
    const [reference, ...autres] = FONCTIONS.map(blocDe);
    for (const [i, copie] of autres.entries()) {
      expect(copie, `${FONCTIONS[i + 1]} diverge de ${FONCTIONS[0]}`).toBe(reference);
    }
  });

  it('les deux clients sont bien branchés sur les lecteurs', () => {
    for (const fonction of ['inviter-utilisateur', 'supprimer-utilisateur']) {
      const src = source(fonction);
      expect(src, fonction).toContain('createClient(url, cleSecrete())');
      expect(src, fonction).toContain('clePubliable(),');
    }
    // `traduire` lit la clé AVANT son `try`, dont le `catch` répond « pas de
    // traduction » sans rien dire : sinon un défaut de configuration se
    // confondrait avec une panne de DeepL.
    const traduire = source('traduire');
    expect(traduire).toMatch(/secrete = cleSecrete\(\);/);
    expect(traduire.indexOf('secrete = cleSecrete();')).toBeLessThan(
      traduire.indexOf('const admin = createClient(url, secrete);'),
    );
    expect(traduire).toContain('status: 500');
  });
});

describe('le repli sur les anciennes clés a été RETIRÉ', () => {
  it('aucune fonction ne LIT plus une ancienne variable, nulle part', () => {
    // Contrôle sur le CODE et non sur le fichier : le commentaire du bloc
    // nomme ces variables pour expliquer pourquoi on ne les lit plus, et un
    // contrôle naïf le prendrait pour une lecture.
    for (const fonction of FONCTIONS) {
      const code = codeDe(fonction);
      expect(code, fonction).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(code, fonction).not.toContain('SUPABASE_ANON_KEY');
      // Le nom au SINGULIER n'a jamais existé côté Supabase ; il ne doit pas
      // réapparaître sous couvert de repli.
      expect(code, fonction).not.toMatch(/SUPABASE_PUBLISHABLE_KEY\b(?!S)/);
    }
  });

  it('`cleApi()` ne prend plus qu’UN paramètre : il n’y a plus de second nom', () => {
    // La signature est la preuve la plus courte que le repli est parti.
    expect(blocDe('traduire')).toContain('function cleApi(nomTrousseau: string): string {');
    expect(blocDe('traduire')).toContain("return cleApi('SUPABASE_SECRET_KEYS');");
    expect(blocDe('traduire')).toContain("return cleApi('SUPABASE_PUBLISHABLE_KEYS');");
  });

  it('la mention « À RETIRER » a disparu avec ce qu’elle désignait', () => {
    // Elle exigeait sa propre suppression : la garder après la coupure
    // laisserait croire qu'il reste quelque chose à faire.
    for (const fonction of FONCTIONS) {
      expect(blocDe(fonction), fonction).not.toContain('À RETIRER');
      expect(blocDe(fonction), fonction).not.toContain('TEMPORAIRE');
    }
  });

  it('le bloc dit POURQUOI le repli est parti, pour qu’on ne le remette pas', () => {
    // Un repli réintroduit de bonne foi masquerait de nouveau une régression :
    // la raison doit rester lisible à l'endroit de la décision.
    const bloc = blocDe('inviter-utilisateur');
    expect(bloc).toContain('PLUS AUCUN REPLI');
    expect(bloc).toMatch(/07\/09\/2026/);
  });
});

describe('cleApi() — le trousseau JSON, ou rien', () => {
  let vu: Lecteurs;

  beforeEach(async () => {
    vu = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_abc' }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_xyz' }),
    });
  });

  it('lit la clé « default » du trousseau, sans rien dire du tout', () => {
    // État NORMAL : aucune trace, ni erreur ni avertissement.
    expect(vu.cleSecrete()).toBe('sb_secret_abc');
    expect(vu.clePubliable()).toBe('sb_publishable_xyz');
    expect(vu.journal).toEqual([]);
    expect(vu.alertes).toEqual([]);
  });

  it('les anciennes variables sont IGNORÉES même quand elles répondent', async () => {
    // Elles existent toujours dans l'environnement de la fonction, avec un JWT
    // périmé. Les lire serait replier sur une clé morte.
    const deux = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_neuve' }),
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
      SUPABASE_ANON_KEY: 'eyJ.ancien.anon',
    });
    expect(deux.cleSecrete()).toBe('sb_secret_neuve');
    expect(deux.journal).toEqual([]);
    expect(deux.alertes).toEqual([]);
  });
});

describe('cleApi() — refuse franchement, et le dit', () => {
  /** Toutes les façons dont le trousseau peut être inutilisable. */
  const inutilisables: { cas: string; env: EnvSimule; trace: RegExp }[] = [
    { cas: 'trousseau absent', env: {}, trace: /absent de l’environnement/ },
    {
      cas: 'trousseau illisible',
      env: { SUPABASE_SECRET_KEYS: '{ceci n’est pas du JSON' },
      trace: /JSON/,
    },
    {
      cas: 'trousseau sans clé « default »',
      env: { SUPABASE_SECRET_KEYS: JSON.stringify({ prod: 'sb_secret_prod', vieille: 'x' }) },
      trace: /prod, vieille/,
    },
    {
      cas: 'clé « default » vide',
      env: { SUPABASE_SECRET_KEYS: JSON.stringify({ default: '' }) },
      trace: /pas de clé/,
    },
    { cas: 'JSON valide mais nul', env: { SUPABASE_SECRET_KEYS: 'null' }, trace: /pas un objet/ },
    {
      cas: 'JSON valide mais une chaîne',
      env: { SUPABASE_SECRET_KEYS: '"sb_secret_seule"' },
      trace: /pas un objet/,
    },
    {
      cas: 'JSON valide mais un nombre',
      env: { SUPABASE_SECRET_KEYS: '42' },
      trace: /pas un objet/,
    },
  ];

  for (const { cas, env, trace } of inutilisables) {
    it(`${cas} : lève, avec la variable nommée`, async () => {
      // Jamais `undefined` vers createClient : l'erreur d'authentification
      // arriverait trois appels plus loin, illisible. Et le repli d'avant
      // aurait ici renvoyé une clé morte, donc reporté la panne au premier
      // appel réseau — c'est exactement ce qu'on refuse.
      const vu = await lecteurs(env);
      expect(() => vu.cleSecrete()).toThrow(/Configuration incomplète/);
      expect(() => vu.cleSecrete()).toThrow(/SUPABASE_SECRET_KEYS/);
    });

    it(`${cas} : journalise AVANT de lever, en disant la cause`, async () => {
      // `traduire` attrape et répond neutre : sans cette trace la panne serait
      // muette, et une panne muette se répète.
      const vu = await lecteurs(env);
      expect(() => vu.cleSecrete()).toThrow();
      expect(vu.journal).toHaveLength(1);
      expect(vu.journal[0]).toContain('SUPABASE_SECRET_KEYS');
      expect(vu.journal[0]).toMatch(trace);
      // Rien dans `warn` : plus aucun repli à annoncer.
      expect(vu.alertes).toEqual([]);
    });
  }

  it('un JSON valide mais un TABLEAU vide n’a pas de clé « default »', async () => {
    // `Object.keys([])` vaut `[]` : le cas passe par « noms présents »,
    // pas par « pas un objet ». Il lève quand même.
    const vu = await lecteurs({ SUPABASE_SECRET_KEYS: '[]' });
    expect(() => vu.cleSecrete()).toThrow(/Configuration incomplète/);
    expect(vu.journal[0]).toContain('(aucun)');
  });

  it('la clé publiable refuse de la même façon, en nommant SA variable', async () => {
    const vu = await lecteurs({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_a' }) });
    expect(() => vu.clePubliable()).toThrow(/SUPABASE_PUBLISHABLE_KEYS/);
    expect(vu.journal).toHaveLength(1);
    expect(vu.journal[0]).toContain('SUPABASE_PUBLISHABLE_KEYS');
  });
});
