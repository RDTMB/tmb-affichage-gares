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
import { enVeille } from '../core/horaires';
import {
  CADENCE_GUETTEUR_MS,
  MARQUE_ECHEC_GUETTEUR,
  SEUIL_GUETTEUR_MUET_MS,
  bandeauGuetteur,
  pastilleSurveillance,
} from '../pages/supervision-logique';
import { PARAMS_DEFAUT } from '../core/params';
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
    // Et plus de réessai : c'est le réessai d'un envoi « échoué » qui faisait
    // boucler le courriel quand son issue ne pouvait pas s'écrire. Le
    // comportement est éprouvé plus bas (« L'épisode est écrit AVANT le
    // courriel ») ; ceci garde la condition lisible là où on la cherche.
    expect(FONCTION).toContain('if (!connues.has(defaut.id)) aAnnoncer.push(defaut);');
    expect(FONCTION).not.toContain('MAX_TENTATIVES');
  });

  it('n’annonce le rétablissement que de ce qui a été DIT', () => {
    // … et seulement une fois l'épisode REFERMÉ en base.
    expect(FONCTION).toContain(
      'const retablisDits = clotureFaite ? aRetablir.filter((l) => l.envoyee_at) : [];',
    );
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

// ---------------------------------------------------------------------------
// LE BANC : le guetteur ENTIER, exécuté
//
// Le premier tour de mutation n'avait tué que ce qu'il visait, parce que tout
// le reste de la fonction n'était éprouvé que par des repères de texte. Un
// second tour a montré ce que cela coûtait : « un envoi ÉCHOUÉ est marqué
// réussi », « l'alerte se répète », « une réponse Brevo en erreur passe pour
// un succès » survivaient toutes.
//
// Alors on exécute la fonction. Son unique import (`jsr:@supabase/…`) est
// retiré, et `Deno`, `createClient`, `fetch` et `console` sont fournis à la
// main : ce qui tourne ici est le fichier qui part chez Supabase, à la ligne
// d'import près.
// ---------------------------------------------------------------------------

interface LigneAlerteBanc {
  ecran_id: string;
  depuis: string;
  detectee_at: string;
  envois_tentes: number;
  envoyee_at: string | null;
  dernier_echec: string | null;
}

interface Ecriture {
  op: 'upsert' | 'delete' | 'update';
  table: string;
  lignes?: unknown;
  ids?: unknown;
  valeurs?: Record<string, unknown>;
  /** Colonne et valeur du filtre (`eq`, `in`) : QUELLES lignes sont visées. */
  filtre?: [string, unknown];
  /** Options passées à l'écriture (`onConflict` d'un upsert). */
  options?: unknown;
  /** L'écriture a été TENTÉE, et le client d'essai l'a fait échouer. */
  echouee?: boolean;
}

/**
 * Chaque opération que le guetteur adresse à la base, nommée pour qu'on puisse
 * la faire échouer SEULE. `erreur` : le client rend `{ data: null, error }`,
 * comme PostgREST pour une clé révoquée ou une table absente ; `leve` : la
 * promesse est REJETÉE, comme une coupure réseau sous `fetch`.
 */
type OperationBase =
  | 'select:ecrans'
  | 'select:params'
  | 'select:alertes_ecran'
  | 'upsert:alertes_ecran'
  | 'update:alertes_ecran'
  | 'delete:alertes_ecran'
  | 'update:surveillance_etat';
type ModeEchec = 'erreur' | 'leve';

interface Courriel {
  sujet: string;
  corps: string;
  destinataires: string[];
  cle: string | undefined;
}

interface Passage {
  statut: number;
  corps: Record<string, unknown> | string;
  ecritures: Ecriture[];
  courriels: Courriel[];
  journal: string[];
  /** Tables réellement LUES : sert à prouver qu'un refus ne lit rien. */
  lues: string[];
  /**
   * L'ORDRE des écritures et des envois, tels qu'ils ont eu lieu : `courriel`,
   * ou `<op>:<table>`, suffixé de ` ✗` quand le client d'essai l'a refusée.
   */
  sequence: string[];
  /**
   * `alertes_ecran` telle que la base la tiendrait APRÈS le passage : les
   * écritures acceptées y sont appliquées, les refusées non. C'est ce qu'on
   * rend au passage suivant pour enchaîner deux passages comme en service.
   */
  alertesApres: LigneAlerteBanc[];
}

type Poignee = (req: Request) => Promise<Response>;

/** Compile la fonction une seule fois ; chaque passage réinstalle son décor. */
async function chargeGuetteur(): Promise<(decor: Decor) => Promise<Passage>> {
  const sansImport = FONCTION.replace(/^import \{[^}]*\} from 'jsr:[^']*';\n/m, '');
  const { code } = await transformWithEsbuild(sansImport, 'guetteur.ts', {
    loader: 'ts',
    target: 'es2022',
  });
  return async (decor: Decor) => {
    const ecritures: Ecriture[] = [];
    const courriels: Courriel[] = [];
    const journal: string[] = [];
    const lues: string[] = [];
    const sequence: string[] = [];
    let alertesApres: LigneAlerteBanc[] = decor.alertes.map((l) => ({ ...l }));
    const trace = (op: string, refusee: boolean) => sequence.push(refusee ? `${op} ✗` : op);

    const contenu = (table: string): unknown[] =>
      table === 'ecrans'
        ? decor.ecrans
        : table === 'params'
          ? decor.params
          : table === 'alertes_ecran'
            ? decor.alertes
            : [];

    // UN CLIENT QUI PEUT ÉCHOUER. La première version de ce banc rendait
    // toujours `error: null` : elle ne pouvait pas éprouver un code qui doit
    // savoir échouer, et c'est ainsi que R-02 (relecture de septembre 2026) a
    // passé — lectures en échec lues comme « zéro écran, aucun défaut ».
    // Chaque opération échoue désormais SEULE, sur demande du décor.
    const repond = (operation: OperationBase, data: unknown) => ({
      then: (
        r: (v: { data: unknown; error: unknown }) => unknown,
        rejette?: (e: unknown) => unknown,
      ) => {
        const mode = decor.echecs?.[operation];
        if (mode === 'leve') return rejette?.(new TypeError('fetch failed'));
        if (mode === 'erreur') {
          return r({
            data: null,
            error: {
              message: decor.messageErreur ?? `permission denied for ${operation}`,
              code: '42501',
            },
          });
        }
        return r({ data, error: null });
      },
    });
    const echoue = (operation: OperationBase): boolean => decor.echecs?.[operation] !== undefined;
    // UN CLIENT QUI LIT CE QU'ON LUI DEMANDE. Un second tour de mutation
    // (lot du guetteur honnête) a vu survivre `select('ecran_id')`,
    // `.in('id', …)`, `.eq('id', false)` et un upsert sans `onConflict` : le
    // client d'essai ignorait ses arguments. Il projette désormais les
    // colonnes demandées, filtre sur `in`, et note les filtres et options des
    // écritures pour que les tests les regardent.
    const projette = (lignes: unknown[], colonnes: string): unknown[] => {
      if (colonnes.trim() === '*') return lignes;
      const noms = colonnes.split(',').map((c) => c.trim());
      return lignes.map((l) =>
        Object.fromEntries(noms.map((n) => [n, (l as Record<string, unknown>)[n]])),
      );
    };
    const createClient = () => ({
      from(table: string) {
        const lecture = `select:${table}` as OperationBase;
        return {
          select: (colonnes = '*') => {
            lues.push(table);
            const lignes = projette(contenu(table), colonnes);
            return {
              ...repond(lecture, lignes),
              in: (col: string, valeurs: unknown[]) =>
                repond(
                  lecture,
                  lignes.filter((l) => valeurs.includes((l as Record<string, unknown>)[col])),
                ),
            };
          },
          upsert: (lignes: unknown, options?: unknown) => {
            const op = `upsert:${table}` as OperationBase;
            ecritures.push({ op: 'upsert', table, lignes, options, echouee: echoue(op) });
            trace(op, echoue(op));
            if (table === 'alertes_ecran' && !echoue(op)) {
              for (const l of lignes as LigneAlerteBanc[]) {
                alertesApres = [...alertesApres.filter((a) => a.ecran_id !== l.ecran_id), { ...l }];
              }
            }
            return repond(op, lignes);
          },
          delete: () => ({
            in: (col: string, ids: unknown) => {
              const op = `delete:${table}` as OperationBase;
              ecritures.push({ op: 'delete', table, ids, filtre: [col, ids], echouee: echoue(op) });
              trace(op, echoue(op));
              if (table === 'alertes_ecran' && !echoue(op)) {
                const vises = ids as unknown[];
                alertesApres = alertesApres.filter(
                  (a) => !vises.includes((a as unknown as Record<string, unknown>)[col]),
                );
              }
              return repond(op, []);
            },
          }),
          update: (valeurs: Record<string, unknown>) => {
            const op = `update:${table}` as OperationBase;
            const ecrire = (col: string, val: unknown, vise: (v: unknown) => boolean) => {
              ecritures.push({
                op: 'update',
                table,
                valeurs,
                filtre: [col, val],
                echouee: echoue(op),
              });
              trace(op, echoue(op));
              if (table === 'alertes_ecran' && !echoue(op)) {
                alertesApres = alertesApres.map((a) =>
                  vise((a as unknown as Record<string, unknown>)[col])
                    ? ({ ...a, ...valeurs } as LigneAlerteBanc)
                    : a,
                );
              }
              return repond(op, []);
            };
            return {
              eq: (col: string, val: unknown) => ecrire(col, val, (v) => v === val),
              in: (col: string, ids: unknown[]) => ecrire(col, ids, (v) => ids.includes(v)),
            };
          },
        };
      },
    });

    let poignee: Poignee | null = null;
    const Deno = {
      env: { get: (n: string) => decor.env[n] },
      serve: (h: Poignee) => {
        poignee = h;
      },
    };
    const faussefetch = async (
      _url: string,
      init: { headers: Record<string, string>; body: string },
    ) => {
      const envoi = JSON.parse(init.body) as {
        subject: string;
        textContent: string;
        to: { email: string }[];
      };
      sequence.push('courriel');
      courriels.push({
        sujet: envoi.subject,
        corps: envoi.textContent,
        destinataires: envoi.to.map((t) => t.email),
        cle: init.headers['api-key'],
      });
      if (decor.brevoLeve) throw new Error('réseau coupé');
      return { ok: (decor.brevoStatut ?? 201) < 300, status: decor.brevoStatut ?? 201 };
    };
    const fausseConsole = {
      error: (...a: unknown[]) => void journal.push(a.map(String).join(' ')),
      log: () => {},
      warn: () => {},
    };

    new Function('Deno', 'createClient', 'fetch', 'console', code)(
      Deno,
      createClient,
      faussefetch,
      fausseConsole,
    );
    if (!poignee) throw new Error('la fonction n’a pas appelé Deno.serve');

    const reponse = await (poignee as Poignee)(
      new Request('https://exemple.test/alerte-ecrans', {
        method: 'POST',
        headers: decor.entetes ?? { 'x-cle-guetteur': decor.env.CLE_GUETTEUR ?? '' },
      }),
    );
    const texte = await reponse.text();
    let corps: Record<string, unknown> | string = texte;
    try {
      corps = JSON.parse(texte) as Record<string, unknown>;
    } catch {
      /* réponse en texte brut : c'est le cas des refus */
    }
    return {
      statut: reponse.status,
      corps,
      ecritures,
      courriels,
      journal,
      lues,
      sequence,
      alertesApres,
    };
  };
}

interface Decor {
  ecrans: Record<string, unknown>[];
  params: { cle: string; valeur: unknown }[];
  alertes: LigneAlerteBanc[];
  env: Record<string, string | undefined>;
  entetes?: Record<string, string>;
  brevoStatut?: number;
  brevoLeve?: boolean;
  /** Opérations de base à faire échouer, chacune indépendamment. */
  echecs?: Partial<Record<OperationBase, ModeEchec>>;
  /** Message porté par l'erreur simulée, quand le motif par défaut ne suffit pas. */
  messageErreur?: string;
}

const passe = await chargeGuetteur();

const ENV_COMPLET = {
  CLE_GUETTEUR: 'secret-du-guetteur',
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_abc' }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_xyz' }),
  BREVO_API_KEY: 'brevo-abc',
  BREVO_EXPEDITEUR: 'supervision@exemple.test',
};

