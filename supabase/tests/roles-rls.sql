-- =============================================================================
-- TMB — RECETTE de la matrice des rôles, EN BASE (RLS + déclencheurs)
-- À exécuter dans l'éditeur SQL du projet de TEST, d'un seul bloc, APRÈS
-- supabase/migrations/2026-09-roles-multiples.sql.
--
-- Le script se termine par un ROLLBACK : il ne laisse AUCUNE trace, ni compte
-- de test, ni rôle attribué. Il peut donc être relancé autant de fois qu'on
-- veut, y compris — en dernier recours et hors heures de service — sur la
-- production.
--
-- LECTURE DU RÉSULTAT. Chaque cas affiche une ligne « OK — … » dans l'onglet
-- des messages. Le premier cas qui ne se comporte pas comme prévu lève une
-- erreur « ÉCHEC — … » et arrête tout : il n'y a donc rien à dépouiller à la
-- main, seulement à vérifier qu'aucune erreur n'apparaît et que la dernière
-- ligne annonce la recette complète.
--
-- POURQUOI CE FICHIER PLUTÔT QU'UN TEST AUTOMATISÉ. Les tests Vitest du dépôt
-- (npm test) ne voient que le TEXTE des scripts et le miroir de confort
-- src/core/roles.ts ; l'intégration continue publique n'a ni base ni secret.
-- La garantie réelle — « la base refuse » — ne se démontre que sur une base.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Comptes de test
-- ---------------------------------------------------------------------------
-- Créés directement dans auth.users : c'est possible depuis l'éditeur SQL et
-- la transaction est annulée à la fin. Si l'insertion échoue (schéma GoTrue
-- différent), créer les six comptes à la main dans Authentication → Users et
-- remplacer les identifiants ci-dessous.
insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'test-technique@exemple.invalid',  'authenticated', 'authenticated', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'test-admin@exemple.invalid',      'authenticated', 'authenticated', now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'test-supervision@exemple.invalid','authenticated', 'authenticated', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'test-caisse@exemple.invalid',     'authenticated', 'authenticated', now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'test-cumul@exemple.invalid',      'authenticated', 'authenticated', now(), now()),
  ('66666666-6666-6666-6666-666666666666', 'test-sans-role@exemple.invalid',  'authenticated', 'authenticated', now(), now());

insert into profils (user_id, nom, email, actif) values
  ('11111111-1111-1111-1111-111111111111', 'Test Technique',   'test-technique@exemple.invalid',   true),
  ('22222222-2222-2222-2222-222222222222', 'Test Admin',       'test-admin@exemple.invalid',       true),
  ('33333333-3333-3333-3333-333333333333', 'Test Supervision', 'test-supervision@exemple.invalid', true),
  ('44444444-4444-4444-4444-444444444444', 'Test Caisse',      'test-caisse@exemple.invalid',      true),
  ('55555555-5555-5555-5555-555555555555', 'Test Cumul',       'test-cumul@exemple.invalid',       true),
  ('66666666-6666-6666-6666-666666666666', 'Test Sans rôle',   'test-sans-role@exemple.invalid',   true);

-- Attributions d'amorçage : écriture « sans visage », donc revendiquée.
set local tmb.attribution_systeme = 'secours';
insert into profils_roles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'technique'),
  ('22222222-2222-2222-2222-222222222222', 'admin'),
  ('33333333-3333-3333-3333-333333333333', 'supervision'),
  ('44444444-4444-4444-4444-444444444444', 'caisse'),
  ('55555555-5555-5555-5555-555555555555', 'technique'),
  ('55555555-5555-5555-5555-555555555555', 'admin');
set local tmb.attribution_systeme = '';

-- Deux outils de lecture du résultat, le temps de la transaction.
create or replace function pg_temp.ok(cas text) returns void
language plpgsql as $$
begin
  raise notice 'OK — %', cas;
end $$;

create or replace function pg_temp.echec(cas text) returns void
language plpgsql as $$
begin
  raise exception 'ÉCHEC — %', cas;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Les rôles vus par chacun
