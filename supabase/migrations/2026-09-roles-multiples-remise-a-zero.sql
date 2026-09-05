-- =============================================================================
-- TMB — Rôles multiples : REMISE À ZÉRO du chantier
-- Efface TOUS les objets du chantier « rôles multiples » pour permettre de
-- rejouer la migration depuis un état propre.
--
-- ⚠ À RÉSERVER À LA BASE DE TEST. Sur la production, la migration
--   `2026-09-roles-multiples.sql` sait repartir d'un état partiel : il n'y a
--   aucune raison d'effacer d'abord.
--
-- ⚠ CE SCRIPT LAISSE LA BASE INUTILISABLE. Il supprime les politiques
--   d'écriture sans les remplacer : plus aucune écriture d'exploitation ne
--   passera tant que la migration n'aura pas été rejouée. Les DEUX scripts
--   s'enchaînent, dans cet ordre, sans rien faire entre les deux :
--       1. supabase/migrations/2026-09-roles-multiples-remise-a-zero.sql
--       2. supabase/migrations/2026-09-roles-multiples.sql
--
-- CE QUI EST EFFACÉ : la table de liaison `profils_roles` et ses attributions,
-- le catalogue `roles`, les fonctions d'habilitation, les déclencheurs du
-- chantier, et toutes les politiques préfixées « roles: ».
--
-- CE QUI EST PRÉSERVÉ : les comptes (`profils`), les données d'exploitation, le
-- journal, et la colonne `profils.role` — que la migration relira pour
-- reconstituer les rôles de chacun. Si cette colonne a déjà été retirée par le
-- script de nettoyage, la migration ne pourra rien reprendre : il faudra
-- réattribuer les rôles à la main (docs/securite.md §2).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Confirmation explicite : jamais par mégarde
-- ---------------------------------------------------------------------------
-- Ce script laisse la base sans politique d'écriture pendant quelques minutes.
-- Sur la production, cela couperait l'exploitation. Il ne s'exécute donc que
-- si l'opérateur l'a REVENDIQUÉ — même principe que l'attribution de rôle sans
-- utilisateur connecté.
--
-- ⚠ DÉCOMMENTER LA LIGNE SUIVANTE, sur la base de TEST uniquement :
-- set local tmb.remise_a_zero = 'je confirme';

do $$
begin
  if coalesce(current_setting('tmb.remise_a_zero', true), '') <> 'je confirme' then
    raise exception 'REMISE À ZÉRO REFUSÉE : ce script efface les politiques d''écriture de la base.'
      using hint = 'Sur la base de TEST : décommenter la ligne « set local tmb.remise_a_zero = ''je confirme''; » en tête de script, puis relancer le fichier ENTIER.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Déclencheurs du chantier
-- ---------------------------------------------------------------------------
drop trigger if exists trg_roles_proteger on profils_roles;
drop trigger if exists trg_roles_pas_de_truncate on profils_roles;
drop trigger if exists trg_roles_quorum_liaison on profils_roles;
drop trigger if exists trg_roles_miroir on profils_roles;
drop trigger if exists trg_journal_profils_roles on profils_roles;
drop trigger if exists trg_roles_quorum_profils on profils;
drop trigger if exists trg_roles_auto_desactivation on profils;
drop trigger if exists trg_journal_profils on profils;
drop trigger if exists trg_roles_ecrans_identite on ecrans;

-- ---------------------------------------------------------------------------
-- 2. Politiques du chantier — dynamique, pour n'en oublier aucune
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
  n int := 0;
begin
  for pol in
    select schemaname, tablename, policyname
      from pg_policies
     where policyname like 'roles: %'
        or coalesce(qual, '') like '%a_le_role%'
        or coalesce(with_check, '') like '%a_le_role%'
        or coalesce(qual, '') like '%a_un_des_roles%'
        or coalesce(with_check, '') like '%a_un_des_roles%'
        or coalesce(qual, '') like '%peut_gerer_profil%'
        or coalesce(with_check, '') like '%peut_gerer_profil%'
        or coalesce(qual, '') like '%peut_attribuer%'
        or coalesce(with_check, '') like '%peut_attribuer%'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
    n := n + 1;
  end loop;
  raise notice '% politique(s) du chantier effacée(s).', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tables d'habilitation
