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
const MIGRATION = source('supabase/migrations/2026-09-train-special.sql');
const SUPABASE = source('src/data/supabase.ts');

describe('la colonne existe, et elle est PROPRE', () => {
  it('`commanditaire` est une colonne de `circulations`, pas un sens de plus sur `motif`', () => {
    // `motif` porte déjà la raison d'une suppression et celle d'un retard.
    // Un troisième sens en ferait le piège qu'a été `terminus`.
    expect(SCHEMA).toContain('commanditaire text,');
    expect(MIGRATION).toContain('alter table circulations add column if not exists commanditaire');
    expect(source('src/core/types.ts')).toContain('commanditaire?: string | null;');
  });

  it('la migration est REJOUABLE', () => {
    expect(MIGRATION).toContain('add column if not exists');
    expect(MIGRATION).toContain('drop trigger if exists trg_journal_circulations');
  });

  it('le JOURNAL suit la colonne', () => {
    // Sans cela, changer l'affréteur d'un train ne laisserait aucune trace —
    // or c'est la donnée qu'on cherchera le jour où l'on se demande qui a
    // demandé quoi.
    for (const [nom, sql] of [
      ['schema.sql', SCHEMA],
      ['migration', MIGRATION],
    ] as const) {
      const trigger = /create trigger trg_journal_circulations([\s\S]*?);/.exec(sql)?.[0] ?? '';
      expect(trigger, `déclencheur absent de ${nom}`).not.toBe('');
      expect(trigger, nom).toContain("'commanditaire'");
    }
  });
});

describe('`anon` ne lit PAS le commanditaire', () => {
  it('le droit de colonne existe dans les DEUX copies', () => {
    for (const [nom, sql] of [
      ['schema.sql', SCHEMA],
      ['migration', MIGRATION],
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
    expect(colonnesAccordeesAAnon(SCHEMA)).toEqual(colonnesAccordeesAAnon(MIGRATION));
  });

  it('ni `id` ni `maj` : on n’accorde que ce qui est affiché', () => {
    const colonnes = colonnesAccordeesAAnon(SCHEMA);
    expect(colonnes).not.toContain('id');
    expect(colonnes).not.toContain('maj');
  });

  it('`authenticated` garde la table entière : la supervision doit la voir', () => {
    for (const sql of [SCHEMA, MIGRATION]) {
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