-- ---------------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","email":"test-cumul@exemple.invalid"}', true);
do $$
begin
  if private.roles_courants() @> array['technique','admin']
     and not private.a_le_role('supervision') then
    perform pg_temp.ok('cumul : roles_courants() renvoie technique ET admin, pas supervision');
  else
    perform pg_temp.echec('cumul : roles_courants() = ' || private.roles_courants()::text);
  end if;
end $$;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
begin
  if private.roles_courants() = array['supervision'] then
    perform pg_temp.ok('supervision : un seul rôle, aucun héritage');
  else
    perform pg_temp.echec('supervision : roles_courants() = ' || private.roles_courants()::text);
  end if;
end $$;

reset role;

-- Un profil DÉSACTIVÉ perd tout, immédiatement.
update profils set actif = false where user_id = '44444444-4444-4444-4444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
begin
  if private.roles_courants() = array[]::text[] then
    perform pg_temp.ok('compte désactivé : aucun rôle, donc aucun droit');
  else
    perform pg_temp.echec('compte désactivé : roles_courants() = ' || private.roles_courants()::text);
  end if;
end $$;
reset role;
update profils set actif = true where user_id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------------------
-- 2. Attribution : qui donne quoi
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","email":"test-admin@exemple.invalid"}', true);

do $$
begin
  -- (a) Un administrateur ne fabrique pas un technique.
  begin
    insert into profils_roles (user_id, role)
      values ('66666666-6666-6666-6666-666666666666', 'technique');
    perform pg_temp.echec('un admin a pu attribuer « technique »');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('un admin ne peut pas attribuer « technique »');
  end;

  -- (b) …mais il attribue bien les rôles d'exploitation.
  insert into profils_roles (user_id, role)
    values ('66666666-6666-6666-6666-666666666666', 'supervision');
  perform pg_temp.ok('un admin attribue « supervision »');

  -- (c) L'attribution est signée par le JETON, pas par le client.
  if (select attribue_par from profils_roles
       where user_id = '66666666-6666-6666-6666-666666666666' and role = 'supervision')
     = 'test-admin@exemple.invalid' then
    perform pg_temp.ok('l''auteur de l''attribution vient du jeton');
  else
    perform pg_temp.echec('attribue_par n''a pas été renseigné depuis le jeton');
  end if;

  -- (d) Personne ne se donne un rôle à soi-même.
  begin
    insert into profils_roles (user_id, role)
      values ('22222222-2222-2222-2222-222222222222', 'caisse');
    perform pg_temp.echec('un admin a pu modifier ses propres rôles');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('personne ne modifie ses propres rôles');
  end;

  -- (e) Une ligne d'attribution est immuable.
  begin
    update profils_roles set role = 'caisse'
     where user_id = '66666666-6666-6666-6666-666666666666' and role = 'supervision';
    perform pg_temp.echec('une attribution a pu être modifiée par UPDATE');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('une attribution est immuable (retirer puis attribuer)');
  end;

  -- (f) Une attribution manuelle ne peut pas se déguiser en SSO.
  begin
    insert into profils_roles (user_id, role, source)
      values ('66666666-6666-6666-6666-666666666666', 'caisse', 'entra');
    perform pg_temp.echec('une attribution manuelle a pu se déclarer « entra »');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('la source « entra » est refusée à un client');
  end;

  -- (g) Retrait d'un rôle non protégé : accepté.
  delete from profils_roles
   where user_id = '66666666-6666-6666-6666-666666666666' and role = 'supervision';
  perform pg_temp.ok('un admin retire « supervision »');
end $$;

-- La supervision et la caisse n'attribuent rien du tout.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
begin
  begin
    insert into profils_roles (user_id, role)
      values ('66666666-6666-6666-6666-666666666666', 'caisse');
    perform pg_temp.echec('un superviseur a pu attribuer un rôle');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('un superviseur n''attribue aucun rôle');
  end;
end $$;

