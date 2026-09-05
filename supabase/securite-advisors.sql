-- =============================================================================
-- TMB — Correctifs des Security Advisors Supabase (7 avertissements)
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service. Le script est
-- rejouable : chaque objet est supprimé puis recréé.
--
-- ⚠ ORDRE. Depuis le chantier « rôles multiples » (septembre 2026), les
--   politiques recréées ici s'appuient sur `private.a_le_role()` et
--   `private.a_un_des_roles()`. Ce script doit donc être exécuté APRÈS
--   `supabase/migrations/2026-09-roles-multiples.sql`, qui crée les tables
--   `roles` / `profils_roles` et ces fonctions. Sur une base NEUVE, il n'a
--   plus rien à corriger : `supabase/schema.sql` contient déjà l'intégralité
--   de ce qui suit (docs/mise-en-service.md §B).
--
-- Trois chantiers d'origine :
--   1. écriture anonyme sur `ecrans` : plus d'INSERT, UPDATE limité aux
--      colonnes du signal de vie par des GRANT de colonnes ;
--   2. lecture publique du bucket `medias` retirée de storage.objects ;
--   3. fonctions SECURITY DEFINER déplacées dans un schéma `private` NON
--      exposé par PostgREST, exécution publique révoquée.
--
-- ATTENTION À L'ORDRE INTERNE : les politiques RLS dépendent des fonctions
--   d'habilitation. On les supprime, on (re)déclare les fonctions, puis on les
--   recrée. Ne PAS se contenter de révoquer EXECUTE à `authenticated` : les
--   politiques sont évaluées AU NOM de l'utilisateur connecté, cela casserait
--   toutes les écritures.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Schéma privé, hors de portée de PostgREST
-- ---------------------------------------------------------------------------
-- PostgREST n'expose que les schémas de sa configuration (`public`) : une
-- fonction dans `private` n'est plus appelable en RPC depuis le front, tout
-- en restant utilisable par les politiques et les triggers.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Retrait des politiques à remplacer
-- ---------------------------------------------------------------------------
-- Les noms HISTORIQUES (modèle à rôle unique, jusqu'à août 2026) : ils n'ont
-- plus lieu d'exister, mais un `drop if exists` reste sans effet s'ils sont
-- déjà partis.
drop policy if exists "exploitation" on jours;
drop policy if exists "exploitation" on circulations;
drop policy if exists "exploitation" on medias;
drop policy if exists "messages tous roles" on messages;
drop policy if exists "admin" on machines;
drop policy if exists "admin" on motifs;
drop policy if exists "admin" on params;
drop policy if exists "affichage tous roles" on params;
drop policy if exists "params admin" on params;
drop policy if exists "lecture connectes" on modeles_messages;
drop policy if exists "admin" on modeles_messages;
drop policy if exists "lire son profil" on profils;
drop policy if exists "gerer profils" on profils;
drop policy if exists "oublier ecran" on ecrans;
drop policy if exists "journal insert" on publications;
drop policy if exists "journal select" on publications;
-- Écrans : les deux politiques anonymes larges disparaissent définitivement
drop policy if exists "heartbeat insert" on ecrans;
drop policy if exists "heartbeat update" on ecrans;
drop policy if exists "signal de vie" on ecrans;
drop policy if exists "declarer ecran" on ecrans;
drop policy if exists "commande ecran" on ecrans;
-- Storage
drop policy if exists "medias lecture publique" on storage.objects;
drop policy if exists "medias lecture exploitation" on storage.objects;
drop policy if exists "medias ecriture exploitation" on storage.objects;
drop policy if exists "medias suppression exploitation" on storage.objects;

-- …et les noms ACTUELS, pour que le script reste rejouable.
drop policy if exists "roles: jours ecriture" on jours;
drop policy if exists "roles: jours reinitialisation" on jours;
drop policy if exists "roles: jours reinitialisation retrait" on jours;
drop policy if exists "roles: circulations ecriture" on circulations;
drop policy if exists "roles: circulations regeneration" on circulations;
drop policy if exists "roles: medias" on medias;
drop policy if exists "roles: messages" on messages;
drop policy if exists "roles: machines" on machines;
drop policy if exists "roles: motifs" on motifs;
drop policy if exists "roles: params affichage" on params;
drop policy if exists "roles: params medias" on params;
drop policy if exists "roles: params exploitation" on params;
drop policy if exists "roles: params technique" on params;
drop policy if exists "roles: modeles lecture" on modeles_messages;
drop policy if exists "roles: modeles ecriture" on modeles_messages;
drop policy if exists "roles: profils lecture" on profils;
drop policy if exists "roles: profils creation" on profils;
drop policy if exists "roles: profils gestion" on profils;
drop policy if exists "roles: profils suppression" on profils;
drop policy if exists "roles: ecrans declarer" on ecrans;
drop policy if exists "roles: ecrans commander" on ecrans;
drop policy if exists "roles: ecrans oublier" on ecrans;
drop policy if exists "roles: publications ecriture" on publications;
drop policy if exists "roles: publications lecture" on publications;
drop policy if exists "roles: medias lecture" on storage.objects;
drop policy if exists "roles: medias ecriture" on storage.objects;
drop policy if exists "roles: medias suppression" on storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Fonctions SECURITY DEFINER dans `private`, search_path verrouillé
-- ---------------------------------------------------------------------------
-- search_path vide + noms pleinement qualifiés : plus aucune résolution de
-- nom ne dépend du search_path de l'appelant (advisor « Function Search Path
-- Mutable »).
--
-- Les fonctions d'HABILITATION (roles_courants, a_le_role, a_un_des_roles,
-- peut_attribuer, peut_gerer_profil, nb_detenteurs_actifs, email_appelant)
-- sont déclarées par `supabase/migrations/2026-09-roles-multiples.sql` et
-- reprises dans `supabase/schema.sql` : elles ne sont pas redéclarées ici, ce
-- qui éviterait toute divergence entre deux copies du même corps. Ce script
-- se contente de vérifier qu'elles sont là.
do $$
begin
  if to_regprocedure('private.a_le_role(text)') is null then
    raise exception 'Fonctions d''habilitation absentes.'
      using hint = 'Exécuter d''abord supabase/migrations/2026-09-roles-multiples.sql.';
  end if;
