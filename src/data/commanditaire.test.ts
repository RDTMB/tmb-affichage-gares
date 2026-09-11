// COMMANDITAIRE d'un train spécial — champ interne, et ce que sa protection
// coûte au reste du projet.
//
// CE QUE CES TESTS PROTÈGENT. `circulations` porte « lecture publique …
// using (true) » : les écrans lisent sans compte. RLS ne filtre que des
// LIGNES — pour retirer une COLONNE à la clé publiable, il n'y a que les
// droits de colonne, comme pour `affluence.maj_par` le 10/09/2026.
//
// La différence est le nombre de colonnes : trois là-bas, seize ici. Deux
// listes doivent donc rester d'accord — celle du `grant select` en base et
// celle que `getJour` demande. Si elles divergent :
//   • une colonne dans le front mais pas dans le grant → « permission denied »
//     et les SIX écrans de gare s'éteignent ensemble ;
//   • une colonne dans le grant mais pas dans le front → `anon` peut lire
//     quelque chose que personne n'a décidé de lui montrer.
// Aucune des deux ne se verrait en test unitaire sans ce fichier.
//
// Non prouvé ici : le refus réel de PostgreSQL (recette
// supabase/tests/roles-rls.sql, jouée sur la base de test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

/** Colonnes du `grant select (…) on circulations to anon` d'un script SQL. */
function colonnesAccordeesAAnon(sql: string): string[] {
  // `[^)]*` et non `[\s\S]*?` : le fichier contient d'autres `grant select (`
  // avant celui-ci (affluence, profils…), et une capture paresseuse partait
  // du PREMIER d'entre eux — elle ramenait 49 colonnes au lieu de 16.
  const bloc = /grant select \(([^)]*)\) on circulations to anon;/.exec(sql)?.[1];
  if (bloc === undefined) return [];
  return bloc
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