-- Le catalogue n'est pas empoisonnable : sans lui, toute la matrice tomberait.
do $$
begin
  begin
    update roles set attribuable_par = array['caisse'] where code = 'technique';
    perform pg_temp.echec('la matrice d''attribution a pu être modifiée depuis l''API');
  exception when insufficient_privilege then
    perform pg_temp.ok('le catalogue des rôles est en lecture seule pour les clients');
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Gestion des comptes : règle STRICTE
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  -- (a) Un admin ne renomme pas un compte technique : RLS FILTRE la ligne,
  --     elle ne lève pas — c'est pourquoi le front compte les lignes écrites.
  update profils set nom = 'Renommé par un admin'
   where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics touchees = row_count;
  if touchees = 0 then
    perform pg_temp.ok('un admin ne gère pas un compte « technique »');
  else
    perform pg_temp.echec('un admin a pu renommer un compte technique');
  end if;

  -- (b) …mais il gère les comptes d'exploitation.
  update profils set nom = 'Renommé' where user_id = '33333333-3333-3333-3333-333333333333';
  get diagnostics touchees = row_count;
  if touchees = 1 then
    perform pg_temp.ok('un admin renomme un compte « supervision »');
  else
    perform pg_temp.echec('un admin n''a pas pu renommer un compte supervision');
  end if;

  -- (c) On ne se modifie pas soi-même.
  update profils set nom = 'Moi-même' where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics touchees = row_count;
  if touchees = 0 then
    perform pg_temp.ok('personne ne modifie son propre profil');
  else
    perform pg_temp.echec('un admin a pu modifier son propre profil');
  end if;

  -- (d) La colonne de compatibilité n'est plus écrivable (tant qu'elle existe).
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils' and column_name = 'role')
  then
    begin
      execute $x$update profils set role = 'admin'
                where user_id = '33333333-3333-3333-3333-333333333333'$x$;
      perform pg_temp.echec('la colonne miroir profils.role a pu être écrite');
    exception when insufficient_privilege then
      perform pg_temp.ok('la colonne miroir profils.role est en lecture seule');
    end;
  else
    perform pg_temp.ok('colonne miroir déjà retirée (script de nettoyage passé)');
  end if;
end $$;

-- Un technique ne gère pas davantage les comptes d'exploitation.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update profils set nom = 'Renommé par le technique'
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics touchees = row_count;
  if touchees = 0 then
    perform pg_temp.ok('un technique ne gère pas un compte « admin »');
  else
    perform pg_temp.echec('un technique a pu renommer un administrateur');
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Matrice des écritures d'exploitation
-- ---------------------------------------------------------------------------
-- Une journée d'essai, très éloignée du service réel.
insert into jours (date, grille_version) values ('2099-12-31', 'recette-roles')
  on conflict (date) do nothing;

set local role authenticated;

-- (a) La supervision écrit l'exploitation.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update jours set terminus_bellevue_a_partir_du_train = 9 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('supervision : écrit une journée');
  else perform pg_temp.echec('supervision : n''a pas pu écrire une journée'); end if;

  -- …et le bandeau voyageurs.
  update params set valeur = '{"t":3,"ciel_fr":"Dégagé","ciel_en":"Clear"}'::jsonb
   where cle = 'meteo_sommet';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('supervision : écrit la météo du sommet');
  else perform pg_temp.echec('supervision : n''a pas pu écrire la météo'); end if;

  -- …mais pas les réglages d'infrastructure.
  update params set valeur = '{"debut":"20:00","fin":"05:00"}'::jsonb where cle = 'veille_nuit';
  get diagnostics touchees = row_count;
  if touchees = 0 then perform pg_temp.ok('supervision : la veille de nuit globale lui est refusée');
  else perform pg_temp.echec('supervision : a pu écrire la veille de nuit globale'); end if;

  -- …ni les rames.
  update machines set couleur = '#000000' where nom = 'Marie';
  get diagnostics touchees = row_count;
  if touchees = 0 then perform pg_temp.ok('supervision : les rames lui sont refusées');
  else perform pg_temp.echec('supervision : a pu modifier une rame'); end if;
