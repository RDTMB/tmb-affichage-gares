// Suppression définitive d'un compte — Edge Function « supprimer-utilisateur ».
//
// CE QUE CE TEST PROUVE, ET CE QU'IL NE PROUVE PAS. `tsconfig.include` s'arrête
// à `src` : les Edge Functions ne sont ni compilées ni testées par la chaîne
// d'intégration (constat I-21, chantier à part, pas ouvert ici). La PR de la
// veille a créé le précédent : extraire du code Deno et l'exécuter pour de vrai
// dans Vitest via `transformWithEsbuild` de Vite. Ici la logique corrigée n'est
// pas un bloc de fonctions pures mais du code EN LIGNE dans le gestionnaire de
// requête, alors le précédent est appliqué un cran plus haut : c'est le
// gestionnaire ENTIER qui est compilé et exécuté, avec un faux `createClient`
// injecté à la place de l'import.
//
// Prouvé : l'enchaînement des trois temps, l'ordre dans lequel les écritures
// partent, QUEL client porte chacune (jeton de l'agent ou clé secrète), et
// toutes les décisions de refus avec leur statut et leur message.
//
// NON prouvé : RLS, les déclencheurs, les cascades. Le faux client les IMITE,
// d'après `supabase/schema.sql` — en particulier il refuse `deleteUser` tant
// qu'une liaison `profils_roles` subsiste, exactement comme
// `trg_roles_proteger` l'a fait en production. C'est ce qui rend ce fichier un
// test de non-régression au sens propre : retirer l'étape 1 bis du code y
// reproduit le « Database error deleting user » du 05/09/2026. Mais seule la
// base réelle prouve la base réelle, d'où la recette sur le projet de test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';

const CHEMIN = 'supabase/functions/supprimer-utilisateur/index.ts';

/** Clés rendues par le faux environnement ; elles disent QUI agit. */
const CLE_SECRETE = 'sb_secret_du-test';
const CLE_PUBLIABLE = 'sb_publishable_du-test';

const JETON_AGENT = 'jeton-de-lagent';
const AGENT = '00000000-0000-4000-8000-00000000000a';
const CIBLE = '00000000-0000-4000-8000-00000000000c';

interface Profil {
  user_id: string;
  email: string;
  actif: boolean;
}

interface Liaison {
  user_id: string;
  role: string;
  source: 'manuel' | 'entra';
}

interface Base {
  profils: Profil[];
  liaisons: Liaison[];
  /** Rôles que l'agent connecté est habilité à attribuer (`peut_attribuer`). */
  attribuables: string[];
  /** Comptes Auth supprimés, dans l'ordre. */
  authSupprimes: string[];
  /** Journal des opérations, pour vérifier l'ORDRE et non seulement l'effet. */
  trace: string[];
  /** Panne à simuler sur `deleteUser`, indépendante des rôles. */
  panneDeleteUser?: string;
}

function baseNeuve(complement: Partial<Base> = {}): Base {
  return {
    profils: [
      { user_id: AGENT, email: 'agent@tmb.fr', actif: true },
      { user_id: CIBLE, email: 'cible@tmb.fr', actif: true },
    ],
    liaisons: [
      { user_id: AGENT, role: 'admin', source: 'manuel' },
      { user_id: CIBLE, role: 'supervision', source: 'manuel' },
      { user_id: CIBLE, role: 'caisse', source: 'manuel' },
    ],
    attribuables: ['supervision', 'caisse', 'admin'],
    authSupprimes: [],
    trace: [],
    ...complement,
  };
}

/**
 * `private.peut_gerer_profil` : il faut pouvoir attribuer TOUS les rôles de la
 * cible, et ce n'est jamais son propre compte. C'est ce que la politique
 * « roles: profils gestion » applique à l'étape 1.
 */
function peutGererProfil(base: Base, cible: string): boolean {
  if (cible === AGENT) return false;
  return base.liaisons
    .filter((l) => l.user_id === cible)
    .every((l) => base.attribuables.includes(l.role));
}

/**
 * Faux client Supabase, réduit à ce que la fonction appelle, et fidèle à
 * `schema.sql` sur les deux points qui décident : RLS filtre SANS lever, et
 * `deleteUser` échoue tant qu'une liaison subsiste.
 */
