// La frontière de sécurité est le SQL lui-même : on la teste donc sur le TEXTE
// des scripts — un `git revert` partiel ou un copier-coller d'ancienne
// politique doit faire rougir la suite. Les garanties RLS réelles se
// vérifient, elles, sur une base : supabase/tests/roles-rls.sql, et les blocs
// VÉRIFICATION à la fin de chaque script.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ATTRIBUABLE_PAR, LIBELLE_ROLE, ROLES, ROLES_PROTEGES } from '../core/roles';

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
      expect(code).toMatch(/revoke insert, update on profils from authenticated/);
      expect(code).toMatch(/grant update \(nom, actif\) on profils to authenticated/);
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
      expect(code).toMatch(
        /create policy "roles: ecrans commander"[\s\S]*?array\['technique','supervision'\]/,
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
