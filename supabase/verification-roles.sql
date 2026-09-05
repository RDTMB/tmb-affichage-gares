-- =============================================================================
-- TMB — Rôles multiples : VÉRIFICATION D'APRÈS-MIGRATION
-- À exécuter dans l'éditeur SQL, APRÈS 2026-09-roles-multiples.sql.
--
-- CE SCRIPT NE MODIFIE RIEN. Il éprouve les garde-fous en tentant réellement
-- les gestes interdits, mais chaque tentative vit dans un sous-bloc à
-- rattrapage d'erreur : PostgreSQL annule tout ce qui s'y est passé. Même si
-- un garde-fou était défaillant, la tentative serait quand même annulée — le
-- script lève alors sa propre erreur pour forcer ce retour en arrière, et
-- le signale en clair.
--
-- Il remplace le bloc VÉRIFICATION en commentaires à la fin de la migration,
-- qui demandait de coller des UUID à la main et dont le contrôle du quorum se
-- terminait par un « commit » — inapplicable en production.
--
-- Résultat : un seul tableau, une ligne par contrôle, colonne VERDICT à lire.
-- =============================================================================

create temporary table if not exists tmb_verif (
  numero    int,
  controle  text,
  detail    text,
  obtenu    text,
  verdict   text
);
truncate tmb_verif;

-- Tout tient dans UN SEUL bloc : l'éditeur SQL de Supabase valide les
-- instructions une à une, et seul un bloc est atomique par construction.
do $$
declare
  uid_qui_conque uuid;
  uid_admin_pur  uuid;
  v              text;
  r              record;
  nb             int;
  echecs         int := 0;
