// La frontière de sécurité est le SQL lui-même : on la teste donc sur le TEXTE
// des scripts — un `git revert` partiel ou un copier-coller d'ancienne
// politique doit faire rougir la suite. Les garanties RLS réelles se
// vérifient, elles, sur une base : supabase/tests/roles-rls.sql, et les blocs
// VÉRIFICATION à la fin de chaque script.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ATTRIBUABLE_PAR,
  aLeDroit,
  LIBELLE_ROLE,
  ONGLETS,
  ONGLET_DE_SECOURS,
  ROLES,
  ROLES_PROTEGES,
  ROLES_QUI_ROUVRENT,
  plafondOnglets,
} from '../core/roles';
import { REF_PROJET_PRODUCTION } from './config';

function chemin(fichier: string): string {
  return fileURLToPath(new URL(`../../supabase/${fichier}`, import.meta.url));
}

function sql(fichier: string): string {
  // Fins de ligne normalisées : le dépôt mêle des fichiers écrits sous Windows
  // et sous Unix, et les expressions régulières ci-dessous raisonnent en « \n ».
  return readFileSync(chemin(fichier), 'utf-8').replace(/\r\n/g, '\n');
}

/** Retire les commentaires SQL : seules les instructions réelles comptent. */
function instructions(texte: string): string {
  return texte
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

/** TOUS les scripts du dépôt : aucun ne doit rester sur l'ancien modèle. */
function tousLesScripts(): string[] {
  const racine = readdirSync(chemin('.')).filter((f) => f.endsWith('.sql'));
  const migrations = readdirSync(chemin('migrations')).map((f) => `migrations/${f}`);
  const tests = readdirSync(chemin('tests')).map((f) => `tests/${f}`);
  return [...racine, ...migrations, ...tests];
}

const MIGRATION_ROLES = 'migrations/2026-09-roles-multiples.sql';
const NETTOYAGE_ROLES = 'migrations/2026-09-roles-multiples-nettoyage.sql';
const REMISE_A_ZERO = 'migrations/2026-09-roles-multiples-remise-a-zero.sql';

/** Scripts qui posent des politiques ou des fonctions d'habilitation. */
const FICHIERS = ['schema.sql', 'securite-advisors.sql', MIGRATION_ROLES];

describe('Fonctions SECURITY DEFINER hors de portée de PostgREST', () => {
  for (const fichier of FICHIERS) {
    it(`${fichier} : aucune fonction SECURITY DEFINER dans le schéma public`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/create (or replace )?function public\./);
      expect(code).toMatch(/create schema if not exists private/);
    });

    it(`${fichier} : search_path verrouillé sur chaque fonction`, () => {
      const code = instructions(sql(fichier));
      const fonctions = [...code.matchAll(/create or replace function [^\n]*\n?[^\n]*/g)].map(
        (m) => m[0],
      );
      expect(fonctions.length).toBeGreaterThan(0);
      for (const f of fonctions) expect(f).toMatch(/set search_path = ''/);
    });
  }
});

describe('L’ancien modèle à rôle UNIQUE a bien disparu', () => {
  for (const fichier of tousLesScripts()) {
    it(`${fichier} : plus aucune politique ne s’appuie sur role_courant()`, () => {
      const code = instructions(sql(fichier));
      // L'ancienne fonction ne peut plus être ni redéclarée, ni appelée par une
      // politique. Elle reste nommable pour être SUPPRIMÉE et pour que la
      // migration contrôle qu'il n'en reste rien.
      expect(code).not.toMatch(/create or replace function [^\n]*role_courant/);
      const lignesDePolitique = code
        .split('\n')
        .filter((l) => /create policy|using \(|with check \(/.test(l))
        // …sauf les requêtes de contrôle qui CHERCHENT ces politiques.
        .filter((l) => !l.includes("like '%role_courant%'"));
      for (const ligne of lignesDePolitique) expect(ligne).not.toContain('role_courant');
    });

    it(`${fichier} : les fonctions d’habilitation sont toujours qualifiées « private. »`, () => {
      const code = instructions(sql(fichier));
      // Un appel nu échouerait, le schéma `private` n'étant pas dans le
      // search_path : piège déjà rencontré avec ajout-modeles.sql.
      for (const nom of ['a_le_role', 'a_un_des_roles', 'roles_courants', 'peut_attribuer']) {
        const nus = [...code.matchAll(new RegExp(`(^|[^.\\w])${nom}\\s*\\(`, 'g'))];
        expect(nus).toEqual([]);
      }
    });
  }
});

describe('Les fonctions d’habilitation sont exécutables par les politiques', () => {
  for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
    it(`${fichier} : révoquées au public, accordées à authenticated`, () => {
      const code = instructions(sql(fichier));
      for (const signature of [
        'private\\.roles_courants\\(\\)',
        'private\\.a_le_role\\(text\\)',
        'private\\.a_un_des_roles\\(text\\[\\]\\)',
        'private\\.peut_attribuer\\(text\\)',
        'private\\.peut_gerer_profil\\(uuid\\)',
      ]) {
        expect(code).toMatch(new RegExp(`revoke all on function ${signature} from public`));
        // INDISPENSABLE : les politiques évaluent ces fonctions AU NOM de
        // l'utilisateur connecté — sans ce GRANT, toute écriture serait refusée.
        expect(code).toMatch(new RegExp(`grant execute on function ${signature} to authenticated`));
      }
      expect(code).toMatch(/grant usage on schema private to authenticated/);
    });
  }
});

describe('Les tables d’habilitation ne sont pas modifiables par l’API', () => {
  for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
    const code = instructions(sql(fichier));

    it(`${fichier} : RLS activée sur roles et profils_roles`, () => {
      expect(code).toMatch(/alter table roles enable row level security/);
      expect(code).toMatch(/alter table profils_roles enable row level security/);
    });

    it(`${fichier} : les droits par défaut de Supabase sont révoqués`, () => {
      // Supabase accorde TOUS les droits de table à anon/authenticated sur une
      // table neuve : sans ce revoke, n'importe quel compte connecté
      // réécrirait la matrice « qui attribue quoi » et s'habiliterait lui-même.
      expect(code).toMatch(/revoke all on roles from anon, authenticated/);
      expect(code).toMatch(/revoke all on profils_roles from anon, authenticated/);
    });

    it(`${fichier} : le catalogue des rôles est en LECTURE seule`, () => {
      expect(code).toMatch(/grant select on roles to authenticated/);
      expect(code).not.toMatch(/create policy [^\n]* on roles for (insert|update|delete|all)/);
      expect(code).not.toMatch(/grant (insert|update|delete)[^\n]* on roles to/);
    });

    it(`${fichier} : une attribution est IMMUABLE (jamais d’UPDATE)`, () => {
      // Retirer puis attribuer : deux gestes, deux contrôles, deux lignes de
      // journal. Un UPDATE échapperait au garde-fou du dernier détenteur.
      expect(code).toMatch(/grant select, delete on profils_roles to authenticated/);
      expect(code).toMatch(/grant insert \(user_id, role\) on profils_roles to authenticated/);
      expect(code).not.toMatch(/grant[^\n]*update[^\n]* on profils_roles to/);
    });

    it(`${fichier} : la colonne email et le miroir de rôle ne sont pas réécrivables`, () => {
      // L'adresse sert d'identité au journal et à l'amorçage de la migration.
      expect(code).toMatch(/revoke all on profils from anon, authenticated/);
      expect(code).toMatch(/grant update \(nom, actif\) on profils to authenticated/);
      expect(code).toMatch(
        /grant insert \(user_id, nom, email, actif\) on profils to authenticated/,
      );
    });

    it(`${fichier} : TRUNCATE n'est accordé sur aucune table d'habilitation`, () => {
      // C'est le SEUL ordre d'écriture que RLS ne filtre pas : tant qu'il est
      // accordé, aucune politique ne protège la table de son vidage.
      for (const table of ['profils', 'profils_roles', 'roles']) {
        const accords = [
          ...code.matchAll(new RegExp(`grant ([^;]*) on ${table} to ([^;]*);`, 'g')),
        ];
        for (const accord of accords) {
          expect(accord[1], `TRUNCATE accordé sur ${table}`).not.toMatch(/truncate|all/i);
        }
      }
    });
  }
});