end $$;

-- (b) La caisse ne tient QUE le bandeau.
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update params set valeur = '"90"'::jsonb where cle = 'vitesse_ticker_px_s';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('caisse : règle la vitesse du bandeau');
  else perform pg_temp.echec('caisse : n''a pas pu régler la vitesse du bandeau'); end if;

  update jours set terminus_bellevue_a_partir_du_train = 1 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 0 then perform pg_temp.ok('caisse : les circulations lui sont refusées');
  else perform pg_temp.echec('caisse : a pu écrire une journée'); end if;
end $$;

-- (c) Le technique protège la base, il ne conduit pas l'exploitation.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update params set valeur = '{"debut":"20:00","fin":"05:00"}'::jsonb where cle = 'veille_nuit';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('technique : règle la veille de nuit globale');
  else perform pg_temp.echec('technique : n''a pas pu régler la veille de nuit'); end if;

  update jours set terminus_bellevue_a_partir_du_train = 1 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 0 then perform pg_temp.ok('technique : modifier un terminus lui est refusé');
  else perform pg_temp.echec('technique : a pu modifier un terminus'); end if;

  -- …mais il réinitialise une journée (supprimer puis régénérer).
  delete from jours where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('technique : réinitialise une journée');
  else perform pg_temp.echec('technique : n''a pas pu supprimer une journée'); end if;

  insert into jours (date, grille_version) values ('2099-12-31', 'recette-roles');
  perform pg_temp.ok('technique : régénère la journée supprimée');

  -- …et il ne touche pas au bandeau voyageurs.
  begin
    insert into messages (texte_fr) values ('Message posé par le technique');
    perform pg_temp.echec('technique : a pu écrire un message voyageurs');
  exception when insufficient_privilege then
    perform pg_temp.ok('technique : le bandeau voyageurs lui est refusé');
  end;
end $$;

-- (d) Grilles horaires : partagées, pour que l'exploitation n'attende personne.
do $$ begin
  perform 1 from grilles limit 1;
  perform pg_temp.ok('grilles : lecture publique inchangée');
end $$;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update grilles set commentaire = coalesce(commentaire, '') where version is not null;
  get diagnostics touchees = row_count;
  if touchees > 0 then perform pg_temp.ok('supervision : charge et modifie les grilles');
  else perform pg_temp.echec('supervision : les grilles lui sont refusées'); end if;
end $$;

-- (e) Écrans : commander relève de l'exploitation, l'identité du technique.
insert into ecrans (id, gare, type) values ('recette-roles-1', 'le-fayet', 'ecran')
  on conflict (id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
declare
  touchees int;
begin
  update ecrans set recharger_demande_at = now() where id = 'recette-roles-1';
  get diagnostics touchees = row_count;
  if touchees = 1 then perform pg_temp.ok('supervision : recharge un écran');
  else perform pg_temp.echec('supervision : n''a pas pu recharger un écran'); end if;

  begin
    update ecrans set gare = 'bellevue' where id = 'recette-roles-1';
    perform pg_temp.echec('supervision : a pu déplacer un écran');
  exception when insufficient_privilege then
    perform pg_temp.ok('supervision : changer la gare d''un écran lui est refusé');
  end;

  begin
    insert into ecrans (id, gare, type) values ('recette-roles-2', 'bellevue', 'ecran');
    perform pg_temp.echec('supervision : a pu déclarer un écran');
  exception when insufficient_privilege then
    perform pg_temp.ok('supervision : déclarer un écran lui est refusé');
  end;
end $$;

-- (f) Journal : les lignes de rôles ne regardent que ceux qui gèrent les comptes.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from journal_exploitation where table_cible = 'profils_roles') = 0 then
    perform pg_temp.ok('supervision : ne lit pas les lignes de rôles du journal');
  else
    perform pg_temp.echec('supervision : a lu des lignes de rôles du journal');
  end if;
