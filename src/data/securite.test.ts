// Correctifs des Security Advisors Supabase : la frontière de sécurité est le
// SQL lui-même, on la teste donc sur le texte des scripts — un `git revert`
// partiel ou un copier-coller d'ancienne politique doit faire rougir la suite.
// Les garanties RLS réelles se vérifient sur la base (bloc VÉRIFICATION à la
// fin de supabase/securite-advisors.sql).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function sql(fichier: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../supabase/${fichier}`, import.meta.url)),
    'utf-8',
  );
}

/** Retire les commentaires SQL : seules les instructions réelles comptent. */
function instructions(texte: string): string {
  return texte
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

const FICHIERS = ['schema.sql', 'securite-advisors.sql'];

describe('Fonctions SECURITY DEFINER hors de portée de PostgREST', () => {
  for (const fichier of FICHIERS) {
    it(`${fichier} : aucune fonction SECURITY DEFINER dans le schéma public`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/create (or replace )?function public\./);
      expect(code).toMatch(/create schema if not exists private/);
    });

    it(`${fichier} : plus aucune politique n'appelle role_courant() sans schéma`, () => {
      const code = instructions(sql(fichier));
      // Toute occurrence doit être qualifiée `private.`
      const nues = [...code.matchAll(/(^|[^.\w])role_courant\s*\(/g)];
      expect(nues).toEqual([]);
      expect(code).toMatch(/private\.role_courant\(\)/);
    });

    it(`${fichier} : search_path verrouillé sur chaque fonction`, () => {
      const code = instructions(sql(fichier));
      const fonctions = [...code.matchAll(/create or replace function [^\n]*\n?[^\n]*/g)].map(
        (m) => m[0],
      );
      expect(fonctions.length).toBeGreaterThan(0);
      for (const f of fonctions) expect(f).toMatch(/set search_path = ''/);
    });

    it(`${fichier} : l'exécution publique des fonctions privées est révoquée`, () => {
      const code = instructions(sql(fichier));
      expect(code).toMatch(/revoke all on function private\.role_courant\(\) from public/);
      expect(code).toMatch(/revoke all on function private\.sync_rame_descente\(\) from public/);
      // …mais `authenticated` DOIT garder EXECUTE, sinon les politiques (qui
      // l'évaluent au nom de l'utilisateur connecté) refuseraient TOUTE écriture.
      expect(code).toMatch(/grant execute on function private\.role_courant\(\) to authenticated/);
      expect(code).toMatch(/grant usage on schema private to authenticated/);
    });
  }
});

describe('Table ecrans : plus d’écriture anonyme non restreinte', () => {
  for (const fichier of FICHIERS) {
    it(`${fichier} : aucune politique anonyme large ne subsiste`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/create policy "heartbeat insert"/);
      expect(code).not.toMatch(/create policy "heartbeat update"/);
      // Un INSERT sans restriction de rôle est l'erreur exacte à ne pas refaire
      expect(code).not.toMatch(/create policy [^\n]* on ecrans for insert with check \(true\)/);
    });

    it(`${fichier} : l'INSERT sur ecrans est réservé à l'administrateur`, () => {
      const code = instructions(sql(fichier));
      expect(code).toMatch(
        /create policy "declarer ecran" on ecrans for insert to authenticated\s*\n?\s*with check \(private\.role_courant\(\) = 'admin'\)/,
      );
    });

    it(`${fichier} : anon ne garde QUE les colonnes du signal de vie`, () => {
      const code = instructions(sql(fichier));
      expect(code).toMatch(/revoke insert, update, delete, truncate on ecrans from anon/);
      const grant = code.match(/grant update \(([^)]*)\)\s*\n?\s*on ecrans to anon/);
      expect(grant).not.toBeNull();
      const colonnes = (grant?.[1] ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .sort();
      expect(colonnes).toEqual(
        ['date_affichee', 'derniere_vue', 'donnees_maj', 'reseau', 'version_app'].sort(),
      );
      // La commande de rechargement n'est PAS dans la liste : un anonyme ne
      // peut pas ordonner le rechargement des écrans de la ligne.
      expect(colonnes).not.toContain('recharger_demande_at');
      expect(colonnes).not.toContain('id');
      expect(colonnes).not.toContain('gare');
    });

    it(`${fichier} : l'ordre de rechargement est un horodatage, plus un booléen`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/recharger boolean/);
      expect(code).toMatch(/recharger_demande_at timestamptz/);
    });
  }
});

describe('Bucket medias : plus de lecture ouverte à tous', () => {
  for (const fichier of FICHIERS) {
    it(`${fichier} : la politique SELECT publique a disparu`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/create policy "medias lecture publique"/);
      expect(code).not.toMatch(
        /on storage\.objects for select\s*\n?\s*using \(bucket_id = 'medias'\)/,
      );
    });

    it(`${fichier} : la lecture restante est réservée à l'exploitation connectée`, () => {
      const code = instructions(sql(fichier));
      expect(code).toMatch(
        /create policy "medias lecture exploitation" on storage\.objects for select to authenticated/,
      );
    });
  }
});

describe('Le script de migration reste applicable sur une base en service', () => {
  const migration = sql('securite-advisors.sql');

  it('est transactionnel', () => {
    expect(migration).toMatch(/^begin;/m);
    expect(migration).toMatch(/^commit;/m);
  });

  it('supprime chaque politique avant de la recréer (rejouable)', () => {
    const code = instructions(migration);
    const recreees = [...code.matchAll(/create policy "([^"]+)" on (\S+)/g)].map(
      (m) => `${m[1]}|${m[2]}`,
    );
    const supprimees = new Set(
      [...code.matchAll(/drop policy if exists "([^"]+)" on (\S+);/g)].map(
        (m) => `${m[1]}|${m[2]}`,
      ),
    );
    expect(recreees.length).toBeGreaterThan(10);
    for (const p of recreees) expect(supprimees).toContain(p);
  });

  it('déplace le trigger sur la fonction privée', () => {
    const code = instructions(migration);
    expect(code).toMatch(/drop trigger if exists trg_sync_rame on circulations/);
    expect(code).toMatch(/execute function private\.sync_rame_descente\(\)/);
    // Les anciennes fonctions publiques sont retirées APRÈS les politiques
    const iPolitique = code.indexOf('drop policy if exists "exploitation" on jours');
    const iDrop = code.indexOf('drop function if exists public.role_courant()');
    expect(iPolitique).toBeGreaterThan(-1);
    expect(iDrop).toBeGreaterThan(iPolitique);
  });
});
