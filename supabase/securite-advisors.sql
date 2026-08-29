-- =============================================================================
-- TMB — Correctifs des Security Advisors Supabase (7 avertissements)
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service. Le script est
-- rejouable : chaque objet est supprimé puis recréé. Intégré à
-- supabase/schema.sql pour les nouvelles installations.
--
-- Trois chantiers :
--   1. écriture anonyme sur `ecrans` : plus d'INSERT, UPDATE limité aux
--      colonnes du signal de vie par des GRANT de colonnes ;
--   2. lecture publique du bucket `medias` retirée de storage.objects ;
--   3. fonctions SECURITY DEFINER déplacées dans un schéma `private` NON
--      exposé par PostgREST, exécution publique révoquée.
--
-- ATTENTION À L'ORDRE : les politiques RLS dépendent de role_courant(). On
--   les supprime, on déplace la fonction, puis on les recrée. Ne PAS se
--   contenter de révoquer EXECUTE à `authenticated` : les politiques sont
--   évaluées AU NOM de l'utilisateur connecté, cela casserait toutes les
--   écritures.
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
-- 2. Retrait des politiques qui référencent public.role_courant()
-- ---------------------------------------------------------------------------
drop policy if exists "exploitation" on jours;
drop policy if exists "exploitation" on circulations;
drop policy if exists "exploitation" on medias;
drop policy if exists "messages tous roles" on messages;
drop policy if exists "admin" on machines;
drop policy if exists "admin" on motifs;
drop policy if exists "admin" on params;
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
-- …et les trois qui les remplacent, pour que le script soit rejouable
drop policy if exists "signal de vie" on ecrans;
drop policy if exists "declarer ecran" on ecrans;
drop policy if exists "commande ecran" on ecrans;
-- Storage
drop policy if exists "medias lecture publique" on storage.objects;
drop policy if exists "medias lecture exploitation" on storage.objects;
drop policy if exists "medias ecriture exploitation" on storage.objects;
drop policy if exists "medias suppression exploitation" on storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Fonctions SECURITY DEFINER dans `private`, search_path verrouillé
-- ---------------------------------------------------------------------------
-- search_path vide + noms pleinement qualifiés : plus aucune résolution de
-- nom ne dépend du search_path de l'appelant (advisor « Function Search Path
-- Mutable »).
create or replace function private.role_courant()
returns text language sql stable security definer set search_path = '' as $fn$
  select role from public.profils where user_id = auth.uid() and actif
$fn$;
revoke all on function private.role_courant() from public;
-- INDISPENSABLE : les politiques évaluent cette fonction au nom de
-- l'utilisateur connecté. Sans ce GRANT, toute écriture est refusée.
grant execute on function private.role_courant() to authenticated;

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

-- Les anciennes fonctions publiques n'ont plus aucun dépendant.
drop function if exists public.sync_rame_descente();
drop function if exists public.role_courant();

-- ---------------------------------------------------------------------------
-- 4. Politiques recréées sur private.role_courant()
-- ---------------------------------------------------------------------------
create policy "exploitation" on jours for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));
create policy "exploitation" on circulations for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));
create policy "exploitation" on medias for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));

create policy "messages tous roles" on messages for all to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'))
  with check (private.role_courant() in ('admin','supervision','caisse'));

create policy "admin" on machines for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');
create policy "admin" on motifs for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');
create policy "admin" on params for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

create policy "lecture connectes" on modeles_messages for select to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'));
create policy "admin" on modeles_messages for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

create policy "lire son profil" on profils for select to authenticated
  using (user_id = auth.uid() or private.role_courant() = 'admin');
create policy "gerer profils" on profils for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

create policy "journal insert" on publications for insert to authenticated
  with check (private.role_courant() in ('admin','supervision','caisse'));
create policy "journal select" on publications for select to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'));

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

-- Déclaration préalable d'un poste : administrateur uniquement.
create policy "declarer ecran" on ecrans for insert to authenticated
  with check (private.role_courant() = 'admin');

-- Commandes à distance (rechargement) : exploitation authentifiée.
create policy "commande ecran" on ecrans for update to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));

create policy "oublier ecran" on ecrans for delete to authenticated
  using (private.role_courant() in ('admin','supervision'));

-- ---------------------------------------------------------------------------
-- 6. Bucket `medias` : plus de SELECT ouvert à tous sur storage.objects
-- ---------------------------------------------------------------------------
-- Le bucket reste `public` : les écrans affichent les médias par l'URL
-- publique (/storage/v1/object/public/...), qui ne passe pas par RLS. La
-- politique SELECT n'est donc plus nécessaire aux voyageurs — mais elle
-- l'est à l'exploitation, dont la suppression de fichier a besoin de voir
-- l'objet. On la RESTREINT au lieu de la retirer.
create policy "medias lecture exploitation" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));
create policy "medias ecriture exploitation" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));
create policy "medias suppression exploitation" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));

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
-- (e) Un compte admin écrit toujours : se connecter à la supervision et
--     modifier un train — la modification doit persister après rechargement.
--     C'est le contrôle qui prouve que le GRANT EXECUTE de l'étape 3 est bon.
--     Puis un compte « caisse » : onglet Messages fonctionnel, Circulations
--     refusées.