-- ---------------------------------------------------------------------------
-- `profils_roles` d'abord : elle référence `roles`.
drop table if exists profils_roles;
drop table if exists roles;

-- ---------------------------------------------------------------------------
-- 4. Fonctions d'habilitation
-- ---------------------------------------------------------------------------
drop function if exists private.peut_gerer_profil(uuid);
drop function if exists private.peut_attribuer(text);
drop function if exists private.nb_detenteurs_actifs(text);
drop function if exists private.a_un_des_roles(text[]);
drop function if exists private.a_le_role(text);
drop function if exists private.roles_courants();
drop function if exists private.email_appelant();
drop function if exists private.proteger_profils_roles();
drop function if exists private.interdire_truncate_roles();
drop function if exists private.verifier_quorum_roles();
drop function if exists private.interdire_auto_desactivation();
drop function if exists private.proteger_identite_ecran();
drop function if exists private.miroir_role_principal();
drop function if exists private.tracer_role();

-- `tracer_ecriture` a été réécrite par la migration pour lire l'adresse dans
-- le jeton (via email_appelant, supprimée ci-dessus). On la remet dans sa
-- version d'origine, sans quoi TOUS les déclencheurs du journal tomberaient en
-- erreur à la première écriture d'exploitation.
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

  select p.email into v_qui from public.profils p where p.user_id = auth.uid();

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

-- La purge redevient elle aussi indépendante du chantier.
create or replace function private.purge_journal_exploitation(mois int default 12)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  supprimees bigint;
begin
  delete from public.journal_exploitation
    where quand < now() - make_interval(months => mois);
  get diagnostics supprimees = row_count;
  return supprimees;
end $fn$;
revoke all on function private.purge_journal_exploitation(int) from public;
grant execute on function private.purge_journal_exploitation(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Droits de table rendus à leur état d'avant chantier
-- ---------------------------------------------------------------------------
-- La migration avait restreint `profils` à des droits de COLONNE ; sans cette
-- remise en état, le rejeu partirait d'une base déjà à moitié verrouillée.
grant insert, update on profils to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Contrôle final, DANS la transaction
-- ---------------------------------------------------------------------------
do $$
declare
  reste int;
begin
  select count(*) into reste from pg_policies where policyname like 'roles: %';
  if reste > 0 then
    raise exception 'REMISE À ZÉRO INCOMPLÈTE : % politique(s) « roles: » subsistent.', reste;
  end if;
  if to_regclass('public.profils_roles') is not null or to_regclass('public.roles') is not null then
    raise exception 'REMISE À ZÉRO INCOMPLÈTE : une table du chantier subsiste.';
  end if;
  if to_regprocedure('private.a_le_role(text)') is not null then
    raise exception 'REMISE À ZÉRO INCOMPLÈTE : private.a_le_role() subsiste.';
  end if;
  raise notice 'Chantier effacé. ENCHAÎNER MAINTENANT avec 2026-09-roles-multiples.sql : la base n''a plus de politique d''écriture.';
end $$;

commit;

-- =============================================================================
-- VÉRIFICATION — puis ENCHAÎNER SANS ATTENDRE avec la migration.
-- =============================================================================
--
-- (a) Il ne reste rien du chantier :
--     select count(*) from pg_policies where policyname like 'roles: %';   -- 0
--     select to_regclass('public.profils_roles'), to_regclass('public.roles');  -- null, null
--
-- (b) Les comptes et leur ancien rôle sont intacts — c'est ce que la migration
--     va reprendre :
--     select email, role, actif from profils order by email;
--
-- (c) Lancer `supabase/migrations/2026-09-roles-multiples.sql`, puis
--     `supabase/diagnostic-roles.sql` : le verdict doit annoncer
--     « migration APPLIQUÉE ».