/** Secondes locales à Paris MAINTENANT : le guetteur lit l'heure réelle. */
function secondesParisMaintenant(): number {
  const [h = 0, m = 0, s = 0] = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  return h * 3600 + m * 60 + s;
}

/** « HH:MM » à `decalage_s` de l'heure courante — pour cadrer une veille. */
function heureDecalee(decalage_s: number): string {
  const s = (((secondesParisMaintenant() + decalage_s) % 86_400) + 86_400) % 86_400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function posteBanc(id: string, silence_ms: number | null, reste: Record<string, unknown> = {}) {
  return {
    id,
    gare: id.split('-ecran-')[0],
    derniere_vue: silence_ms === null ? null : new Date(Date.now() - silence_ms).toISOString(),
    ...reste,
  };
}

const VEILLE_JAMAIS = { cle: 'veille_nuit', valeur: { debut: '00:00', fin: '00:00' } };
const DESTINATAIRE = { cle: 'alertes_destinataires', valeur: ['alerte@exemple.test'] };
const MUET = 20 * 60_000;

/** La ligne de `alertes_ecran` telle que la base la tient APRÈS le passage. */
function ligneApres(p: Passage, id = 'saint-gervais-ecran-1'): LigneAlerteBanc | undefined {
  return p.alertesApres.find((l) => l.ecran_id === id);
}

/** Les lignes écrites dans `alertes_ecran` par le passage. */
function upsertAlertes(p: Passage): LigneAlerteBanc[] {
  return p.ecritures
    .filter((e) => e.op === 'upsert' && e.table === 'alertes_ecran')
    .flatMap((e) => e.lignes as LigneAlerteBanc[]);
}

describe('Le guetteur, exécuté — le refus avant tout', () => {
  it('sans CLE_GUETTEUR, il refuse et ne lit RIEN', async () => {
    // Déployée sans vérification de jeton, cette fonction serait ouverte à
    // tout l'internet si son secret manquait côté Supabase.
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: { ...ENV_COMPLET, CLE_GUETTEUR: undefined },
      entetes: {},
    });
    expect(p.statut).toBe(500);
    expect(p.lues).toEqual([]);
    expect(p.courriels).toEqual([]);
    expect(p.journal.join(' ')).toContain('CLE_GUETTEUR absent');
  });

  it('avec un mauvais secret, il refuse et ne lit RIEN', async () => {
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      entetes: { 'x-cle-guetteur': 'pas-le-bon' },
    });
    expect(p.statut).toBe(401);
    expect(p.lues).toEqual([]);
    expect(p.ecritures).toEqual([]);
  });
});