/** Colonnes des `select('…')` littéraux de `getJour`, par appel. */
function selectsDeGetJour(ts: string): string[][] {
  const debut = ts.indexOf('async getJour(');
  const fin = ts.indexOf('\n  async ', debut + 1);
  const corps = ts.slice(debut, fin === -1 ? undefined : fin);
  return [...corps.matchAll(/\.select\(\s*'([^']*numero[^']*)'/g)].map((m) =>
    (m[1] ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== ''),
  );
}

const SCHEMA = source('supabase/schema.sql');
// Deux migrations, et le découpage EST le sujet : A ajoute (la colonne, le
// journal) sans rien retirer, B retire (la lecture en bloc de anon). SQL tout
// en un seul bloc, il n'existe aucun ordre gagnant — soit les six écrans
// s'éteignent le temps du déploiement, soit la supervision tombe sur
// « column commanditaire does not exist ».
const MIGRATION_A = source('supabase/migrations/2026-09-train-special-A.sql');
const MIGRATION_B = source('supabase/migrations/2026-09-train-special-B.sql');
const SUPABASE = source('src/data/supabase.ts');

describe('la colonne existe, et elle est PROPRE', () => {
  it('`commanditaire` est une colonne de `circulations`, pas un sens de plus sur `motif`', () => {
    // `motif` porte déjà la raison d'une suppression et celle d'un retard.
    // Un troisième sens en ferait le piège qu'a été `terminus`.
    expect(SCHEMA).toContain('commanditaire text,');
    expect(MIGRATION_A).toContain(
      'alter table circulations add column if not exists commanditaire',
    );
    expect(source('src/core/types.ts')).toContain('commanditaire?: string | null;');
  });

  it('les deux migrations sont REJOUABLES', () => {
    expect(MIGRATION_A).toContain('add column if not exists');
    expect(MIGRATION_A).toContain('drop trigger if exists trg_journal_circulations');
    // B ne fait que des `revoke`/`grant`, idempotents par nature.
    expect(MIGRATION_B).toContain('revoke all on circulations from anon;');
  });

  it('le JOURNAL suit la colonne, et il est posé par A', () => {
    // Sans cela, changer l'affréteur d'un train ne laisserait aucune trace —
    // or c'est la donnée qu'on cherchera le jour où l'on se demande qui a
    // demandé quoi.
    for (const [nom, sql] of [
      ['schema.sql', SCHEMA],
      ['migration A', MIGRATION_A],
    ] as const) {
      const trigger = /create trigger trg_journal_circulations([\s\S]*?);/.exec(sql)?.[0] ?? '';
      expect(trigger, `déclencheur absent de ${nom}`).not.toBe('');
      expect(trigger, nom).toContain("'commanditaire'");
    }
  });
});

describe('le DÉCOUPAGE en deux migrations, et ce qu’il protège', () => {
  it('A n’enlève RIEN : l’ancien front tient jusqu’au déploiement', () => {
    // C'est toute la raison du découpage. Un `revoke` glissé dans A
    // éteindrait les six gares pendant la propagation de GitHub Pages.
    // Sur la TABLE : A ne doit rien y retirer. (Le `revoke … on function`
    // qui durcit la fonction de déclencheur n'enlève rien à personne sur les
    // données — c'est la pose normale d'une fonction `private`.)
    expect(MIGRATION_A, 'A révoque des droits sur la table').not.toMatch(
      /revoke[^;]*\son circulations/,
    );
    expect(MIGRATION_A, 'A restreint des droits').not.toContain('grant select (');
  });

  it('B ne crée RIEN : il ne fait que fermer', () => {
    // Une colonne ajoutée dans B ne serait créée qu'APRÈS le déploiement du
    // front qui l'utilise — donc trop tard.
    expect(MIGRATION_B, 'B ajoute une colonne').not.toContain('add column');
  });

  it('les DEUX fichiers portent la séquence complète, dans l’ordre', () => {
    // Elle doit se lire là où on l'exécute. Un ordre gardé dans une PR se
    // perd ; un ordre écrit en tête du script s'exécute.
    for (const [nom, sql] of [
      ['A', MIGRATION_A],
      ['B', MIGRATION_B],
    ] as const) {
      const etapes = [
        'A sur la base de TEST',
        'déploiement du front',
        'vérifier les SIX écrans',
        'B sur la base de TEST',
        'en PRODUCTION',
      ];
      let precedent = -1;
      for (const etape of etapes) {
        const ou = sql.indexOf(etape);
        expect(ou, `${nom} : étape « ${etape} » absente`).toBeGreaterThan(precedent);
        precedent = ou;
      }
    }
  });

  it('B avertit qu’il ne se joue pas avant le front', () => {
    expect(MIGRATION_B).toContain(
      'NE PAS JOUER CE SCRIPT AVANT QUE LE NOUVEAU FRONT SOIT EN LIGNE',
    );
  });
});

describe('`anon` ne lit PAS le commanditaire', () => {
  it('le droit de colonne existe dans les DEUX copies', () => {
    for (const [nom, sql] of [
      ['schema.sql', SCHEMA],
      ['migration B', MIGRATION_B],
    ] as const) {
      expect(sql, `${nom} : anon garde ses droits par défaut`).toContain(
        'revoke all on circulations from anon;',
      );
      const colonnes = colonnesAccordeesAAnon(sql);
      expect(colonnes.length, `${nom} : grant introuvable`).toBeGreaterThan(0);
      expect(colonnes, `${nom} : commanditaire exposé à la clé publiable`).not.toContain(
        'commanditaire',
      );
    }
  });

  it('les deux copies accordent EXACTEMENT les mêmes colonnes', () => {
    // Élargir ici sans élargir là-bas donne le pire résultat : la base de test
    // et la production ne se comportent pas pareil.
    expect(colonnesAccordeesAAnon(SCHEMA)).toEqual(colonnesAccordeesAAnon(MIGRATION_B));
  });

  it('ni `id` ni `maj` : on n’accorde que ce qui est affiché', () => {
    const colonnes = colonnesAccordeesAAnon(SCHEMA);
    expect(colonnes).not.toContain('id');
    expect(colonnes).not.toContain('maj');
  });

  it('`authenticated` garde la table entière : la supervision doit la voir', () => {
    for (const sql of [SCHEMA, MIGRATION_B]) {
      expect(sql).toContain(
        'grant select, insert, update, delete on circulations to authenticated;',
      );
    }
  });
});

describe('le front demande EXACTEMENT ce qui lui est accordé', () => {
  it("plus aucun `select('*')` sur `circulations`", () => {
    // C'est lui qui éteindrait les six gares : PostgREST étend `*` à toutes
    // les colonnes de la table, `commanditaire` comprise.
    expect(SUPABASE).not.toMatch(/from\('circulations'\)[\s\S]{0,60}select\('\*'\)/);
  });

  it('la lecture d’ÉCRAN est la liste accordée à `anon`, au mot près', () => {
    const selects = selectsDeGetJour(SUPABASE);
    expect(selects.length, 'les deux lectures de getJour sont introuvables').toBe(2);
    const publique = selects.find((c) => !c.includes('commanditaire'));
    expect(publique, 'aucune lecture sans commanditaire').toBeDefined();
    expect(publique).toEqual(colonnesAccordeesAAnon(SCHEMA));
  });

  it('la lecture de SUPERVISION ajoute le commanditaire, et rien d’autre', () => {
    const selects = selectsDeGetJour(SUPABASE);
    const publique = selects.find((c) => !c.includes('commanditaire')) ?? [];
    const privee = selects.find((c) => c.includes('commanditaire')) ?? [];
    expect(privee).toEqual([...publique, 'commanditaire']);
  });

  it('l’option existe dans l’interface ET elle est facultative', () => {
    // Le défaut doit être de NE PAS demander la colonne : un futur appelant
    // qui l'oublie lit comme un écran, pas comme la supervision.
    const provider = source('src/data/provider.ts');
    const signature = /getJour\(([\s\S]*?)\): Promise<Jour>;/.exec(provider)?.[1] ?? '';
    expect(signature).toContain('avecCommanditaire?: boolean');
  });

  it('la supervision, elle, la demande partout où elle lit une journée', () => {
    const ts = source('src/pages/supervision.ts');
    const appels = [...ts.matchAll(/provider\.getJour\(([\s\S]*?)\)/g)].map((m) => m[1] ?? '');
    expect(appels.length, 'aucun appel trouvé').toBeGreaterThan(0);
    for (const appel of appels) {
      expect(appel, `appel sans commanditaire : ${appel}`).toContain('avecCommanditaire: true');
    }
  });

  it('les surfaces d’AFFICHAGE ne la demandent jamais', () => {
    // Elles lisent en `anon` : la demander serait « permission denied », donc
    // un écran de gare noir.
    for (const chemin of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
      expect(source(chemin), chemin).not.toContain('avecCommanditaire');
    }
  });
});

describe('la recette RLS contrôle ce que la base fait vraiment', () => {
  // Ce fichier-ci ne prouve que du TEXTE : la seule preuve du refus est
  // PostgreSQL, et elle est dans supabase/tests/roles-rls.sql, jouée à la main
  // sur la base de test. Vitest n'exécute pas ce script — si personne ne
  // verrouille son contenu, il peut perdre un cas sans que rien ne tombe.
  // C'est exactement ce qui s'était produit le 10/09 avec l'upsert de
  // l'affluence : recette verte, production refusée.
  const RECETTE = source('supabase/tests/roles-rls.sql');

  it('elle vérifie que l’écran LIT la circulation', () => {
    // La moitié qu'on oublie : un refus trop large casserait l'affichage en
    // gare, et le script ne le dirait pas.
    // Apostrophes DOUBLÉES : c'est du SQL, et la chaîne vit dans un
    // `raise notice '…'`.
    expect(RECETTE).toContain("OK — anonyme : l''écran de gare lit la circulation");
  });

  it('elle vérifie que l’anonyme NE LIT PAS le commanditaire', () => {
    expect(RECETTE).toContain('perform commanditaire from public.circulations');
    expect(RECETTE).toContain('OK — anonyme : le commanditaire lui est refusé');
  });

  it('elle vérifie que `select *` ÉCHOUE pour l’anonyme', () => {
    // C'est ce refus-là qui protège les colonnes FUTURES : sans lui, une
    // colonne ajoutée sans toucher au grant partirait sur Internet.
    expect(RECETTE).toContain('perform * from public.circulations');
    expect(RECETTE).toContain('OK — anonyme : la lecture en bloc lui est refusée');
  });

  it('elle vérifie que la supervision, elle, l’écrit et la relit', () => {
    expect(RECETTE).toContain("update public.circulations set commanditaire = 'Recette RLS'");
    expect(RECETTE).toContain('OK — supervision : relit le commanditaire');
    expect(RECETTE).toContain('OK — journal : le commanditaire est tracé');
  });
});

describe('le mock ne ment pas sur ce point', () => {
  it('il retire la colonne quand elle n’est pas demandée', () => {
    // La production ne la RETIRE pas : elle ne la lit pas, faute de droit. Le
    // mock n'a pas de droits — s'il la servait à tout le monde, l'aperçu
    // écran de la démo montrerait un nom d'affréteur que la gare ne verra
    // jamais, et on ne s'en apercevrait qu'en production.
    const mock = source('src/data/mock.ts');
    expect(mock).toContain('private filtreCommanditaire(');
    const corps = /private filtreCommanditaire\([\s\S]*?\n  }\n/.exec(mock)?.[0] ?? '';
    expect(corps).toContain('delete copie.commanditaire;');
    // Le COMPORTEMENT, lui, est éprouvé dans src/data/mock.test.ts, qui
    // porte l'environnement navigateur : ces contrôles de texte avaient
    // laissé survivre la mutation « if (true) return jour ».
    // Les DEUX sorties de getJour passent par le filtre — la journée normale
    // et celle tronquée à Bellevue.
    expect([...mock.matchAll(/this\.filtreCommanditaire\(/g)]).toHaveLength(2);
  });
});