function clientFactice(base: Base, cleUtilisee: string, avecJeton: boolean) {
  const sousRls = cleUtilisee !== CLE_SECRETE;
  // Un client publiable SANS jeton ne serait pas `authenticated` : la fonction
  // n'en crée jamais, mais l'imiter mal masquerait une régression.
  const agitCommeAgent = sousRls && avecJeton;

  function requete(table: string) {
    // Constructeur CHAÎNABLE, comme PostgREST : `.select()` puis `.eq()` pour
    // une lecture, `.update()/.delete()` puis `.eq()` puis éventuellement
    // `.select()` pour un RETURNING. Rien ne part avant `await` ou
    // `.maybeSingle()` — c'est ce qui rend la trace fidèle à l'ordre réel.
    let filtreUserId: string | null = null;
    let operation: 'select' | 'update' | 'delete' = 'select';
    let demandeRetour = false;
    let majActif: boolean | null = null;

    const constructeur = {
      select(_colonnes?: string) {
        demandeRetour = true;
        return constructeur;
      },
      update(valeurs: { actif?: boolean }) {
        operation = 'update';
        majActif = valeurs.actif ?? null;
        return constructeur;
      },
      delete() {
        operation = 'delete';
        return constructeur;
      },
      eq(colonne: string, valeur: string) {
        if (colonne !== 'user_id') throw new Error(`colonne inattendue : ${colonne}`);
        filtreUserId = valeur;
        return constructeur;
      },
      maybeSingle() {
        const r = lit();
        return Promise.resolve({ data: r.data[0] ?? null, error: null });
      },
      then(
        resolue: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown,
        rejetee?: (e: unknown) => unknown,
      ) {
        const resultat = operation === 'select' ? lit() : ecrit();
        return Promise.resolve(resultat).then(resolue, rejetee);
      },
    };

    function lignes(): (Profil | Liaison)[] {
      if (table === 'profils') return base.profils.filter((x) => x.user_id === filtreUserId);
      if (table === 'profils_roles') return base.liaisons.filter((x) => x.user_id === filtreUserId);
      throw new Error(`table inattendue : ${table}`);
    }

    function lit(): { data: Record<string, unknown>[]; error: null } {
      base.trace.push(`${table}.select(${sousRls ? 'jeton' : 'secrete'})`);
      return { data: lignes() as unknown as Record<string, unknown>[], error: null };
    }

    function ecrit(): { data: unknown[] | null; error: { message: string } | null } {
      base.trace.push(`${table}.${operation}(${sousRls ? 'jeton' : 'secrete'})`);
      if (table === 'profils' && operation === 'update') {
        // Politique « roles: profils gestion » (peut_gerer_profil).
        const autorise = !sousRls || (agitCommeAgent && peutGererProfil(base, filtreUserId ?? ''));
        const touchees = autorise ? (lignes() as Profil[]) : [];
        for (const ligne of touchees) if (majActif !== null) ligne.actif = majActif;
        return { data: demandeRetour ? touchees : null, error: null };
      }
      if (table === 'profils_roles' && operation === 'delete') {
        // Politique « roles: liaison retrait » : `source = 'manuel'`,
        // `peut_attribuer(role)`, jamais son propre compte. Une ligne qui n'y
        // répond pas est FILTRÉE, sans erreur — c'est tout le piège.
        const candidates = lignes() as Liaison[];
        const retirables = candidates.filter(
          (l) =>
            !sousRls ||
            (agitCommeAgent &&
              l.source === 'manuel' &&
              base.attribuables.includes(l.role) &&
              l.user_id !== AGENT),
        );
        base.liaisons = base.liaisons.filter((l) => !retirables.includes(l));
        return { data: demandeRetour ? retirables : null, error: null };
      }
      throw new Error(`écriture inattendue : ${table}.${operation}`);
    }

    return constructeur;
  }

  return {
    from: requete,
    auth: {
      getUser(jwt: string) {
        return Promise.resolve({
          data: { user: jwt === JETON_AGENT ? { id: AGENT } : null },
          error: null,
        });
      },
      admin: {
        deleteUser(id: string) {
          base.trace.push('auth.deleteUser');
          if (base.panneDeleteUser) {
            return Promise.resolve({ error: { message: base.panneDeleteUser } });
          }
          // LE DÉFAUT DU 05/09, imité : la cascade réveille
          // `trg_roles_proteger`, qui refuse une écriture de rôle sans
          // `auth.uid()`, et GoTrue enveloppe le message.
          if (base.liaisons.some((l) => l.user_id === id)) {
            return Promise.resolve({ error: { message: 'Database error deleting user' } });
          }
          base.authSupprimes.push(id);
          base.profils = base.profils.filter((p) => p.user_id !== id);
          return Promise.resolve({ error: null });
        },
      },
    },
  };
}

