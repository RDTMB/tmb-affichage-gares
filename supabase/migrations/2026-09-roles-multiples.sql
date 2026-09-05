-- =============================================================================
-- TMB — RÔLES MULTIPLES ET CUMULABLES (chantier « rôles multiples »)
-- À exécuter dans l'éditeur SQL, sur le projet de TEST d'abord, puis en
-- PRODUCTION **AVANT** la fusion de la pull request (docs/mise-en-service.md
-- §I).
--
-- AVANT DE LANCER : passer `supabase/diagnostic-roles.sql` (lecture seule) et
-- lire son VERDICT. Ce script sait repartir d'une base neuve comme d'un ÉTAT
-- PARTIEL laissé par une exécution interrompue ; si le diagnostic révèle des
-- objets étrangers au chantier, préférer `2026-09-roles-multiples-remise-a-zero.sql`
-- puis rejouer celui-ci.
--
-- POURQUOI. Le modèle à UN rôle par personne (colonne `profils.role`) ne sait
-- pas représenter le cumul de fonctions. Le chef d'exploitation est aussi,
-- temporairement, responsable informatique ; le prestataire informatique ne
-- sera PAS exploitant ; son successeur à l'exploitation ne sera PAS
-- informaticien. Une hiérarchie linéaire de rôles ne dit aucune de ces trois
-- situations.
--
-- LE MODÈLE. Quatre rôles NON hiérarchiques et CUMULABLES :
--   technique   — responsable informatique / prestataire : grilles horaires,
--                 identité des écrans, paramètres d'infrastructure, comptes
--                 techniques, purge du journal ;
--   admin       — chef d'exploitation : comptes d'exploitation, modèles de
--                 messages, médias, paramètres d'exploitation ;
--   supervision — exploitation courante : circulations, bandeau, publication ;
--   caisse      — bandeau voyageurs.
-- Un droit est accordé si AU MOINS UN rôle de la personne le donne (UNION).
-- Aucun rôle n'en implique un autre : « technique » ne donne pas
-- l'exploitation, et réciproquement.
--
-- CE QUI CHANGE DE PLACE. `private.role_courant()` (une valeur) disparaît au
-- profit de `private.roles_courants()` (un tableau) et de deux helpers,
-- `private.a_le_role(text)` et `private.a_un_des_roles(text[])`, utilisés dans
-- TOUTES les politiques : la règle reste lisible dans `pg_policies`.
--
-- CE QUI NE CHANGE PAS. La lecture publique des tables d'affichage (les écrans
-- lisent sans compte), le signal de vie anonyme borné par des GRANT de
-- colonnes, et le principe « la frontière réelle est RLS » (docs/securite.md).
--
-- IDEMPOTENCE — ce que ce script garantit, et comment.
--   Un simple `create table if not exists` NE SUFFIT PAS : si la table existe
--   déjà avec un schéma DIFFÉRENT (colonne manquante), il ne fait rien et
--   l'`insert` qui suit échoue. Chaque table est donc CRÉÉE **puis ALIGNÉE**
--   colonne par colonne et contrainte par contrainte. De même, les fonctions
--   sont SUPPRIMÉES avant d'être recréées (un `create or replace` refuse de
--   changer un type de retour), et cette suppression vient APRÈS le retrait
--   des politiques qui pourraient en dépendre.
--   Les rôles déjà attribués ne sont JAMAIS réattribués : la reprise depuis
--   l'ancienne colonne ne s'exécute que sur une table de liaison encore vide.
--
-- FENÊTRE DE DÉPLOIEMENT. Ce script tourne AVANT la fusion du code : l'ANCIEN
-- front doit continuer à connecter tout le monde. La colonne `profils.role`
-- est donc CONSERVÉE comme MIROIR en lecture seule, recalculé par déclencheur
-- depuis `profils_roles` ; plus personne ne peut l'écrire. Elle est supprimée
-- après la fusion par `2026-09-roles-multiples-nettoyage.sql`.
-- ⚠ Pendant cette fenêtre, la gestion des utilisateurs de l'ANCIEN front est
--   fermée (son écriture du rôle est refusée, bruyamment) et il ne faut créer
--   AUCUN compte « technique » seul.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Amorçage et contrôles préalables
-- ---------------------------------------------------------------------------
-- Adresse du compte Auth (pas celle de `profils`, qu'un administrateur peut
-- écrire : l'appariement doit reposer sur une donnée que seul le titulaire
-- contrôle). Sur un autre projet — base de test, reprise — remplacer cette
-- valeur AVANT d'exécuter le script.
create temporary table if not exists tmb_amorcage (email text primary key) on commit drop;
truncate tmb_amorcage;
insert into tmb_amorcage (email) values ('thomas.musset@tramwaydumontblanc.fr');

-- (a) La base doit être à jour de tous les scripts précédents
--     (docs/mise-en-service §B) : ce script recrée LEURS politiques. Sur une
--     base incomplète, mieux vaut un message clair qu'une erreur
--     « relation does not exist » en plein milieu.
do $$
declare
  manquantes text[];
begin
  select array_agg(t) into manquantes from unnest(array[
    'profils','jours','circulations','messages','medias','machines','motifs',
    'ciels','modeles_messages','params','ecrans','publications',
    'journal_exploitation','grilles'
  ]) t
   where to_regclass('public.' || t) is null;
  if manquantes is not null then
    raise exception 'MIGRATION ANNULÉE : table(s) absente(s) : %.', array_to_string(manquantes, ', ')
      using hint = 'Exécuter d''abord les scripts de docs/mise-en-service.md §B (schema.sql, securite-advisors.sql, ajout-*.sql).';
  end if;

  if to_regprocedure('private.tracer_ecriture()') is null then
    raise exception 'MIGRATION ANNULÉE : private.tracer_ecriture() est absente.'
      using hint = 'Exécuter d''abord supabase/ajout-journal-exploitation.sql.';
  end if;
end $$;

-- (b) Un catalogue `roles` laissé par une exécution antérieure ne doit pas
--     contenir de code inconnu : le garde-fou de quorum boucle dessus, et un
--     rôle « protégé » fantôme rendrait toute la base inutilisable.
do $$
declare
  intrus text[];
