-- =============================================================================
-- TMB — DIAGNOSTIC du chantier « rôles multiples » — LECTURE SEULE
-- À exécuter dans l'éditeur SQL de N'IMPORTE QUELLE base (test ou production).
-- Ce script n'écrit RIEN d'autre qu'une table temporaire, détruite à la fin de
-- la session : il ne crée, ne modifie ni ne supprime aucun objet.
--
-- POURQUOI. Une exécution partielle a pu laisser des objets en place :
-- tables au schéma différent, fonctions orphelines, politiques supprimées et
-- jamais recréées. Avant de rejouer quoi que ce soit, il faut savoir
-- exactement où en est la base — en particulier si des tables se retrouvent
-- SANS politique d'écriture, auquel cas l'exploitation ne peut plus rien
-- enregistrer.
--
-- COMMENT LIRE LE RÉSULTAT. Une seule table en sortie, à copier telle quelle.
-- Les lignes sont regroupées par section ; celles dont l'état commence par
-- « ⚠ » demandent une décision.
--
-- Le rapport passe par une table temporaire et du SQL dynamique : une requête
-- qui nommerait directement une table absente échouerait à la planification,
-- avant même d'être exécutée.
-- =============================================================================

create temporary table if not exists tmb_diagnostic (
  section int,
  rubrique text,
  objet text,
  etat text,
  detail text
) on commit preserve rows;
truncate tmb_diagnostic;

do $$
declare
  r record;
  nb bigint;
  colonnes text;
