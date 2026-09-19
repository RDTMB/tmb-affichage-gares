// Le guetteur : la copie de la règle répond-elle EXACTEMENT comme l'original ?
//
// POURQUOI CE TEST EXISTE. `supabase/functions/alerte-ecrans/index.ts` porte
// une COPIE de la règle de `src/core/surveillance-ecrans.ts`. L'import direct
// est impossible — les 30 imports relatifs de `src/core/` n'ont pas
// d'extension de fichier, et Deno l'exige ; la raison complète est écrite à
// côté de la copie, dans la fonction elle-même.
//
// Une duplication ne devient acceptable qu'à une condition : être ÉPROUVÉE,
// pas promise. Et pas à l'œil — deux campagnes de mutation ont vu passer des
// tests qui ne verrouillaient que la présence d'une chaîne. Alors ce fichier
// fait ce que `cles-edge-functions.test.ts` fait pour le bloc des clés, en
// plus exigeant : il découpe le bloc de décision, le COMPILE, l'EXÉCUTE, et
// confronte ses réponses à celles du cœur sur plusieurs milliers de
// combinaisons engendrées. Un `>` mis pour un `>=`, un `<` inversé, un motif
// renommé : la confrontation le voit. Une ressemblance de texte, non.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';

import {
  SEUIL_DEFAUT_MS,
  bilanSurveillance,
  etatSurveillance,
  silenceLisible,
  type PosteSurveille,
} from '../core/surveillance-ecrans';
import type { VeilleNuit } from '../core/types';

const DEBUT = 'BLOC DE DÉCISION — copie vérifiée de src/core (début)';
const FIN = 'BLOC DE DÉCISION — copie vérifiée de src/core (fin)';

function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const FONCTION = source('supabase/functions/alerte-ecrans/index.ts');

/** Le bloc de décision, bornes comprises. Lève si les repères ont bougé. */
function blocDecision(): string {
  const debut = FONCTION.indexOf(DEBUT);
  const fin = FONCTION.indexOf(FIN);
  if (debut === -1 || fin === -1 || fin < debut) {
    throw new Error('bloc de décision introuvable ou bornes inversées');
  }
  return FONCTION.slice(FONCTION.lastIndexOf('\n', debut) + 1, FONCTION.indexOf('\n', fin) + 1);
}

interface Copie {
  SEUIL_DEFAUT_MS: number;
  etatSurveillance: typeof etatSurveillance;
  bilanSurveillance: typeof bilanSurveillance;
  silenceLisible: typeof silenceLisible;
  secondesParis(d: Date): number;
}

/**
 * Compile le bloc et rend ses fonctions. Ce n'est pas une transcription du
 * code déployé qui est éprouvée : c'est LUI, découpé dans le fichier qui part
 * chez Supabase.
 */
async function copieDeployee(): Promise<Copie> {
  const { code } = await transformWithEsbuild(blocDecision(), 'bloc-decision.ts', {
    loader: 'ts',
    target: 'es2020',
  });
  const fabrique = new Function(
    `${code}\nreturn { SEUIL_DEFAUT_MS, etatSurveillance, bilanSurveillance, silenceLisible, secondesParis };`,
  ) as () => Copie;
  return fabrique();
}

const copie = await copieDeployee();

// ---------------------------------------------------------------------------
// Le matériel des combinaisons
// ---------------------------------------------------------------------------

/** Instant de référence : 19/09/2026 10:00 heure de Paris. */
const MAINTENANT_MS = Date.parse('2026-09-19T10:00:00+02:00');

/** Silences balayés, resserrés autour du seuil — c'est là que les défauts vivent. */
const SILENCES: (number | null)[] = [
  0,
  1_000,
  59_999,
  60_000,
  5 * 60_000,
  SEUIL_DEFAUT_MS - 1,
  SEUIL_DEFAUT_MS,
  SEUIL_DEFAUT_MS + 1,
  3 * 3_600_000 + 12 * 60_000,
  30 * 24 * 3_600_000,
  -5_000, // horloge du poste en avance
  null, // jamais vu
];

const SURVEILLE: (boolean | null | undefined)[] = [undefined, true, false, null];