begin
  if to_regclass('public.roles') is not null then
    execute $q$
      select array_agg(code order by code) from public.roles
       where code not in ('technique','admin','supervision','caisse')
    $q$ into intrus;
    if intrus is not null then
      raise exception 'MIGRATION ANNULÉE : la table roles contient des codes inconnus (%).',
        array_to_string(intrus, ', ')
        using hint = 'Les retirer, ou repartir de supabase/migrations/2026-09-roles-multiples-remise-a-zero.sql.';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tables d'habilitation : créées PUIS alignées
-- ---------------------------------------------------------------------------
-- Le catalogue : la règle « qui attribue quoi » est une DONNÉE, lisible d'un
-- simple SELECT par l'exploitant comme par le prestataire, au lieu d'être
-- enfouie dans le corps d'une fonction.
create table if not exists roles (
  code text primary key,
  libelle text,
  protege boolean not null default false,
  attribuable_par text[],
  ordre int not null default 0,
  groupe_entra text
);

-- ALIGNEMENT : une table déjà présente peut avoir été créée par une version
-- antérieure du chantier, sans certaines colonnes. `add column if not exists`
-- ne touche à rien quand la colonne est déjà là.
alter table roles add column if not exists libelle text;
alter table roles add column if not exists protege boolean not null default false;
alter table roles add column if not exists attribuable_par text[];
alter table roles add column if not exists ordre int not null default 0;
alter table roles add column if not exists groupe_entra text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.roles'::regclass and contype = 'p'
  ) then
    alter table roles add primary key (code);
  end if;
end $$;

alter table roles enable row level security;
-- Supabase accorde par défaut TOUS les droits de table : on retire tout, puis
-- on ne rend que la lecture. Sans ce revoke, n'importe quel compte connecté
-- réécrirait la matrice et s'habiliterait lui-même.
revoke all on roles from anon, authenticated;
grant select on roles to authenticated;

-- Une ligne = une personne × un rôle. Table de LIAISON plutôt que colonne
-- `text[]` : RLS s'évalue LIGNE à ligne, donc « l'appelant peut-il attribuer
-- CE rôle ? » s'écrit directement dans la politique (`with check` à l'INSERT,
-- `using` au DELETE). Avec un tableau, la seule opération serait un UPDATE du
-- tableau entier, et `with check` ne voit jamais l'ancienne valeur : la règle
-- devrait quitter `pg_policies` pour un déclencheur. S'ajoutent la clé
-- étrangère vers le catalogue, une ligne de journal par rôle accordé ou
-- retiré, et les métadonnées PAR rôle dont la réconciliation SSO aura besoin.
create table if not exists profils_roles (
  user_id uuid not null,
  role text not null,
  source text not null default 'manuel',
  attribue_le timestamptz not null default now(),
  attribue_par text
);

alter table profils_roles add column if not exists source text not null default 'manuel';
alter table profils_roles add column if not exists attribue_le timestamptz not null default now();
alter table profils_roles add column if not exists attribue_par text;

alter table profils_roles drop constraint if exists profils_roles_source_check;
alter table profils_roles add constraint profils_roles_source_check
  check (source in ('manuel', 'entra'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profils_roles'::regclass and contype = 'p'
  ) then
    alter table profils_roles add primary key (user_id, role);
  end if;
end $$;

-- Clés étrangères NOMMÉES : sans nom explicite, un rejeu en créerait une
-- seconde à chaque passage.
alter table profils_roles drop constraint if exists profils_roles_user_id_fkey;
alter table profils_roles add constraint profils_roles_user_id_fkey
  foreign key (user_id) references profils(user_id) on delete cascade;
alter table profils_roles drop constraint if exists profils_roles_role_fkey;
alter table profils_roles add constraint profils_roles_role_fkey
  foreign key (role) references roles(code);

create index if not exists idx_profils_roles_role on profils_roles (role);

alter table profils_roles enable row level security;
revoke all on profils_roles from anon, authenticated;
-- Pas d'UPDATE : une attribution est IMMUABLE — on retire un rôle, on en
-- attribue un autre, et chacun des deux gestes passe par sa politique, son
-- garde-fou et son journal. Les autres colonnes (source, attribue_par) sont
-- posées par déclencheur, jamais par le client.
grant select, delete on profils_roles to authenticated;
grant insert (user_id, role) on profils_roles to authenticated;

-- Le catalogue, alimenté avant que quoi que ce soit ne s'y réfère.
insert into roles (code, libelle, protege, attribuable_par, ordre) values
  ('technique',   'Technique',      true,  array['technique'], 10),
  ('admin',       'Administrateur', true,  array['admin'],     20),
  ('supervision', 'Supervision',    false, array['admin'],     30),
  ('caisse',      'Caisse',         false, array['admin'],     40)
on conflict (code) do update set
  libelle = excluded.libelle,
  protege = excluded.protege,
  attribuable_par = excluded.attribuable_par,
  ordre = excluded.ordre;

-- Les colonnes essentielles ne peuvent plus être nulles, maintenant qu'elles
-- sont renseignées pour les quatre rôles.
alter table roles alter column libelle set not null;
alter table roles alter column attribuable_par set not null;

-- ---------------------------------------------------------------------------
-- 2. Retrait des politiques — AVANT de toucher aux fonctions
-- ---------------------------------------------------------------------------
-- L'ordre compte : une politique qui référence une fonction en dépend
-- (pg_depend), et le DROP FUNCTION de l'étape 3 échouerait — donc, transaction
-- oblige, annulerait toute la migration.
--
-- Suppression DYNAMIQUE plutôt qu'une liste écrite à la main : la production a
-- déjà connu des objets créés directement dans l'éditeur SQL (la table `ciels`
-- le 31/08/2026), et une exécution partielle a pu laisser des politiques
-- « roles: » à moitié posées.
do $$
declare
  pol record;
  n int := 0;