begin
  -- ---------------------------------------------------------------------
  -- 1. Reprise : qui porte quoi
  -- ---------------------------------------------------------------------
  for r in
    select p.email,
           p.actif,
           coalesce(array_agg(pr.role order by pr.role)
                    filter (where pr.role is not null), '{}'::text[]) as roles
      from public.profils p
      left join public.profils_roles pr using (user_id)
     group by p.email, p.actif
     order by p.email
  loop
    insert into tmb_verif values (
      1, 'Comptes et rôles', r.email,
      array_to_string(r.roles, ', ') || case when r.actif then '' else '  (INACTIF)' end,
      case when r.actif and cardinality(r.roles) = 0
           then 'À REGARDER — compte actif sans aucun rôle'
           else 'info' end);
    if r.actif and cardinality(r.roles) = 0 then echecs := echecs + 1; end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 2. Quorum : il reste au moins un détenteur actif de chaque rôle protégé
  -- ---------------------------------------------------------------------
  for r in select code, libelle from public.roles where protege order by code loop
    nb := private.nb_detenteurs_actifs(r.code);
    insert into tmb_verif values (
      2, 'Détenteurs actifs', r.libelle, nb::text,
      case when nb >= 1 then 'OK' else 'ÉCHEC — plus aucun détenteur' end);
    if nb < 1 then echecs := echecs + 1; end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 3. Retirer le DERNIER technique doit être refusé
  --    Écriture sans utilisateur connecté : elle doit être revendiquée, sinon
  --    c'est l'autre garde-fou qui répondrait et le contrôle mentirait.
  -- ---------------------------------------------------------------------
  v := null;
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('tmb.attribution_systeme', 'secours', true);
    delete from public.profils_roles where role = 'technique';
    execute 'set constraints all immediate';
    raise exception 'TMB_GARDE_FOU_MUET';
  exception when others then
    v := sqlerrm;
  end;
  perform set_config('tmb.attribution_systeme', '', true);
  insert into tmb_verif values (
    3, 'Retrait du dernier technique', 'doit être refusé', v,
    case when v like '%au moins un compte actif%' then 'OK — refusé'
         when v = 'TMB_GARDE_FOU_MUET'            then 'ÉCHEC — rien ne l''a empêché'
         else 'À REGARDER — refusé, mais pas pour la raison attendue' end);
  if v is null or v = 'TMB_GARDE_FOU_MUET' then echecs := echecs + 1; end if;

  -- ---------------------------------------------------------------------
  -- 4. Une écriture sans utilisateur connecté et NON revendiquée est refusée
  -- ---------------------------------------------------------------------
  select p.user_id into uid_qui_conque
    from public.profils p
    join public.profils_roles pr using (user_id)
   where p.actif
   order by p.email
   limit 1;

  v := null;
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('tmb.attribution_systeme', '', true);
    insert into public.profils_roles (user_id, role) values (uid_qui_conque, 'caisse');
    raise exception 'TMB_GARDE_FOU_MUET';
  exception when others then
    v := sqlerrm;
  end;
  insert into tmb_verif values (
    4, 'Écriture non revendiquée', 'doit être refusée', v,
    case when v like '%sans utilisateur connecté%' then 'OK — refusée'
         when v = 'TMB_GARDE_FOU_MUET'             then 'ÉCHEC — rien ne l''a empêchée'
         else 'À REGARDER' end);
  if v is null or v = 'TMB_GARDE_FOU_MUET' then echecs := echecs + 1; end if;

  -- ---------------------------------------------------------------------
  -- 5. Personne ne modifie ses propres rôles
  -- ---------------------------------------------------------------------
  v := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid_qui_conque, 'role', 'authenticated')::text, true);
    insert into public.profils_roles (user_id, role) values (uid_qui_conque, 'caisse');
    raise exception 'TMB_GARDE_FOU_MUET';
  exception when others then
    v := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into tmb_verif values (
    5, 'Modifier ses propres rôles', 'doit être refusé', v,
    case when v like '%ses propres rôles%'  then 'OK — refusé'
         when v like '%écriture%refus%'     then 'OK — refusé par RLS'
         when v = 'TMB_GARDE_FOU_MUET'      then 'ÉCHEC — rien ne l''a empêché'
         else 'À REGARDER' end);
  if v is null or v = 'TMB_GARDE_FOU_MUET' then echecs := echecs + 1; end if;

  -- ---------------------------------------------------------------------
  -- 6. Pas d'escalade : un admin qui n'est pas technique n'en fabrique pas un
  --    Sans compte de ce profil, le contrôle est SANS OBJET — et le dire vaut
  --    mieux que de le faire passer pour réussi.
  -- ---------------------------------------------------------------------
  select p.user_id into uid_admin_pur
    from public.profils p
   where p.actif
     and exists (select 1 from public.profils_roles x
                  where x.user_id = p.user_id and x.role = 'admin')
     and not exists (select 1 from public.profils_roles x
                      where x.user_id = p.user_id and x.role = 'technique')
   limit 1;

  if uid_admin_pur is null then
    insert into tmb_verif values (
      6, 'Escalade admin vers technique', 'aucun compte admin sans technique',
      '(non applicable)',
      'SANS OBJET — à éprouver par supabase/tests/roles-rls.sql');
  else
    v := null;
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',
        json_build_object('sub', uid_admin_pur, 'role', 'authenticated')::text, true);
      insert into public.profils_roles (user_id, role) values (uid_qui_conque, 'technique');
      raise exception 'TMB_GARDE_FOU_MUET';
    exception when others then
      v := sqlerrm;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    insert into tmb_verif values (
      6, 'Escalade admin vers technique', 'doit être refusée', v,
      case when v like '%ne fait pas partie de ceux que vous pouvez attribuer%' then 'OK — refusée'
           when v like '%écriture%refus%'   then 'OK — refusée par RLS'
           when v = 'TMB_GARDE_FOU_MUET'    then 'ÉCHEC — un admin a pu fabriquer un technique'
           else 'À REGARDER' end);
    if v is null or v = 'TMB_GARDE_FOU_MUET' then echecs := echecs + 1; end if;
  end if;

  -- ---------------------------------------------------------------------
  -- 7. La matrice d'attribution n'est pas modifiable depuis l'API
  -- ---------------------------------------------------------------------
  v := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid_qui_conque, 'role', 'authenticated')::text, true);
    update public.roles set attribuable_par = array['caisse'] where code = 'technique';
    raise exception 'TMB_GARDE_FOU_MUET';
  exception when others then
    v := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into tmb_verif values (
    7, 'Modifier la matrice depuis l''API', 'doit être refusé', v,
    case when v like '%permission denied%' then 'OK — refusé'
         when v = 'TMB_GARDE_FOU_MUET'     then 'ÉCHEC — la matrice est modifiable'
         else 'À REGARDER' end);
  if v is null or v = 'TMB_GARDE_FOU_MUET' then echecs := echecs + 1; end if;

  -- ---------------------------------------------------------------------
  -- 8. Le garde-fou du quorum suppose READ COMMITTED
  -- ---------------------------------------------------------------------
  select current_setting('default_transaction_isolation') into v;
  insert into tmb_verif values (
    8, 'Isolation des transactions', 'read committed attendu', v,
    case when v = 'read committed' then 'OK' else 'À REGARDER' end);

  -- ---------------------------------------------------------------------
  -- 9. Verdict
  -- ---------------------------------------------------------------------
  insert into tmb_verif values (
    9, 'VERDICT', '',
    echecs::text || ' contrôle(s) en échec',
    case when echecs = 0
         then 'TOUT EST EN PLACE — déployer les Edge Functions, puis fusionner'
         else 'NE PAS FUSIONNER — lire les lignes ci-dessus' end);
end $$;

select numero, controle, detail, obtenu, verdict
  from tmb_verif
 order by numero, controle, detail;
