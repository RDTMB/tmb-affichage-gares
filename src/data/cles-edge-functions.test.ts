// Lecture des clés d'API par les trois Edge Functions (constat S9 : sortir des
// clés « legacy » sans casser l'invitation, la suppression et la traduction).
//
// POURQUOI CE TEST EXISTE SOUS CETTE FORME. `tsconfig.include` s'arrête à
// `src` : les Edge Functions ne sont ni compilées ni testées par la chaîne
// d'intégration (constat I-21, chantier à part). Elles tournent sous Deno, pas
// sous Node, et appellent `Deno.serve` dès le chargement du module — on ne peut
// donc pas les importer ici. Alors on fait les deux seules choses qui prouvent
// quelque chose :
//   1. on découpe le bloc de lecture des clés dans les TROIS fichiers et on
//      compare les copies caractère par caractère. C'est une divergence entre
//      les trois qui a produit l'état d'avant : deux fonctions avaient un repli
//      de clé publiable, la troisième non ;
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

interface EnvSimule {
  [nom: string]: string | undefined;
}

interface Lecteurs {
  cleApi(nomTrousseau: string, nomLegacy: string): string;
  cleSecrete(): string;
  clePubliable(): string;
  journal: string[];
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
  const fabrique = new Function(
    'Deno',
    'console',
    `${js}\nreturn { cleApi, cleSecrete, clePubliable };`,
  ) as (
    deno: { env: { get(nom: string): string | undefined } },
    faussseConsole: { error(message: string): void },
  ) => Omit<Lecteurs, 'journal'>;
  const api = fabrique(
    { env: { get: (nom: string) => env[nom] } },
    { error: (message: string) => void journal.push(message) },
  );
  return { ...api, journal };
}

describe('les trois copies du bloc sont identiques', () => {
  it('le bloc est présent et délimité dans les trois fonctions', async () => {
    for (const fonction of FONCTIONS) {
      expect(() => blocDe(fonction), fonction).not.toThrow();
    }
  });

  it('caractère par caractère, les trois copies sont le même texte', async () => {
    // Aucun module partagé : le tableau de bord déploie une fonction en collant
    // UN fichier. La duplication est donc voulue — et vérifiée ici plutôt que
    // promise en commentaire.
    const [reference, ...autres] = FONCTIONS.map(blocDe);
    for (const [i, copie] of autres.entries()) {
      expect(copie, `${FONCTIONS[i + 1]} diverge de ${FONCTIONS[0]}`).toBe(reference);
    }
  });

  it('plus aucune fonction ne lit une ancienne variable en dehors du bloc', async () => {
    // C'est le cœur de S9 : une lecture directe oubliée quelque part casserait
    // à la coupure, et ne se verrait qu'en gare.
    for (const fonction of FONCTIONS) {
      const horsBloc = source(fonction).replace(blocDe(fonction), '');
      expect(horsBloc, fonction).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(horsBloc, fonction).not.toContain('SUPABASE_ANON_KEY');
      expect(horsBloc, fonction).not.toContain('SUPABASE_PUBLISHABLE_KEY');
    }
  });

  it('les deux clients sont bien branchés sur les lecteurs', async () => {
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

  it('le repli sur les anciens noms est marqué comme temporaire, à retirer', async () => {
    // Après la coupure, ces variables gardent leur JWT périmé au lieu de
    // disparaître : le repli ne protège de rien et n'a plus qu'à partir. Sans
    // cette marque, il resterait là pour toujours.
    const bloc = blocDe('traduire');
    expect(bloc).toContain('À RETIRER');
    expect(bloc).toContain('TEMPORAIRE');
  });
});

describe('cleApi() — le trousseau JSON d’abord', () => {
  let vu: Lecteurs;

  beforeEach(async () => {
    vu = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_abc' }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_xyz' }),
    });
  });

  it('lit la clé « default » du trousseau, sans rien journaliser', async () => {
    expect(vu.cleSecrete()).toBe('sb_secret_abc');
    expect(vu.clePubliable()).toBe('sb_publishable_xyz');
    expect(vu.journal).toEqual([]);
  });

  it('le trousseau L’EMPORTE sur l’ancienne variable, même si les deux sont là', async () => {
    // Pendant la fenêtre de transition les deux répondent. Prendre la nouvelle
    // est ce qui fait que la coupure ne change rien.
    const deux = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_neuve' }),
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
    });
    expect(deux.cleSecrete()).toBe('sb_secret_neuve');
    expect(deux.journal).toEqual([]);
  });
});