begin
  for pol in
    select schemaname, tablename, policyname
      from pg_policies
     where coalesce(qual, '') like '%role_courant%'
        or coalesce(with_check, '') like '%role_courant%'
        or coalesce(qual, '') like '%a_le_role%'
        or coalesce(with_check, '') like '%a_le_role%'
        or coalesce(qual, '') like '%a_un_des_roles%'
        or coalesce(with_check, '') like '%a_un_des_roles%'
        or coalesce(qual, '') like '%peut_gerer_profil%'
        or coalesce(with_check, '') like '%peut_gerer_profil%'
        or coalesce(qual, '') like '%peut_attribuer%'
        or coalesce(with_check, '') like '%peut_attribuer%'
        or policyname like 'roles: %'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
    raise notice 'Politique retirée : %.% → %', pol.schemaname, pol.tablename, pol.policyname;
    n := n + 1;
  end loop;
  raise notice '% politique(s) d''habilitation retirée(s) avant reconstruction.', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Fonctions d'habilitation (schéma `private`, hors de portée de PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- SUPPRIMÉES puis recréées : `create or replace` refuse de changer un type de
-- retour, et une exécution antérieure a pu laisser une signature différente.
drop function if exists private.roles_courants();
drop function if exists private.a_le_role(text);
drop function if exists private.a_un_des_roles(text[]);
drop function if exists private.peut_attribuer(text);
drop function if exists private.peut_gerer_profil(uuid);
drop function if exists private.nb_detenteurs_actifs(text);
drop function if exists private.email_appelant();

-- Rôles de l'appelant. Tableau VIDE si le profil est absent ou inactif : une
-- personne désactivée perd tout, immédiatement, sans autre réglage.
create or replace function private.roles_courants()
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(pr.role order by pr.role), array[]::text[])
    from public.profils_roles pr
    join public.profils p on p.user_id = pr.user_id
   where pr.user_id = auth.uid() and p.actif
$fn$;
revoke all on function private.roles_courants() from public;
-- INDISPENSABLE : les politiques l'évaluent au nom de l'utilisateur
-- connecté — sans ce GRANT, toute écriture serait refusée.
grant execute on function private.roles_courants() to authenticated;

create or replace function private.a_le_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_role = any (private.roles_courants())
$fn$;
revoke all on function private.a_le_role(text) from public;
grant execute on function private.a_le_role(text) to authenticated;

-- UNION : vrai dès qu'un seul des rôles demandés est détenu.
create or replace function private.a_un_des_roles(p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $fn$
  select private.roles_courants() && p_roles
$fn$;
revoke all on function private.a_un_des_roles(text[]) from public;
grant execute on function private.a_un_des_roles(text[]) to authenticated;

-- L'appelant peut-il accorder (ou retirer) CE rôle ? La règle vient du
-- catalogue : technique attribue technique, admin attribue les rôles
-- d'exploitation, personne d'autre n'attribue rien.
create or replace function private.peut_attribuer(p_role text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.roles r
     where r.code = p_role and private.roles_courants() && r.attribuable_par
  )
$fn$;
revoke all on function private.peut_attribuer(text) from public;
grant execute on function private.peut_attribuer(text) to authenticated;

-- Peut-on renommer, désactiver ou supprimer CE compte ? Règle STRICTE : il
-- faut pouvoir attribuer TOUS les rôles de la cible — un administrateur ne
-- touche donc pas au compte du prestataire informatique, et réciproquement.
-- Son PROPRE compte est toujours exclu : personne ne se modifie soi-même.
create or replace function private.peut_gerer_profil(p_cible uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_cible is distinct from auth.uid()
     and exists (select 1 from public.roles r where private.peut_attribuer(r.code))
     and not exists (
       select 1 from public.profils_roles pr
        where pr.user_id = p_cible and not private.peut_attribuer(pr.role)
     )
$fn$;
revoke all on function private.peut_gerer_profil(uuid) from public;
grant execute on function private.peut_gerer_profil(uuid) to authenticated;

-- Combien de comptes RÉELLEMENT utilisables portent ce rôle ? Un profil actif
-- dont le compte Auth est banni ou supprimé ne peut plus se connecter : le
-- compter satisferait l'invariant avec un fantôme. Les colonnes de auth.users
-- varient selon la version de GoTrue, d'où la construction dynamique.
do $$
declare
  filtre text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'banned_until') then
    filtre := filtre || ' and (u.banned_until is null or u.banned_until <= now())';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'deleted_at') then
    filtre := filtre || ' and u.deleted_at is null';
  end if;
  execute format($corps$
create or replace function private.nb_detenteurs_actifs(p_role text)
returns int language sql stable security definer set search_path = '' as $fn$
  select count(*)::int
    from public.profils_roles pr
    join public.profils p on p.user_id = pr.user_id
    join auth.users u on u.id = pr.user_id
   where pr.role = p_role and p.actif %s
$fn$;
  $corps$, filtre);
end $$;
revoke all on function private.nb_detenteurs_actifs(text) from public;
grant execute on function private.nb_detenteurs_actifs(text) to authenticated;

-- Adresse de l'agent connecté, telle qu'elle figure dans SON JETON : une
-- identité que personne ne peut réécrire dans `profils` pour se faire passer
-- pour un collègue au journal.
create or replace function private.email_appelant()
returns text language sql stable security definer set search_path = '' as $fn$
  select coalesce(
    -- Les revendications du jeton, lues directement plutôt que par auth.jwt() :
    -- même source, sans dépendre d'une fonction du schéma auth dont la
    -- présence varie selon la version de GoTrue.
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'email',
      ''
    ),
    (select p.email from public.profils p where p.user_id = auth.uid())
  )
$fn$;
revoke all on function private.email_appelant() from public;
grant execute on function private.email_appelant() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. `profils` : la colonne `role` devient un MIROIR en lecture seule
-- ---------------------------------------------------------------------------
-- Conditionnel : le script de nettoyage a pu retirer la colonne, et la
-- migration doit rester rejouable après lui.
alter table profils add column if not exists email text;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils' and column_name = 'role')
  then
    alter table profils alter column role drop not null;
    alter table profils alter column role drop default;
    alter table profils drop constraint if exists profils_role_check;
    raise notice 'Colonne profils.role conservée en miroir (fenêtre de déploiement).';
  else
    raise notice 'Colonne profils.role déjà retirée : rien à mettre en miroir.';
  end if;
end $$;

-- Plus personne n'écrit `role` ni `email` par l'API : le miroir est tenu par
-- un déclencheur, et l'adresse sert d'identité au journal comme à l'amorçage
-- (même technique de verrouillage par colonnes que `ecrans`).
revoke insert, update on profils from authenticated;
grant insert (user_id, nom, email, actif) on profils to authenticated;
grant update (nom, actif) on profils to authenticated;