describe('Le guetteur, exécuté — un épisode de panne', () => {
  it('première annonce : UN courriel, et la ligne porte l’heure de l’envoi', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET), posteBanc('le-fayet-ecran-1', 30_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(p.statut).toBe(200);
    expect(p.corps).toMatchObject({ surveilles: 2, en_defaut: 1, annonces: 1, globale: false });
    expect(p.courriels).toHaveLength(1);
    expect(p.courriels[0]?.sujet).toBe('[TMB] Écran muet — Saint-Gervais');
    expect(p.courriels[0]?.destinataires).toEqual(['alerte@exemple.test']);
    expect(p.courriels[0]?.cle).toBe('brevo-abc');
    expect(p.courriels[0]?.corps).toContain('saint-gervais-ecran-1');
    expect(p.courriels[0]?.corps).toContain('muet depuis 20 min');
    const ligne = ligneApres(p);
    expect(upsertAlertes(p).map((l) => l.ecran_id)).toEqual(['saint-gervais-ecran-1']);
    // Sans `onConflict`, l'upsert heurterait la clé primaire au réessai : une
    // ligne par poste, c'est l'épisode.
    expect(p.ecritures.find((e) => e.op === 'upsert')?.options).toEqual({
      onConflict: 'ecran_id',
    });
    expect(ligne?.envois_tentes).toBe(1);
    // L'heure de DÉTECTION est celle du passage, pas la dernière vue du
    // poste : c'est elle qui dit depuis quand la panne est CONNUE.
    expect(Date.now() - Date.parse(ligne?.detectee_at ?? '')).toBeLessThan(5_000);
    expect(ligne?.detectee_at).not.toBe(ligne?.depuis);
    expect(ligne?.envoyee_at).toBeTruthy();
    expect(ligne?.dernier_echec).toBeNull();
    // La dernière vue du poste EST la clé de l'épisode : sans elle, deux
    // pannes successives se confondraient.
    expect(ligne?.depuis).toBe((p.ecritures[0]?.lignes as LigneAlerteBanc[])[0]?.depuis);
    expect(Date.parse(ligne?.depuis ?? '')).toBeLessThan(Date.now() - MUET + 5_000);
  });

  it('les passages SUIVANTS ne renvoient rien : trente-six courriels, c’est ce qu’on répare', async () => {
    const dejaDite: LigneAlerteBanc = {
      ecran_id: 'saint-gervais-ecran-1',
      depuis: new Date(Date.now() - MUET).toISOString(),
      detectee_at: new Date(Date.now() - 300_000).toISOString(),
      envois_tentes: 1,
      envoyee_at: new Date(Date.now() - 300_000).toISOString(),
      dernier_echec: null,
    };
    for (const essai of [1, 2, 3]) {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET + essai * 300_000)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [dejaDite],
        env: ENV_COMPLET,
      });
      expect(p.courriels, `passage ${essai}`).toEqual([]);
      expect(upsertAlertes(p), `passage ${essai}`).toEqual([]);
    }
  });

  it('un envoi échoué n’est PAS réessayé : l’épisode garde son échec, et la carte le dit', async () => {
    // Décision du lot « épisode avant courriel » : un épisode a UN envoi. Le
    // réessai (trois au plus) est ce qui faisait boucler le courriel quand
    // l'issue ne s'écrivait pas. Y compris pour les lignes laissées par la
    // version précédente, qui n'avaient épuisé qu'une ou deux tentatives.
    for (const tentes of [1, 2, 3]) {
      const ligne: LigneAlerteBanc = {
        ecran_id: 'saint-gervais-ecran-1',
        depuis: new Date(Date.now() - MUET).toISOString(),
        detectee_at: new Date(Date.now() - 600_000).toISOString(),
        envois_tentes: tentes,
        envoyee_at: null,
        dernier_echec: 'Brevo 500',
      };
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [ligne],
        env: ENV_COMPLET,
      });
      expect(p.courriels, `après ${tentes} tentative(s)`).toEqual([]);
      expect(
        p.ecritures.filter((e) => e.table === 'alertes_ecran'),
        `${tentes}`,
      ).toEqual([]);
      // La ligne est intacte : l'échec reste lisible en supervision.
      expect(ligneApres(p)).toEqual(ligne);
    }
  });

  it('le rétablissement est annoncé, et l’épisode se referme', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'saint-gervais-ecran-1',
          depuis: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          detectee_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          envois_tentes: 1,
          envoyee_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          dernier_echec: null,
        },
      ],
      env: ENV_COMPLET,
    });
    expect(p.courriels).toHaveLength(1);
    expect(p.courriels[0]?.sujet).toContain('rétabli');
    expect(p.ecritures.filter((e) => e.op === 'delete')[0]?.ids).toEqual(['saint-gervais-ecran-1']);
    // Sur la bonne colonne : `.in('id', …)` ne viserait aucune ligne, et
    // l'épisode ne se refermerait jamais.
    expect(p.ecritures.filter((e) => e.op === 'delete')[0]?.filtre?.[0]).toBe('ecran_id');
  });

  it('un rétablissement que Brevo refuse est RENDU dans la réponse', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'saint-gervais-ecran-1',
          depuis: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          detectee_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          envois_tentes: 1,
          envoyee_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          dernier_echec: null,
        },
      ],
      env: ENV_COMPLET,
      brevoStatut: 403,
    });
    expect(p.corps).toMatchObject({ echec_envoi: 'Brevo 403' });
  });

  it('une panne que PERSONNE n’a connue n’a pas de rétablissement à annoncer', async () => {
    // Clé Brevo absente au moment de la panne : l'épisode se referme en
    // silence. Annoncer « c'est réparé » d'une panne jamais dite ferait
    // chercher un message qu'on n'a pas reçu.
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'saint-gervais-ecran-1',
          depuis: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          detectee_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          envois_tentes: 3,
          envoyee_at: null,
          dernier_echec: 'BREVO_API_KEY absent',
        },
      ],
      env: ENV_COMPLET,
    });
    expect(p.courriels).toEqual([]);
    expect(p.ecritures.filter((e) => e.op === 'delete')[0]?.ids).toEqual(['saint-gervais-ecran-1']);
  });

  it('un poste DÉCOCHÉ pendant sa panne voit son épisode retiré, sans un mot', async () => {
    const p = await passe({
      ecrans: [posteBanc('nid-daigle-ecran-1', 5 * 86_400_000, { surveille: false })],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'nid-daigle-ecran-1',
          depuis: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          detectee_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          envois_tentes: 1,
          envoyee_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          dernier_echec: null,
        },
      ],
      env: ENV_COMPLET,
    });
    expect(p.courriels).toEqual([]);
    expect(p.ecritures.filter((e) => e.op === 'delete')[0]?.ids).toEqual(['nid-daigle-ecran-1']);
  });

  it('un poste qui s’endort pendant sa panne GARDE sa ligne', async () => {
    // Une heure de veille calée sur l'instant du test : déterministe, quelle
    // que soit l'heure à laquelle la suite tourne.
    const ligne: LigneAlerteBanc = {
      ecran_id: 'saint-gervais-ecran-1',
      depuis: new Date(Date.now() - MUET).toISOString(),
      detectee_at: new Date(Date.now() - 600_000).toISOString(),
      envois_tentes: 1,
      envoyee_at: new Date(Date.now() - 600_000).toISOString(),
      dernier_echec: null,
    };
    const p = await passe({
      ecrans: [
        posteBanc('saint-gervais-ecran-1', MUET, {
          veille_debut: `${heureDecalee(-3600)}:00`,
          veille_fin: `${heureDecalee(3600)}:00`,
        }),
      ],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [ligne],
      env: ENV_COMPLET,
    });
    expect(p.courriels).toEqual([]);
    expect(p.ecritures.filter((e) => e.op === 'delete')).toEqual([]);
    expect(upsertAlertes(p)).toEqual([]);
  });
});