end $$;

create or replace function private.sync_rame_descente()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.sens = 'montee' then
    update public.circulations set rame = new.rame
      where date = new.date and numero = new.numero + 1 and rame is distinct from new.rame;
  end if;
  return new;
end $fn$;
revoke all on function private.sync_rame_descente() from public;
-- Aucun GRANT nécessaire : PostgreSQL vérifie EXECUTE d'une fonction de
-- trigger à la CRÉATION du trigger, pas à chaque déclenchement.

drop trigger if exists trg_sync_rame on circulations;
create trigger trg_sync_rame after insert or update of rame on circulations
  for each row execute function private.sync_rame_descente();

-- Les anciennes fonctions n'ont plus aucun dépendant : celle du schéma public
-- (avant août 2026) comme celle du modèle à rôle UNIQUE (avant septembre 2026).
drop function if exists public.sync_rame_descente();
drop function if exists public.role_courant();
drop function if exists private.role_courant();

-- ---------------------------------------------------------------------------
-- 4. Politiques recréées sur les rôles MULTIPLES
-- ---------------------------------------------------------------------------
-- Forme retenue : `(select private.a_le_role(…))`. L'enveloppe `(select …)`
-- fait évaluer la fonction une fois par requête et non une fois par ligne ; la
-- liste des rôles reste lisible telle quelle dans `pg_policies`.

-- L'exploitation écrit les journées et les circulations ; le technique n'a que
-- la RÉINITIALISATION (supprimer puis régénérer depuis la grille).
create policy "roles: jours ecriture" on jours for all to authenticated
  using ((select private.a_le_role('supervision')))
  with check ((select private.a_le_role('supervision')));
create policy "roles: jours reinitialisation" on jours for insert to authenticated
  with check ((select private.a_le_role('technique')));
create policy "roles: jours reinitialisation retrait" on jours for delete to authenticated
  using ((select private.a_le_role('technique')));

create policy "roles: circulations ecriture" on circulations for all to authenticated
  using ((select private.a_le_role('supervision')))
  with check ((select private.a_le_role('supervision')));
create policy "roles: circulations regeneration" on circulations for insert to authenticated
  with check ((select private.a_le_role('technique')));

create policy "roles: medias" on medias for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision'])))
  with check ((select private.a_un_des_roles(array['admin','supervision'])));

create policy "roles: messages" on messages for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['admin','supervision','caisse'])));

create policy "roles: machines" on machines for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));
create policy "roles: motifs" on motifs for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Params : quatre politiques permissives, une par jeu de clés. Les clés
-- inconnues ne sont ouvertes qu'au technique.
create policy "roles: params affichage" on params for all to authenticated
  using (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  )
  with check (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  );
create policy "roles: params medias" on params for all to authenticated
  using (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  )
  with check (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  );
