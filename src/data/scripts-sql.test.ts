// Scripts d'AJOUT sur base existante (ajout-*.sql) : la frontière de sécurité
// est le SQL lui-même, on la teste donc sur le texte — comme securite.test.ts
// pour schema.sql. Un copier-coller d'une ancienne politique doit faire rougir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';

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

describe('Scripts d’ajout : politiques toujours qualifiées private., RLS activée', () => {
  for (const fichier of ['ajout-grilles.sql', 'ajout-ciels.sql']) {
    it(`${fichier}`, () => {
      const code = instructions(sql(fichier));
      expect([...code.matchAll(/(^|[^.\w])role_courant\s*\(/g)]).toEqual([]);
      expect(code).toMatch(/private\.role_courant\(\)/);
      expect(code).toMatch(/enable row level security/);
      // Rejouable : chaque politique est supprimée avant d'être recréée
      expect(code).toMatch(/drop policy if exists/);
      expect(code).toMatch(/create table if not exists/);
    });
  }
});

describe('ajout-grilles.sql : droits et contenu', () => {
  const code = instructions(sql('ajout-grilles.sql'));

  it('lecture publique (les écrans sont anonymes), écriture admin et supervision seulement', () => {
    expect(code).toMatch(/create policy "lecture publique" on grilles for select using \(true\)/);
    expect(code).toMatch(
      /create policy "exploitation" on grilles for all to authenticated\s*\n?\s*using \(private\.role_courant\(\) in \('admin','supervision'\)\)/,
    );
    expect(code).not.toMatch(/'caisse'/);
  });

  it('une version existante n’est jamais écrasée, et les deux grilles été 2026 sont insérées telles quelles', () => {
    expect(code.match(/on conflict \(version\) do nothing/g)).toHaveLength(2);
    for (const grille of [grandServiceJson, petitServiceJson]) {
      // Le JSON inséré est exactement celui du dépôt (comparaison structurelle).
      const debut = code.indexOf(`'${grille.version}'`);
      expect(debut).toBeGreaterThan(0);
      const bloc = code.slice(debut, code.indexOf('on conflict (version) do nothing', debut));
      const contenus = [...bloc.matchAll(/\$json\$(.*?)\$json\$::jsonb/g)].map((m) => m[1] ?? '');
      expect(contenus).toHaveLength(2); // périodes, puis contenu
      expect(JSON.parse(contenus[0] ?? '')).toEqual(grille.periodes);
      expect(JSON.parse(contenus[1] ?? '')).toEqual(grille);
    }
  });

  it('contrainte de forme sur le contenu et temps réel activé', () => {
    expect(code).toMatch(/grilles_contenu_forme check/);
    expect(code).toMatch(/\(contenu \? 'montees'\)/);
    expect(code).toMatch(/alter publication supabase_realtime add table grilles/);
  });
});
