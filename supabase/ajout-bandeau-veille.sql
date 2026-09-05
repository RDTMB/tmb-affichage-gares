-- =============================================================================
-- TMB — Onglet « Bandeau » et veille par écran
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service. Rejouable.
-- Intégré à supabase/schema.sql pour les nouvelles installations.
--
-- Deux changements :
--   1. `ecrans` : veille de nuit surchargeable POSTE PAR POSTE (null = suit
--      le réglage global de `params.veille_nuit`) ;
--   2. `params` : les clés d'AFFICHAGE (météo du sommet, vitesse du bandeau)
--      deviennent modifiables par tous les rôles connectés, y compris la
--      caisse — les autres clés restent réservées au chef d'exploitation ou,
--      pour l'infrastructure, au rôle technique.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Veille par écran
-- ---------------------------------------------------------------------------
-- Nulles par défaut : l'écran suit le réglage global. L'écriture reste
-- réservée à admin/supervision par la politique « commande ecran » — un
-- anonyme n'a le droit d'écrire que les colonnes du signal de vie, et ces
-- deux-là n'en font pas partie (voir supabase/securite-advisors.sql).
alter table ecrans add column if not exists veille_debut time;
alter table ecrans add column if not exists veille_fin time;

-- ---------------------------------------------------------------------------
-- 2. Clés d'affichage de `params` ouvertes à tous les rôles connectés
-- ---------------------------------------------------------------------------
-- Le bandeau voyageurs (messages, vitesse de défilement, météo du sommet) est
-- le quotidien de la caisse : lui refuser ces réglages l'obligeait à passer
-- par un administrateur pour changer une température.
drop policy if exists "roles: params affichage" on params;
drop policy if exists "roles: params medias" on params;
drop policy if exists "roles: params exploitation" on params;
drop policy if exists "roles: params technique" on params;

-- Quatre politiques PERMISSIVES qui se cumulent en OU, une par jeu de clés
-- (supabase/migrations/2026-09-roles-multiples.sql).
-- Clés d'AFFICHAGE : admin, supervision ET caisse.
create policy "roles: params affichage" on params for all to authenticated
  using (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  )
  with check (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  );

-- Cycle des médias : réglé depuis l'onglet Médias, ouvert à l'exploitation.
create policy "roles: params medias" on params for all to authenticated
  using (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  )
  with check (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  );

-- Réglage d'exploitation : le chef d'exploitation.
create policy "roles: params exploitation" on params for all to authenticated
  using (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')))
  with check (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')));

-- Infrastructure (veille de nuit globale, durée du cache) et toute clé
-- INCONNUE : le rôle technique. Une clé nouvelle est un réglage
-- d'infrastructure jusqu'à preuve du contraire.
create policy "roles: params technique" on params for all to authenticated
  using ((select private.a_le_role('technique')))
  with check ((select private.a_le_role('technique')));

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) Les colonnes existent et sont nulles par défaut :
--     select id, veille_debut, veille_fin from ecrans order by gare;
--
-- (b) Un compte CAISSE peut changer la météo mais pas la veille : se
--     connecter en caisse à la supervision, modifier la température dans
--     l'onglet Bandeau (doit réussir). L'onglet Écrans ne lui est pas
--     accessible, donc la veille reste hors de portée.
--
-- (c) Contrôle direct des politiques, sans passer par l'application :
--     select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'params';
--     -> « lecture publique », « affichage tous roles », « params admin ».