/** Fenêtres globales : traversante, non traversante, et vide (début = fin). */
const GLOBALES: VeilleNuit[] = [
  { debut: '21:00', fin: '06:00' },
  { debut: '06:00', fin: '21:00' },
  { debut: '00:00', fin: '00:00' },
];

/** Surcharges de poste, dont les deux demi-fenêtres qui ne doivent pas compter. */
const PROPRES: { veille_debut?: string | null; veille_fin?: string | null }[] = [
  {},
  { veille_debut: '18:00:00', veille_fin: '07:00:00' },
  { veille_debut: '18:00:00', veille_fin: null },
  { veille_debut: null, veille_fin: '07:00:00' },
];

/** Heures locales : toutes les 30 min, plus les bornes qui piègent. */
const HEURES_S = [
  ...Array.from({ length: 48 }, (_, i) => i * 1800),
  0,
  86_399,
  21 * 3600 - 1,
  21 * 3600,
  6 * 3600 - 1,
  6 * 3600,
];

function poste(
  silence: number | null,
  surveille: boolean | null | undefined,
  propre: { veille_debut?: string | null; veille_fin?: string | null },
): PosteSurveille {
  return {
    id: 'saint-gervais-ecran-1',
    gare: 'saint-gervais',
    surveille,
    derniere_vue: silence === null ? null : new Date(MAINTENANT_MS - silence).toISOString(),
    ...propre,
  };
}

describe('Le bloc de décision est bien celui qui est déployé', () => {
  it('les bornes sont dans le fichier de la fonction, et dans cet ordre', () => {
    expect(() => blocDecision()).not.toThrow();
    expect(blocDecision()).toContain('function etatSurveillance(');
    expect(blocDecision()).toContain('function bilanSurveillance(');
  });

  it('la fonction dit POURQUOI la règle est recopiée, à l’endroit de la copie', () => {
    // Sans cette raison écrite là, la copie suivante se fera sans se poser la
    // question — et celle-là ne sera peut-être pas vérifiée.
    const bloc = blocDecision();
    expect(bloc).toContain('POURQUOI UNE COPIE, ET NON UN IMPORT');
    expect(bloc).toContain('src/data/alerte-ecrans.test.ts');
  });

  it('le seuil de la copie est celui du cœur', () => {
    expect(copie.SEUIL_DEFAUT_MS).toBe(SEUIL_DEFAUT_MS);
  });
});

