-- =============================================================================
-- TMB — RECETTE de la matrice des rôles, EN BASE (RLS + déclencheurs)
-- À exécuter dans l'éditeur SQL du projet de TEST, d'un seul bloc, APRÈS
-- supabase/migrations/2026-09-roles-multiples.sql.
--
-- CE SCRIPT NE LAISSE AUCUNE TRACE. Il crée six comptes fictifs, éprouve la
-- matrice, puis les supprime lui-même. Tout tient dans UN SEUL bloc `do $$ … $$`
-- — donc dans une seule instruction, donc dans une seule transaction : si un
-- cas échoue, le bloc lève et TOUT est annulé, comptes de test compris.
--
-- ⚠ POURQUOI UN SEUL BLOC. L'éditeur SQL de Supabase valide les instructions
--   une à une : un `begin; … rollback;` n'y annule rien du tout (constaté le
--   05/09/2026 avec une table temporaire évaporée entre deux instructions).
--   Une recette qui compterait sur un `rollback` final laisserait donc ses six
--   comptes fictifs dans l'annuaire. D'où cette forme, la seule sûre ici.
--
-- LECTURE DU RÉSULTAT. Chaque cas affiche « OK — … » dans l'onglet des
-- messages. Le premier cas qui ne se comporte pas comme prévu lève une erreur
-- « ÉCHEC — … » et arrête tout. Il n'y a donc rien à dépouiller : il suffit de
-- vérifier qu'aucune erreur n'apparaît et que la dernière ligne annonce la
-- recette complète.
--
-- POURQUOI CE FICHIER PLUTÔT QU'UN TEST AUTOMATISÉ. Les tests Vitest du dépôt
-- (npm test) ne voient que le TEXTE des scripts et le miroir de confort
-- src/core/roles.ts ; l'intégration continue publique n'a ni base ni secret.
-- La garantie réelle — « la base refuse » — ne se démontre que sur une base.
-- =============================================================================

do $$
declare
  -- Identifiants fixes, faciles à repérer dans un rapport.
  u_technique constant uuid := '11111111-1111-1111-1111-111111111111';
  u_admin     constant uuid := '22222222-2222-2222-2222-222222222222';
  u_sup       constant uuid := '33333333-3333-3333-3333-333333333333';
  u_caisse    constant uuid := '44444444-4444-4444-4444-444444444444';
  u_cumul     constant uuid := '55555555-5555-5555-5555-555555555555';
  u_sansrole  constant uuid := '66666666-6666-6666-6666-666666666666';
  tous uuid[];
  touchees int;
  roles_vus text[];
  n bigint;