begin
  ---------------------------------------------------------------------------
  -- 1. Les tables du chantier
  ---------------------------------------------------------------------------
  for r in
    select t as nom from unnest(array[
      'roles','profils_roles','profils','journal_exploitation','grilles',
      'jours','circulations','messages','medias','machines','motifs','ciels',
      'modeles_messages','params','ecrans','publications'
    ]) t
  loop
    insert into tmb_diagnostic values (
      1, 'Table',
      r.nom,
      case when to_regclass('public.' || r.nom) is null then '⚠ ABSENTE' else 'présente' end,
      ''
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 2. Colonnes des tables d'habilitation (c'est là qu'un schéma partiel se voit)
  ---------------------------------------------------------------------------
  for r in
    select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('roles', 'profils_roles', 'profils')
     order by c.table_name, c.ordinal_position
  loop
    insert into tmb_diagnostic values (
      2, 'Colonne de ' || r.table_name,
      r.column_name,
      r.data_type || case when r.is_nullable = 'NO' then ' not null' else '' end,
      coalesce('défaut ' || r.column_default, '')
    );
  end loop;

  -- Colonnes ATTENDUES par la migration mais absentes : la cause n°1 d'un échec
  -- au rejeu (« create table if not exists » ne rattrape pas un schéma partiel).
  for r in
    select a.tbl, a.col from (values
      ('roles','code'), ('roles','libelle'), ('roles','protege'),
      ('roles','attribuable_par'), ('roles','ordre'), ('roles','groupe_entra'),
      ('profils_roles','user_id'), ('profils_roles','role'),
      ('profils_roles','source'), ('profils_roles','attribue_le'),
      ('profils_roles','attribue_par')
    ) as a(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is not null
       and not exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = r.tbl and column_name = r.col
       )
    then
      insert into tmb_diagnostic values (
        2, 'Colonne ATTENDUE', r.tbl || '.' || r.col, '⚠ MANQUANTE',
        'la migration doit l''ajouter avant tout insert'
      );
    end if;
  end loop;

  -- La colonne de compatibilité existe-t-elle encore ?
  insert into tmb_diagnostic values (
    2, 'Colonne de compatibilité', 'profils.role',
    case
      when to_regclass('public.profils') is null then '⚠ table profils absente'
      when exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='profils' and column_name='role')
        then 'présente (fenêtre de déploiement)'
      else 'retirée (script de nettoyage passé)'
    end,
    ''
  );

  ---------------------------------------------------------------------------
  -- 3. Fonctions du schéma private
  ---------------------------------------------------------------------------
  if to_regnamespace('private') is null then
    insert into tmb_diagnostic values (3, 'Schéma private', 'private', '⚠ ABSENT', '');
  else
    for r in
      select p.proname,
             pg_get_function_identity_arguments(p.oid) as args,
             p.prosecdef,
             coalesce(array_to_string(p.proconfig, ', '), '') as config
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
       order by p.proname
    loop
      insert into tmb_diagnostic values (
        3, 'Fonction private',
        r.proname || '(' || r.args || ')',
        case when r.prosecdef then 'security definer' else '⚠ security invoker' end,
        case when r.config like '%search_path=%' then r.config else '⚠ search_path NON verrouillé' end
      );
    end loop;
  end if;

  -- Les fonctions que la migration ATTEND, et l'ancienne qu'elle doit retirer.
  for r in
    select a.sig, a.role from (values
      ('private.roles_courants()', 'attendue'),
      ('private.a_le_role(text)', 'attendue'),
      ('private.a_un_des_roles(text[])', 'attendue'),
      ('private.peut_attribuer(text)', 'attendue'),
      ('private.peut_gerer_profil(uuid)', 'attendue'),
      ('private.nb_detenteurs_actifs(text)', 'attendue'),
      ('private.email_appelant()', 'attendue'),
      ('private.role_courant()', 'ANCIENNE — doit disparaître')
    ) as a(sig, role)
  loop
    insert into tmb_diagnostic values (
      3, 'Fonction ' || r.role, r.sig,
      case
        when to_regprocedure(r.sig) is null
          then case when r.role = 'attendue' then '⚠ absente' else 'absente (bien)' end
        else case when r.role = 'attendue' then 'présente' else '⚠ PRÉSENTE' end
      end,
      ''
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 4. Déclencheurs du chantier
  ---------------------------------------------------------------------------
  for r in
    select t.tgname, c.relname, t.tgenabled, t.tgconstraint <> 0 as contrainte
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and n.nspname = 'public'
       and (t.tgname like 'trg_roles%' or t.tgname like 'trg_journal_profils%')
     order by c.relname, t.tgname
  loop
    insert into tmb_diagnostic values (
      4, 'Déclencheur', r.tgname, 'sur ' || r.relname,
      case when r.contrainte then 'déclencheur de contrainte' else '' end
      || case when r.tgenabled = 'D' then ' ⚠ DÉSACTIVÉ' else '' end
    );
  end loop;
  if not exists (select 1 from tmb_diagnostic where section = 4) then
    insert into tmb_diagnostic values (4, 'Déclencheur', '(aucun)', 'aucun déclencheur du chantier', '');
  end if;

  ---------------------------------------------------------------------------
  -- 5. Politiques encore fondées sur l'ANCIEN rôle unique
  ---------------------------------------------------------------------------
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where coalesce(qual, '') like '%role_courant%'
        or coalesce(with_check, '') like '%role_courant%'
     order by schemaname, tablename, policyname
  loop
    insert into tmb_diagnostic values (
      5, 'Politique sur role_courant()',
      r.schemaname || '.' || r.tablename || ' → ' || r.policyname,
      '⚠ ancien modèle', r.cmd
    );
  end loop;
  if not exists (select 1 from tmb_diagnostic where section = 5) then
    insert into tmb_diagnostic values (
      5, 'Politique sur role_courant()', '(aucune)', 'aucune : migration déjà passée, ou base neuve', ''
    );
  end if;

  ---------------------------------------------------------------------------
  -- 6. Politiques du NOUVEAU modèle
  ---------------------------------------------------------------------------
  for r in
    select schemaname, tablename, policyname, cmd
      from pg_policies
     where policyname like 'roles: %'
     order by schemaname, tablename, policyname
  loop
    insert into tmb_diagnostic values (
      6, 'Politique « roles: »',
      r.schemaname || '.' || r.tablename || ' → ' || r.policyname,
      'présente', r.cmd
    );
  end loop;
  if not exists (select 1 from tmb_diagnostic where section = 6) then
    insert into tmb_diagnostic values (
      6, 'Politique « roles: »', '(aucune)', 'le nouveau modèle n''est pas en place', ''
    );
  end if;

  ---------------------------------------------------------------------------
  -- 7. ALERTE : tables dont plus personne ne peut écrire
  ---------------------------------------------------------------------------
  -- C'est le dégât le plus probable d'une exécution interrompue : les
  -- politiques sont supprimées avant d'être recréées.
  for r in
    select c.relname,
           count(*) filter (
             where p.polcmd in ('a', 'w', 'd', '*')      -- insert, update, delete, all
           ) as ecriture
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname in ('jours','circulations','messages','medias','machines','motifs',
                         'ciels','modeles_messages','params','ecrans','publications',
                         'grilles','profils','profils_roles','roles','journal_exploitation')
     group by c.relname
     order by c.relname
  loop
    insert into tmb_diagnostic values (
      7, 'Écriture possible ?', r.relname,
      case
        when r.ecriture > 0 then r.ecriture || ' politique(s) d''écriture'
        when r.relname in ('journal_exploitation', 'roles')
          then 'aucune — normal (écriture réservée aux déclencheurs / à l''éditeur SQL)'
        else '⚠ AUCUNE POLITIQUE D''ÉCRITURE'
      end,
      ''
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 8. Droits de table (Supabase en accorde par défaut : ils doivent être retirés)
  ---------------------------------------------------------------------------
  for r in
    select g.table_name, g.grantee, string_agg(g.privilege_type, ', ' order by g.privilege_type) as droits
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name in ('roles', 'profils_roles', 'profils')
       and g.grantee in ('anon', 'authenticated')
     group by g.table_name, g.grantee
     order by g.table_name, g.grantee
  loop
    insert into tmb_diagnostic values (
      8, 'Droits de table', r.table_name || ' → ' || r.grantee, r.droits,
      case
        when r.table_name = 'roles' and r.grantee = 'anon' then '⚠ anon ne devrait avoir AUCUN droit'
        when r.table_name = 'roles' and r.droits <> 'SELECT' then '⚠ le catalogue doit être en lecture seule'
        when r.table_name = 'profils_roles' and r.droits like '%UPDATE%' then '⚠ une attribution doit être immuable'
        when r.table_name = 'profils_roles' and r.grantee = 'anon' then '⚠ anon ne devrait avoir AUCUN droit'
        else ''
      end
    );
  end loop;

  -- Droits de COLONNE sur profils (le miroir et l'e-mail ne doivent plus être écrits)
  for r in
    select g.column_name, g.grantee, string_agg(g.privilege_type, ', ' order by g.privilege_type) as droits
      from information_schema.column_privileges g
     where g.table_schema = 'public' and g.table_name = 'profils'
       and g.grantee in ('anon', 'authenticated')
       and g.privilege_type in ('INSERT', 'UPDATE')
     group by g.column_name, g.grantee
     order by g.column_name, g.grantee
  loop
    insert into tmb_diagnostic values (
      8, 'Droit de colonne profils', r.column_name || ' → ' || r.grantee, r.droits,
      case when r.column_name = 'role' then '⚠ le miroir ne doit plus être écrit' else '' end
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 9. RLS activée ?
  ---------------------------------------------------------------------------
  for r in
    select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('roles', 'profils_roles', 'profils')
     order by c.relname
  loop
    insert into tmb_diagnostic values (
      9, 'RLS', r.relname,
      case when r.relrowsecurity then 'activée' else '⚠ DÉSACTIVÉE — les politiques sont inertes' end,
      ''
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 10. Données déjà en place
  ---------------------------------------------------------------------------
  if to_regclass('public.roles') is not null then
    -- Les colonnes varient selon l'état : on ne lit que celles qui existent.
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into colonnes
      from information_schema.columns
     where table_schema = 'public' and table_name = 'roles'
       and column_name in ('code', 'libelle', 'protege', 'attribuable_par', 'ordre');
    for r in execute format(
      'select %s::text as ligne from public.roles order by 1', 'concat_ws('' | '', ' || colonnes || ')'
    ) loop
      insert into tmb_diagnostic values (10, 'Catalogue roles', r.ligne, '', '');
    end loop;
    if not exists (select 1 from tmb_diagnostic where section = 10) then
      insert into tmb_diagnostic values (10, 'Catalogue roles', '(vide)', 'aucune ligne', '');
    end if;
  else
    insert into tmb_diagnostic values (10, 'Catalogue roles', '(table absente)', '', '');
  end if;

  if to_regclass('public.profils_roles') is not null then
    execute 'select count(*) from public.profils_roles' into nb;
    insert into tmb_diagnostic values (10, 'Attributions', 'profils_roles', nb || ' ligne(s)', '');
    for r in execute
      'select pr.role || '' : '' || count(*)::text as ligne
         from public.profils_roles pr group by pr.role order by pr.role'
    loop
      insert into tmb_diagnostic values (10, 'Attributions par rôle', r.ligne, '', '');
    end loop;
  else
    insert into tmb_diagnostic values (10, 'Attributions', 'profils_roles', 'table absente', '');
  end if;

  if to_regclass('public.profils') is not null then
    execute 'select count(*) from public.profils' into nb;
    insert into tmb_diagnostic values (10, 'Comptes', 'profils', nb || ' ligne(s)', '');
    execute 'select count(*) from public.profils where actif' into nb;
    insert into tmb_diagnostic values (10, 'Comptes', 'profils actifs', nb || ' ligne(s)', '');
  end if;

  ---------------------------------------------------------------------------
  -- 11. Verdict
  ---------------------------------------------------------------------------
  insert into tmb_diagnostic values (
    11, 'VERDICT', 'état du chantier',
    case
      when to_regclass('public.profils_roles') is null
           and not exists (select 1 from pg_policies where policyname like 'roles: %')
        then 'AVANT migration (rien en place)'
      when to_regprocedure('private.a_le_role(text)') is not null
           and exists (select 1 from pg_policies where policyname like 'roles: %')
           and not exists (select 1 from pg_policies
                            where coalesce(qual,'') like '%role_courant%'
                               or coalesce(with_check,'') like '%role_courant%')
        then 'migration APPLIQUÉE'
      else '⚠ ÉTAT PARTIEL — voir les lignes marquées ci-dessus'
    end,
    ''
  );
end $$;

-- ---------------------------------------------------------------------------
-- LE RAPPORT — copier tout le tableau ci-dessous
-- ---------------------------------------------------------------------------
select section, rubrique, objet, etat, detail
  from tmb_diagnostic
 order by section, rubrique, objet;