type Gestionnaire = (req: Request) => Promise<Response>;

/**
 * Compile le fichier Deno et rend son gestionnaire de requête.
 *
 * L'unique substitution est l'import de `jsr:` — irrésolvable sous Node — que
 * l'on remplace par une injection. Tout le reste du fichier est exécuté tel
 * qu'il sera déployé, commentaires en moins.
 */
async function gestionnaire(base: Base): Promise<Gestionnaire> {
  const url = new URL(`../../${CHEMIN}`, import.meta.url);
  const brut = readFileSync(fileURLToPath(url), 'utf-8');
  const IMPORT = "import { createClient } from 'jsr:@supabase/supabase-js@2';";
  expect(brut.split(IMPORT), `import de createClient introuvable dans ${CHEMIN}`).toHaveLength(2);
  const sansImport = brut.replace(IMPORT, '// createClient est injecté par le test');
  const { code } = await transformWithEsbuild(sansImport, 'supprimer-utilisateur.ts', {
    loader: 'ts',
    target: 'es2022',
  });

  let capture: Gestionnaire | null = null;
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://projet-de-test.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: CLE_SECRETE }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: CLE_PUBLIABLE }),
  };
  const faussesGlobales = {
    env: { get: (nom: string) => env[nom] },
    serve: (h: Gestionnaire) => {
      capture = h;
    },
  };
  const creeClient = (
    _url: string,
    cle: string,
    options?: { global?: { headers?: Record<string, string> } },
  ) => clientFactice(base, cle, Boolean(options?.global?.headers?.Authorization));

  const fabrique = new Function('Deno', 'createClient', 'console', code) as (
    deno: unknown,
    creeClient: unknown,
    faussseConsole: unknown,
  ) => void;
  fabrique(faussesGlobales, creeClient, {
    error: () => {},
    warn: () => {},
    log: () => {},
  });
  if (!capture) throw new Error('Deno.serve n’a pas été appelé : gestionnaire non capturé');
  return capture;
}

function requeteSuppression(corps: unknown, jeton: string | null = JETON_AGENT): Request {
  const entetes: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
  };
  if (jeton !== null) entetes.Authorization = `Bearer ${jeton}`;
  return new Request('https://projet-de-test.supabase.co/functions/v1/supprimer-utilisateur', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify(corps),
  });
}

async function supprime(
  base: Base,
  corps: unknown = { user_id: CIBLE },
  jeton: string | null = JETON_AGENT,
): Promise<{ statut: number; texte: string }> {
  const handler = await gestionnaire(base);
  const reponse = await handler(requeteSuppression(corps, jeton));
  return { statut: reponse.status, texte: await reponse.text() };
}