end $$;

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from journal_exploitation where table_cible = 'profils_roles') > 0 then
    perform pg_temp.ok('admin : lit les lignes de rôles du journal');
  else
    perform pg_temp.echec('admin : ne voit aucune ligne de rôle alors que la recette en a créé');
  end if;
end $$;

-- (g) La purge du journal est réservée au technique.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
begin
  begin
    perform private.purge_journal_exploitation(999);
    perform pg_temp.echec('un admin a pu lancer la purge du journal');
  exception when insufficient_privilege then
    perform pg_temp.ok('la purge du journal est refusée hors rôle technique');
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. Garde-fou : il reste toujours un technique et un admin
-- ---------------------------------------------------------------------------
-- Les déclencheurs de quorum sont DIFFÉRÉS (vérifiés au commit) : dans une
-- recette qui se termine par un rollback, on force leur évaluation avec
-- « set constraints all immediate ».
do $$
begin
  begin
    delete from profils_roles where role = 'technique';
    set constraints all immediate;
    perform pg_temp.echec('tous les rôles « technique » ont pu être retirés');
  exception when check_violation then
    perform pg_temp.ok('impossible de retirer le DERNIER rôle « technique »');
  end;
end $$;

-- L'état de la transaction est intact après une exception attrapée : les
-- lignes supprimées ci-dessus ont été rendues par le sous-bloc PL/pgSQL.
do $$
begin
  begin
    delete from profils_roles where role = 'admin';
    set constraints all immediate;
    perform pg_temp.echec('tous les rôles « admin » ont pu être retirés');
  exception when check_violation then
    perform pg_temp.ok('impossible de retirer le DERNIER rôle « admin »');
  end;
end $$;

-- Retirer UN détenteur quand il en reste un autre : accepté.
do $$
begin
  delete from profils_roles
   where user_id = '55555555-5555-5555-5555-555555555555' and role = 'technique';
  set constraints all immediate;
  perform pg_temp.ok('retirer un technique quand il en reste un autre : accepté');
exception when check_violation then
  perform pg_temp.echec('le retrait d''un technique non-dernier a été refusé');
end $$;

-- Désactiver un compte ne doit pas non plus vider un rôle protégé.
do $$
begin
  begin
    update profils set actif = false
     where user_id in (select user_id from profils_roles where role = 'technique');
    set constraints all immediate;
    perform pg_temp.echec('tous les comptes techniques ont pu être désactivés');
  exception when check_violation then
    perform pg_temp.ok('impossible de désactiver le DERNIER compte technique');
  end;
end $$;

-- Supprimer le compte Auth du dernier technique : la cascade rencontre le
-- même garde-fou (c'est le chemin du tableau de bord Supabase).
do $$
begin
  begin
    delete from auth.users
     where id in (select user_id from profils_roles where role = 'technique');
    set constraints all immediate;
    perform pg_temp.echec('le dernier compte technique a pu être supprimé');
  exception when check_violation then
    perform pg_temp.ok('impossible de supprimer le DERNIER compte technique (cascade comprise)');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Écriture « sans visage » : elle doit être revendiquée
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into profils_roles (user_id, role)
      values ('66666666-6666-6666-6666-666666666666', 'technique');
    perform pg_temp.echec('une attribution sans utilisateur connecté est passée sans être revendiquée');
  exception when check_violation then
    perform pg_temp.ok('une attribution sans utilisateur connecté doit être revendiquée');
  end;
end $$;

set local tmb.attribution_systeme = 'secours';
do $$
begin
  insert into profils_roles (user_id, role)
    values ('66666666-6666-6666-6666-666666666666', 'technique');
  perform pg_temp.ok('dépannage SQL revendiqué : attribution acceptée');
end $$;
set local tmb.attribution_systeme = '';

-- ---------------------------------------------------------------------------
-- 7. Fin — rien n'est conservé
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice '----------------------------------------------------------------';
  raise notice 'RECETTE COMPLÈTE : tous les cas de la matrice se comportent comme prévu.';
  raise notice 'La transaction va être annulée : aucun compte de test ne subsiste.';
  raise notice '----------------------------------------------------------------';
end $$;

rollback;