-- ANON n'a RIEN à faire dans l'annuaire du personnel. Supabase lui accorde
-- pourtant, par défaut, tous les droits de table sur `public` — y compris
-- DELETE et TRUNCATE. RLS les refuse déjà (aucune politique ne vise `anon`
-- sur cette table), mais s'en remettre à une seule barrière quand la seconde
-- ne coûte qu'une ligne serait une négligence : c'est exactement le
-- raisonnement tenu pour `ecrans` dans securite-advisors.sql.
-- Constaté sur le projet de test le 05/09/2026 (diagnostic §8).
revoke all on profils from anon;

-- ---------------------------------------------------------------------------
-- 5. REPRISE de l'existant — une seule fois, jamais au rejeu
-- ---------------------------------------------------------------------------
-- Chaque personne conserve exactement son rôle actuel. Les administrateurs
-- reçoivent EN PLUS « supervision » : sans cela, le chef d'exploitation
-- perdrait l'onglet Circulations à la seconde même où ce script s'exécute, et
-- ne pourrait pas se le rendre (personne ne modifie ses propres rôles).
do $$
declare
  email_technique text;
  nb_technique int;
  nb_admin int;
  reprise_faite boolean := false;
begin
  select email into email_technique from tmb_amorcage limit 1;

  -- (a) Reprise depuis l'ancienne colonne : UNIQUEMENT si la table de liaison
  --     est encore vide. Un rejeu ne doit jamais rendre un rôle retiré depuis.
  if exists (select 1 from public.profils_roles) then
    raise notice 'Reprise ignorée : profils_roles contient déjà des lignes.';
  elsif exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profils' and column_name = 'role')
  then
    execute $q$
      insert into public.profils_roles (user_id, role, source, attribue_par)
        select p.user_id, p.role, 'manuel', 'migration 2026-09-roles-multiples'
          from public.profils p
         where p.role is not null and p.role in ('admin','supervision','caisse')
        on conflict do nothing
    $q$;
    execute $q$
      insert into public.profils_roles (user_id, role, source, attribue_par)
        select p.user_id, 'supervision', 'manuel', 'migration 2026-09-roles-multiples'
          from public.profils p
         where p.role = 'admin'
        on conflict do nothing
    $q$;
    reprise_faite := true;
    raise notice 'Reprise effectuée depuis profils.role (les administrateurs gardent l''exploitation).';
  else
    raise notice 'Aucune reprise possible : ni liaison peuplée, ni colonne profils.role.';
  end if;

  -- (b) AMORÇAGE du rôle technique. Il s'exécute dès qu'AUCUN compte technique
  --     actif n'existe — cas d'une base neuve comme d'un état partiel : sans
  --     technique, plus personne ne peut en attribuer un, la base serait
  --     définitivement bloquée. Il ne « rend » donc jamais un rôle retiré
  --     volontairement : tant qu'un technique subsiste, ce bloc ne fait rien.
  if private.nb_detenteurs_actifs('technique') = 0 then
    insert into public.profils_roles (user_id, role, source, attribue_par)
      select p.user_id, 'technique', 'manuel', 'migration 2026-09-roles-multiples'
        from public.profils p
        join auth.users u on u.id = p.user_id
       where lower(u.email) = lower(email_technique)
      on conflict do nothing;
    if found then
      raise notice 'Rôle « technique » attribué à %.', email_technique;
    else
      raise notice 'Compte d''amorçage « % » introuvable dans auth.users ∩ profils.', email_technique;
    end if;
  end if;

  -- (c) ASSERTION, dans la transaction : une base sans technique ni admin
  --     serait définitivement bloquée (seul un technique attribue technique).
  --     Le bloc VÉRIFICATION de fin de fichier ne remplace pas ce contrôle :
  --     il s'exécute APRÈS le commit, il constate au lieu d'empêcher.
  select private.nb_detenteurs_actifs('technique') into nb_technique;
  select private.nb_detenteurs_actifs('admin') into nb_admin;
  if nb_technique = 0 then
    raise exception 'MIGRATION ANNULÉE : aucun compte actif ne porterait le rôle « technique ».'
      using hint = 'Vérifier l''adresse du §0 : elle doit exister dans Authentication → Users ET dans profils. Sur un autre projet, la remplacer avant d''exécuter.';
  end if;
  if nb_admin = 0 then
    raise exception 'MIGRATION ANNULÉE : aucun compte actif ne porterait le rôle « admin ».'
      using hint = 'Créer d''abord un profil administrateur (docs/mise-en-service.md §C), puis relancer.';
  end if;
  raise notice 'Habilitations en place : % compte(s) technique, % compte(s) admin (reprise : %).',
    nb_technique, nb_admin, case when reprise_faite then 'oui' else 'non' end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Politiques rétablies sur les rôles multiples
-- ---------------------------------------------------------------------------
-- Forme retenue : `(select private.a_un_des_roles(array[...]))`. L'enveloppe
-- `(select …)` fait évaluer la fonction UNE fois par requête et non une fois
-- par ligne. La liste des rôles reste lisible telle quelle dans `pg_policies` :
-- un repreneur voit qui écrit, sans indirection.
--
-- Toutes portent le préfixe « roles: ». Un ancien script rejoué par mégarde ne
-- peut donc en supprimer aucune : ses `drop policy if exists` visent des noms
-- qui n'existent plus, et son `create policy` échoue bruyamment sur
-- `private.role_courant()`, supprimée à l'étape 7.

-- ── Journées et circulations ──────────────────────────────────────────────
-- L'exploitation écrit tout ; le technique n'a que la RÉINITIALISATION
-- (supprimer la journée puis la régénérer depuis la grille), jamais le droit
-- de modifier un statut, un retard ou un terminus.
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
-- Régénération après réinitialisation : la suppression, elle, passe par la
-- cascade de `jours`.
create policy "roles: circulations regeneration" on circulations for insert to authenticated
  with check ((select private.a_le_role('technique')));

create policy "roles: medias" on medias for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision'])))
  with check ((select private.a_un_des_roles(array['admin','supervision'])));

-- Bandeau voyageurs : la caisse le tient au quotidien et ne doit dépendre de
-- personne pour corriger un message ou une température.
create policy "roles: messages" on messages for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['admin','supervision','caisse'])));