describe('le chemin qui marche', () => {
  let base: Base;

  beforeEach(() => {
    base = baseNeuve();
  });

  it('supprime un compte actif portant deux rôles manuels', async () => {
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(200);
    expect(JSON.parse(texte)).toEqual({ ok: true });
    expect(base.authSupprimes).toEqual([CIBLE]);
    expect(base.liaisons.filter((l) => l.user_id === CIBLE)).toEqual([]);
  });

  it('les rôles partent AVANT l’appel Auth, et par le jeton de l’agent', async () => {
    // L'ordre est le correctif. Le vérifier par la trace, et pas seulement par
    // l'état final, c'est vérifier la CAUSE et non la coïncidence. Et le
    // retrait doit passer par le jeton : avec la clé secrète, l'écriture
    // serait « sans visage » — précisément ce que le garde-fou interdit.
    await supprime(base);
    expect(base.trace).toEqual([
      'profils.select(secrete)',
      'profils.update(jeton)',
      'profils_roles.delete(jeton)',
      'profils_roles.select(secrete)',
      'auth.deleteUser',
    ]);
  });

  it('marche sur un compte DÉJÀ désactivé — l’état des comptes en attente', async () => {
    // Les tentatives d'avant le correctif ont laissé deux comptes désactivés
    // mais non supprimés. C'est le critère d'acceptation qui compte : l'étape
    // 1 ne change rien sur eux, et elle doit tout de même rendre sa ligne.
    base.profils = base.profils.map((p) => (p.user_id === CIBLE ? { ...p, actif: false } : p));
    const { statut } = await supprime(base);
    expect(statut).toBe(200);
    expect(base.authSupprimes).toEqual([CIBLE]);
  });

  it('marche sur un compte SANS aucun rôle : zéro retiré sur zéro attendu', async () => {
    // Une ligne `profils` peut exister sans aucune liaison. Zéro n'est pas une
    // erreur, et l'agent doit tout de même pouvoir gérer le compte.
    base.liaisons = base.liaisons.filter((l) => l.user_id !== CIBLE);
    const { statut } = await supprime(base);
    expect(statut).toBe(200);
    expect(base.authSupprimes).toEqual([CIBLE]);
  });
});

describe('§4.A — un rôle que le jeton de l’agent ne peut pas retirer', () => {
  it('refuse franchement un rôle venu de l’annuaire, en le nommant', async () => {
    // La politique de retrait impose `source = 'manuel'` : une liaison `entra`
    // est FILTRÉE par RLS, sans erreur. Enchaîner sur l'étape 2 rendrait le
    // « Database error deleting user » du 05/09. Aucun rôle `entra` n'existe
    // aujourd'hui, mais ce chemin décidera de ce que voit l'agent quand le SSO
    // arrivera, et une panne muette se répète.
    const base = baseNeuve({
      liaisons: [
        { user_id: AGENT, role: 'admin', source: 'manuel' },
        { user_id: CIBLE, role: 'supervision', source: 'entra' },
      ],
    });
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(409);
    expect(texte).toContain('supervision');
    expect(texte).toContain('annuaire');
    expect(texte).toContain('désactivé');
    // Le compte n'est PAS supprimé, et il reste désactivé : état sûr et
    // réversible, jamais un compte à demi supprimé.
    expect(base.authSupprimes).toEqual([]);
    expect(base.profils.find((p) => p.user_id === CIBLE)?.actif).toBe(false);
    // L'appel Auth n'est même pas tenté.
    expect(base.trace).not.toContain('auth.deleteUser');
  });

  it('un compte mi-manuel mi-annuaire : le manuel part, l’autre est nommé', async () => {
    const base = baseNeuve({
      liaisons: [
        { user_id: AGENT, role: 'admin', source: 'manuel' },
        { user_id: CIBLE, role: 'caisse', source: 'manuel' },
        { user_id: CIBLE, role: 'supervision', source: 'entra' },
      ],
    });
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(409);
    expect(texte).toContain('supervision');
    expect(texte).not.toContain('caisse');
    expect(base.liaisons.filter((l) => l.user_id === CIBLE)).toEqual([
      { user_id: CIBLE, role: 'supervision', source: 'entra' },
    ]);
    expect(base.authSupprimes).toEqual([]);
  });
});