create policy "roles: params exploitation" on params for all to authenticated
  using (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')))
  with check (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')));
create policy "roles: params technique" on params for all to authenticated
  using ((select private.a_le_role('technique')))
  with check ((select private.a_le_role('technique')));

create policy "roles: modeles lecture" on modeles_messages for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: modeles ecriture" on modeles_messages for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Comptes : chacun lit son profil ; ceux qui gèrent des comptes les lisent
-- tous. Renommer, activer, désactiver et supprimer suivent la règle STRICTE
-- (il faut pouvoir attribuer TOUS les rôles de la cible).
create policy "roles: profils lecture" on profils for select to authenticated
  using (user_id = auth.uid() or (select private.a_un_des_roles(array['technique','admin'])));
create policy "roles: profils creation" on profils for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin'])));
create policy "roles: profils gestion" on profils for update to authenticated
  using ((select private.peut_gerer_profil(user_id)))
  with check ((select private.peut_gerer_profil(user_id)));
create policy "roles: profils suppression" on profils for delete to authenticated
  using ((select private.peut_gerer_profil(user_id)));

create policy "roles: publications ecriture" on publications for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: publications lecture" on publications for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));

-- ---------------------------------------------------------------------------
-- 5. Table `ecrans` : plus d'INSERT anonyme, UPDATE limité par colonnes
-- ---------------------------------------------------------------------------
-- L'ordre de rechargement passe d'un booléen à un HORODATAGE. Un booléen
-- devait être remis à false par l'écran lui-même — écriture désormais
-- interdite à anon, ce qui l'aurait fait recharger EN BOUCLE. Avec un
-- horodatage, l'écran compare la demande à sa propre heure de chargement :
-- aucune écriture, aucune boucle.
alter table ecrans add column if not exists recharger_demande_at timestamptz;
alter table ecrans drop column if exists recharger;

-- Supabase accorde par défaut tous les droits de table à anon : on retire
-- tout, puis on ne rend QUE les colonnes du signal de vie.
revoke insert, update, delete, truncate on ecrans from anon;
grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau)
  on ecrans to anon;
grant select, insert, update, delete on ecrans to authenticated;

-- Signal de vie anonyme : autorisé au niveau LIGNE, verrouillé au niveau
-- COLONNE par le GRANT ci-dessus. `recharger_demande_at`, `id`, `gare` et
-- `type` sont hors d'atteinte d'un anonyme.
create policy "signal de vie" on ecrans for update to anon
  using (true) with check (true);

-- L'IDENTITÉ d'un poste (le déclarer, l'oublier) relève de l'informatique ; le
-- COMMANDER — recharger après une mise en ligne, régler sa veille un soir de
-- nocturne — relève de l'exploitation, qui ne doit jamais attendre le
-- prestataire. RLS ne sait pas quelles COLONNES changent : le déclencheur
-- `trg_roles_ecrans_identite` (schema.sql) empêche un superviseur de déplacer
-- un écran.
create policy "roles: ecrans declarer" on ecrans for insert to authenticated
  with check ((select private.a_le_role('technique')));
create policy "roles: ecrans commander" on ecrans for update to authenticated
  using ((select private.a_un_des_roles(array['technique','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','supervision'])));
create policy "roles: ecrans oublier" on ecrans for delete to authenticated
  using ((select private.a_le_role('technique')));

-- ---------------------------------------------------------------------------
-- 6. Bucket `medias` : plus de SELECT ouvert à tous sur storage.objects
-- ---------------------------------------------------------------------------
-- Le bucket reste `public` : les écrans affichent les médias par l'URL
-- publique (/storage/v1/object/public/...), qui ne passe pas par RLS. La
-- politique SELECT n'est donc plus nécessaire aux voyageurs — mais elle
-- l'est à l'exploitation, dont la suppression de fichier a besoin de voir
-- l'objet. On la RESTREINT au lieu de la retirer.
create policy "roles: medias lecture" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias ecriture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script, requête par requête.
-- =============================================================================
--
-- (a) Aucune fonction SECURITY DEFINER ne reste dans un schéma exposé :
--     select n.nspname, p.proname
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prosecdef;
--     -> 0 ligne attendue.
--
-- (b) Un anonyme ne peut plus déclarer d'écran :
--     set local role anon;
--     insert into ecrans (id, gare) values ('pirate-1', 'le-fayet');   -- refusé
--     reset role;
--
-- (c) Un anonyme ne peut pas commander un rechargement :
--     set local role anon;
--     update ecrans set recharger_demande_at = now();   -- permission denied (colonne)
--     reset role;
--
-- (d) Un anonyme PEUT donner signe de vie sur un écran DÉCLARÉ :
--     insert into ecrans (id, gare, type)
--       values ('le-fayet-ecran-1','le-fayet','ecran') on conflict (id) do nothing;
--     set local role anon;
--     update ecrans set derniere_vue = now() where id = 'le-fayet-ecran-1';  -- UPDATE 1
--     reset role;
--
-- (e) Plus aucune politique ne dépend de l'ancien rôle unique :
--     select count(*) from pg_policies
--      where coalesce(qual,'') like '%role_courant%'
--         or coalesce(with_check,'') like '%role_courant%';
--     -> 0 attendu.
--
-- (f) Les écritures fonctionnent toujours : se connecter à la supervision avec
--     un compte « supervision » et modifier un train — la modification doit
--     persister après rechargement. C'est le contrôle qui prouve que les GRANT
--     EXECUTE des fonctions d'habilitation sont bons. Puis un compte
--     « caisse » : onglet Bandeau fonctionnel, Circulations refusées.
--
-- (g) La matrice complète, cellule par cellule : supabase/tests/roles-rls.sql