-- Paramétrage d'exploitation : le chef d'exploitation.
create policy "roles: machines" on machines for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));
create policy "roles: motifs" on motifs for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));
create policy "roles: ciels" on ciels for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Params, clé par clé : quatre politiques PERMISSIVES qui se cumulent en OU.
-- Les clés inconnues ne sont ouvertes qu'au technique — une clé nouvelle est
-- un réglage d'infrastructure jusqu'à preuve du contraire.
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

-- Bibliothèque de messages : proposée à la saisie pour tous, administrée par
-- le chef d'exploitation.
create policy "roles: modeles lecture" on modeles_messages for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: modeles ecriture" on modeles_messages for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- ── Comptes et rôles ──────────────────────────────────────────────────────
-- Chacun lit son profil ; ceux qui gèrent des comptes les lisent tous.
create policy "roles: profils lecture" on profils for select to authenticated
  using (user_id = auth.uid() or (select private.a_un_des_roles(array['technique','admin'])));
-- Création : réservée à qui attribue au moins un rôle (l'invitation crée le
-- profil, puis les rôles).
create policy "roles: profils creation" on profils for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin'])));
-- Renommer, activer, désactiver : règle STRICTE (tous les rôles de la cible).
create policy "roles: profils gestion" on profils for update to authenticated
  using ((select private.peut_gerer_profil(user_id)))
  with check ((select private.peut_gerer_profil(user_id)));
create policy "roles: profils suppression" on profils for delete to authenticated
  using ((select private.peut_gerer_profil(user_id)));

-- Catalogue : lisible par tout compte connecté (l'interface a besoin des
-- libellés et de la matrice pour griser les cases), modifiable seulement
-- depuis l'éditeur SQL — aucune politique d'écriture, volontairement.
create policy "roles: catalogue lecture" on roles for select to authenticated using (true);

-- Les rôles d'un compte se voient dès qu'on voit le compte.
create policy "roles: liaison lecture" on profils_roles for select to authenticated
  using (user_id = auth.uid() or (select private.a_un_des_roles(array['technique','admin'])));
-- Attribuer : jamais à soi-même, et seulement un rôle que l'on est habilité à
-- donner. `source = 'manuel'` interdit de déguiser une attribution en SSO.
create policy "roles: liaison attribution" on profils_roles for insert to authenticated
  with check (
    user_id <> auth.uid()
    and source = 'manuel'
    and (select private.peut_attribuer(role))
  );
-- Retirer : mêmes conditions. Le retrait du DERNIER détenteur d'un rôle
-- protégé est refusé par le déclencheur de contrainte (§8).
create policy "roles: liaison retrait" on profils_roles for delete to authenticated
  using (
    user_id <> auth.uid()
    and source = 'manuel'
    and (select private.peut_attribuer(role))
  );

-- ── Écrans ────────────────────────────────────────────────────────────────
-- L'IDENTITÉ d'un poste (le déclarer, l'oublier) relève de l'informatique ;
-- le COMMANDER — recharger après une mise en ligne, régler sa veille un soir
-- de nocturne — relève de l'exploitation, qui ne doit jamais attendre le
-- prestataire. RLS ne sait pas quelles COLONNES changent : le déclencheur
-- `trg_roles_ecrans_identite` (§8) empêche un superviseur de déplacer un écran.
create policy "roles: ecrans declarer" on ecrans for insert to authenticated
  with check ((select private.a_le_role('technique')));
create policy "roles: ecrans commander" on ecrans for update to authenticated
  using ((select private.a_un_des_roles(array['technique','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','supervision'])));
create policy "roles: ecrans oublier" on ecrans for delete to authenticated
  using ((select private.a_le_role('technique')));

-- ── Grilles horaires ──────────────────────────────────────────────────────
-- Partagées : un horaire corrigé un matin de service ne doit pas attendre le
-- prestataire informatique.
create policy "roles: grilles" on grilles for all to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','admin','supervision'])));

-- ── Journal des publications ──────────────────────────────────────────────
create policy "roles: publications ecriture" on publications for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: publications lecture" on publications for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));

-- ── Journal d'exploitation ────────────────────────────────────────────────
-- Ouvert à tous… SAUF les lignes qui tracent les comptes et les rôles :
-- l'annuaire des habilitations ne regarde que ceux qui gèrent des comptes.
create policy "roles: journal lecture" on journal_exploitation for select to authenticated
  using (
    case
      when table_cible in ('profils', 'profils_roles', 'roles')
        then (select private.a_un_des_roles(array['technique','admin']))
      else (select private.a_un_des_roles(array['technique','admin','supervision','caisse']))
    end
  );

-- ── Médias stockés ────────────────────────────────────────────────────────
-- Le bucket reste public : les écrans passent par l'URL publique, hors RLS.
-- Ces politiques ne servent qu'à l'exploitation (voir un objet pour le
-- supprimer).
create policy "roles: medias lecture" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias ecriture" on storage.objects for insert to authenticated
  with check (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));

-- ---------------------------------------------------------------------------
-- 7. L'ancienne fonction disparaît — APRÈS les politiques qui en dépendaient
-- ---------------------------------------------------------------------------
-- Pas de « shim » de compatibilité : un ancien script rejoué par erreur doit
-- échouer BRUYAMMENT (« function private.role_courant() does not exist »)
-- plutôt que réinstaller en silence un modèle à rôle unique.
drop function if exists private.role_courant();

-- ---------------------------------------------------------------------------
-- 8. Garde-fous — EN BASE, jamais seulement dans l'interface
-- ---------------------------------------------------------------------------
-- Ces déclencheurs s'appliquent à TOUS les chemins : l'application, une Edge
-- Function à clé secrète, l'éditeur SQL et la cascade déclenchée par la
-- suppression d'un compte depuis le tableau de bord Supabase. RLS, elle, ne
-- s'applique ni à `service_role` ni au propriétaire des tables — c'est le même
-- principe que le journal d'exploitation : rien ne doit y échapper.