describe('Le guetteur, exécuté — la panne générale', () => {
  it('trois postes muets : UN courriel, et il nomme la cause probable', async () => {
    const p = await passe({
      ecrans: [
        posteBanc('le-fayet-ecran-1', MUET),
        posteBanc('saint-gervais-ecran-1', MUET + 60_000),
        posteBanc('motivon-ecran-1', MUET + 120_000),
      ],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(p.courriels).toHaveLength(1);
    expect(p.courriels[0]?.sujet).toBe('[TMB] PANNE GÉNÉRALE — 3 écrans muets');
    expect(p.courriels[0]?.corps).toContain('la cause est probablement en amont');
    // Le plus ancien silence d'abord : c'est par là qu'on commence à chercher.
    const lignes = p.courriels[0]?.corps.split('\n').filter((l) => l.startsWith('•')) ?? [];
    expect(lignes[0]).toContain('motivon');
    expect(upsertAlertes(p)).toHaveLength(3);
    expect(p.corps).toMatchObject({ globale: true });
  });

  it('un seul poste muet sur deux : le sujet NOMME la gare, sans parler d’amont', async () => {
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET), posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(p.courriels[0]?.sujet).toBe('[TMB] Écran muet — Le Fayet');
    expect(p.courriels[0]?.corps).not.toContain('en amont');
  });
});

describe('Le guetteur, exécuté — quand l’envoi ne marche pas', () => {
  it('sans BREVO_API_KEY : succès, trace, et l’échec CONSERVÉ en base', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: { ...ENV_COMPLET, BREVO_API_KEY: undefined },
    });
    expect(p.statut).toBe(200);
    expect(p.courriels).toEqual([]);
    expect(p.journal.join(' ')).toContain('BREVO_API_KEY absent');
    const ligne = ligneApres(p);
    expect(ligne?.envoyee_at).toBeNull();
    expect(ligne?.dernier_echec).toBe('BREVO_API_KEY absent');
    // La pastille de la supervision, elle, fonctionne : la ligne est écrite.
    expect(ligne?.ecran_id).toBe('saint-gervais-ecran-1');
  });

  it('sans BREVO_EXPEDITEUR : le manquant est NOMMÉ, et ce n’est pas le même', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: { ...ENV_COMPLET, BREVO_EXPEDITEUR: undefined },
    });
    expect(ligneApres(p)?.dernier_echec).toBe('BREVO_EXPEDITEUR absent');
  });

  it('Brevo REFUSE : ce n’est pas un succès', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      brevoStatut: 403,
    });
    expect(ligneApres(p)?.envoyee_at).toBeNull();
    expect(ligneApres(p)?.dernier_echec).toBe('Brevo 403');
  });

  it('réseau coupé : la fonction répond quand même, sans détailler l’erreur', async () => {
    // Le détail pourrait porter l'en-tête `api-key`.
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      brevoLeve: true,
    });
    expect(p.statut).toBe(200);
    expect(ligneApres(p)?.dernier_echec).toBe('réseau');
    expect(p.journal.join(' ')).not.toContain('brevo-abc');
  });

  it('aucun destinataire, ou une adresse qui n’en est pas une : dit, et conservé', async () => {
    for (const valeur of [[], ['pas-une-adresse'], 'pas-un-tableau', undefined]) {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [
          VEILLE_JAMAIS,
          ...(valeur === undefined ? [] : [{ cle: 'alertes_destinataires', valeur }]),
        ],
        alertes: [],
        env: ENV_COMPLET,
      });
      expect(p.courriels, JSON.stringify(valeur)).toEqual([]);
      expect(ligneApres(p)?.dernier_echec, JSON.stringify(valeur)).toBe('aucun destinataire');
    }
  });
});

describe('Le guetteur, exécuté — la preuve qu’il est passé', () => {
  it('il horodate son passage même quand tout va bien', async () => {
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    const maj = p.ecritures.find((e) => e.table === 'surveillance_etat');
    expect(maj?.valeurs?.derniere_execution).toBeTruthy();
    expect(maj?.valeurs?.dernier_resultat).toBe('1 surveillés, aucun défaut');
    // LA ligne unique de la table (`check (id)`) : un filtre faux mettrait à
    // jour zéro ligne, sans erreur, et l'horodatage vieillirait en silence.
    expect(maj?.filtre).toEqual(['id', true]);
  });

  it('et même quand il n’y a AUCUN écran déclaré', async () => {
    const p = await passe({
      ecrans: [],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(
      p.ecritures.find((e) => e.table === 'surveillance_etat')?.valeurs?.derniere_execution,
    ).toBeTruthy();
  });

  it('le résultat porte l’échec d’envoi : l’oubli du réglage se VOIT', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(
      p.ecritures.find((e) => e.table === 'surveillance_etat')?.valeurs?.dernier_resultat,
    ).toBe('1/1 en défaut (envoi : aucun destinataire)');
  });
});

describe('Le guetteur, exécuté — le fuseau et le repli de veille', () => {
  it('un réglage de veille ILLISIBLE replie sur la fenêtre de l’application, pas sur « jamais »', async () => {
    // L'attendu se CALCULE avec la règle du cœur à l'heure réelle du test :
    // le résultat est donc déterministe sans figer d'horloge. Un repli à
    // « jamais de veille » ferait alerter toute la nuit dès qu'une ligne de
    // `params` manque.
    const enVeilleMaintenant = enVeille('21:00', '06:00', secondesParisMaintenant());
    for (const valeur of ['n’importe quoi', null, { debut: 12 }]) {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [{ cle: 'veille_nuit', valeur }, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
      });
      expect(p.corps, JSON.stringify(valeur)).toMatchObject({
        en_defaut: enVeilleMaintenant ? 0 : 1,
      });
    }
  });

  it('le repli est EXACTEMENT la fenêtre par défaut de l’application', () => {
    // Le contrôle de comportement ci-dessus ne distingue le bon repli du
    // mauvais qu'entre 21 h et 6 h : le reste de la journée, « 21:00 → 06:00 »
    // et « jamais de veille » donnent la même réponse. Une campagne de
    // mutation l'a montré le 19/09/2026, en plein après-midi.
    // Alors on compare le littéral de la fonction à la constante du cœur.
    // C'est une lecture de texte, mais elle porte sur une VALEUR, et elle
    // attrape la vraie dérive : un repli qui cesserait d'être celui que
    // l'application applique partout ailleurs.
    const bloc = blocDecision();
    const veille = PARAMS_DEFAUT.veille_nuit;
    expect(FONCTION).toContain(`{ debut: '${veille.debut}', fin: '${veille.fin}' }`);
    expect(bloc).not.toContain("{ debut: '00:00', fin: '00:00' }");
  });

  it('la veille est jugée sur l’heure de PARIS, écrite en toutes lettres', () => {
    // Ce contrôle est textuel, et il le reste faute de mieux : la fonction
    // lit l'heure réelle, et ce poste de développement EST à l'heure de
    // Paris — retirer `timeZone` n'y change donc rien, alors que sur le
    // serveur (en UTC) la veille se décalerait d'une ou deux heures.
    //
    // `hourCycle` est du même ordre, pour une raison différente : `fr-FR`
    // formate déjà minuit « 00 », le retirer ne change rien AUJOURD'HUI. Il
    // est écrit pour que la réponse juste ne dépende pas du réglage par
    // défaut d'une locale — en « h24 », minuit vaudrait 86 400 s et ne
    // tomberait dans aucune fenêtre de veille : la nuit entière alerterait.
    const bloc = blocDecision();
    expect(bloc).toMatch(/function secondesParis[\s\S]*?timeZone: 'Europe\/Paris'/);
    expect(bloc).toMatch(/function secondesParis[\s\S]*?hourCycle: 'h23'/);
  });
});