describe('La copie et le cœur répondent la même chose, partout', () => {
  it('etatSurveillance : sur toutes les combinaisons, au champ près', () => {
    let combinaisons = 0;
    let defauts = 0;
    let repos = 0;
    for (const globale of GLOBALES) {
      for (const silence of SILENCES) {
        for (const surveille of SURVEILLE) {
          for (const propre of PROPRES) {
            const p = poste(silence, surveille, propre);
            for (const heure_s of HEURES_S) {
              const attendu = etatSurveillance(p, globale, MAINTENANT_MS, heure_s);
              const obtenu = copie.etatSurveillance(p, globale, MAINTENANT_MS, heure_s);
              // `toEqual` et non une comparaison de `defaut` seul : le MOTIF
              // fait partie de la réponse — c'est lui que la supervision
              // affiche, et une copie qui rendrait « vivant » au lieu de
              // « en-veille » mentirait sans jamais faire rougir un test qui
              // ne regarderait que le booléen.
              expect(
                obtenu,
                `globale ${globale.debut}→${globale.fin}, silence ${silence}, surveille ${surveille}, propre ${JSON.stringify(propre)}, ${heure_s} s`,
              ).toEqual(attendu);
              combinaisons++;
              if (attendu.defaut) defauts++;
              if (attendu.motif === 'en-veille' || attendu.motif === 'hors-service') repos++;
            }
          }
        }
      }
    }
    // Un balayage qui ne rencontrerait que des « non » ne prouverait rien :
    // on vérifie que les deux issues ont bien été traversées, et en nombre.
    expect(combinaisons).toBeGreaterThan(5_000);
    expect(defauts).toBeGreaterThan(500);
    expect(repos).toBeGreaterThan(500);
  });

  it('bilanSurveillance : sur 300 flottes engendrées, y compris la panne globale', () => {
    // Tirage DÉTERMINISTE (générateur congruentiel) : un test qui change de
    // cas à chaque exécution ne se rejoue pas, et un échec ne se reproduit
    // plus. `Math.random()` était exclu pour cette seule raison.
    let graine = 20_260_919;
    const suivant = (): number =>
      (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
    const GARES = ['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza', 'bellevue', 'nid-daigle'];

    let globales = 0;
    for (let essai = 0; essai < 300; essai++) {
      const taille = 1 + Math.floor(suivant() * 6);
      const flotte: PosteSurveille[] = Array.from({ length: taille }, (_, i) => ({
        ...poste(
          SILENCES[Math.floor(suivant() * SILENCES.length)] ?? null,
          SURVEILLE[Math.floor(suivant() * SURVEILLE.length)],
          PROPRES[Math.floor(suivant() * PROPRES.length)] ?? {},
        ),
        id: `${GARES[i] ?? 'x'}-ecran-1`,
        gare: GARES[i] ?? 'le-fayet',
      }));
      const globale = GLOBALES[Math.floor(suivant() * GLOBALES.length)] ?? GLOBALES[0]!;
      const heure_s = Math.floor(suivant() * 86_400);
      const attendu = bilanSurveillance(flotte, globale, MAINTENANT_MS, heure_s);
      expect(
        copie.bilanSurveillance(flotte, globale, MAINTENANT_MS, heure_s),
        `essai ${essai}`,
      ).toEqual(attendu);
      if (attendu.globale) globales++;
    }
    // Le cas qui compte — « toute la flotte se tait » — doit avoir été tiré,
    // sinon ces 300 essais n'auraient éprouvé que le cas ordinaire.
    expect(globales).toBeGreaterThan(0);
  });

  it('silenceLisible : de la seconde à la journée, au caractère près', () => {
    for (let s = 0; s <= 100_000; s += 7) {
      expect(copie.silenceLisible(s * 1000), `${s} s`).toBe(silenceLisible(s * 1000));
    }
    expect(copie.silenceLisible(-1)).toBe(silenceLisible(-1));
  });
});

// ---------------------------------------------------------------------------
// Le fuseau : la seule pièce que le cœur n'a pas
// ---------------------------------------------------------------------------

describe('secondesParis : le guetteur tourne en UTC, la veille est locale', () => {
  /** Secondes locales calculées AUTREMENT, pour ne pas comparer une chose à elle-même. */
  function reference(iso: string): number {
    const parties = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(new Date(iso));
    const n = (type: string) => Number(parties.find((p) => p.type === type)?.value ?? 0);
    return (n('hour') % 24) * 3600 + n('minute') * 60 + n('second');
  }

  it('en heure d’hiver, Paris est à UTC+1', () => {
    expect(copie.secondesParis(new Date('2026-01-15T22:30:00Z'))).toBe(23 * 3600 + 1800);
    expect(copie.secondesParis(new Date('2026-01-15T23:30:00Z'))).toBe(1800); // 00:30 le lendemain
  });

  it('en heure d’été, Paris est à UTC+2', () => {
    expect(copie.secondesParis(new Date('2026-07-15T22:30:00Z'))).toBe(1800); // 00:30
    expect(copie.secondesParis(new Date('2026-09-19T08:00:00Z'))).toBe(10 * 3600);
  });

  it('minuit se lit « 0 », jamais « 24 » : sinon la veille commencerait un jour trop tard', () => {
    // `hourCycle: 'h23'` est ce qui l'assure. Sans lui, `fr-FR` formate minuit
    // « 24:00:00 », et 24×3600 = 86 400 ne tombe dans AUCUNE fenêtre de veille.
    expect(copie.secondesParis(new Date('2026-07-15T22:00:00Z'))).toBe(0);
    expect(copie.secondesParis(new Date('2026-01-15T23:00:00Z'))).toBe(0);
  });

  it('au passage à l’heure d’ÉTÉ (29/03/2026, 02:00 → 03:00), la marche est franchie', () => {
    // Une minute avant le saut il est 01:59 locale ; une minute après, 03:00.
    // Un décalage fixe se tromperait d'une heure pendant tout l'été.
    expect(copie.secondesParis(new Date('2026-03-29T00:59:00Z'))).toBe(1 * 3600 + 59 * 60);
    expect(copie.secondesParis(new Date('2026-03-29T01:00:00Z'))).toBe(3 * 3600);
    expect(copie.secondesParis(new Date('2026-03-29T01:30:00Z'))).toBe(3 * 3600 + 1800);
  });

  it('au passage à l’heure d’HIVER (25/10/2026, 03:00 → 02:00), l’heure doublée est prise en local', () => {
    // 00:30 UTC et 01:30 UTC donnent tous deux 02:30 locale : c'est le propre
    // de l'heure doublée, et c'est la bonne réponse — la veille de nuit ne
    // distingue pas les deux passages.
    expect(copie.secondesParis(new Date('2026-10-25T00:30:00Z'))).toBe(2 * 3600 + 1800);
    expect(copie.secondesParis(new Date('2026-10-25T01:30:00Z'))).toBe(2 * 3600 + 1800);
    expect(copie.secondesParis(new Date('2026-10-25T02:30:00Z'))).toBe(3 * 3600 + 1800);
  });

  it('sur une année entière, toutes les six heures, la conversion tient', () => {
    // Balaye les deux changements d'heure sans les viser : si la copie
    // repliait sur un décalage fixe, ce test rougirait sur la moitié de
    // l'année, pas seulement sur deux dimanches.
    const debut = Date.parse('2026-01-01T00:00:00Z');
    for (let h = 0; h < 365 * 24; h += 6) {
      const d = new Date(debut + h * 3_600_000);
      expect(copie.secondesParis(d), d.toISOString()).toBe(reference(d.toISOString()));
    }
  });
});

// ---------------------------------------------------------------------------
// Le câblage : le guetteur emploie-t-il la règle, et écrit-il ce qu'il faut ?
// ---------------------------------------------------------------------------

describe('Le guetteur, hors de son bloc de décision', () => {
  it('refuse tout appel sans le secret partagé, et refuse aussi son ABSENCE', () => {
    // La fonction est déployée sans vérification de jeton : ce secret est le
    // seul verrou. S'il manquait côté Supabase, une fonction ouverte à tout
    // l'internet paraîtrait fonctionner — d'où le refus franc.
    expect(FONCTION).toContain("const attendu = Deno.env.get('CLE_GUETTEUR');");
    expect(FONCTION).toContain("if (req.headers.get('x-cle-guetteur') !== attendu) {");
    expect(FONCTION).toMatch(/if \(!attendu\) \{[\s\S]*?status: 500/);
    // Le secret est comparé AVANT la première lecture de la base.
    expect(FONCTION.indexOf("Deno.env.get('CLE_GUETTEUR')")).toBeLessThan(
      FONCTION.indexOf('createClient('),
    );
  });

  it('l’absence de clé Brevo ne fait pas échouer le passage : elle est TRACÉE et rendue', () => {
    // Même motif que `DEEPL_API_KEY`. La pastille de la supervision doit
    // fonctionner dès le premier jour, sans attendre Brevo.
    expect(FONCTION).toMatch(
      /if \(!cle \|\| !expediteur\) \{[\s\S]*?return `\$\{manquant\} absent`/,
    );
    expect(FONCTION).toContain('console.error(`[brevo] ${manquant} absent');
    // L'échec est CONSERVÉ en base, il ne disparaît pas dans un journal.
    expect(FONCTION).toContain('dernier_echec: echecAnnonce');
  });

  it('n’annonce qu’une fois : la ligne en base est la mémoire de l’épisode', () => {
    // Trente-six courriels pendant la panne de samedi, c'est ce qu'une tâche
    // de cinq minutes produit sans cette condition.
    expect(FONCTION).toContain(
      'if (!ligne || (!ligne.envoyee_at && ligne.envois_tentes < MAX_TENTATIVES)) {',
    );
    expect(FONCTION).toContain('const MAX_TENTATIVES = 3;');
  });

  it('n’annonce le rétablissement que de ce qui a été DIT', () => {
    expect(FONCTION).toContain('const retablisDits = aRetablir.filter((l) => l.envoyee_at);');
  });

  it('un poste qui s’endort pendant sa panne garde sa ligne', () => {
    // La supprimer ferait repartir l'alerte au matin comme si c'était une
    // nouvelle panne ; annoncer un rétablissement serait faux.
    expect(FONCTION).toContain("if (etat.motif === 'vivant') aRetablir.push(ligne);");
    expect(FONCTION).toContain("else if (etat.motif === 'hors-service') aOublier.push(poste.id);");
    expect(FONCTION).toMatch(/`en-veille` et `jamais-vu` : la ligne RESTE/);
  });

  it('écrit l’heure de son passage, même quand tout va bien', () => {
    // C'est la seule chose qui distingue un guetteur qui dort d'un guetteur
    // qui n'a rien à dire. Le `pg_cron` inerte du 19/09 avait exactement cette
    // tête : colonne NEXT vide, aucun message.
    expect(FONCTION).toContain("from('surveillance_etat')");
    expect(FONCTION).toContain('derniere_execution: maintenantISO');
    // L'écriture est HORS de tout `if` de défaut : elle a lieu à chaque passage.
    const apresDecision = FONCTION.slice(FONCTION.indexOf('LA PREUVE QUE LE GUETTEUR A TOURNÉ'));
    expect(apresDecision).toContain('update({ derniere_execution: maintenantISO');
  });

  it('un seul courriel pour toute la flotte, et il le dit', () => {
    expect(FONCTION).toContain('PANNE GÉNÉRALE');
    expect(FONCTION).toContain('la cause est probablement en amont');
  });

  it('ne lit que les colonnes dont il a besoin', () => {
    // Le guetteur porte la clé secrète : il contourne RLS. Moins il lit,
    // moins une erreur d'écriture peut porter loin.
    expect(FONCTION).toContain(
      "select('id, gare, surveille, derniere_vue, veille_debut, veille_fin')",
    );
  });
});

// ---------------------------------------------------------------------------
// Le SQL : deux copies, et ce qu'elles ne doivent pas ouvrir
// ---------------------------------------------------------------------------

/** Un script SQL sans ses commentaires ni ses espaces superflus. */
function instructions(chemin: string): string {
  return source(chemin)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n');
}

const MIGRATION = instructions('supabase/migrations/2026-09-alerte-ecrans.sql');
const SCHEMA = instructions('supabase/schema.sql');

/** Le corps d'un `create table if not exists <nom> ( … );`, normalisé. */
function corpsTable(sql: string, nom: string): string {
  const debut = sql.indexOf(`create table if not exists ${nom} (`);
  expect(debut, `table ${nom} introuvable`).toBeGreaterThan(-1);
  return sql.slice(debut, sql.indexOf('\n);', debut)).trim();
}

describe('Migration et schema.sql : deux copies qui ne doivent pas diverger', () => {
  // Une base neuve plus permissive — ou plus stricte — que la production est
  // le pire des deux mondes : on ne s'en aperçoit qu'à la réinstallation.
  for (const table of ['alertes_ecran', 'surveillance_etat']) {
    it(`${table} est définie à l’identique des deux côtés`, () => {
      expect(corpsTable(SCHEMA, table)).toBe(corpsTable(MIGRATION, table));
    });

    it(`${table} : aucune écriture par l’API, dans les deux fichiers`, () => {
      // Le guetteur écrit avec la clé secrète, qui contourne RLS : il n'a
      // besoin d'AUCUNE politique. Une alerte qu'un compte connecté pourrait
      // effacer ne vaudrait rien — et c'est une table d'alertes.
      for (const [nom, sql] of [
        ['migration', MIGRATION],
        ['schema', SCHEMA],
      ] as const) {
        expect(sql, nom).toContain(`revoke all on ${table} from anon, authenticated;`);
        expect(sql, nom).toContain(`grant select on ${table} to authenticated;`);
        // Une seule politique, et elle est en LECTURE.
        const politiques = [
          ...sql.matchAll(new RegExp(`create policy "[^"]+" on ${table} for (\\w+)`, 'g')),
        ];
        expect(
          politiques.map((m) => m[1]),
          `${nom} · ${table}`,
        ).toEqual(['select']);
      }
    });
  }

  it('le déclencheur du journal garde TOUTES ses colonnes en gagnant `surveille`', () => {
    // PostgreSQL ne sait pas ajouter une colonne à la liste d'un `update of` :
    // le déclencheur est remplacé en entier. En recopiant la liste, il est
    // facile d'en perdre une — `recharger_demande_at` a failli disparaître du
    // journal en écrivant cette migration, et rien ne l'aurait dit.
    const colonnes = (sql: string): string[] => {
      const i = sql.indexOf('create trigger trg_journal_ecrans');
      return [
        ...(sql.slice(i, sql.indexOf(';', i)).match(/'(\w+)'/g) ?? []).map((c) => c.slice(1, -1)),
      ].sort();
    };
    const attendues = [
      'gare',
      'id',
      'recharger_demande_at',
      'surveille',
      'type',
      'veille_debut',
      'veille_fin',
      'vitesse_ticker_px_s',
    ];
    expect(colonnes(SCHEMA)).toEqual(attendues);
    expect(colonnes(MIGRATION)).toEqual(attendues);
  });

  it('la fonction de déclenchement est verrouillée comme les autres', () => {
    for (const [nom, sql] of [
      ['migration', MIGRATION],
      ['schema', SCHEMA],
    ] as const) {
      expect(sql, nom).toContain(
        'create or replace function private.declenche_surveillance_ecrans()',
      );
      // `security definer` sans `search_path` vide est la faille que les
      // Security Advisors relèvent : tout est donc qualifié en dur.
      expect(sql, nom).toMatch(
        /function private\.declenche_surveillance_ecrans\(\)\s*returns bigint language plpgsql security definer set search_path = ''/,
      );
      expect(sql, nom).toContain('net.http_post(');
      expect(sql, nom).toContain('vault.decrypted_secrets');
      expect(sql, nom).toContain(
        'revoke all on function private.declenche_surveillance_ecrans() from public;',
      );
    }
  });

  it('un secret absent LÈVE, il ne rend pas la main en silence', () => {
    // Un `return` silencieux donnerait une tâche verte qui ne fait rien —
    // l'exacte panne muette que ce chantier répare. La levée fait apparaître
    // la tâche en échec dans `cron.job_run_details`, avec son message.
    expect(MIGRATION).toMatch(/if v_url is null or v_cle is null then\s*raise exception/);
  });

  it('rejouer la migration ne crée pas une seconde tâche', () => {
    // Deux tâches du même nom enverraient tout en double, ce qui est la
    // meilleure façon de faire cesser de lire une alerte.
    expect(MIGRATION.indexOf("cron.unschedule('surveillance-ecrans')")).toBeGreaterThan(-1);
    expect(MIGRATION.indexOf("cron.unschedule('surveillance-ecrans')")).toBeLessThan(
      MIGRATION.indexOf("cron.schedule(\n 'surveillance-ecrans'"),
    );
  });

  it('aucune adresse ni aucun secret n’est écrit dans le dépôt', () => {
    // « une seule personne sait faire tourner le système » est le risque de
    // fond du projet : l'adresse est un RÉGLAGE, elle vit dans `params`. Et
    // le dépôt est public.
    for (const [nom, sql] of [
      ['migration', MIGRATION],
      ['schema', SCHEMA],
    ] as const) {
      expect(sql, nom).toContain(
        "insert into params (cle, valeur) values ('alertes_destinataires', '[]'::jsonb)",
      );
      expect(sql, nom).not.toMatch(/@tramwaydumontblanc\.fr/);
      expect(sql, nom).not.toMatch(/sb_secret_/);
    }
    // Le fichier ENTIER, commentaires compris : un exemple d'adresse est
    // permis, une vraie ne l'est pas.
    expect(source('supabase/migrations/2026-09-alerte-ecrans.sql')).not.toMatch(
      /[a-z]+\.[a-z]+@tramwaydumontblanc\.fr/,
    );
  });

  it('la MESURE préalable vient avant tout, et ne modifie rien', () => {
    // `pg_cron` et `pg_net` ne sont utilisés nulle part ailleurs dans ce
    // projet : leur disponibilité se mesure, elle ne se suppose pas.
    const brut = source('supabase/migrations/2026-09-alerte-ecrans.sql');
    const mesure = brut.slice(0, brut.indexOf('-- 1. `ecrans.surveille`'));
    expect(mesure).toContain('pg_available_extensions');
    expect(mesure).toContain("'pg_cron', 'pg_net', 'supabase_vault'");
    // Rien d'exécutable dans cette section n'écrit : que des `select`.
    const executables = mesure
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('--'));
    for (const ligne of executables) {
      expect(ligne, ligne).not.toMatch(/^\s*(insert|update|delete|alter|create|drop)\b/i);
    }
  });
});