describe('Attribution des rôles : aucune escalade possible', () => {
  for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
    const code = instructions(sql(fichier));

    it(`${fichier} : on n’attribue jamais un rôle à soi-même`, () => {
      const attribution = code.match(/create policy "roles: liaison attribution"[\s\S]*?;\n/)?.[0];
      expect(attribution).toBeDefined();
      expect(attribution).toMatch(/user_id <> auth\.uid\(\)/);
      expect(attribution).toMatch(/private\.peut_attribuer\(role\)/);
      // La source « entra » est réservée à la synchronisation SSO : un client
      // ne peut pas déguiser une attribution manuelle.
      expect(attribution).toMatch(/source = 'manuel'/);
    });

    it(`${fichier} : le retrait obéit aux mêmes règles que l’attribution`, () => {
      const retrait = code.match(/create policy "roles: liaison retrait"[\s\S]*?;\n/)?.[0];
      expect(retrait).toBeDefined();
      expect(retrait).toMatch(/user_id <> auth\.uid\(\)/);
      expect(retrait).toMatch(/private\.peut_attribuer\(role\)/);
    });

    it(`${fichier} : la matrice est REJOUÉE par un déclencheur, pas seulement par RLS`, () => {
      // RLS ne s'applique ni à service_role ni au propriétaire des tables :
      // une Edge Function compromise contournerait la politique, jamais le
      // déclencheur.
      expect(code).toMatch(/create trigger trg_roles_proteger before insert or update or delete/);
      expect(code).toMatch(/Personne ne modifie ses propres rôles/);
      expect(code).toMatch(/Attribution de rôle sans utilisateur connecté refusée/);
    });

    it(`${fichier} : gérer un compte exige d’attribuer TOUS ses rôles`, () => {
      const fonction = code.match(
        /create or replace function private\.peut_gerer_profil[\s\S]*?\$fn\$;/,
      )?.[0];
      expect(fonction).toBeDefined();
      expect(fonction).toMatch(/p_cible is distinct from auth\.uid\(\)/);
      expect(fonction).toMatch(/not exists/);
      expect(fonction).toMatch(/not private\.peut_attribuer\(pr\.role\)/);
    });
  }
});

describe('Garde-fou : il reste toujours un technique et un admin', () => {
  for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
    const code = instructions(sql(fichier));

    it(`${fichier} : déclencheur de contrainte différé sur les deux chemins`, () => {
      // Différé : « retirer le rôle à A puis le donner à B » reste possible en
      // une transaction. Sur `profils` : couvre la désactivation ET la cascade
      // déclenchée par la suppression d'un compte Auth (tableau de bord).
      expect(code).toMatch(
        /create constraint trigger trg_roles_quorum_liaison\s*\n\s*after delete on profils_roles\s*\n\s*deferrable initially deferred/,
      );
      expect(code).toMatch(
        /create constraint trigger trg_roles_quorum_profils\s*\n\s*after update or delete on profils\s*\n\s*deferrable initially deferred/,
      );
    });

    it(`${fichier} : verrou consultatif contre deux retraits concurrents`, () => {
      // Sans lui, deux transactions retirant chacune l'un des deux derniers
      // détenteurs réussiraient toutes les deux.
      expect(code).toMatch(/pg_advisory_xact_lock\(hashtext\('tmb\.quorum_roles'\)\)/);
    });

    it(`${fichier} : un compte banni ou supprimé ne tient pas lieu de détenteur`, () => {
      const fonction = code.match(/create or replace function private\.nb_detenteurs_actifs/);
      expect(fonction).toBeDefined();
      expect(code).toMatch(/banned_until/);
      expect(code).toMatch(/deleted_at/);
    });

    it(`${fichier} : TRUNCATE est refusé (il ne déclenche aucun trigger de ligne)`, () => {
      expect(code).toMatch(/create trigger trg_roles_pas_de_truncate before truncate/);
    });
  }
});

describe('Périmètre des rôles, tel que validé par l’exploitant', () => {
  for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
    const code = instructions(sql(fichier));

    it(`${fichier} : déclarer ou oublier un écran relève du technique`, () => {
      expect(code).toMatch(
        /create policy "roles: ecrans declarer" on ecrans for insert to authenticated\s*\n?\s*with check \(\(select private\.a_le_role\('technique'\)\)\)/,
      );
      expect(code).toMatch(
        /create policy "roles: ecrans oublier" on ecrans for delete to authenticated\s*\n?\s*using \(\(select private\.a_le_role\('technique'\)\)\)/,
      );
    });

    it(`${fichier} : recharger un écran reste ouvert à l’exploitation`, () => {
      // Le rituel de mise en ligne fait recharger les écrans depuis la
      // supervision : l'exploitation ne doit pas attendre l'informatique.
      // 06/09/2026 : la CAISSE aussi — l'agent est souvent seul en gare le
      // matin, et un écran resté en veille ne s'attrape pas par téléphone.
      expect(code).toMatch(
        /create policy "roles: ecrans commander"[\s\S]*?array\['technique','supervision','caisse'\]/,
      );
    });

    it(`${fichier} : les médias sont ouverts au guichet, FICHE ET FICHIER`, () => {
      // Les quatre politiques vont ENSEMBLE. Élargir la fiche sans le bucket
      // donne une interface qui promet ce que la base refuse ; élargir le
      // bucket sans le SELECT laisse la suppression échouer à mi-chemin, en
      // abandonnant un fichier orphelin.
      for (const politique of [
        'roles: medias',
        'roles: medias lecture',
        'roles: medias ecriture',
        'roles: medias suppression',
      ]) {
        const bloc = code.match(new RegExp(`create policy "${politique}"[\\s\\S]*?;`))?.[0];
        expect(bloc, `${politique} introuvable`).toBeDefined();
        expect(bloc).toContain("array['admin','supervision','caisse']");
      }
    });

    it(`${fichier} : le CYCLE des médias suit la même ouverture`, () => {
      // `mode_medias` et `duree_horaires_s` sont l'autre moitié du droit
      // `medias` du miroir TypeScript : les laisser en arrière ferait mentir
      // src/core/roles.ts.
      expect(code).toMatch(
        /create policy "roles: params medias"[\s\S]*?array\['admin','supervision','caisse'\]/,
      );
    });

    it(`${fichier} : les grilles sont partagées, jamais réservées au technique`, () => {
      expect(code).toMatch(
        /create policy "roles: grilles"[\s\S]*?array\['technique','admin','supervision'\]/,
      );
    });

    it(`${fichier} : la veille de nuit globale et les clés inconnues restent techniques`, () => {
      expect(code).toMatch(
        /create policy "roles: params technique" on params for all to authenticated\s*\n\s*using \(\(select private\.a_le_role\('technique'\)\)\)/,
      );
      // …et la caisse garde la météo et la vitesse du bandeau.
      expect(code).toMatch(
        /create policy "roles: params affichage"[\s\S]*?array\['admin','supervision','caisse'\]/,
      );
    });

    it(`${fichier} : les lignes de rôles du journal ne sont pas ouvertes à tous`, () => {
      const journal = code.match(/create policy "roles: journal lecture"[\s\S]*?;\n/)?.[0];
      expect(journal).toBeDefined();
      expect(journal).toMatch(/'profils', 'profils_roles', 'roles'/);
      expect(journal).toMatch(/array\['technique','admin'\]/);
    });
  }

  it('la purge du journal est refusée hors rôle technique', () => {
    for (const fichier of ['schema.sql', 'ajout-journal-exploitation.sql']) {
      const code = instructions(sql(fichier));
      const purge = code.match(
        /create or replace function private\.purge_journal_exploitation[\s\S]*?\$fn\$;/,
      )?.[0];
      expect(purge).toBeDefined();
      expect(purge).toMatch(/not private\.a_le_role\('technique'\)/);
    }
  });
});

describe('Table ecrans : plus d’écriture anonyme non restreinte', () => {
  for (const fichier of ['schema.sql', 'securite-advisors.sql']) {
    it(`${fichier} : aucune politique anonyme large ne subsiste`, () => {
      const code = instructions(sql(fichier));
      expect(code).not.toMatch(/create policy "heartbeat insert"/);
      expect(code).not.toMatch(/create policy "heartbeat update"/);
      // Un INSERT sans restriction de rôle est l'erreur exacte à ne pas refaire
      expect(code).not.toMatch(/create policy [^\n]* on ecrans for insert with check \(true\)/);
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

  it('déplacer un écran relève du technique, quelle que soit la politique UPDATE', () => {
    // RLS ne voit pas les COLONNES modifiées : sans ce déclencheur, un
    // superviseur autorisé à recharger pourrait aussi changer la gare.
    for (const fichier of ['schema.sql', MIGRATION_ROLES]) {
      const code = instructions(sql(fichier));
      expect(code).toMatch(/create trigger trg_roles_ecrans_identite before update of gare, type/);
    }
  });
});

describe('Bucket medias : plus de lecture ouverte à tous', () => {
  for (const fichier of ['schema.sql', 'securite-advisors.sql']) {
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
        /create policy "roles: medias lecture" on storage\.objects for select to authenticated/,
      );
    });
  }
});