describe('les refus qui existaient déjà, inchangés', () => {
  it('sans jeton valable : 401', async () => {
    const base = baseNeuve();
    const { statut, texte } = await supprime(base, { user_id: CIBLE }, 'pas-le-bon-jeton');
    expect(statut).toBe(401);
    expect(texte).toBe('Non connecté');
    expect(base.trace).toEqual([]);
  });

  it('agent dont le propre compte est inactif : 403', async () => {
    const base = baseNeuve();
    base.profils = base.profils.map((p) => (p.user_id === AGENT ? { ...p, actif: false } : p));
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(403);
    expect(texte).toContain('Compte inactif');
    expect(base.trace).toEqual(['profils.select(secrete)']);
  });

  it('user_id absent : 400', async () => {
    const { statut, texte } = await supprime(baseNeuve(), {});
    expect(statut).toBe(400);
    expect(texte).toBe('user_id requis');
  });

  it('son propre compte : 400, et rien n’est écrit', async () => {
    const base = baseNeuve();
    const { statut, texte } = await supprime(base, { user_id: AGENT });
    expect(statut).toBe(400);
    expect(texte).toContain('votre propre compte');
    expect(base.trace).toEqual(['profils.select(secrete)']);
  });

  it('cible portant un rôle que l’agent n’attribue pas : 403 dès l’étape 1', async () => {
    // Règle stricte de `peut_gerer_profil` : un administrateur ne touche pas
    // au compte du prestataire informatique. L'UPDATE ne rend aucune ligne.
    const base = baseNeuve({
      liaisons: [
        { user_id: AGENT, role: 'admin', source: 'manuel' },
        { user_id: CIBLE, role: 'technique', source: 'manuel' },
      ],
      attribuables: ['supervision', 'caisse', 'admin'],
    });
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(403);
    expect(texte).toContain('un rôle que vous n’attribuez pas');
    expect(base.trace).not.toContain('profils_roles.delete(jeton)');
    expect(base.authSupprimes).toEqual([]);
  });

  it('panne d’Auth pour une autre raison : 409, et le compte reste désactivé', async () => {
    const base = baseNeuve({ panneDeleteUser: 'connexion perdue' });
    const { statut, texte } = await supprime(base);
    expect(statut).toBe(409);
    expect(texte).toContain('connexion perdue');
    expect(texte).toContain('désactivé mais pas supprimé');
    expect(base.profils.find((p) => p.user_id === CIBLE)?.actif).toBe(false);
  });

  it('préflight CORS : 200 sans jeton', async () => {
    const handler = await gestionnaire(baseNeuve());
    const reponse = await handler(
      new Request('https://projet-de-test.supabase.co/functions/v1/supprimer-utilisateur', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
    );
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});

describe('le défaut du 05/09/2026 ne peut plus revenir', () => {
  it('le faux client refuse deleteUser tant qu’une liaison subsiste', async () => {
    // Contrôle du contrôle : si cette imitation cessait de refuser, tous les
    // tests ci-dessus passeraient même sans l'étape 1 bis, et ce fichier ne
    // prouverait plus rien. On appelle donc `deleteUser` à la main, sur une
    // base dont les liaisons sont encore là.
    const base = baseNeuve();
    const admin = clientFactice(base, CLE_SECRETE, false);
    const { error } = await admin.auth.admin.deleteUser(CIBLE);
    expect(error?.message).toBe('Database error deleting user');
    expect(base.authSupprimes).toEqual([]);
  });

  it('le code appelle bien le retrait avant la suppression, dans le fichier', async () => {
    // Verrou de TEXTE, en plus de l'exécution : une réécriture qui remettrait
    // l'appel Auth en premier casserait la trace, mais ce repère-ci dit
    // pourquoi en un coup d'œil dans le diff.
    const url = new URL(`../../${CHEMIN}`, import.meta.url);
    const src = readFileSync(fileURLToPath(url), 'utf-8');
    const retrait = src.indexOf("appelant.from('profils_roles').delete()");
    const relecture = src.indexOf("admin\n      .from('profils_roles')".replace('\n', '\r\n'));
    const suppression = src.indexOf('admin.auth.admin.deleteUser(');
    expect(retrait, 'retrait des rôles par le jeton de l’agent').toBeGreaterThan(0);
    expect(suppression, 'appel deleteUser').toBeGreaterThan(0);
    expect(retrait).toBeLessThan(suppression);
    expect(relecture, 'relecture des liaisons par la clé secrète').toBeGreaterThan(retrait);
    expect(relecture).toBeLessThan(suppression);
    // Et jamais le retrait par la clé secrète : ce serait une écriture de rôle
    // sans visage, exactement ce que `trg_roles_proteger` interdit.
    expect(src).not.toContain("admin.from('profils_roles').delete()");
  });
});