-- (a) Attribution : la matrice du catalogue est REJOUÉE ici, en plus de la
--     politique RLS.
create or replace function private.proteger_profils_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  cible uuid;
  role_vise text;
  contexte text := current_setting('tmb.attribution_systeme', true);
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une attribution de rôle est immuable : retirez le rôle, puis attribuez-le.'
      using errcode = 'check_violation';
  end if;
  -- NEW n'existe pas sur un DELETE (et OLD pas sur un INSERT) : y toucher
  -- lèverait « record new is not assigned yet ».
  if tg_op = 'DELETE' then
    cible := old.user_id;
    role_vise := old.role;
  else
    cible := new.user_id;
    role_vise := new.role;
  end if;

  if auth.uid() is null then
    -- Écriture « sans visage » : migration, synchronisation SSO, dépannage.
    -- Elle doit être REVENDIQUÉE, sinon une Edge Function compromise ou une
    -- fausse manœuvre en SQL passerait pour un geste légitime.
    if contexte is null or contexte not in ('migration', 'entra', 'secours') then
      raise exception 'Attribution de rôle sans utilisateur connecté refusée.'
        using errcode = 'check_violation',
              hint = 'Depuis l''éditeur SQL : set local tmb.attribution_systeme = ''secours''; (voir docs/securite.md §2)';
    end if;
    if tg_op = 'INSERT' then
      new.source := case when contexte = 'entra' then 'entra' else 'manuel' end;
      new.attribue_par := coalesce(new.attribue_par, 'script (' || contexte || ')');
      return new;
    end if;
    return old;
  end if;

  if cible = auth.uid() then
    raise exception 'Personne ne modifie ses propres rôles.'
      using errcode = 'check_violation';
  end if;
  if not private.peut_attribuer(role_vise) then
    raise exception 'Le rôle « % » ne fait pas partie de ceux que vous pouvez attribuer.', role_vise
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    new.source := 'manuel';
    new.attribue_par := private.email_appelant();
    return new;
  end if;
  return old;
end $fn$;
revoke all on function private.proteger_profils_roles() from public;

drop trigger if exists trg_roles_proteger on profils_roles;
create trigger trg_roles_proteger before insert or update or delete on profils_roles
  for each row execute function private.proteger_profils_roles();

-- TRUNCATE ne déclenche aucun déclencheur de LIGNE : il lui faut le sien.
create or replace function private.interdire_truncate_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  raise exception 'TRUNCATE interdit sur %.', tg_table_name using errcode = 'check_violation';
end $fn$;
revoke all on function private.interdire_truncate_roles() from public;

drop trigger if exists trg_roles_pas_de_truncate on profils_roles;
create trigger trg_roles_pas_de_truncate before truncate on profils_roles
  for each statement execute function private.interdire_truncate_roles();

-- (b) Quorum : il reste toujours au moins un compte actif « technique » et un
--     « admin ». Déclencheur de CONTRAINTE DIFFÉRÉ, vérifié à la fin de la
--     transaction : depuis l'éditeur SQL, « retirer le rôle à A puis le donner
--     à B » passe dans un même begin/commit. Depuis la supervision (une
--     transaction par requête), il faut DONNER d'abord, RETIRER ensuite — le
--     message le rappelle.
--     Le verrou consultatif sérialise deux retraits concurrents : sans lui,
--     deux transactions retirant chacune l'un des deux derniers détenteurs
--     réussiraient toutes les deux.
create or replace function private.verifier_quorum_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  r record;
begin
  -- Sur un UPDATE de `profils`, seule la DÉSACTIVATION touche au quorum. Le
  -- test est imbriqué : NEW n'existe pas sur un DELETE, et PL/pgSQL évalue
  -- l'expression entière avant de la court-circuiter.
  if tg_op = 'UPDATE' then
    if not (old.actif and not new.actif) then
      return null;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('tmb.quorum_roles'));

  for r in select code, libelle from public.roles where protege loop
    if private.nb_detenteurs_actifs(r.code) = 0 then
      raise exception 'Refusé : il doit toujours rester au moins un compte actif « % ».', r.libelle
        using errcode = 'check_violation',
              hint = 'Donnez d''abord ce rôle à un autre compte actif, puis recommencez.';
    end if;
  end loop;
  return null;
end $fn$;
revoke all on function private.verifier_quorum_roles() from public;

drop trigger if exists trg_roles_quorum_liaison on profils_roles;
create constraint trigger trg_roles_quorum_liaison
  after delete on profils_roles
  deferrable initially deferred
  for each row execute function private.verifier_quorum_roles();

-- Sur `profils` : couvre la désactivation, la suppression depuis l'interface,
-- ET la cascade déclenchée par `auth.users` (tableau de bord Supabase,
-- auth.admin.deleteUser) — la clé étrangère contourne RLS, jamais les
-- déclencheurs.
drop trigger if exists trg_roles_quorum_profils on profils;
create constraint trigger trg_roles_quorum_profils
  after update or delete on profils
  deferrable initially deferred
  for each row execute function private.verifier_quorum_roles();

-- (c) On ne se désactive pas soi-même (ceinture et bretelles : la politique
--     « roles: profils gestion » l'interdit déjà par peut_gerer_profil).
create or replace function private.interdire_auto_desactivation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is not null and new.user_id = auth.uid()
     and old.actif and not new.actif then
    raise exception 'Vous ne pouvez pas désactiver votre propre compte.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
revoke all on function private.interdire_auto_desactivation() from public;

drop trigger if exists trg_roles_auto_desactivation on profils;
create trigger trg_roles_auto_desactivation before update of actif on profils
  for each row when (old.actif is distinct from new.actif)
  execute function private.interdire_auto_desactivation();

-- (d) Identité d'un écran : la politique UPDATE ouvre la table au technique ET
--     à l'exploitation, mais RLS ne sait pas quelles COLONNES changent. Seul
--     le technique déplace un poste ou en change le type.
create or replace function private.proteger_identite_ecran()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (new.gare is distinct from old.gare or new.type is distinct from old.type)
     and auth.uid() is not null and not private.a_le_role('technique') then
    raise exception 'Changer la gare ou le type d''un écran relève du rôle technique.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $fn$;
revoke all on function private.proteger_identite_ecran() from public;

drop trigger if exists trg_roles_ecrans_identite on ecrans;
create trigger trg_roles_ecrans_identite before update of gare, type on ecrans
  for each row execute function private.proteger_identite_ecran();

-- ---------------------------------------------------------------------------
-- 9. Miroir `profils.role` et journal d'exploitation
-- ---------------------------------------------------------------------------
-- (a) Le miroir sert UNIQUEMENT à l'ancien front pendant la fenêtre de
--     déploiement : il n'ouvre aucun droit (les politiques lisent
--     `profils_roles`). Il ne prend que les trois valeurs que l'ancien code
--     sait afficher ; un compte « technique » seul y paraît « caisse », ce qui
--     lui montre une interface inoffensive dont chaque écriture est refusée.
--     Ce déclencheur et cette colonne disparaissent avec le script de
--     nettoyage, après la fusion.
create or replace function private.miroir_role_principal()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  cible uuid;
  principal text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profils'
                    and column_name = 'role') then
    return null;   -- colonne déjà retirée : plus rien à tenir à jour
  end if;
  -- NEW n'est pas assigné sur un DELETE : jamais de `case` mêlant les deux.
  if tg_op = 'DELETE' then cible := old.user_id; else cible := new.user_id; end if;
  select pr.role into principal
    from public.profils_roles pr
   where pr.user_id = cible and pr.role in ('admin','supervision','caisse')
   order by case pr.role when 'admin' then 1 when 'supervision' then 2 else 3 end
   limit 1;
  update public.profils set role = coalesce(principal, 'caisse')
   where user_id = cible and role is distinct from coalesce(principal, 'caisse');
  return null;