begin
  tous := array[u_technique, u_admin, u_sup, u_caisse, u_cumul, u_sansrole];

  -------------------------------------------------------------------------
  -- 0. Comptes de test
  -------------------------------------------------------------------------
  insert into auth.users (id, email, aud, role, created_at, updated_at) values
    (u_technique, 'test-technique@exemple.invalid',   'authenticated', 'authenticated', now(), now()),
    (u_admin,     'test-admin@exemple.invalid',       'authenticated', 'authenticated', now(), now()),
    (u_sup,       'test-supervision@exemple.invalid', 'authenticated', 'authenticated', now(), now()),
    (u_caisse,    'test-caisse@exemple.invalid',      'authenticated', 'authenticated', now(), now()),
    (u_cumul,     'test-cumul@exemple.invalid',       'authenticated', 'authenticated', now(), now()),
    (u_sansrole,  'test-sans-role@exemple.invalid',   'authenticated', 'authenticated', now(), now());

  insert into public.profils (user_id, nom, email, actif) values
    (u_technique, 'Test Technique',   'test-technique@exemple.invalid',   true),
    (u_admin,     'Test Admin',       'test-admin@exemple.invalid',       true),
    (u_sup,       'Test Supervision', 'test-supervision@exemple.invalid', true),
    (u_caisse,    'Test Caisse',      'test-caisse@exemple.invalid',      true),
    (u_cumul,     'Test Cumul',       'test-cumul@exemple.invalid',       true),
    (u_sansrole,  'Test Sans rôle',   'test-sans-role@exemple.invalid',   true);

  -- Attributions d'amorçage : écriture « sans visage », donc revendiquée.
  perform set_config('tmb.attribution_systeme', 'secours', true);
  insert into public.profils_roles (user_id, role) values
    (u_technique, 'technique'),
    (u_admin,     'admin'),
    (u_sup,       'supervision'),
    (u_caisse,    'caisse'),
    (u_cumul,     'technique'),
    (u_cumul,     'admin');
  perform set_config('tmb.attribution_systeme', '', true);
  raise notice 'OK — six comptes de test créés';

  -------------------------------------------------------------------------
  -- 1. Les rôles vus par chacun
  -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cumul, 'role', 'authenticated',
                      'email', 'test-cumul@exemple.invalid')::text, true);
  execute 'set local role authenticated';

  roles_vus := private.roles_courants();
  if roles_vus @> array['technique','admin'] and not private.a_le_role('supervision') then
    raise notice 'OK — cumul : private.roles_courants() renvoie technique ET admin, pas supervision';
  else
    raise exception 'ÉCHEC — cumul : rôles = %', roles_vus;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  if private.roles_courants() = array['supervision'] then
    raise notice 'OK — supervision : un seul rôle, aucun héritage';
  else
    raise exception 'ÉCHEC — supervision : rôles = %', private.roles_courants();
  end if;

  execute 'reset role';

  -- Un profil DÉSACTIVÉ perd tout, immédiatement.
  update public.profils set actif = false where user_id = u_caisse;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_caisse, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if private.roles_courants() = array[]::text[] then
    raise notice 'OK — compte désactivé : aucun rôle, donc aucun droit';
  else
    raise exception 'ÉCHEC — compte désactivé : rôles = %', private.roles_courants();
  end if;
  execute 'reset role';
  update public.profils set actif = true where user_id = u_caisse;

  -------------------------------------------------------------------------
  -- 2. Attribution : qui donne quoi
  -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_admin, 'role', 'authenticated',
                      'email', 'test-admin@exemple.invalid')::text, true);
  execute 'set local role authenticated';

  -- (a) Un administrateur ne fabrique pas un technique.
  begin
    insert into public.profils_roles (user_id, role) values (u_sansrole, 'technique');
    raise exception 'ÉCHEC — un admin a pu attribuer « technique »';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — un admin ne peut pas attribuer « technique »';
  end;

  -- (b) …mais il attribue bien les rôles d'exploitation.
  insert into public.profils_roles (user_id, role) values (u_sansrole, 'supervision');
  raise notice 'OK — un admin attribue « supervision »';

  -- (c) L'attribution est signée par le JETON, pas par le client.
  if (select attribue_par from public.profils_roles
       where user_id = u_sansrole and role = 'supervision') = 'test-admin@exemple.invalid'
  then
    raise notice 'OK — l''auteur de l''attribution vient du jeton';
  else
    raise exception 'ÉCHEC — attribue_par n''a pas été renseigné depuis le jeton';
  end if;

  -- (d) Personne ne se donne un rôle à soi-même.
  begin
    insert into public.profils_roles (user_id, role) values (u_admin, 'caisse');
    raise exception 'ÉCHEC — un admin a pu modifier ses propres rôles';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — personne ne modifie ses propres rôles';
  end;

  -- (e) Une ligne d'attribution est immuable.
  begin
    update public.profils_roles set role = 'caisse'
     where user_id = u_sansrole and role = 'supervision';
    raise exception 'ÉCHEC — une attribution a pu être modifiée par UPDATE';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — une attribution est immuable (retirer puis attribuer)';
  end;

  -- (f) Une attribution manuelle ne peut pas se déguiser en SSO.
  begin
    insert into public.profils_roles (user_id, role, source)
      values (u_sansrole, 'caisse', 'entra');
    raise exception 'ÉCHEC — une attribution manuelle a pu se déclarer « entra »';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — la source « entra » est refusée à un client';
  end;

  -- (g) Retrait d'un rôle non protégé : accepté.
  delete from public.profils_roles where user_id = u_sansrole and role = 'supervision';
  raise notice 'OK — un admin retire « supervision »';

  -- (h) Le catalogue n'est pas empoisonnable : sans lui, toute la matrice tombe.
  begin
    update public.roles set attribuable_par = array['caisse'] where code = 'technique';
    raise exception 'ÉCHEC — la matrice d''attribution a pu être modifiée depuis l''API';
  exception when insufficient_privilege then
    raise notice 'OK — le catalogue des rôles est en lecture seule pour les clients';
  end;

  -- (i) La supervision n'attribue rien du tout.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  begin
    insert into public.profils_roles (user_id, role) values (u_sansrole, 'caisse');
    raise exception 'ÉCHEC — un superviseur a pu attribuer un rôle';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — un superviseur n''attribue aucun rôle';
  end;

  execute 'reset role';

  -------------------------------------------------------------------------
  -- 3. Gestion des comptes : règle STRICTE
  -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- (a) Un admin ne renomme pas un compte technique : RLS FILTRE la ligne,
  --     elle ne lève pas — c'est pourquoi le front compte les lignes écrites.
  update public.profils set nom = 'Renommé par un admin' where user_id = u_technique;
  get diagnostics touchees = row_count;
  if touchees = 0 then
    raise notice 'OK — un admin ne gère pas un compte « technique »';
  else
    raise exception 'ÉCHEC — un admin a pu renommer un compte technique';
  end if;

  -- (b) …mais il gère les comptes d'exploitation.
  update public.profils set nom = 'Renommé' where user_id = u_sup;
  get diagnostics touchees = row_count;
  if touchees = 1 then
    raise notice 'OK — un admin renomme un compte « supervision »';
  else
    raise exception 'ÉCHEC — un admin n''a pas pu renommer un compte supervision';
  end if;

  -- (c) On ne se modifie pas soi-même.
  update public.profils set nom = 'Moi-même' where user_id = u_admin;
  get diagnostics touchees = row_count;
  if touchees = 0 then
    raise notice 'OK — personne ne modifie son propre profil';
  else
    raise exception 'ÉCHEC — un admin a pu modifier son propre profil';
  end if;

  -- (d) La colonne de compatibilité n'est plus écrivable (tant qu'elle existe).
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils' and column_name = 'role')
  then
    begin
      execute format('update public.profils set role = %L where user_id = %L', 'admin', u_sup);
      raise exception 'ÉCHEC — la colonne miroir profils.role a pu être écrite';
    exception when insufficient_privilege then
      raise notice 'OK — la colonne miroir profils.role est en lecture seule';
    end;
  else
    raise notice 'OK — colonne miroir déjà retirée (script de nettoyage passé)';
  end if;

  -- (e) Un technique ne gère pas davantage les comptes d'exploitation.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);
  update public.profils set nom = 'Renommé par le technique' where user_id = u_admin;
  get diagnostics touchees = row_count;
  if touchees = 0 then
    raise notice 'OK — un technique ne gère pas un compte « admin »';
  else
    raise exception 'ÉCHEC — un technique a pu renommer un administrateur';
  end if;

  execute 'reset role';

  -------------------------------------------------------------------------
  -- 4. Matrice des écritures d'exploitation
  -------------------------------------------------------------------------
  -- Une journée d'essai, très éloignée du service réel.
  insert into public.jours (date, grille_version) values ('2099-12-31', 'recette-roles')
    on conflict (date) do nothing;
  insert into public.ecrans (id, gare, type) values ('recette-roles-1', 'le-fayet', 'ecran')
    on conflict (id) do nothing;

  execute 'set local role authenticated';

  -- (a) La supervision écrit l'exploitation.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);

  update public.jours set terminus_bellevue_a_partir_du_train = 9 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — supervision : écrit une journée';
  else raise exception 'ÉCHEC — supervision : n''a pas pu écrire une journée'; end if;

  update public.params set valeur = '{"t":3,"ciel_fr":"Dégagé","ciel_en":"Clear"}'::jsonb
   where cle = 'meteo_sommet';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — supervision : écrit la météo du sommet';
  else raise exception 'ÉCHEC — supervision : n''a pas pu écrire la météo'; end if;

  update public.params set valeur = '{"debut":"20:00","fin":"05:00"}'::jsonb where cle = 'veille_nuit';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — supervision : la veille de nuit globale lui est refusée';
  else raise exception 'ÉCHEC — supervision : a pu écrire la veille de nuit globale'; end if;

  update public.machines set couleur = '#000000' where nom = 'Marie';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — supervision : les rames lui sont refusées';
  else raise exception 'ÉCHEC — supervision : a pu modifier une rame'; end if;

  -- Grilles et écrans : PARTAGÉS avec l'exploitation.
  update public.grilles set commentaire = coalesce(commentaire, '') where version is not null;
  get diagnostics touchees = row_count;
  if touchees > 0 then raise notice 'OK — supervision : charge et modifie les grilles';
  else raise exception 'ÉCHEC — supervision : les grilles lui sont refusées'; end if;

  update public.ecrans set recharger_demande_at = now() where id = 'recette-roles-1';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — supervision : recharge un écran';
  else raise exception 'ÉCHEC — supervision : n''a pas pu recharger un écran'; end if;

  begin
    update public.ecrans set gare = 'bellevue' where id = 'recette-roles-1';
    raise exception 'ÉCHEC — supervision : a pu déplacer un écran';
  exception when insufficient_privilege then
    raise notice 'OK — supervision : changer la gare d''un écran lui est refusé';
  end;

  begin
    insert into public.ecrans (id, gare, type) values ('recette-roles-2', 'bellevue', 'ecran');
    raise exception 'ÉCHEC — supervision : a pu déclarer un écran';
  exception when insufficient_privilege then
    raise notice 'OK — supervision : déclarer un écran lui est refusé';
  end;

  -- (b) La caisse : le bandeau, les médias, la COMMANDE de son écran — et
  --     rien de l'exploitation ni des comptes (élargissement du 06/09/2026).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_caisse, 'role', 'authenticated')::text, true);

  update public.params set valeur = '90'::jsonb where cle = 'vitesse_ticker_px_s';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : règle la vitesse du bandeau';
  else raise exception 'ÉCHEC — caisse : n''a pas pu régler la vitesse du bandeau'; end if;

  -- CE QU'ELLE GAGNE. Médias : la FICHE…
  insert into public.medias (nom, type, chemin, duree_s)
    values ('recette-roles-media', 'image', 'recette-roles/essai.png', 8);
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : dépose un média';
  else raise exception 'ÉCHEC — caisse : n''a pas pu déposer un média'; end if;

  update public.medias set actif = false where nom = 'recette-roles-media';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : retire un média de l''affichage';
  else raise exception 'ÉCHEC — caisse : n''a pas pu retirer un média'; end if;

  delete from public.medias where nom = 'recette-roles-media';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : supprime un média';
  else raise exception 'ÉCHEC — caisse : n''a pas pu supprimer un média'; end if;

  -- …et le CYCLE d'affichage, l'autre moitié du même droit. On vise
  -- `duree_horaires_s` et non `mode_medias` : seule la première est amorcée
  -- par seed.sql, et un UPDATE sur une clé ABSENTE toucherait zéro ligne —
  -- ce qui se lirait comme un refus RLS alors que la politique est correcte.
  update public.params set valeur = '20'::jsonb where cle = 'duree_horaires_s';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : règle la durée du cycle des médias';
  else raise exception 'ÉCHEC — caisse : n''a pas pu régler la durée du cycle'; end if;

  -- Commander son écran : recharger, mettre en veille, ajuster sa vitesse.
  update public.ecrans set recharger_demande_at = now() where id = 'recette-roles-1';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : recharge un écran';
  else raise exception 'ÉCHEC — caisse : n''a pas pu recharger un écran'; end if;

  update public.ecrans set veille_debut = '21:00', veille_fin = '06:00'
    where id = 'recette-roles-1';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — caisse : règle la veille de son poste';
  else raise exception 'ÉCHEC — caisse : n''a pas pu régler la veille du poste'; end if;

  -- CE QU'ELLE NE GAGNE PAS. Cette moitié compte autant : un élargissement
  -- qui ouvre trop est un incident, pas un détail de finition.
  update public.jours set terminus_bellevue_a_partir_du_train = 1 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : les circulations lui sont refusées';
  else raise exception 'ÉCHEC — caisse : a pu écrire une journée'; end if;

  -- Paramètres d'EXPLOITATION : le délai « à quai » reste au chef d'exploitation.
  update public.params set valeur = '300'::jsonb where cle = 'a_quai_origine_s';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : le délai « à quai » lui est refusé';
  else raise exception 'ÉCHEC — caisse : a pu régler le délai « à quai »'; end if;

  -- Paramètres TECHNIQUES : la veille GLOBALE n'est pas la veille d'un poste.
  update public.params set valeur = '{"debut":"22:00","fin":"05:00"}'::jsonb
    where cle = 'veille_nuit';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : la veille de nuit globale lui est refusée';
  else raise exception 'ÉCHEC — caisse : a pu régler la veille de nuit globale'; end if;

  -- Listes d'exploitation : machines, motifs, états du ciel.
  -- ⚠ Sur une table VIDE, un UPDATE touche zéro ligne et ce contrôle passerait
  -- sans rien contrôler. On exige donc d'abord qu'il y ait quelque chose à
  -- refuser (la lecture, elle, est publique).
  select count(*) into touchees from public.machines;
  if touchees = 0 then
    raise exception 'RECETTE INVALIDE — aucune rame en base : le refus testé ci-dessous serait vide. Jouer supabase/seed.sql d''abord.';
  end if;
  update public.machines set en_service = true where nom is not null;
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : les rames lui sont refusées';
  else raise exception 'ÉCHEC — caisse : a pu modifier une rame'; end if;

  -- IDENTITÉ d'un écran : commander n'est pas déclarer.
  begin
    update public.ecrans set gare = 'bellevue' where id = 'recette-roles-1';
    raise exception 'ÉCHEC — caisse : a pu déplacer un écran';
  exception when insufficient_privilege then
    raise notice 'OK — caisse : changer la gare d''un écran lui est refusé';
  end;

  begin
    insert into public.ecrans (id, gare, type) values ('recette-roles-3', 'bellevue', 'ecran');
    raise exception 'ÉCHEC — caisse : a pu déclarer un écran';
  exception when insufficient_privilege then
    raise notice 'OK — caisse : déclarer un écran lui est refusé';
  end;

  delete from public.ecrans where id = 'recette-roles-1';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : oublier un écran lui est refusé';
  else raise exception 'ÉCHEC — caisse : a pu oublier un écran'; end if;

  -- COMPTES et rôles : rien, comme avant.
  update public.profils set nom = 'Renommé par la caisse' where user_id = u_sup;
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — caisse : renommer un compte lui est refusé';
  else raise exception 'ÉCHEC — caisse : a pu renommer un compte'; end if;

  begin
    insert into public.profils_roles (user_id, role) values (u_sansrole, 'caisse');
    raise exception 'ÉCHEC — caisse : a pu attribuer un rôle';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK — caisse : attribuer un rôle lui est refusé';
  end;

  -- (c) Le technique protège la base, il ne conduit pas l'exploitation.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);

  update public.params set valeur = '{"debut":"20:00","fin":"05:00"}'::jsonb where cle = 'veille_nuit';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — technique : règle la veille de nuit globale';
  else raise exception 'ÉCHEC — technique : n''a pas pu régler la veille de nuit'; end if;

  update public.jours set terminus_bellevue_a_partir_du_train = 1 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 0 then raise notice 'OK — technique : modifier un terminus lui est refusé';
  else raise exception 'ÉCHEC — technique : a pu modifier un terminus'; end if;

  -- …mais il réinitialise une journée (supprimer puis régénérer).
  delete from public.jours where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — technique : réinitialise une journée';
  else raise exception 'ÉCHEC — technique : n''a pas pu supprimer une journée'; end if;

  insert into public.jours (date, grille_version) values ('2099-12-31', 'recette-roles');
  raise notice 'OK — technique : régénère la journée supprimée';

  -- …et il ne touche pas au bandeau voyageurs.
  begin
    insert into public.messages (texte_fr) values ('Message posé par le technique');
    raise exception 'ÉCHEC — technique : a pu écrire un message voyageurs';
  exception when insufficient_privilege then
    raise notice 'OK — technique : le bandeau voyageurs lui est refusé';
  end;

  -- (d) Journal : les lignes de rôles ne regardent que ceux qui gèrent les comptes.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  select count(*) into n from public.journal_exploitation where table_cible = 'profils_roles';
  if n = 0 then
    raise notice 'OK — supervision : ne lit pas les lignes de rôles du journal';
  else
    raise exception 'ÉCHEC — supervision : a lu % ligne(s) de rôles du journal', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.journal_exploitation where table_cible = 'profils_roles';
  if n > 0 then
    raise notice 'OK — admin : lit les lignes de rôles du journal (% ligne(s))', n;
  else
    raise exception 'ÉCHEC — admin : ne voit aucune ligne de rôle alors que la recette en a créé';
  end if;

  -- (e) La purge du journal est réservée au technique.
  begin
    perform private.purge_journal_exploitation(999);
    raise exception 'ÉCHEC — un admin a pu lancer la purge du journal';
  exception when insufficient_privilege then
    raise notice 'OK — la purge du journal est refusée hors rôle technique';
  end;

  -------------------------------------------------------------------------
  -- 4 bis. ONGLETS VISIBLES PAR RÔLE — l'invariant, démontré en base
  -------------------------------------------------------------------------
  -- CE QU'IL FAUT PROUVER : masquer un onglet ne change RIEN à ce que RLS
  -- accepte ou refuse. C'est un rangement d'interface, pas une permission.
  -- Si un seul de ces cas basculait, la table serait devenue une barrière de
  -- sécurité par accident — et une barrière que l'exploitant règle lui-même,
  -- sans revue, est la pire de toutes.

  -- Cette section suppose la migration 2026-09-onglets-par-role.sql. Sur une
  -- base qui ne l'a pas encore reçue, on le DIT et on saute — plutôt que
  -- d'échouer sur « relation inexistante », message qui n'apprend rien.
  if to_regclass('public.onglets_par_role') is null then
    raise notice 'IGNORÉ — table onglets_par_role absente : jouer supabase/migrations/2026-09-onglets-par-role.sql pour éprouver cette section.';
  else

  -- (a) Le réglage est réservé au technique.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  begin
    insert into public.onglets_par_role (role, onglet) values ('caisse', 'parametres');
    raise exception 'ÉCHEC — un admin a pu régler la visibilité des onglets';
  exception when insufficient_privilege then
    raise notice 'OK — régler les onglets est refusé hors rôle technique';
  end;

  -- (b) Référence : ce que la caisse peut écrire AVANT tout masquage. Sans ce
  --     témoin, le cas (d) ne prouverait rien — il passerait aussi si la
  --     caisse n'avait JAMAIS pu écrire.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_caisse, 'role', 'authenticated')::text, true);
  update public.params set valeur = '95'::jsonb where cle = 'vitesse_ticker_px_s';
  get diagnostics touchees = row_count;
  if touchees <> 1 then
    raise exception 'RECETTE INVALIDE — la caisse ne peut déjà plus régler le bandeau ; le cas (d) ne prouverait rien.';
  end if;

  -- (c) Le technique masque à la caisse l'onglet Bandeau, celui de son métier.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);
  delete from public.onglets_par_role where role = 'caisse' and onglet = 'bandeau';
  get diagnostics touchees = row_count;
  if touchees = 1 then raise notice 'OK — technique : masque un onglet';
  else raise exception 'ÉCHEC — technique : n''a pas pu masquer un onglet (ligne absente du seed ?)'; end if;

  -- (d) LE POINT DE TOUTE LA SECTION : la caisse écrit toujours.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_caisse, 'role', 'authenticated')::text, true);
  update public.params set valeur = '85'::jsonb where cle = 'vitesse_ticker_px_s';
  get diagnostics touchees = row_count;
  if touchees = 1 then
    raise notice 'OK — masquer un onglet ne retire AUCUN droit : la caisse règle toujours le bandeau';
  else
    raise exception 'ÉCHEC — masquer un onglet a retiré un droit : la table est devenue une barrière de sécurité';
  end if;

  -- (e) …et l'inverse : ACCORDER un onglet hors plafond n'ouvre rien.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);
  insert into public.onglets_par_role (role, onglet) values ('caisse', 'circulations')
    on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_caisse, 'role', 'authenticated')::text, true);
  update public.jours set terminus_bellevue_a_partir_du_train = 3 where date = '2099-12-31';
  get diagnostics touchees = row_count;
  if touchees = 0 then
    raise notice 'OK — accorder l''onglet Circulations à la caisse n''ouvre AUCUNE écriture';
  else
    raise exception 'ÉCHEC — une ligne d''onglet a ouvert une écriture : l''invariant est rompu';
  end if;

  -- (f) L'auteur du réglage vient du JETON, pas du client.
  if exists (
    select 1 from public.onglets_par_role
     where role = 'caisse' and onglet = 'circulations'
       and regle_par is distinct from 'test-technique@exemple.invalid'
  ) then
    raise exception 'ÉCHEC — regle_par n''a pas été posée depuis le jeton';
  end if;
  raise notice 'OK — l''auteur du réglage est tracé depuis le jeton';

  -- (g) ANTI-ENFERMEMENT : masquer le dernier accès à Utilisateurs est refusé.
  --     Le déclencheur est DIFFÉRÉ : il tombe à la fin du bloc englobant, pas
  --     sur le DELETE lui-même. D'où le sous-bloc, qui joue le rôle du COMMIT.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);
  begin
    delete from public.onglets_par_role where role = 'technique' and onglet = 'utilisateurs';
    -- Force la vérification des contraintes différées SANS clore la
    -- transaction : c'est exactement ce que ferait le COMMIT.
    set constraints all immediate;
    raise exception 'ÉCHEC — le dernier accès à l''onglet Utilisateurs a pu être masqué';
  exception when check_violation then
    raise notice 'OK — masquer le dernier accès à Utilisateurs est refusé';
  end;
  set constraints all deferred;

  -- (h) Remise en état de ce que cette section a bousculé : la recette ne
  --     laisse RIEN derrière elle, réglages compris.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_technique, 'role', 'authenticated')::text, true);
  delete from public.onglets_par_role where role = 'caisse' and onglet = 'circulations';
  insert into public.onglets_par_role (role, onglet) values ('caisse', 'bandeau')
    on conflict do nothing;
  end if;

  execute 'reset role';

  -------------------------------------------------------------------------
  -- 5. Garde-fou : il reste toujours un technique et un admin
  -------------------------------------------------------------------------
  -- ⚠ REDEVENIR « SANS VISAGE ». `reset role` remet le rôle Postgres, mais
  --   LAISSE le jeton posé : `auth.uid()` désigne encore le dernier compte
  --   incarné, et le déclencheur d'attribution lui applique la matrice — un
  --   administrateur ne retire pas un rôle « technique », fût-ce depuis
  --   l'éditeur SQL. C'est le bon comportement du modèle, et c'est ce qui
  --   faisait échouer cette section : il faut effacer le jeton, PUIS
  --   revendiquer l'écriture système, comme le ferait un dépannage réel.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('tmb.attribution_systeme', 'secours', true);

  -- Les déclencheurs de quorum sont DIFFÉRÉS (vérifiés au commit) : on force
  -- leur évaluation avec « set constraints all immediate ».
  begin
    delete from public.profils_roles where role = 'technique';
    execute 'set constraints all immediate';
    raise exception 'ÉCHEC — tous les rôles « technique » ont pu être retirés';
  exception when check_violation then
    raise notice 'OK — impossible de retirer le DERNIER rôle « technique »';
  end;

  begin
    delete from public.profils_roles where role = 'admin';
    execute 'set constraints all immediate';
    raise exception 'ÉCHEC — tous les rôles « admin » ont pu être retirés';
  exception when check_violation then
    raise notice 'OK — impossible de retirer le DERNIER rôle « admin »';
  end;

  -- Retirer UN détenteur quand il en reste d'autres : accepté.
  begin
    delete from public.profils_roles where user_id = u_cumul and role = 'technique';
    execute 'set constraints all immediate';
    raise notice 'OK — retirer un technique quand il en reste un autre : accepté';
  exception when check_violation then
    raise exception 'ÉCHEC — le retrait d''un technique non-dernier a été refusé';
  end;

  -- Désactiver tous les comptes techniques : refusé.
  begin
    update public.profils set actif = false
     where user_id in (select user_id from public.profils_roles where role = 'technique');
    execute 'set constraints all immediate';
    raise exception 'ÉCHEC — tous les comptes techniques ont pu être désactivés';
  exception when check_violation then
    raise notice 'OK — impossible de désactiver le DERNIER compte technique';
  end;

  -- Supprimer le compte Auth du dernier technique : la cascade rencontre le
  -- même garde-fou (c'est le chemin du tableau de bord Supabase).
  -- ⚠ Ce cas vise TOUS les comptes techniques, VOTRE compte réel compris. Il
  --   s'exécute dans une sous-transaction que l'exception annule : le compte
  --   est rétabli avant la ligne suivante, et le contrôle qui suit le vérifie.
  begin
    delete from auth.users
     where id in (select user_id from public.profils_roles where role = 'technique');
    execute 'set constraints all immediate';
    raise exception 'ÉCHEC — le dernier compte technique a pu être supprimé';
  exception when check_violation then
    raise notice 'OK — impossible de supprimer le DERNIER compte technique (cascade comprise)';
  end;

  -- Ceinture : le compte réel doit être intact. S'il ne l'était pas, on lève
  -- ici — et le bloc entier étant atomique, rien ne serait conservé.
  if not exists (
    select 1 from public.profils_roles pr
    join public.profils p on p.user_id = pr.user_id
    where pr.role = 'technique' and p.actif and not (pr.user_id = any (tous))
  ) then
    raise exception 'ÉCHEC — le compte technique réel n''a pas été rétabli après le test de cascade';
  end if;
  raise notice 'OK — le compte technique réel est intact après les tests de garde-fou';

  -------------------------------------------------------------------------
  -- 6. Écriture « sans visage » : elle doit être revendiquée
  -------------------------------------------------------------------------
  -- On lève la revendication posée en §5 : c'est précisément son ABSENCE que
  -- ce cas éprouve.
  perform set_config('tmb.attribution_systeme', '', true);
  begin
    insert into public.profils_roles (user_id, role) values (u_sansrole, 'technique');
    raise exception 'ÉCHEC — une attribution sans utilisateur connecté est passée sans être revendiquée';
  exception when check_violation then
    raise notice 'OK — une attribution sans utilisateur connecté doit être revendiquée';
  end;

  perform set_config('tmb.attribution_systeme', 'secours', true);
  insert into public.profils_roles (user_id, role) values (u_sansrole, 'technique');
  raise notice 'OK — dépannage SQL revendiqué : attribution acceptée';

  -------------------------------------------------------------------------
  -- 7. Nettoyage — la recette ne laisse RIEN derrière elle
  -------------------------------------------------------------------------
  -- La revendication reste posée : supprimer un compte fait tomber ses lignes
  -- de `profils_roles` par cascade, et le déclencheur d'attribution s'applique
  -- à ce chemin comme à tout autre — c'est exactement ce que la §5 vient de
  -- démontrer.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('tmb.attribution_systeme', 'secours', true);

  delete from public.jours where date = '2099-12-31';
  delete from public.ecrans where id like 'recette-roles-%';
  -- La caisse supprime elle-même son média au §4 (c'est le cas testé), et un
  -- échec annule tout le bloc : cette ligne ne rattrape donc rien aujourd'hui.
  -- Elle est là pour que le nettoyage reste COMPLET si le §4 change un jour.
  delete from public.medias where nom = 'recette-roles-media';
  -- Les comptes d'abord : la cascade emporte profils puis profils_roles. Le
  -- quorum reste satisfait, les comptes RÉELS de la base gardant leurs rôles.
  delete from auth.users where id = any (tous);
  delete from public.journal_exploitation
   where cle like 'test-%@exemple.invalid' or qui like 'test-%@exemple.invalid';

  if exists (select 1 from public.profils where user_id = any (tous)) then
    raise exception 'ÉCHEC — des comptes de test subsistent après nettoyage';
  end if;
  perform set_config('tmb.attribution_systeme', '', true);

  raise notice '----------------------------------------------------------------';
  raise notice 'RECETTE COMPLÈTE : tous les cas de la matrice se comportent comme prévu.';
  raise notice 'Les six comptes de test ont été supprimés ; la base est intacte.';
  raise notice '----------------------------------------------------------------';
end $$;

-- =============================================================================
-- APRÈS LA RECETTE — contrôle que rien ne subsiste (0 ligne attendue partout).
-- =============================================================================
--
--   select count(*) from auth.users where email like 'test-%@exemple.invalid';
--   select count(*) from profils      where email like 'test-%@exemple.invalid';
--   select count(*) from jours        where date = '2099-12-31';
--   select count(*) from ecrans       where id like 'recette-roles-%';
--
-- Si la recette s'est ARRÊTÉE sur une erreur « ÉCHEC — … », tout a été annulé
-- d'un bloc : ces quatre requêtes renvoient 0 elles aussi. Le message dit quel
-- cas a échoué ; corriger, puis relancer la recette entière.