// ---------------------------------------------------------------------------
// QUAND LA BASE NE RÉPOND PAS — R-02 (relecture de septembre 2026)
//
// Le constat, mesuré sur la fonction réelle : un client dont toutes les
// lectures échouent donnait un statut 200, `{"surveilles":0,"en_defaut":0}`,
// « 0 surveillés, aucun défaut » dans `surveillance_etat`, aucun courriel,
// aucune trace. La supervision affichait « Surveillance active », en vert,
// pendant que plus personne ne regardait les écrans.
// ---------------------------------------------------------------------------

const TOUTES_LES_LECTURES: OperationBase[] = [
  'select:ecrans',
  'select:params',
  'select:alertes_ecran',
];

/** Ce que le passage a écrit dans `surveillance_etat` — la seule chose qu'un humain lit. */
function resultatEcrit(p: Passage): string | undefined {
  const maj = p.ecritures.find((e) => e.table === 'surveillance_etat');
  return maj?.valeurs?.dernier_resultat as string | undefined;
}

describe('Le guetteur, exécuté — le constat R-02', () => {
  for (const mode of ['erreur', 'leve'] as const) {
    it(`toutes les lectures en ${mode} : ni 200, ni « aucun défaut », ni silence`, async () => {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
        echecs: Object.fromEntries(TOUTES_LES_LECTURES.map((o) => [o, mode])),
      });
      expect(p.statut).not.toBe(200);
      expect(resultatEcrit(p)).not.toMatch(/aucun défaut/);
      expect(p.corps).not.toMatchObject({ surveilles: 0, en_defaut: 0 });
      expect(p.journal.length).toBeGreaterThan(0);
    });
  }
});

describe('Le guetteur, exécuté — une lecture VITALE échoue : le passage est abandonné', () => {
  // `ecrans` : le guetteur ne sait rien du parc. `params` : il ne sait ni qui
  // prévenir, ni quand les postes dorment. Dans les deux cas il ne conclut
  // rien, ne touche pas aux épisodes, et le DIT.
  const EPISODE: LigneAlerteBanc = {
    ecran_id: 'saint-gervais-ecran-1',
    depuis: new Date(Date.now() - MUET).toISOString(),
    detectee_at: new Date(Date.now() - 600_000).toISOString(),
    envois_tentes: 1,
    envoyee_at: new Date(Date.now() - 600_000).toISOString(),
    dernier_echec: null,
  };

  for (const lecture of ['select:ecrans', 'select:params'] as const) {
    for (const mode of ['erreur', 'leve'] as const) {
      it(`${lecture} en ${mode} : 500, « ÉCHEC » écrit, rien envoyé, épisodes intacts`, async () => {
        const p = await passe({
          // Un poste muet ET un poste rétabli avec son épisode : si le passage
          // allait au bout, il enverrait deux courriels et toucherait la table.
          ecrans: [posteBanc('le-fayet-ecran-1', MUET), posteBanc('saint-gervais-ecran-1', 20_000)],
          params: [VEILLE_JAMAIS, DESTINATAIRE],
          alertes: [EPISODE],
          env: ENV_COMPLET,
          echecs: { [lecture]: mode },
        });
        expect(p.statut).toBe(500);
        expect(p.courriels).toEqual([]);
        expect(p.ecritures.filter((e) => e.table === 'alertes_ecran')).toEqual([]);
        const resultat = resultatEcrit(p) ?? '';
        expect(resultat.startsWith('ÉCHEC — lecture impossible')).toBe(true);
        // La table fautive est NOMMÉE : c'est ce qui envoie chercher au bon
        // endroit (clé révoquée, table renommée).
        expect(resultat).toContain(lecture.slice('select:'.length));
        expect(resultat).toContain("aucun écran n'a été jugé");
        // Le passage est quand même HORODATÉ : la chaîne pg_cron → pg_net →
        // fonction marche, c'est la base qui ne répond pas. La supervision
        // doit le distinguer d'un guetteur à l'arrêt.
        const maj = p.ecritures.find((e) => e.table === 'surveillance_etat');
        expect(maj?.valeurs?.derniere_execution).toBeTruthy();
        // Rien qui ressemble à un bilan : « 0 surveillés » était le mensonge.
        expect(p.corps).toMatchObject({ surveilles: null, en_defaut: null });
        expect(p.journal.join('\n')).toContain(`[guetteur] ${lecture.slice('select:'.length)}`);
        // Et la CONCLUSION, en une ligne : c'est elle qu'on cherche dans les
        // journaux quand la supervision a rougi.
        expect(p.journal.join('\n')).toContain('passage abandonné');
      });
    }
  }

  it('le motif de la base est rendu, sans jamais recopier une clé', async () => {
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      echecs: { 'select:ecrans': 'erreur' },
    });
    expect(resultatEcrit(p)).toContain('ecrans : permission denied for select:ecrans');
    for (const trace of [resultatEcrit(p) ?? '', ...p.journal]) {
      expect(trace).not.toContain('sb_secret_abc');
    }
  });

  it('un message de la base qui porterait une clé ou un jeton est MASQUÉ', async () => {
    // Le résultat est affiché en supervision, à tout compte qui voit l'onglet
    // Écrans. PostgREST ne recopie pas de clé dans ses messages ; si un jour
    // un intermédiaire le faisait, la supervision ne doit pas la montrer.
    const jeton = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl';
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      echecs: { 'select:ecrans': 'erreur' },
      messageErreur: `Invalid API key sb_secret_abc123 (Bearer ${jeton})`,
    });
    const resultat = resultatEcrit(p) ?? '';
    expect(resultat).toContain('Invalid API key');
    for (const trace of [resultat, ...p.journal]) {
      expect(trace).not.toContain('sb_secret_abc123');
      expect(trace).not.toContain(jeton);
    }
  });

  it('un message de la base démesuré est TRONQUÉ', async () => {
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      echecs: { 'select:ecrans': 'erreur' },
      messageErreur: 'x'.repeat(5_000),
    });
    expect((resultatEcrit(p) ?? '').length).toBeLessThan(400);
  });

  it('les trois lectures illisibles sont TOUTES nommées', async () => {
    const p = await passe({
      ecrans: [],
      params: [],
      alertes: [],
      env: ENV_COMPLET,
      echecs: Object.fromEntries(TOUTES_LES_LECTURES.map((o) => [o, 'erreur'])),
    });
    const resultat = resultatEcrit(p) ?? '';
    for (const table of ['ecrans :', 'params :', 'alertes_ecran :']) {
      expect(resultat, table).toContain(table);
    }
  });
});