end $fn$;
revoke all on function private.miroir_role_principal() from public;

drop trigger if exists trg_roles_miroir on profils_roles;
create trigger trg_roles_miroir after insert or delete on profils_roles
  for each row execute function private.miroir_role_principal();

-- Alignement immédiat du miroir, seulement si la colonne existe encore.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils' and column_name = 'role')
  then
    execute $q$
      update public.profils p set role = coalesce((
        select pr.role from public.profils_roles pr
         where pr.user_id = p.user_id and pr.role in ('admin','supervision','caisse')
         order by case pr.role when 'admin' then 1 when 'supervision' then 2 else 3 end
         limit 1
      ), 'caisse')
      where role is distinct from coalesce((
        select pr.role from public.profils_roles pr
         where pr.user_id = p.user_id and pr.role in ('admin','supervision','caisse')
         order by case pr.role when 'admin' then 1 when 'supervision' then 2 else 3 end
         limit 1
      ), 'caisse')
    $q$;
  end if;
end $$;

-- (b) Journal : une ligne par rôle accordé ou retiré, avec l'adresse de la
--     PERSONNE CONCERNÉE en clé — un uuid ne dirait rien à l'exploitant.
create or replace function private.tracer_role()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  cible uuid;
  email_cible text;
  suffixe text := '';
  auteur text;
  role_retire text;
  role_accorde text;
begin
  -- NEW n'est pas assigné sur un DELETE, OLD ne l'est pas sur un INSERT.
  if tg_op = 'DELETE' then
    cible := old.user_id;
    role_retire := old.role;
    auteur := coalesce(private.email_appelant(), 'script');
    if old.source = 'entra' then suffixe := ' (SSO)'; end if;
  else
    cible := new.user_id;
    role_accorde := new.role;
    auteur := coalesce(private.email_appelant(), new.attribue_par, 'script');
    if new.source = 'entra' then suffixe := ' (SSO)'; end if;
  end if;

  select p.email into email_cible from public.profils p where p.user_id = cible;
  insert into public.journal_exploitation (qui, table_cible, cle, champ, avant, apres)
  values (auteur, 'profils_roles', coalesce(email_cible, cible::text),
          'role' || suffixe, role_retire, role_accorde);
  return null;
end $fn$;
revoke all on function private.tracer_role() from public;

drop trigger if exists trg_journal_profils_roles on profils_roles;
create trigger trg_journal_profils_roles after insert or delete on profils_roles
  for each row execute function private.tracer_role();

-- Comptes : nom et activation. La colonne `role` n'est PAS tracée — elle
-- n'est plus qu'un reflet, et chaque changement réel est déjà consigné
-- ci-dessus.
drop trigger if exists trg_journal_profils on profils;
create trigger trg_journal_profils
  after insert or delete or update of nom, actif on profils
  for each row execute function private.tracer_ecriture('email', '', 'nom', 'actif');

-- L'auteur d'une écriture vient désormais du JETON de l'appelant : l'adresse
-- inscrite dans `profils` ne peut plus servir à imputer un geste à un
-- collègue. Repli sur `profils` quand il n'y a pas de jeton (déclencheur
-- lancé par un script).
create or replace function private.tracer_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  avant_json jsonb;
  apres_json jsonb;
  colonne text;
  colonnes text[];
  v_avant text;
  v_apres text;
  v_cle text;
  v_date date;
  v_qui text;
begin
  avant_json := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  apres_json := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;

  v_cle := coalesce(
    (case when tg_op = 'DELETE' then avant_json else apres_json end) ->> tg_argv[0],
    '?'
  );
  if position(',' in tg_argv[0]) > 0 then
    v_cle := '';
    foreach colonne in array string_to_array(tg_argv[0], ',') loop
      v_cle := v_cle
        || case when v_cle = '' then '' else ' ' end
        || coalesce((case when tg_op = 'DELETE' then avant_json else apres_json end) ->> colonne, '?');
    end loop;
  end if;

  if tg_argv[1] <> '' then
    v_date := ((case when tg_op = 'DELETE' then avant_json else apres_json end) ->> tg_argv[1])::date;
  end if;

  v_qui := private.email_appelant();

  if array_length(tg_argv, 1) > 2 then
    colonnes := tg_argv[2:array_length(tg_argv, 1) - 1];
  else
    colonnes := array(
      select k from jsonb_object_keys(apres_json || avant_json) k
      where k not in ('id', 'maj')
    );
  end if;

  foreach colonne in array colonnes loop
    v_avant := avant_json ->> colonne;
    v_apres := apres_json ->> colonne;
    if v_avant is not distinct from v_apres then
      continue;
    end if;

    if jsonb_typeof(avant_json -> colonne) = 'object'
       or jsonb_typeof(apres_json -> colonne) = 'object' then
      declare
        sous_cle text;
        a_sous text;
        b_sous text;
      begin
        foreach sous_cle in array array(
          select k from jsonb_object_keys(
            (case when jsonb_typeof(apres_json -> colonne) = 'object'
                  then apres_json -> colonne else '{}'::jsonb end)
            ||
            (case when jsonb_typeof(avant_json -> colonne) = 'object'
                  then avant_json -> colonne else '{}'::jsonb end)
          ) k
        ) loop
          a_sous := avant_json -> colonne ->> sous_cle;
          b_sous := apres_json -> colonne ->> sous_cle;
          if a_sous is distinct from b_sous then
            insert into public.journal_exploitation
              (qui, table_cible, cle, champ, avant, apres, date_service)
            values (v_qui, tg_table_name, v_cle, sous_cle, a_sous, b_sous, v_date);
          end if;
        end loop;
      end;
    else
      insert into public.journal_exploitation
        (qui, table_cible, cle, champ, avant, apres, date_service)
      values (v_qui, tg_table_name, v_cle, colonne, v_avant, v_apres, v_date);
    end if;
  end loop;

  return null;