describe('cleApi() — le repli temporaire sur les anciens noms', () => {
  it('sert quand le trousseau est absent : la fenêtre avant la coupure', async () => {
    const vu = await lecteurs({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt' });
    expect(vu.cleSecrete()).toBe('eyJ.ancien.jwt');
    // Trousseau absent tout court : rien à signaler, c'est l'état d'avant.
    expect(vu.journal).toEqual([]);
  });

  it('sert aussi quand le trousseau existe sans clé « default » — en le DISANT', async () => {
    // Une clé nommée autrement (« prod », « ecrans »…) est un réglage à
    // corriger : la liste des noms réellement présents est la seule
    // information qui permette de le faire.
    const vu = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ prod: 'sb_secret_prod', vieille: 'x' }),
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
    });
    expect(vu.cleSecrete()).toBe('eyJ.ancien.jwt');
    expect(vu.journal).toHaveLength(1);
    expect(vu.journal[0]).toContain('SUPABASE_SECRET_KEYS');
    expect(vu.journal[0]).toContain('prod, vieille');
  });

  it('sert aussi quand le trousseau est illisible — en le DISANT', async () => {
    const vu = await lecteurs({
      SUPABASE_SECRET_KEYS: '{ceci n’est pas du JSON',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
    });
    expect(vu.cleSecrete()).toBe('eyJ.ancien.jwt');
    expect(vu.journal).toHaveLength(1);
    expect(vu.journal[0]).toContain('JSON');
  });

  it('une clé vide dans le trousseau ne compte pas pour une clé', async () => {
    // `''` est présent au sens de JavaScript et inutilisable au sens de
    // Supabase : le traiter comme une clé ferait passer la panne à l'appel.
    const vu = await lecteurs({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: '' }),
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
    });
    expect(vu.cleSecrete()).toBe('eyJ.ancien.jwt');
    expect(vu.journal).toHaveLength(1);
  });

  it('un trousseau JSON valide mais qui n’est pas un objet ne fait pas planter', async () => {
    // `JSON.parse('null')` et `JSON.parse('"x"')` réussissent tous les deux.
    for (const brut of ['null', '"sb_secret_seule"', '[]', '42']) {
      const vu = await lecteurs({
        SUPABASE_SECRET_KEYS: brut,
        SUPABASE_SERVICE_ROLE_KEY: 'eyJ.ancien.jwt',
      });
      expect(vu.cleSecrete(), brut).toBe('eyJ.ancien.jwt');
    }
  });
});

describe('cleApi() — aucune source utilisable', () => {
  it('refuse franchement, en nommant la variable attendue', async () => {
    // Jamais `undefined` vers createClient : l'erreur d'authentification
    // arriverait trois appels plus loin, illisible.
    const vu = await lecteurs({});
    expect(() => vu.cleSecrete()).toThrow(/Configuration incomplète/);
    expect(() => vu.cleSecrete()).toThrow(/SUPABASE_SECRET_KEYS/);
  });

  it('journalise AVANT de lever, en nommant les deux sources essayées', async () => {
    // `traduire` attrape et répond neutre : sans cette trace la panne serait
    // muette, et une panne muette se répète.
    const vu = await lecteurs({});
    expect(() => vu.clePubliable()).toThrow();
    expect(vu.journal).toHaveLength(1);
    expect(vu.journal[0]).toContain('SUPABASE_PUBLISHABLE_KEYS');
    expect(vu.journal[0]).toContain('SUPABASE_ANON_KEY');
  });

  it('un trousseau sans « default » et sans ancienne variable lève, avec DEUX traces', async () => {
    const vu = await lecteurs({ SUPABASE_SECRET_KEYS: JSON.stringify({ prod: 'sb_secret_prod' }) });
    expect(() => vu.cleSecrete()).toThrow(/Configuration incomplète/);
    expect(vu.journal).toHaveLength(2);
    expect(vu.journal[0]).toContain('prod');
    expect(vu.journal[1]).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('une ancienne variable VIDE ne compte pas pour une source', async () => {
    const vu = await lecteurs({ SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(() => vu.cleSecrete()).toThrow(/Configuration incomplète/);
  });
});