describe('Le guetteur, exécuté — l’historique des alertes est illisible', () => {
  // Il sait QUI est muet, pas s'il l'a déjà dit. Le rapport chiffrait le
  // risque : un courriel par passage, douze par heure. La règle retenue :
  // n'annoncer que le poste qui a franchi le seuil depuis le passage
  // précédent — au plus UN courriel par épisode, sans rétablissement.
  const SANS_HISTORIQUE = { 'select:alertes_ecran': 'erreur' } as const;

  it('un poste qui VIENT de franchir le seuil est annoncé, et le courriel prévient', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', SEUIL_DEFAUT_MS + 60_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      echecs: SANS_HISTORIQUE,
    });
    expect(p.courriels).toHaveLength(1);
    expect(p.courriels[0]?.corps).toContain('n’a pas pu relire son historique');
    expect(p.courriels[0]?.corps).toContain('NE SERA PAS annoncé');
    expect(p.courriels[0]?.corps).not.toContain('Vous recevrez un second message');
    // On tente d'écrire la mémoire : si la lecture n'a échoué qu'une fois, le
    // passage suivant saura que c'est dit et ne répétera pas.
    expect(upsertAlertes(p).map((l) => l.ecran_id)).toEqual(['saint-gervais-ecran-1']);
    expect(p.statut).toBe(500);
    const resultat = resultatEcrit(p) ?? '';
    expect(resultat.startsWith('ÉCHEC — historique illisible')).toBe(true);
    // Le constat reste dit : il est juste, même sans historique.
    expect(resultat).toContain('1/1 en défaut');
  });

  it('un poste muet depuis LONGTEMPS n’est pas réannoncé : douze courriels par heure, c’est ce qu’on refuse', async () => {
    // Douze passages d'une heure de panne, historique illisible à chacun :
    // le poste ne se trouve dans la fenêtre d'annonce qu'à UN seul d'entre eux.
    let courriels = 0;
    for (let passage = 0; passage < 12; passage++) {
      const silence = SEUIL_DEFAUT_MS - 2 * 60_000 + passage * CADENCE_GUETTEUR_MS;
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', silence)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
        echecs: SANS_HISTORIQUE,
      });
      courriels += p.courriels.length;
    }
    expect(courriels).toBe(1);
  });

  it('la fenêtre d’annonce est EXACTEMENT une cadence de pg_cron', async () => {
    // Plus étroite, un poste pourrait la sauter entre deux passages et ne
    // jamais être annoncé ; plus large, il serait annoncé deux fois.
    const annonce = async (silence: number) =>
      (
        await passe({
          ecrans: [posteBanc('saint-gervais-ecran-1', silence)],
          params: [VEILLE_JAMAIS, DESTINATAIRE],
          alertes: [],
          env: ENV_COMPLET,
          echecs: SANS_HISTORIQUE,
        })
      ).courriels.length;
    // Une seconde de marge de part et d'autre : le banc lit l'heure réelle.
    expect(await annonce(SEUIL_DEFAUT_MS + 1_000)).toBe(1);
    expect(await annonce(SEUIL_DEFAUT_MS + CADENCE_GUETTEUR_MS - 2_000)).toBe(1);
    expect(await annonce(SEUIL_DEFAUT_MS + CADENCE_GUETTEUR_MS + 2_000)).toBe(0);
  });

  it('aucun rétablissement annoncé, aucune ligne supprimée', async () => {
    // Le poste bat de nouveau ; on ne sait pas si sa panne a été dite. Dire
    // « c'est réparé » d'une panne jamais annoncée ferait chercher un message
    // qu'on n'a pas reçu.
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'saint-gervais-ecran-1',
          depuis: new Date(Date.now() - 3_600_000).toISOString(),
          detectee_at: new Date(Date.now() - 3_600_000).toISOString(),
          envois_tentes: 1,
          envoyee_at: new Date(Date.now() - 3_600_000).toISOString(),
          dernier_echec: null,
        },
      ],
      env: ENV_COMPLET,
      echecs: SANS_HISTORIQUE,
    });
    expect(p.courriels).toEqual([]);
    expect(p.ecritures.filter((e) => e.op === 'delete')).toEqual([]);
    expect(resultatEcrit(p)).toContain('aucun rétablissement annoncé');
    expect(p.statut).toBe(500);
  });

  it('même quand le parc va bien, le passage ne se dit pas réussi', async () => {
    // « 1 surveillés, aucun défaut » serait vrai, mais le guetteur ne peut
    // plus tenir sa promesse d'un seul courriel par épisode : ce n'est pas un
    // passage réussi, et la supervision doit rougir.
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
      echecs: SANS_HISTORIQUE,
    });
    expect(resultatEcrit(p)?.startsWith('ÉCHEC')).toBe(true);
    expect(resultatEcrit(p)).toContain('1 surveillés, aucun défaut');
  });
});