end $fn$;
revoke all on function private.tracer_ecriture() from public;

-- ---------------------------------------------------------------------------
-- 10. Purge du journal : réservée au rôle technique
-- ---------------------------------------------------------------------------
-- Le GRANT EXECUTE reste ouvert à `authenticated` (la fonction s'évalue au nom
-- de l'appelant), mais elle refuse désormais tout appelant qui n'est pas
-- technique : effacer douze mois de traces n'est pas un geste d'exploitation.
create or replace function private.purge_journal_exploitation(mois int default 12)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  supprimees bigint;
begin
  if auth.uid() is not null and not private.a_le_role('technique') then
    raise exception 'La purge du journal est réservée au rôle technique.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.journal_exploitation
    where quand < now() - make_interval(months => mois);
  get diagnostics supprimees = row_count;
  return supprimees;
end $fn$;
revoke all on function private.purge_journal_exploitation(int) from public;
grant execute on function private.purge_journal_exploitation(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Réplication temps réel et contrôle final
-- ---------------------------------------------------------------------------
-- `profils`, `profils_roles` et `roles` restent HORS de la publication temps
-- réel : l'annuaire du personnel et ses habilitations n'ont pas à être
-- diffusés aux écrans.

-- Rien ne doit plus dépendre de l'ancien rôle unique, et aucune table
-- d'exploitation ne doit se retrouver sans politique d'écriture. Ce contrôle
-- est DANS la transaction : s'il échoue, tout est annulé et la base reste
-- intacte.
do $$
declare
  restantes int;
  muettes text[];
begin
  select count(*) into restantes from pg_policies
   where coalesce(qual, '') like '%role_courant%'
      or coalesce(with_check, '') like '%role_courant%';
  if restantes > 0 then
    raise exception 'MIGRATION ANNULÉE : % politique(s) référencent encore role_courant().', restantes;
  end if;
  if to_regprocedure('private.role_courant()') is not null then
    raise exception 'MIGRATION ANNULÉE : private.role_courant() existe encore.';
  end if;

  -- Le dégât le plus probable d'une exécution interrompue : des politiques
  -- supprimées et jamais recréées, donc une table que plus personne n'écrit.
  select array_agg(c.relname order by c.relname) into muettes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('jours','circulations','messages','medias','machines','motifs',
                       'ciels','modeles_messages','params','ecrans','publications',
                       'grilles','profils','profils_roles')
     and not exists (
       select 1 from pg_policy p
        where p.polrelid = c.oid and p.polcmd in ('a', 'w', 'd', '*')
     );
  if muettes is not null then
    raise exception 'MIGRATION ANNULÉE : table(s) sans politique d''écriture : %.',
      array_to_string(muettes, ', ');
  end if;

  raise notice 'Rôles multiples en place. Déployer les Edge Functions, puis fusionner la pull request.';
end $$;

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script, requête par requête.
-- =============================================================================
--
-- (a) Reprise : chacun a gardé son rôle, les administrateurs ont l'exploitation,
--     le compte d'amorçage est aussi technique.
--     select p.email, p.actif, array_agg(pr.role order by pr.role) as roles
--       from profils p left join profils_roles pr using (user_id)
--      group by p.email, p.actif order by p.email;
--
-- (b) Rôles vus par un compte donné (remplacer l'uuid) :
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--       select private.roles_courants(), private.a_le_role('technique');
--     rollback;
--
-- (c) Dernier technique : le retrait est REFUSÉ (au commit, déclencheur différé).
--     begin;
--       delete from profils_roles where role = 'technique';
--     commit;    -- -> « il doit toujours rester au moins un compte actif "Technique" »
--
-- (d) Suppression du compte depuis le tableau de bord (Authentication → Users) :
--     supprimer le dernier compte technique doit ÉCHOUER (la cascade déclenche
--     le même garde-fou). Le message affiché par le tableau de bord est
--     générique : la cause exacte est celle du point (c).
--
-- (e) Personne ne modifie ses propres rôles :
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<son propre uuid>","role":"authenticated"}';
--       insert into profils_roles (user_id, role) values ('<son propre uuid>', 'technique');
--     rollback;   -- -> « Personne ne modifie ses propres rôles. »
--
-- (f) Pas d'escalade : un administrateur ne fabrique pas un technique.
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<uuid d''un admin>","role":"authenticated"}';
--       insert into profils_roles (user_id, role) values ('<uuid d''un autre>', 'technique');
--     rollback;   -- -> « Le rôle "technique" ne fait pas partie de ceux que vous pouvez attribuer. »
--
-- (g) La matrice n'est pas modifiable depuis l'API :
--     begin;
--       set local role authenticated;
--       update roles set attribuable_par = array['caisse'] where code = 'technique';
--     rollback;   -- -> permission denied for table roles
--
-- (h) Suite complète de la matrice (une cellule par cas) :
--     supabase/tests/roles-rls.sql
--
-- (i) Isolation des transactions : le garde-fou suppose READ COMMITTED (défaut).
--     show default_transaction_isolation;   -- -> read committed
--
-- (j) Ancien front (pendant la fenêtre) : se connecter à la supervision encore
--     en ligne, vérifier que les onglets s'affichent et qu'une modification de
--     circulation passe. La gestion des utilisateurs, elle, est fermée : le
--     changement de rôle y échoue avec « écriture refusée », c'est attendu.
--
-- (k) REJEU : relancer ce script en entier doit se terminer sans erreur, sans
--     rien réattribuer (le notice dit « Reprise ignorée »). C'est le contrôle
--     qui prouve l'idempotence.