describe('Les scripts restent applicables sur une base en service', () => {
  for (const fichier of [
    'securite-advisors.sql',
    'ajout-bandeau-veille.sql',
    'ajout-journal-exploitation.sql',
    'ajout-ciels.sql',
    'ajout-grilles.sql',
    'ajout-modeles.sql',
    MIGRATION_ROLES,
    NETTOYAGE_ROLES,
  ]) {
    it(`${fichier} : est transactionnel`, () => {
      // Une erreur en plein milieu ne doit jamais laisser une table sans
      // politique d'écriture.
      const code = sql(fichier);
      expect(code).toMatch(/^begin;/m);
      expect(code).toMatch(/^commit;/m);
    });
  }

  it('securite-advisors.sql supprime chaque politique avant de la recréer', () => {
    const code = instructions(sql('securite-advisors.sql'));
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

  it('la migration retire les anciennes politiques AVANT de supprimer leur fonction', () => {
    // Postgres refuserait le DROP FUNCTION tant qu'une politique en dépend —
    // et, transaction oblige, annulerait toute la migration.
    const code = instructions(sql(MIGRATION_ROLES));
    const iRetrait = code.indexOf("like '%role_courant%'");
    const iDrop = code.indexOf('drop function if exists private.role_courant()');
    expect(iRetrait).toBeGreaterThan(-1);
    expect(iDrop).toBeGreaterThan(iRetrait);
  });

  it('la migration s’annule si la base se retrouvait sans technique ou sans admin', () => {
    // Un simple NOTICE laisserait commiter une base que plus personne ne
    // pourrait débloquer : seul un technique attribue « technique ».
    const code = instructions(sql(MIGRATION_ROLES));
    expect(code).toMatch(
      /MIGRATION ANNULÉE : aucun compte actif ne porterait le rôle « technique »/,
    );
    expect(code).toMatch(/MIGRATION ANNULÉE : aucun compte actif ne porterait le rôle « admin »/);
  });

  it('la migration ne réattribue aucun rôle au rejeu', () => {
    // Sans ce garde, rejouer le script rendrait un rôle retiré depuis.
    const code = instructions(sql(MIGRATION_ROLES));
    expect(code).toMatch(/if exists \(select 1 from public\.profils_roles\) then/);
    expect(code).toMatch(/drop function if exists private\.role_courant\(\)/);
  });
});

describe('La migration absorbe un ÉTAT PARTIEL', () => {
  // Une exécution interrompue laisse des objets derrière elle. Un simple
  // `create table if not exists` ne rattrape PAS une table déjà présente au
  // schéma différent : il ne fait rien, et l'`insert` qui suit échoue sur une
  // colonne absente. C'est exactement ce qui s'est produit sur la base de test.
  const code = instructions(sql(MIGRATION_ROLES));

  it('chaque colonne du catalogue est alignée, pas seulement créée', () => {
    for (const colonne of ['libelle', 'protege', 'attribuable_par', 'ordre', 'groupe_entra']) {
      expect(code, `roles.${colonne} n’est pas alignée`).toMatch(
        new RegExp(`alter table roles add column if not exists ${colonne}\\b`),
      );
    }
  });

  it('chaque colonne de la table de liaison est alignée', () => {
    for (const colonne of ['source', 'attribue_le', 'attribue_par']) {
      expect(code, `profils_roles.${colonne} n’est pas alignée`).toMatch(
        new RegExp(`alter table profils_roles add column if not exists ${colonne}\\b`),
      );
    }
  });

  it('les clés et contraintes sont posées de façon rejouable', () => {
    // Une clé étrangère anonyme serait recréée à chaque passage ; une clé
    // primaire absente ferait échouer les `on conflict`.
    expect(code).toMatch(/where conrelid = 'public\.roles'::regclass and contype = 'p'/);
    expect(code).toMatch(/where conrelid = 'public\.profils_roles'::regclass and contype = 'p'/);
    for (const contrainte of [
      'profils_roles_source_check',
      'profils_roles_user_id_fkey',
      'profils_roles_role_fkey',
    ]) {
      expect(code).toMatch(new RegExp(`drop constraint if exists ${contrainte}`));
      expect(code).toMatch(new RegExp(`add constraint ${contrainte}`));
    }
  });

  it('les fonctions sont SUPPRIMÉES avant d’être recréées', () => {
    // `create or replace` refuse de changer un type de retour : une signature
    // laissée par une exécution antérieure bloquerait toute la migration.
    for (const signature of [
      'private\\.roles_courants\\(\\)',
      'private\\.a_le_role\\(text\\)',
      'private\\.a_un_des_roles\\(text\\[\\]\\)',
      'private\\.peut_attribuer\\(text\\)',
      'private\\.peut_gerer_profil\\(uuid\\)',
      'private\\.nb_detenteurs_actifs\\(text\\)',
      'private\\.email_appelant\\(\\)',
    ]) {
      expect(code).toMatch(new RegExp(`drop function if exists ${signature}`));
    }
  });

  it('les politiques sont retirées AVANT que les fonctions ne soient supprimées', () => {
    // Une politique dépend de la fonction qu'elle appelle : le DROP FUNCTION
    // échouerait, donc annulerait la transaction entière.
    const iRetraitPolitiques = code.indexOf("or policyname like 'roles: %'");
    const iDropFonctions = code.indexOf('drop function if exists private.roles_courants()');
    expect(iRetraitPolitiques).toBeGreaterThan(-1);
    expect(iDropFonctions).toBeGreaterThan(iRetraitPolitiques);
  });

  it('le retrait des politiques couvre AUSSI les fonctions du nouveau modèle', () => {
    // Sinon un rejeu buterait sur les politiques « roles: » déjà en place.
    for (const nom of ['a_le_role', 'a_un_des_roles', 'peut_gerer_profil', 'peut_attribuer']) {
      expect(code).toMatch(new RegExp(`like '%${nom}%'`));
    }
  });

  it('tout ce qui dépend de profils.role est conditionnel', () => {
    // Le script de nettoyage a pu retirer la colonne : la migration doit
    // rester rejouable après lui.
    const blocs = code.match(/column_name = 'role'/g) ?? [];
    expect(blocs.length).toBeGreaterThanOrEqual(3);
    expect(code).toMatch(/alter table profils add column if not exists email text/);
  });

  it('le contrôle final refuse de laisser une table sans politique d’écriture', () => {
    // Le dégât le plus probable d'une exécution interrompue.
    expect(code).toMatch(/table\(s\) sans politique d''écriture/);
    expect(code).toMatch(/p\.polcmd in \('a', 'w', 'd', '\*'\)/);
  });

  it('un catalogue contenant un rôle inconnu arrête la migration', () => {
    // Le garde-fou de quorum boucle sur les rôles protégés : un code fantôme
    // rendrait la base inutilisable.
    expect(code).toMatch(/la table roles contient des codes inconnus/);
  });

  it('l’amorçage du rôle technique se déclenche dès qu’aucun n’existe', () => {
    // Cas d'un état partiel : la reprise est sautée (liaison non vide), mais
    // il ne doit pas rester zéro technique — plus personne ne pourrait alors
    // en attribuer un.
    expect(code).toMatch(/if private\.nb_detenteurs_actifs\('technique'\) = 0 then/);
  });

  it('la recette RLS ne compte pas sur un rollback pour se nettoyer', () => {
    // L'éditeur SQL de Supabase valide les instructions une à une : un
    // `begin; … rollback;` n'y annule rien, et la recette laisserait ses six
    // comptes fictifs dans l'annuaire. Elle tient donc dans UN SEUL bloc `do`
    // — une instruction, donc une transaction — et se nettoie elle-même.
    const recette = instructions(sql('tests/roles-rls.sql'));
    expect(recette).not.toMatch(/^rollback;/m);
    expect(recette).not.toMatch(/^begin;/m);
    expect((recette.match(/^do \$\$/gm) ?? []).length).toBe(1);
    expect(recette).toMatch(/delete from auth\.users where id = any \(tous\)/);
    expect(recette).toMatch(/des comptes de test subsistent après nettoyage/);
  });

  it('aucune table TEMPORAIRE : l’éditeur SQL de Supabase ne les conserve pas', () => {
    // Constaté le 05/09/2026 : « relation tmb_amorcage does not exist ». Une
    // table temporaire créée par une instruction n'existe plus pour les
    // suivantes — c'est aussi ce qui explique qu'un premier essai ait laissé
    // des objets derrière lui malgré le begin/commit.
    expect(code).not.toMatch(/create temporary table/i);
  });

  it('le quorum est vérifié AVANT la moindre modification', () => {
    // L'éditeur validant les instructions une à une, un refus tardif
    // laisserait des tables créées et des politiques déjà retirées.
    const iPreControle = code.indexOf('MIGRATION REFUSÉE');
    const iPremiereCreation = code.indexOf('create table if not exists roles');
    const iRetraitPolitiques = code.indexOf("or policyname like 'roles: %'");
    expect(iPreControle).toBeGreaterThan(-1);
    expect(iPreControle).toBeLessThan(iPremiereCreation);
    expect(iPreControle).toBeLessThan(iRetraitPolitiques);
  });
});

describe('L’adresse d’amorçage ne figure qu’en des endroits cohérents', () => {
  // Elle apparaît dans la migration (pré-contrôle et amorçage) et dans le
  // diagnostic. Une divergence ferait passer le pré-contrôle puis échouer
  // l'amorçage — au pire moment, après les premières modifications.
  const ADRESSE = /'([\w.+-]+@[\w.-]+)'/;

  function adressesDe(fichier: string): string[] {
    return instructions(sql(fichier))
      .split('\n')
      .filter((l) => /email_technique text :=|email_attendu text :=/.test(l))
      .map((l) => l.match(ADRESSE)?.[1] ?? '')
      .filter(Boolean);
  }

  it('la migration en déclare exactement deux, identiques', () => {
    const adresses = adressesDe(MIGRATION_ROLES);
    expect(adresses).toHaveLength(2);
    expect(adresses[0]).toBe(adresses[1]);
  });

  it('le diagnostic annonce la MÊME adresse que la migration', () => {
    const [attendue] = adressesDe('diagnostic-roles.sql');
    expect(attendue).toBeDefined();
    expect(attendue).toBe(adressesDe(MIGRATION_ROLES)[0]);
  });
});

describe('Le script de remise à zéro ne s’exécute pas par mégarde', () => {
  const code = instructions(sql(REMISE_A_ZERO));

  it('exige une confirmation explicite', () => {
    expect(code).toMatch(/REMISE À ZÉRO REFUSÉE/);
    expect(code).toMatch(/current_setting\('tmb\.remise_a_zero', true\)/);
  });

  it('la ligne qui confirme reste COMMENTÉE dans le dépôt', () => {
    // Une instruction, pas une mention dans un message d'aide : on ne regarde
    // que les lignes qui COMMENCENT par l'ordre SQL.
    const instructionActive = sql(REMISE_A_ZERO)
      .split('\n')
      .map((l) => l.trim())
      .some((l) => l.startsWith('set local tmb.remise_a_zero'));
    expect(instructionActive).toBe(false);
  });

  it('rend au journal une fonction autonome du chantier', () => {
    // `tracer_ecriture` avait été réécrite pour appeler email_appelant(), que
    // ce script supprime : sans remise en état, toute écriture d'exploitation
    // tomberait en erreur. La version restaurée doit relire l'adresse dans
    // `profils`, comme avant le chantier.
    expect(code).toMatch(/create or replace function private\.tracer_ecriture\(\)/);
    const corps = code.match(
      /create or replace function private\.tracer_ecriture\(\)[\s\S]*?\$fn\$;/,
    )?.[0];
    expect(corps).toBeDefined();
    expect(corps).toMatch(/select p\.email into v_qui from public\.profils/);
    expect(corps).not.toMatch(/email_appelant/);
  });

  it('contrôle son propre résultat avant de commiter', () => {
    const iControle = code.indexOf('REMISE À ZÉRO INCOMPLÈTE');
    const iCommit = code.indexOf('\ncommit;');
    expect(iControle).toBeGreaterThan(-1);
    expect(iCommit).toBeGreaterThan(iControle);
  });

  it('la migration contrôle son propre résultat avant de commiter', () => {
    const code = instructions(sql(MIGRATION_ROLES));
    const iControle = code.indexOf('MIGRATION ANNULÉE : % politique(s) référencent encore');
    const iCommit = code.indexOf('\ncommit;');
    expect(iControle).toBeGreaterThan(-1);
    expect(iCommit).toBeGreaterThan(iControle);
  });

  it('les nouvelles politiques portent un préfixe distinct de l’ancien jeu', () => {
    // Un ancien script rejoué par mégarde ne doit rien pouvoir détruire : ses
    // `drop policy if exists` visent des noms qui n'existent plus.
    const code = instructions(sql(MIGRATION_ROLES));
    const creees = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(creees.length).toBeGreaterThan(10);
    for (const nom of creees) expect(nom.startsWith('roles: ')).toBe(true);
  });
});

describe('Le catalogue SQL et le miroir TypeScript disent la même chose', () => {
  // src/core/roles.ts n'est qu'un confort d'interface ; s'il divergeait du
  // catalogue, la supervision proposerait des gestes que la base refuse.
  const seed = instructions(sql(MIGRATION_ROLES)).match(
    /insert into roles \(code, libelle, protege, attribuable_par, ordre\) values([\s\S]*?)on conflict/,
  )?.[1];

  it('le seed est bien présent', () => {
    expect(seed).toBeDefined();
  });

  for (const role of ROLES) {
    it(`${role} : libellé, protection et attribution identiques des deux côtés`, () => {
      const ligne = (seed ?? '').split('\n').find((l) => l.includes(`'${role}'`));
      expect(ligne, `ligne du rôle ${role} absente du seed`).toBeDefined();
      expect(ligne).toContain(`'${LIBELLE_ROLE[role]}'`);
      expect(ligne).toContain(ROLES_PROTEGES.includes(role) ? 'true' : 'false');
      const attribuants = ATTRIBUABLE_PAR[role].map((r) => `'${r}'`).join(',');
      expect(ligne?.replace(/\s+/g, '')).toContain(`array[${attribuants}]`);
    });
  }

  it('aucun rôle du seed n’est absent du miroir', () => {
    const codes = [...(seed ?? '').matchAll(/\('([a-z]+)',/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual([...ROLES].sort());
  });
});

describe('Script de déploiement des Edge Functions', () => {
  const script = readFileSync(
    fileURLToPath(new URL('../../outils/deployer-edge-functions.ps1', import.meta.url)),
    'utf-8',
  ).replace(/\r\n/g, '\n');

  it('vise la production sur le ref que connaît le front, sans divergence possible', () => {
    // Deux endroits nomment la production : si l'un dérive, un déploiement
    // « en prod » partirait ailleurs sans que rien ne le signale.
    expect(script).toContain(`prod = '${REF_PROJET_PRODUCTION}'`);
  });

  it('passe TOUJOURS --project-ref, même si un projet est lié en cache', () => {
    // supabase/.temp/linked-project.json pointe sur la production : un
    // « functions deploy » sans ref explicite y partirait tout seul.
    const appels = script.match(/@\('functions', '(deploy|list)'[^\n]*/g) ?? [];
    expect(appels.length).toBeGreaterThan(0);
    // Chaque appel nomme le projet ; aucun ne s'en remet au projet lié.
    for (const appel of appels) expect(appel).toMatch(/'--project-ref', \$(ref|REFS\['test'\])/);

    const deploiement = script.match(/\$arguments = @\('functions', 'deploy'\)[^\n]*/)?.[0];
    expect(deploiement).toBeTruthy();
    expect(deploiement).toContain("'--project-ref', $ref");
  });

  it('n’accepte que « test » ou « prod », jamais un ref tapé à la main', () => {
    expect(script).toMatch(/\[ValidateSet\('test', 'prod'\)\]/);
    expect(script).toMatch(/\[ValidateSet\('test', 'prod'\)\]\s*\n\s*\[string\] \$Projet/);
  });

  it('exige une confirmation tapée avant tout envoi en production', () => {
    const gardeFou = script.indexOf("Read-Host 'Déploiement en PRODUCTION");
    const deploiement = script.indexOf("$arguments = @('functions', 'deploy')");
    expect(gardeFou).toBeGreaterThan(0);
    expect(gardeFou).toBeLessThan(deploiement);
    expect(script).toContain("-cne 'PRODUCTION'");
  });

  it('se passe de Docker', () => {
    expect(script).toContain("'--use-api'");
  });

  it('ne confond pas la sortie de la CLI avec son code de retour', () => {
    // Sans « | Out-Host », la sortie du programme part dans le flux de succès
    // de la fonction : elle disparaît de l'écran et se mêle au code de retour,
    // qui devient un tableau. « -ne 0 » sur ce tableau est toujours vrai, donc
    // tout appel RÉUSSI passait pour un échec — et le message d'erreur de la
    // CLI n'était jamais montré. Constaté sur un jeton pourtant valide.
    const corps = script.match(/function Invoquer-Cli \{[\s\S]*?\n\}/)?.[0];
    expect(corps).toBeTruthy();
    expect(corps).toContain('| Out-Host');
    expect(corps).toContain('return [int]$code');
  });

  it('ne met jamais le jeton sur une ligne de commande', () => {
    // Les lignes de commande sont lisibles par les autres processus du compte.
    // Le jeton ne voyage donc que par l'environnement du processus.
    expect(script).not.toMatch(/--token/);
    // Et on n'appelle pas « supabase login », qui exige un vrai terminal.
    expect(script).not.toMatch(/Arguments @\('login'/);
  });

  it('demande le jeton à la frappe invisible et l’efface de la mémoire', () => {
    expect(script).toContain('-AsSecureString');
    expect(script).toContain('ZeroFreeBSTR');
  });

  it('ne conserve le jeton que le temps du processus', () => {
    // SetEnvironmentVariable en portée User ou Machine l'écrirait dans le
    // registre : c'est à l'utilisateur de le décider, pas au script.
    expect(script).not.toMatch(/SetEnvironmentVariable/);
    // Et il ne part dans aucun fichier.
    expect(script).not.toMatch(/(Out-File|Set-Content|Add-Content)[^\n]*SUPABASE_ACCESS_TOKEN/);
  });

  it('n’affiche jamais la valeur du jeton', () => {
    // Nommer la variable est sans risque ; c'est sa VALEUR qui ne doit jamais
    // partir vers la sortie. On traque donc $env:SUPABASE_ACCESS_TOKEN, pas le
    // simple nom cité dans un mode opératoire.
    const lignes = script.split('\n').filter((l) => l.includes('$env:SUPABASE_ACCESS_TOKEN'));
    expect(lignes.length).toBeGreaterThan(0);
    for (const ligne of lignes) {
      const affichage = /Write-Host|Write-Output|Ecrire-(Ok|Info|Titre)/.test(ligne);
      expect(affichage, `le jeton ne doit pas s’afficher : ${ligne.trim()}`).toBe(false);
    }
  });

  it('refuse au lieu d’attendre quand le terminal ne sait pas lire une saisie', () => {
    // Sans cette garde, Read-Host sur une entrée redirigée fait attendre le
    // script indéfiniment — constaté.
    expect(script).toContain('[Console]::IsInputRedirected');
    expect(script).toContain('[Environment]::UserInteractive');
  });
});

describe('Lanceur .cmd : Windows refuse d’exécuter un .ps1 par défaut', () => {
  const chemin = fileURLToPath(
    new URL('../../outils/deployer-edge-functions.cmd', import.meta.url),
  );
  const brut = readFileSync(chemin, 'latin1');
  const lanceur = brut.replace(/\r\n/g, '\n');

  it('rouvre PowerShell avec l’autorisation, pour ce seul appel', () => {
    expect(lanceur).toContain('-ExecutionPolicy Bypass');
    // -File, pas -Command : un chemin contenant une espace resterait entier.
    expect(lanceur).toContain('-File "%~dp0deployer-edge-functions.ps1"');
    // %~dp0 : le lanceur marche depuis n’importe quel dossier courant.
    expect(lanceur).toContain('%~dp0');
  });

  it('transmet les paramètres et rend le code de sortie du script', () => {
    expect(lanceur).toMatch(/deployer-edge-functions\.ps1" %\*/);
    expect(lanceur).toContain('exit /b %ERRORLEVEL%');
  });

  it('ne modifie jamais la stratégie d’exécution du poste', () => {
    // Set-ExecutionPolicy changerait durablement un réglage de sécurité :
    // le lanceur se contente d’une dérogation limitée à son propre processus.
    expect(lanceur).not.toMatch(/Set-ExecutionPolicy/i);
    expect(lanceur).not.toMatch(/RemoteSigned|Unrestricted/i);
  });

  it('est écrit en fins de ligne Windows, seules lisibles par cmd.exe', () => {
    // Livré en LF, cmd.exe découpe mal les lignes et répond « 'm' n'est pas
    // reconnu » sur chaque commentaire rem.
    expect(brut).toContain('\r\n');
    expect(brut.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('reste en ASCII pur : la console cmd n’a pas la même page de codes', () => {
    for (const [i, c] of [...brut].entries()) {
      if (c.charCodeAt(0) > 127) {
        throw new Error(`caractère non ASCII en position ${i} : ${JSON.stringify(c)}`);
      }
    }
  });

  it('est le chemin indiqué par le script lui-même quand il refuse', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../../outils/deployer-edge-functions.ps1', import.meta.url)),
      'utf-8',
    );
    expect(script).toContain('deployer-edge-functions.cmd -Connexion');
  });
});

describe('Localisation de node : le terminal peut mentir sur LOCALAPPDATA', () => {
  const script = readFileSync(
    fileURLToPath(new URL('../../outils/deployer-edge-functions.ps1', import.meta.url)),
    'utf-8',
  ).replace(/\r\n/g, '\n');

  it('remonte au-dessus du dossier Packages, où un terminal empaqueté est enfermé', () => {
    // L'application Claude est un paquet MSIX : un terminal ouvert depuis elle
    // voit LOCALAPPDATA pointer sur …\Packages\<paquet>\LocalCache\Local, et
    // le dossier node paraît absent alors qu'il est un cran plus haut.
    expect(script).toContain(String.raw`IndexOf('\Packages\')`);
    expect(script).toContain('$r.Substring(0, $i)');
  });

  it('essaie plusieurs façons de nommer le même dossier', () => {
    expect(script).toContain('$env:LOCALAPPDATA');
    expect(script).toContain("[Environment]::GetFolderPath('LocalApplicationData')");
    expect(script).toContain(String.raw`Join-Path $env:USERPROFILE 'AppData\Local'`);
    expect(script).toContain(String.raw`C:\Users\$env:USERNAME`);
  });

  it('explore aussi les caches locaux des paquets Windows', () => {
    // Une application empaquetée qui installe dans …\AppData\Local voit son
    // écriture détournée vers …\Packages\<paquet>\LocalCache\Local. Vu du
    // dehors, le chemin ordinaire n'existe alors pas : node est déclaré
    // introuvable alors qu'il est bien installé. C'est le cas réel du poste.
    expect(script).toContain(String.raw`Join-Path $base 'Packages'`);
    expect(script).toContain(String.raw`Join-Path $paquet.FullName 'LocalCache\Local'`);
    // On ne retient qu'un cache qui porte vraiment node, sans quoi le
    // diagnostic se noierait sous des dizaines de chemins inutiles.
    expect(script).toMatch(/Test-Path -LiteralPath \(Join-Path \$cache 'nodejs-portable'\)/);
  });

  it('ne fige pas la version de node : elle changera', () => {
    expect(script).toContain("-Filter 'node-v*-win-x64'");
  });

  it('dit ce qu’il a essayé quand il ne trouve rien', () => {
    // Un « introuvable » sec n'apprend rien et coûte un aller-retour.
    expect(script).toContain('Emplacements essayés');
    expect(script).toContain('$script:Essais');
    expect(script).toContain('Ce que ce terminal résout');
  });

  it('laisse désigner le dossier à la main en dernier recours', () => {
    expect(script).toMatch(/\[string\] \$Node,/);
    expect(script).toContain('Trouver-Npx -Impose $Node');
  });
});

// ---------------------------------------------------------------------------
// C-01, seconde barrière — la forme des valeurs de `params`.
//
// La contrainte a été écrite dans une migration parce que la production
// existait déjà. Tant qu'elle n'est PAS aussi dans schema.sql, toute nouvelle
// installation repart sans elle : le trou se rouvre en silence, et personne ne
// le voit avant la prochaine injection.
// ---------------------------------------------------------------------------

describe('Contraintes de forme de `params` : schema.sql ne doit pas les perdre', () => {
  const MIGRATION_PARAMS = 'migrations/2026-08-params-forme.sql';
  const schema = instructions(sql('schema.sql'));
  const migration = instructions(sql(MIGRATION_PARAMS));

  /** Noms des contraintes réellement AJOUTÉES par un script. */
  function contraintesAjoutees(texte: string): string[] {
    return [...texte.matchAll(/add constraint (params_\w+)/g)].map((m) => m[1] as string).sort();
  }

  it('les six contraintes de la migration figurent toutes dans schema.sql', () => {
    const attendues = contraintesAjoutees(migration);
    expect(attendues.length).toBe(6);
    expect(contraintesAjoutees(schema)).toEqual(attendues);
  });

  it('chacune est précédée d’un `drop … if exists` : le fichier reste rejouable', () => {
    for (const nom of contraintesAjoutees(schema)) {
      expect(schema).toContain(`drop constraint if exists ${nom}`);
    }
  });

  it('la clé écrite par le rôle le MOINS privilégié est bornée', () => {
    // `caisse` écrit meteo_sommet et vitesse_ticker_px_s via l'API REST :
    // ce sont exactement les deux clés qu'un attaquant atteint en premier.
    expect(schema).toContain('params_meteo_sommet_forme');
    expect(schema).toContain('params_vitesse_ticker_forme');
    // Le type de `t` est vérifié avant tout cast : une chaîne HTML est refusée.
    expect(schema).toMatch(/jsonb_typeof\(valeur -> 't'\) = 'number'/);
  });

  it('les bornes de schema.sql sont celles de la migration, au chiffre près', () => {
    // Deux copies qui divergent, c'est une base neuve plus permissive que la
    // production — le pire des deux mondes.
    for (const borne of [
      'between -50 and 50',
      'between 3 and 60',
      'between 0 and 1800',
      'between 20 and 400',
    ]) {
      expect(migration).toContain(borne);
      expect(schema).toContain(borne);
    }
  });

  it('teste la PRÉSENCE des clés : un objet vide ne doit pas passer', () => {
    // Sans l'opérateur `?`, jsonb_typeof(NULL) vaut NULL, la contrainte n'est
    // ni vraie ni fausse, et PostgreSQL l'accepte : `{}` entrerait.
    for (const cle of ["valeur ? 't'", "valeur ? 'ciel_fr'", "valeur ? 'ciel_en'"]) {
      expect(schema).toContain(cle);
    }
  });

  it('`duree_cache_min` n’accepte pas 0 : il figerait l’écran en neutre', () => {
    // 0 rendrait tout écran définitivement neutre, en pleine exploitation.
    // Pour tester l'écran neutre en gare, `?cache=` est prévu pour cela.
    expect(schema).toMatch(/duree_cache_min[\s\S]{0,300}between 3 and 60/);
  });

  it('`duree_horaires_s` reste VOLONTAIREMENT libre', () => {
    // La supervision l'écrit sans bornage : une contrainte remonterait à
    // l'agent une erreur PostgreSQL brute au lieu d'un message clair.
    expect(schema).not.toContain('params_duree_horaires_s_forme');
  });

  it('les valeurs d’amorçage de seed.sql satisfont ces contraintes', () => {
    // Une base neuve doit s'installer d'un trait : un seed refusé par sa
    // propre contrainte ne se découvre qu'en installant.
    const seed = sql('seed.sql');
    expect(seed).toMatch(/'meteo_sommet',\s*'\{[^']*"t":\s*-?\d/);
    expect(seed).toMatch(/'meteo_sommet',\s*'\{[^']*"ciel_fr"/);
    expect(seed).toMatch(/'meteo_sommet',\s*'\{[^']*"ciel_en"/);
    expect(seed).toMatch(/'veille_nuit',\s*'\{[^']*"debut"[^']*"fin"/);
    for (const [cle, min, max] of [
      ['duree_cache_min', 3, 60],
      ['a_quai_origine_s', 0, 1800],
      ['vitesse_ticker_px_s', 20, 400],
    ] as const) {
      const valeur = new RegExp(`'${cle}',\\s*'(-?\\d+)'`).exec(seed)?.[1];
      expect(valeur, `${cle} absente de seed.sql`).toBeDefined();
      expect(Number(valeur)).toBeGreaterThanOrEqual(min);
      expect(Number(valeur)).toBeLessThanOrEqual(max);
    }
  });
});

// ---------------------------------------------------------------------------
// Élargissement du rôle `caisse` (06/09/2026) — médias et commande d'écran.
//
// Le piège de ce chantier n'était pas d'écrire la politique : c'était de
// découvrir que QUATRE scripts rejouables recréent les mêmes politiques. Un
// seul oublié, et rejouer securite-advisors.sql un jour d'audit annulerait
// l'élargissement sans un mot — la supervision continuerait d'afficher le
// bouton, et la base refuserait l'écriture.
// ---------------------------------------------------------------------------

const MIGRATION_CAISSE = 'migrations/2026-09-caisse-medias-ecrans.sql';

describe('Le rôle caisse est élargi PARTOUT, ou nulle part', () => {
  /** Tous les scripts qui recréent au moins une des six politiques visées. */
  const PORTEURS = [
    'schema.sql',
    'securite-advisors.sql',
    'ajout-bandeau-veille.sql',
    MIGRATION_ROLES,
    MIGRATION_CAISSE,
  ];

  /** Le bloc d'une politique nommée, du `create policy` au `;` qui le clôt. */
  function politique(fichier: string, nom: string): string | undefined {
    return instructions(sql(fichier)).match(new RegExp(`create policy "${nom}"[\\s\\S]*?;`))?.[0];
  }

  const ELARGIES = [
    ['roles: medias', "array['admin','supervision','caisse']"],
    ['roles: params medias', "array['admin','supervision','caisse']"],
    ['roles: medias lecture', "array['admin','supervision','caisse']"],
    ['roles: medias ecriture', "array['admin','supervision','caisse']"],
    ['roles: medias suppression', "array['admin','supervision','caisse']"],
    ['roles: ecrans commander', "array['technique','supervision','caisse']"],
  ] as const;

  for (const fichier of PORTEURS) {
    for (const [nom, attendu] of ELARGIES) {
      const bloc = politique(fichier, nom);
      // Chaque fichier ne porte pas toutes les politiques (ajout-bandeau-veille
      // n'en recrée qu'une) : on ne contrôle que celles qu'il contient — mais
      // celles-là doivent être à jour.
      if (!bloc) continue;
      it(`${fichier} : « ${nom} » inclut la caisse`, () => {
        expect(bloc).toContain(attendu);
      });
    }
  }

  it('au moins un script porte chacune des six politiques', () => {
    // Sans ce contrôle, une politique renommée disparaîtrait de la boucle
    // ci-dessus sans faire échouer un seul test : tous les blocs seraient
    // simplement « introuvables », donc ignorés.
    for (const [nom] of ELARGIES) {
      const porteurs = PORTEURS.filter((f) => politique(f, nom));
      expect(porteurs.length, `aucun script ne crée « ${nom} »`).toBeGreaterThan(0);
    }
  });

  it('les politiques HORS PÉRIMÈTRE n’ont pas suivi', () => {
    // Un élargissement se fait de proche en proche si personne ne regarde.
    const code = instructions(sql('schema.sql'));
    for (const nom of [
      'roles: circulations ecriture',
      'roles: jours ecriture',
      'roles: machines',
      'roles: motifs',
      'roles: ciels',
      'roles: modeles ecriture',
      'roles: params exploitation',
      'roles: params technique',
      'roles: ecrans declarer',
      'roles: ecrans oublier',
      'roles: profils creation',
      'roles: profils gestion',
      'roles: liaison attribution',
    ]) {
      const bloc = code.match(new RegExp(`create policy "${nom}"[\\s\\S]*?;`))?.[0];
      expect(bloc, `${nom} introuvable : ce contrôle ne contrôle plus rien`).toBeDefined();
      expect(bloc, `${nom} s’est ouverte à la caisse`).not.toContain('caisse');
    }
  });

  it('le déclencheur d’identité d’écran reste une LISTE BLANCHE d’un seul nom', () => {
    // Il exige POSITIVEMENT `technique` ; il n'énumère aucun rôle interdit.
    // C'est ce qui fait qu'élargir « roles: ecrans commander » ne peut pas
    // l'affaiblir. Le réécrire en liste de rôles refusés serait une
    // régression : le prochain rôle créé passerait à travers par défaut.
    const code = instructions(sql('schema.sql'));
    const fonction = code.match(
      /create or replace function private\.proteger_identite_ecran[\s\S]*?\$fn\$;/,
    )?.[0];
    expect(fonction).toBeDefined();
    expect(fonction).toMatch(/not private\.a_le_role\('technique'\)/);
    // Aucune énumération de rôles : ni tableau, ni mention d'un rôle précis.
    expect(fonction).not.toMatch(/a_un_des_roles/);
    expect(fonction).not.toContain("'caisse'");
    expect(fonction).not.toContain("'supervision'");
    // …et il reste bien posé, sur les deux colonnes d'identité.
    expect(code).toMatch(
      /create trigger trg_roles_ecrans_identite before update of gare, type on ecrans/,
    );
  });
});

describe(`${MIGRATION_CAISSE} : refuse de s’exécuter sur une base inconnue`, () => {
  const code = instructions(sql(MIGRATION_CAISSE));

  it('contrôle l’état de départ AVANT de créer quoi que ce soit', () => {
    // Une migration qui s'exécute sur une base qu'elle n'a pas comprise fait
    // plus de dégâts qu'une migration qui refuse.
    const verrou = code.indexOf('raise exception');
    const premiereCreation = code.indexOf('create policy');
    expect(verrou).toBeGreaterThan(-1);
    expect(verrou).toBeLessThan(premiereCreation);
  });

  it('exige les fonctions d’habilitation et le rôle caisse au catalogue', () => {
    expect(code).toContain("to_regprocedure('private.a_un_des_roles(text[])')");
    expect(code).toMatch(/from public\.roles where code = 'caisse'/);
  });

  it('est REJOUABLE : chaque politique est supprimée avant d’être recréée', () => {
    const creees = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1] as string);
    expect(creees).toHaveLength(6);
    for (const nom of creees) {
      expect(code).toContain(`drop policy if exists "${nom}"`);
    }
  });

  it('ne touche à AUCUNE politique hors périmètre', () => {
    const creees = new Set([...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]));
    const attendues = new Set(ELARGIES_ATTENDUES);
    expect([...creees].sort()).toEqual([...attendues].sort());
    // Ni la table `circulations`, ni les comptes n'apparaissent en écriture.
    expect(code).not.toMatch(/(drop|create) policy[^\n]*on (circulations|jours|profils)/);
  });

  it('la contre-vérification contrôle ses PROPRES noms de politiques', () => {
    // Un nom mal orthographié ne serait trouvé nulle part, la requête
    // renverrait zéro ligne, et l'absence de résultat se lirait comme un
    // succès. Un contrôle qui ne contrôle rien est pire que pas de contrôle.
    expect(code).toContain('INTROUVABLE');
    // Et les noms cités doivent exister pour de vrai dans schema.sql.
    const schema = instructions(sql('schema.sql'));
    const contre = code.slice(code.indexOf('with attendues(policyname)'));
    const cites = [...contre.matchAll(/\('(roles: [^']+)'\)/g)].map((m) => m[1] as string);
    expect(cites.length).toBeGreaterThan(10);
    for (const nom of cites) {
      expect(schema, `« ${nom} » n’existe pas dans schema.sql`).toContain(`create policy "${nom}"`);
    }
  });

  it('n’est pas présentée comme applicable sans vérification', () => {
    // L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No
    // rows returned » est le résultat NORMAL d'une migration réussie.
    expect(code + sql(MIGRATION_CAISSE)).toContain('Success. No rows returned');
    expect(sql(MIGRATION_CAISSE)).toMatch(/base de TEST/);
  });
});

/** Les six politiques que la migration a le droit de recréer, et rien d'autre. */
const ELARGIES_ATTENDUES = [
  'roles: medias',
  'roles: params medias',
  'roles: ecrans commander',
  'roles: medias lecture',
  'roles: medias ecriture',
  'roles: medias suppression',
];

// ---------------------------------------------------------------------------
// Onglets visibles par rôle (06/09/2026).
//
// Ce qui se joue ici : ce réglage ressemble à un mécanisme de permissions et
// n'en est pas un. Les tests ci-dessous verrouillent la différence des DEUX
// côtés — la table ne peut rien accorder, et elle ne peut enfermer personne.
// ---------------------------------------------------------------------------

const MIGRATION_ONGLETS = 'migrations/2026-09-onglets-par-role.sql';

describe('Table onglets_par_role : forme et droits', () => {
  for (const fichier of ['schema.sql', MIGRATION_ONGLETS]) {
    const code = instructions(sql(fichier));

    it(`${fichier} : table de LIAISON, une ligne par rôle × onglet`, () => {
      // Pas une colonne text[] : RLS s'évalue ligne à ligne, et le journal doit
      // recevoir une ligne par onglet accordé ou masqué.
      expect(code).toMatch(/create table if not exists onglets_par_role/);
      expect(code).toMatch(/primary key \(role, onglet\)/);
      expect(code).toMatch(/role text not null references roles\(code\)/);
      expect(code).not.toMatch(/onglets text\[\]/);
    });

    it(`${fichier} : les huit onglets sont énumérés par une CONTRAINTE`, () => {
      // Un onglet inconnu n'a aucun sens et ne doit pas pouvoir entrer.
      const contrainte = code.match(/check \(onglet in \(([\s\S]*?)\)\)/)?.[1] ?? '';
      for (const onglet of ONGLETS) expect(contrainte).toContain(`'${onglet}'`);
    });

    it(`${fichier} : RLS activée et droits par défaut RÉVOQUÉS`, () => {
      expect(code).toMatch(/alter table onglets_par_role enable row level security/);
      expect(code).toMatch(/revoke all on onglets_par_role from anon, authenticated/);
    });

    it(`${fichier} : pas d’UPDATE, et \`regle_par\` hors du GRANT d’INSERT`, () => {
      // Accorder et masquer sont deux gestes, deux lignes de journal. Et
      // l'auteur d'un réglage vient du jeton, jamais du client.
      expect(code).toMatch(/grant select, delete on onglets_par_role to authenticated/);
      expect(code).toMatch(/grant insert \(role, onglet\) on onglets_par_role to authenticated/);
      expect(code).not.toMatch(/grant[^\n]*update[^\n]* on onglets_par_role to/);
      expect(code).not.toMatch(/grant insert \([^)]*regle_par/);
    });

    it(`${fichier} : lecture ouverte, ÉCRITURE au seul rôle technique`, () => {
      expect(code).toMatch(
        /create policy "onglets: lecture" on onglets_par_role for select to authenticated\s*\n?\s*using \(true\)/,
      );
      for (const nom of ['onglets: reglage', 'onglets: masquage']) {
        const bloc = code.match(new RegExp(`create policy "${nom}"[\\s\\S]*?;`))?.[0];
        expect(bloc, `${nom} introuvable`).toBeDefined();
        expect(bloc).toContain("private.a_le_role('technique')");
      }
    });
  }
});

describe('onglets_par_role : les garde-fous d’enfermement', () => {
  for (const fichier of ['schema.sql', MIGRATION_ONGLETS]) {
    const code = instructions(sql(fichier));
    const quorum =
      code.match(
        /create or replace function private\.verifier_quorum_onglets[\s\S]*?\$fn\$;/,
      )?.[0] ?? '';

    it(`${fichier} : le quorum est DIFFÉRÉ et sérialisé par un verrou`, () => {
      // Différé : « masquer ici, accorder là » doit passer en une transaction.
      // Verrou : sans lui, deux transactions supprimant chacune l'un des deux
      // derniers accès réussiraient toutes les deux.
      expect(quorum).toContain('pg_advisory_xact_lock');
      expect(code).toMatch(
        /create constraint trigger trg_onglets_quorum[\s\S]*?deferrable initially deferred/,
      );
      // INSERT autant que DELETE : un réglage partiel enferme aussi.
      expect(code).toMatch(/trg_onglets_quorum\s*\n?\s*after insert or delete on onglets_par_role/);
    });

    it(`${fichier} : le rôle qui rouvre la porte est le MIROIR de roles.ts`, () => {
      // La base ne connaît pas la matrice droit × rôle : la liste y est écrite
      // en dur. Si elle diverge du miroir TypeScript, le garde-fou protège le
      // mauvais rôle — et personne ne s'en aperçoit avant l'enfermement.
      const liste = quorum.match(/rouvreurs constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? '';
      const codesSql = [...liste.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
      expect(codesSql).toEqual([...ROLES_QUI_ROUVRENT].sort());
    });

    it(`${fichier} : l’onglet protégé est le MIROIR de ONGLET_DE_SECOURS`, () => {
      expect(quorum).toContain(`onglet_secours constant text := '${ONGLET_DE_SECOURS}'`);
    });

    it(`${fichier} : un rôle SANS AUCUNE LIGNE ne déclenche pas le refus`, () => {
      // C'est le même repli que côté front : tout supprimer se soigne seul,
      // seul le réglage PARTIEL enferme. Sans ce `not exists`, une base fraîche
      // refuserait toute écriture.
      expect(quorum).toMatch(/not exists \([\s\S]{0,120}from public\.onglets_par_role/);
    });

    it(`${fichier} : le message de refus dit COMMENT s’en sortir`, () => {
      expect(quorum).toContain('hint =');
      expect(quorum).toMatch(/delete from onglets_par_role where role = ''technique''/);
    });

    it(`${fichier} : l’auteur du réglage vient du JETON`, () => {
      const marque =
        code.match(
          /create or replace function private\.marquer_reglage_onglet[\s\S]*?\$fn\$;/,
        )?.[0] ?? '';
      expect(marque).toContain('private.email_appelant()');
      expect(code).toMatch(/create trigger trg_onglets_auteur before insert on onglets_par_role/);
    });

    it(`${fichier} : TRUNCATE a son propre déclencheur`, () => {
      // Il ne déclenche aucun déclencheur de LIGNE : le journal ne verrait
      // rien passer.
      expect(code).toMatch(/trg_onglets_pas_de_truncate before truncate on onglets_par_role/);
    });

    it(`${fichier} : chaque réglage laisse une ligne de journal`, () => {
      expect(code).toMatch(
        /create trigger trg_journal_onglets\s*\n?\s*after insert or delete on onglets_par_role/,
      );
      expect(code).toMatch(/tracer_ecriture\('role,onglet', ''\)/);
    });
  }
});

describe('onglets_par_role : le seed est la PHOTOGRAPHIE de la matrice', () => {
  /** Lignes du seed, telles qu'écrites dans un script. */
  function seed(fichier: string): Set<string> {
    const bloc = instructions(sql(fichier)).match(
      /insert into onglets_par_role \(role, onglet\) values([\s\S]*?)on conflict/,
    )?.[1];
    expect(bloc, `seed introuvable dans ${fichier}`).toBeDefined();
    return new Set(
      [...(bloc ?? '').matchAll(/\('([a-z]+)', '([a-z]+)'\)/g)].map((m) => `${m[1]} ${m[2]}`),
    );
  }

  /** Ce que la matrice du code produit, moins la décision du lot 2. */
  const ATTENDU = new Set(
    ROLES.flatMap((r) =>
      plafondOnglets(r)
        .filter((o) => !(r === 'caisse' && o === 'horaires'))
        .map((o) => `${r} ${o}`),
    ),
  );

  for (const fichier of ['schema.sql', MIGRATION_ONGLETS]) {
    it(`${fichier} : le seed dit EXACTEMENT ce que la matrice produit aujourd’hui`, () => {
      // Le jour de la bascule ne doit rien changer pour personne — sauf pour
      // la caisse, et seulement sur Horaires. Un seed qui dériverait de la
      // matrice masquerait des onglets sans que personne l'ait décidé.
      expect([...seed(fichier)].sort()).toEqual([...ATTENDU].sort());
    });

    it(`${fichier} : le lot 2 est bien là — la caisse SANS Horaires`, () => {
      const lignes = seed(fichier);
      expect(lignes.has('caisse horaires')).toBe(false);
      expect(lignes.has('caisse bandeau')).toBe(true);
    });

    it(`${fichier} : le seed est REJOUABLE et n’écrase aucun réglage`, () => {
      // `do nothing`, jamais `do update` : rejouer le script ne doit pas
      // rendre un onglet que l'exploitant avait masqué depuis.
      const code = instructions(sql(fichier));
      expect(code).toMatch(
        /insert into onglets_par_role[\s\S]*?on conflict \(role, onglet\) do nothing/,
      );
      expect(code).not.toMatch(/insert into onglets_par_role[\s\S]*?on conflict[^;]*do update/);
    });
  }

  it('les deux scripts posent le MÊME seed', () => {
    expect([...seed('schema.sql')].sort()).toEqual([...seed(MIGRATION_ONGLETS)].sort());
  });

  it('le mock de démonstration montre la même chose que la production', () => {
    // Une démo qui montrerait Horaires à la caisse enseignerait un
    // comportement qui n'existe pas.
    const mock = readFileSync(
      fileURLToPath(new URL('./mock.ts', import.meta.url)),
      'utf-8',
    ).replace(/\r\n/g, '\n');
    expect(mock).toContain('ONGLETS_PAR_ROLE_DEMO');
    expect(mock).toMatch(/role === 'caisse' && o === 'horaires'/);
    // Calculé depuis `plafondOnglets`, jamais recopié à la main.
    expect(mock).toMatch(/ONGLETS_PAR_ROLE_DEMO[\s\S]{0,200}plafondOnglets\(role\)/);
  });
});

describe(`${MIGRATION_ONGLETS} : refuse de s’exécuter sur une base inconnue`, () => {
  const code = instructions(sql(MIGRATION_ONGLETS));

  it('contrôle l’état de départ AVANT de créer quoi que ce soit', () => {
    // Le piège du 05/09 : un `create ... if not exists` suivi d'un `insert`
    // qui suppose le schéma complet laisse la base à moitié migrée.
    const verrou = code.indexOf('raise exception');
    expect(verrou).toBeGreaterThan(-1);
    expect(verrou).toBeLessThan(code.indexOf('create table if not exists onglets_par_role'));
    expect(verrou).toBeLessThan(code.indexOf('insert into onglets_par_role'));
  });

  it('exige tout ce dont la suite dépend, pas seulement la table des rôles', () => {
    expect(code).toContain("to_regclass('public.roles')");
    // Les quatre codes : sans eux, le seed échoue sur sa clé étrangère.
    for (const role of ROLES) expect(code).toContain(`'${role}'`);
    // L'identité de l'auteur et le journal : sans eux, un réglage ne laisse
    // aucune trace, ce qui est justement ce qu'on veut éviter.
    expect(code).toContain("to_regprocedure('private.email_appelant()')");
    expect(code).toContain("to_regprocedure('private.tracer_ecriture()')");
    expect(code).toContain("to_regprocedure('private.interdire_truncate_roles()')");
  });

  it('dit que « Success. No rows returned » ne prouve rien', () => {
    const brut = sql(MIGRATION_ONGLETS);
    expect(brut).toContain('Success. No rows returned');
    expect(brut).toMatch(/base de TEST/);
  });

  it('fournit la porte de SECOURS en clair', () => {
    // Si quelqu'un s'enferme malgré tout (dépannage SQL, service_role), la
    // sortie doit être écrite noir sur blanc dans le fichier.
    expect(sql(MIGRATION_ONGLETS)).toMatch(
      /delete from onglets_par_role where role = 'technique';/,
    );
  });

  it('ne touche à AUCUNE autre table', () => {
    expect(code).not.toMatch(/create policy[^\n]*on (?!onglets_par_role)/);
    expect(code).not.toMatch(/alter table (?!onglets_par_role)/);
  });
});

// ---------------------------------------------------------------------------
// AFFLUENCE (10/09/2026) — le remplissage constaté au guichet.
//
// Ce qui se joue ici : la table existe PARCE QUE la caisse doit pouvoir y
// écrire sans toucher à `circulations`. Si sa politique se resserrait, la
// carte du guichet montrerait des boutons que la base refuse ; si elle
// s’élargissait au technique, on aurait déplacé la frontière sans le dire.
// Les deux copies — schema.sql pour une base neuve, la migration pour une
// base existante — doivent rester identiques.
// ---------------------------------------------------------------------------

const MIGRATION_AFFLUENCE = 'migrations/2026-09-affluence.sql';
const PORTEURS_AFFLUENCE = ['schema.sql', MIGRATION_AFFLUENCE];

describe('affluence — la table du guichet', () => {
  for (const fichier of PORTEURS_AFFLUENCE) {
    const code = instructions(sql(fichier));

    it(`${fichier} : l’écriture est ouverte à admin, supervision et caisse`, () => {
      const bloc = code.match(/create policy "roles: affluence"[\s\S]*?;/)?.[0];
      expect(bloc, 'politique « roles: affluence » absente').toBeDefined();
      // Les DEUX clauses, contrôlées SÉPARÉMENT. Elles ne font pas le même
      // travail : `with check` garde les INSERT, `using` garde ce qu'on peut
      // voir, modifier et supprimer. Une politique dont elles divergent
      // laisserait déclarer un train complet sans pouvoir le rouvrir à la
      // vente. Un simple `toContain` sur le bloc entier ne le voyait PAS —
      // la seconde clause suffisait à le satisfaire (trou trouvé en mutant
      // ce test le 10/09/2026).
      const using = /using \(\(select private\.a_un_des_roles\(([^)]*)\)/.exec(bloc ?? '')?.[1];
      const check = /with check \(\(select private\.a_un_des_roles\(([^)]*)\)/.exec(
        bloc ?? '',
      )?.[1];
      expect(using, 'clause `using` absente ou resserrée').toBe(
        "array['admin','supervision','caisse']",
      );
      expect(check, 'clause `with check` absente ou resserrée').toBe(
        "array['admin','supervision','caisse']",
      );
      // Le technique protège la base, il ne constate pas les ventes.
      expect(bloc).not.toContain('technique');
    });

    it(`${fichier} : les écrans lisent sans compte`, () => {
      expect(code).toMatch(
        /create policy "lecture publique" on affluence for select using \(true\)/,
      );
      expect(code).toMatch(/grant select on affluence to anon, authenticated/);
    });

    it(`${fichier} : RLS est ACTIVÉE — une politique sans elle ne filtre rien`, () => {
      expect(code).toMatch(/alter table affluence enable row level security/);
    });

    it(`${fichier} : la signature n’est accordée à personne`, () => {
      // `maj_par` est posée par déclencheur depuis le JETON. Accordée au
      // client, elle deviendrait une signature qu’on peut forger.
      expect(code).toMatch(/grant insert \(date, numero, niveau\) on affluence/);
      expect(code).toMatch(/grant update \(niveau\) on affluence/);
      expect(code).not.toMatch(/grant (insert|update)[^;]*maj_par/);
      expect(code).toMatch(/new\.maj_par := private\.email_appelant\(\)/);
    });

    it(`${fichier} : chaque écriture passe au journal d’exploitation`, () => {
      expect(code).toMatch(
        /create trigger trg_journal_affluence[\s\S]*?tracer_ecriture\('date,numero', 'date', 'niveau'\)/,
      );
    });

    it(`${fichier} : le niveau est BORNÉ en base, pas seulement dans le front`, () => {
      // Le front ignore un niveau inconnu ; la base, elle, le refuse.
      expect(code).toMatch(/check \(niveau in \('limite', 'complet'\)\)/);
    });

    it(`${fichier} : réinitialiser une journée efface son affluence`, () => {
      // Sans la cascade, un « complet » survivrait à la régénération et
      // affirmerait un fait que personne n’a constaté depuis.
      expect(code).toMatch(
        /foreign key \(date, numero\) references circulations \(date, numero\) on delete cascade/,
      );
    });

    it(`${fichier} : les écrans voient le changement en temps réel`, () => {
      expect(code).toMatch(/supabase_realtime add table[\s\S]{0,200}?affluence/);
    });
  }

  it('le miroir du front accorde exactement les mêmes rôles', () => {
    // Élargir `roles.ts` sans élargir le SQL donne le pire résultat
    // possible : l’interface affiche le bouton, la base refuse l’écriture.
    const bloc =
      instructions(sql('schema.sql')).match(/create policy "roles: affluence"[\s\S]*?;/)?.[0] ?? '';
    for (const role of ROLES) {
      const enBase = bloc.includes(`'${role}'`);
      expect(aLeDroit([role], 'affluence'), `${role} : front et base divergent`).toBe(enBase);
    }
  });

  it('la migration se dit rejouable et vise la base de TEST', () => {
    const brut = sql(MIGRATION_AFFLUENCE);
    expect(brut).toMatch(/[Rr]ejouable/);
    expect(brut).toMatch(/base de TEST/);
  });

  it('la migration ne touche à AUCUNE autre table', () => {
    const code = instructions(sql(MIGRATION_AFFLUENCE));
    expect(code).not.toMatch(/create policy[^\n]*on (?!affluence)/);
    expect(code).not.toMatch(/alter table (?!affluence)/);
    expect(code).not.toMatch(/create table[^\n]*(?!affluence)\bcirculations\b/);
  });
});