describe('Le guetteur, exécuté — une écriture échoue', () => {
  for (const mode of ['erreur', 'leve'] as const) {
    it(`mémoire de l’épisode non écrite (${mode}) : dit, avec la conséquence`, async () => {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
        echecs: { 'upsert:alertes_ecran': mode },
      });
      // L'épisode n'a pas pu s'écrire : le courriel ne part PAS. Le laisser
      // partir referait la boucle que ce lot ferme.
      expect(p.courriels).toEqual([]);
      expect(p.statut).toBe(500);
      const resultat = resultatEcrit(p) ?? '';
      expect(resultat.startsWith('ÉCHEC — écriture impossible')).toBe(true);
      expect(resultat).toContain('alertes_ecran (enregistrement)');
      expect(resultat).toContain("aucun courriel n'est parti");
    });
  }

  it('clôture d’épisode non écrite : dit aussi', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [
        {
          ecran_id: 'saint-gervais-ecran-1',
          depuis: new Date(Date.now() - 3_600_000).toISOString(),
          detectee_at: new Date(Date.now() - 3_600_000).toISOString(),
          envois_tentes: 1,
          envoyee_at: new Date(Date.now() - 3_600_000).toISOString(),
          dernier_echec: null,
        },
      ],
      env: ENV_COMPLET,
      echecs: { 'delete:alertes_ecran': 'erreur' },
    });
    expect(p.statut).toBe(500);
    expect(resultatEcrit(p)).toContain('alertes_ecran (clôture)');
  });

  for (const mode of ['erreur', 'leve'] as const) {
    it(`surveillance_etat non écrite (${mode}) : 500 et trace, jamais une exception muette`, async () => {
      // La seule trace qu'un humain lit ne s'écrit pas. Il reste les journaux
      // de la fonction et le statut — et, au bout de quinze minutes, la
      // supervision « À L'ARRÊT », puisque l'horodatage vieillit.
      const p = await passe({
        ecrans: [posteBanc('le-fayet-ecran-1', 20_000)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
        echecs: { 'update:surveillance_etat': mode },
      });
      expect(p.statut).toBe(500);
      expect(p.journal.join('\n')).toContain('[guetteur] surveillance_etat');
      expect(p.corps).toMatchObject({ echec: expect.stringContaining('surveillance_etat') });
    });
  }

  it('un passage sans aucun échec reste un 200, sans « ÉCHEC » ni trace', async () => {
    // Le contrôle inverse : un guetteur qui crierait à chaque passage serait
    // un guetteur qu'on cesse d'écouter.
    const p = await passe({
      ecrans: [posteBanc('le-fayet-ecran-1', 20_000)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    expect(p.statut).toBe(200);
    expect(resultatEcrit(p)).toBe('1 surveillés, aucun défaut');
    expect(p.journal).toEqual([]);
    expect(p.corps).toMatchObject({ echec: null });
  });
});

describe('Ce que le guetteur ÉCRIT, la supervision le LIT comme il faut', () => {
  // La correspondance entre la fonction Deno et la page ne tient qu'à un mot
  // (`MARQUE_ECHEC_GUETTEUR`). Elle est éprouvée de bout en bout : le
  // résultat réellement écrit par la fonction passe dans la décision réelle
  // de la page.
  const maintenant = () => Date.now();
  const bandeauApres = (p: Passage) => {
    const maj = p.ecritures.find((e) => e.table === 'surveillance_etat')?.valeurs ?? {};
    return bandeauGuetteur(
      {
        derniere_execution: maj.derniere_execution as string,
        dernier_resultat: maj.dernier_resultat as string,
      },
      maintenant(),
    );
  };
  const decors: [string, Partial<Record<OperationBase, ModeEchec>>][] = [
    ['écrans illisibles', { 'select:ecrans': 'erreur' }],
    ['réglages illisibles', { 'select:params': 'leve' }],
    ['historique illisible', { 'select:alertes_ecran': 'erreur' }],
    ['mémoire non écrite', { 'upsert:alertes_ecran': 'erreur' }],
    ['tout illisible', Object.fromEntries(TOUTES_LES_LECTURES.map((o) => [o, 'erreur']))],
  ];
  for (const [nom, echecs] of decors) {
    it(`${nom} : la supervision affiche EN ÉCHEC, en rouge`, async () => {
      const p = await passe({
        ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
        params: [VEILLE_JAMAIS, DESTINATAIRE],
        alertes: [],
        env: ENV_COMPLET,
        echecs,
      });
      const b = bandeauApres(p);
      expect(b.classe).toBe('alerte');
      expect(b.libelle).toContain('EN ÉCHEC');
      expect(b.libelle).not.toContain('active');
    });
  }

  it('un passage réussi : la supervision affiche « Surveillance active », en vert', async () => {
    const p = await passe({
      ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
      params: [VEILLE_JAMAIS, DESTINATAIRE],
      alertes: [],
      env: ENV_COMPLET,
    });
    const b = bandeauApres(p);
    expect(b.classe).toBe('ok');
    expect(b.libelle).toContain('Surveillance active');
  });

  it('la marque est la même des deux côtés', () => {
    expect(FONCTION).toContain(`const MARQUE_ECHEC = '${MARQUE_ECHEC_GUETTEUR}';`);
  });
});

// ---------------------------------------------------------------------------
// R-42 — la cadence de pg_cron, le seuil « À L'ARRÊT », la fenêtre d'annonce
// ---------------------------------------------------------------------------

describe('Une seule cadence, lue dans la planification', () => {
  /** Minutes entre deux passages, lues dans la VRAIE planification. */
  function cadencePlanifieeMs(): number {
    const planif = MIGRATION.match(/cron\.schedule\(\s*'surveillance-ecrans',\s*'([^']+)'/);
    expect(planif, 'planification surveillance-ecrans introuvable').not.toBeNull();
    // Seule forme admise : « */N * * * * ». Une autre forme (liste de minutes,
    // heures bornées) rend la cadence irrégulière, et ce test doit alors
    // tomber pour qu'on repense la fenêtre d'annonce et le seuil, pas passer.
    const pas = planif?.[1]?.match(/^\*\/(\d+) \* \* \* \*$/);
    expect(pas, `forme de planification inattendue : ${planif?.[1]}`).not.toBeNull();
    return Number(pas?.[1]) * 60_000;
  }

  it('la supervision déclare la cadence qui est planifiée', () => {
    expect(CADENCE_GUETTEUR_MS).toBe(cadencePlanifieeMs());
  });

  it('la fonction déclare la cadence qui est planifiée', () => {
    // Le comportement est éprouvé plus haut (la fenêtre d'annonce vaut
    // `CADENCE_GUETTEUR_MS`) ; ceci relie la constante à la planification.
    const cadence = FONCTION.match(/^const CADENCE_MS = (\d+) \* 60_000;$/m);
    expect(cadence).not.toBeNull();
    expect(Number(cadence?.[1]) * 60_000).toBe(cadencePlanifieeMs());
  });

  it('le seuil « À L’ARRÊT » laisse passer DEUX passages manqués, et pas un de plus', () => {
    // Une cadence relevée au-delà du seuil ferait dire « À L'ARRÊT » à un
    // guetteur parfaitement sain — une fausse alarme sur l'organe d'alarme.
    // Le seuil n'est donc pas une constante libre : il vaut trois cadences.
    expect(SEUIL_GUETTEUR_MUET_MS).toBe(3 * cadencePlanifieeMs());
  });

  it('la cadence reste sous le seuil de défaut d’un écran', () => {
    // Plus lente que dix minutes, un écran pourrait se taire et revenir entre
    // deux passages sans que personne ne le sache — et la fenêtre d'annonce
    // sans historique cesserait d'avoir un sens.
    expect(cadencePlanifieeMs()).toBeLessThan(SEUIL_DEFAUT_MS);
  });
});

// ---------------------------------------------------------------------------
// L'ÉPISODE AVANT LE COURRIEL
//
// La première version écrivait l'épisode APRÈS l'envoi. Une écriture refusée
// laissait donc un courriel parti sans mémoire, et le passage suivant le
// renvoyait — sans limite tant que la table refusait. L'ordre est inversé :
// mieux vaut un épisode enregistré dont le courriel n'est jamais parti (la
// supervision l'affiche) qu'un courriel en boucle que personne n'arrête.
// ---------------------------------------------------------------------------

/** Un poste muet, décor ordinaire, avec ce qu'on veut y changer. */
const muet = (reste: Partial<Decor> = {}): Decor => ({
  ecrans: [posteBanc('saint-gervais-ecran-1', MUET)],
  params: [VEILLE_JAMAIS, DESTINATAIRE],
  alertes: [],
  env: ENV_COMPLET,
  ...reste,
});

/** Enchaîne `n` passages ; chacun repart de la table laissée par le précédent. */
async function passages(n: number, decor: (i: number) => Decor): Promise<Passage[]> {
  const faits: Passage[] = [];
  let alertes: LigneAlerteBanc[] = decor(0).alertes;
  for (let i = 0; i < n; i++) {
    const p = await passe({ ...decor(i), alertes });
    faits.push(p);
    alertes = p.alertesApres;
  }
  return faits;
}

describe('L’épisode est écrit AVANT le courriel', () => {
  it('envoi en échec après enregistrement réussi : au passage suivant, AUCUN second courriel', async () => {
    const [premier, second] = await passages(2, (i) => muet({ brevoStatut: i === 0 ? 503 : 201 }));
    expect(premier?.courriels).toHaveLength(1);
    expect(second?.courriels, 'le même épisode ne repart pas').toEqual([]);
    // L'échec reste DIT, là où la supervision le lit.
    const ligne = second?.alertesApres.find((l) => l.ecran_id === 'saint-gervais-ecran-1');
    expect(ligne?.envoyee_at).toBeNull();
    expect(ligne?.dernier_echec).toBe('Brevo 503');
  });

  it('l’épisode est enregistré, PUIS le courriel part', async () => {
    const p = await passe(muet());
    expect(p.sequence.indexOf('upsert:alertes_ecran')).toBeGreaterThan(-1);
    expect(p.sequence.indexOf('upsert:alertes_ecran')).toBeLessThan(p.sequence.indexOf('courriel'));
  });

  for (const mode of ['erreur', 'leve'] as const) {
    it(`épisode non enregistrable (${mode}) : AUCUN courriel, et c’est dit`, async () => {
      const p = await passe(muet({ echecs: { 'upsert:alertes_ecran': mode } }));
      expect(p.courriels).toEqual([]);
      expect(p.statut).toBe(500);
      // La réponse compte ce qui a été TENTÉ, pas ce qui était prévu.
      expect(p.corps).toMatchObject({ annonces: 0, en_defaut: 1 });
      expect(resultatEcrit(p)).toContain("aucun courriel n'est parti");
    });
  }

  it('épisode JAMAIS enregistrable : douze passages, zéro courriel — et non douze', async () => {
    const faits = await passages(12, () => muet({ echecs: { 'upsert:alertes_ecran': 'erreur' } }));
    expect(faits.reduce((n, p) => n + p.courriels.length, 0)).toBe(0);
  });

  it('issue de l’envoi non enregistrable : UN courriel sur douze passages, pas douze', async () => {
    // Le courriel part (l'épisode est écrit), mais son issue ne s'écrit pas.
    // C'est le cas qui bouclait : il est désormais borné par la ligne écrite
    // AVANT l'envoi.
    const faits = await passages(12, () => muet({ echecs: { 'update:alertes_ecran': 'erreur' } }));
    expect(faits.reduce((n, p) => n + p.courriels.length, 0)).toBe(1);
    expect(faits[0]?.statut).toBe(500);
  });

  it('issue non enregistrée : la supervision dit « non envoyée », jamais « envoyée » à tort', async () => {
    // Pessimiste par construction : la ligne écrite avant l'envoi ne prétend
    // pas que le courriel est parti. Une fausse alarme vaut mieux qu'une
    // fausse assurance.
    const p = await passe(muet({ echecs: { 'update:alertes_ecran': 'erreur' } }));
    const ligne = p.alertesApres[0];
    expect(ligne?.envoyee_at).toBeNull();
    expect(ligne?.dernier_echec).toBe('envoi tenté, issue non enregistrée');
    expect(resultatEcrit(p)).toContain("issue de l'envoi non enregistrée");
  });

  it('sans historique lisible, la règle est la même : pas d’épisode écrit, pas de courriel', async () => {
    const p = await passe(
      muet({
        ecrans: [posteBanc('saint-gervais-ecran-1', SEUIL_DEFAUT_MS + 60_000)],
        echecs: { 'select:alertes_ecran': 'erreur', 'upsert:alertes_ecran': 'erreur' },
      }),
    );
    expect(p.courriels).toEqual([]);
    expect(resultatEcrit(p)).toContain('0 annonce(s) sans mémoire');
  });
});

describe('La clôture est écrite AVANT l’avis de rétablissement', () => {
  const EPISODE_DIT = (): LigneAlerteBanc => ({
    ecran_id: 'saint-gervais-ecran-1',
    depuis: new Date(Date.now() - 3_600_000).toISOString(),
    detectee_at: new Date(Date.now() - 3_600_000).toISOString(),
    envois_tentes: 1,
    envoyee_at: new Date(Date.now() - 3_600_000).toISOString(),
    dernier_echec: null,
  });
  const retabli = (reste: Partial<Decor> = {}): Decor =>
    muet({
      ecrans: [posteBanc('saint-gervais-ecran-1', 20_000)],
      alertes: [EPISODE_DIT()],
      ...reste,
    });

  it('la ligne disparaît, PUIS l’avis part', async () => {
    const p = await passe(retabli());
    expect(p.sequence.indexOf('delete:alertes_ecran')).toBeGreaterThan(-1);
    expect(p.sequence.indexOf('delete:alertes_ecran')).toBeLessThan(p.sequence.indexOf('courriel'));
  });

  it('clôture JAMAIS enregistrable : douze passages, zéro avis — et non douze', async () => {
    const faits = await passages(12, () =>
      retabli({ echecs: { 'delete:alertes_ecran': 'erreur' } }),
    );
    expect(faits.reduce((n, p) => n + p.courriels.length, 0)).toBe(0);
    expect(faits[0]?.statut).toBe(500);
  });

  it('avis en échec après clôture réussie : rien ne repart au passage suivant', async () => {
    const [premier, second] = await passages(2, (i) =>
      retabli({ brevoStatut: i === 0 ? 503 : 201 }),
    );
    expect(premier?.courriels).toHaveLength(1);
    expect(second?.courriels).toEqual([]);
  });
});

describe('« Personne n’a été prévenu » ne ressemble pas à « le guetteur n’a rien vu »', () => {
  const pastilleDe = (p: Passage) => {
    const poste = posteBanc('saint-gervais-ecran-1', MUET);
    const etat = etatSurveillance(
      poste,
      { debut: '00:00', fin: '00:00' },
      Date.now(),
      secondesParisMaintenant(),
    );
    return pastilleSurveillance(etat, true, p.alertesApres[0] ?? null);
  };
  const bandeauDe = (p: Passage) => {
    const maj = p.ecritures.find((e) => e.table === 'surveillance_etat')?.valeurs ?? {};
    return bandeauGuetteur(
      {
        derniere_execution: maj.derniere_execution as string,
        dernier_resultat: maj.dernier_resultat as string,
      },
      Date.now(),
    );
  };

  it('envoi refusé : le guetteur a vu (bandeau VERT), le poste dit ALERTE NON ENVOYÉE', async () => {
    const p = await passe(muet({ brevoStatut: 503 }));
    expect(bandeauDe(p).classe).toBe('ok');
    expect(bandeauDe(p).detail).toContain('envoi : Brevo 503');
    const pastille = pastilleDe(p);
    expect(pastille.classe).toBe('defaut');
    expect(pastille.libelle).toContain('ALERTE NON ENVOYÉE (Brevo 503)');
  });

  it('épisode non enregistrable : le guetteur n’a pas pu faire son travail (bandeau ROUGE)', async () => {
    const p = await passe(muet({ echecs: { 'upsert:alertes_ecran': 'erreur' } }));
    expect(bandeauDe(p).classe).toBe('alerte');
    expect(bandeauDe(p).libelle).toContain('EN ÉCHEC');
  });

  it('les deux libellés de poste ne se confondent pas', async () => {
    const nonEnvoyee = pastilleDe(await passe(muet({ brevoStatut: 503 }))).libelle;
    const envoyee = pastilleDe(await passe(muet())).libelle;
    expect(envoyee).toContain('alerte envoyée à');
    expect(nonEnvoyee).not.toContain('alerte envoyée');
  });
});
