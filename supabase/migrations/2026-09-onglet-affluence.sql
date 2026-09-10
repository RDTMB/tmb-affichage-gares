-- =============================================================================
-- ONGLET « PLACES » — le remplissage quitte Circulations et Bandeau
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Déjà recopié dans supabase/schema.sql pour
-- les nouvelles installations ; src/data/securite.test.ts compare les copies.
--
-- ⚠ L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No rows
-- returned » est le résultat NORMAL, et ne prouve rien. Le bloc VÉRIFICATION
-- en fin de script, lui, prouve.
--
-- POURQUOI. Le remplissage se déclarait à DEUX endroits — une colonne dans
-- l'onglet Circulations (supervision) et une carte en tête de l'onglet
-- Bandeau (guichet). L'exploitant veut un seul endroit pour les deux rôles.
-- Pas Circulations : cet onglet vit autour du brouillon et de « Publier »,
-- alors que le remplissage s'écrit immédiatement, et n'y montrer qu'une
-- commande à la caisse obligerait à conditionner chaque AUTRE commande à un
-- droit, une par une, pour toujours. Pas Bandeau : ce n'est pas son sujet.
-- La règle du lieu est UN ONGLET = UN DROIT ; le droit `affluence` existe
-- depuis le lot précédent, il lui manquait son onglet.
--
-- CE QUE FAIT CE SCRIPT. Deux choses, et rien d'autre : élargir la liste
-- d'onglets admise par `onglets_par_role`, et y accorder le nouvel onglet aux
-- trois rôles qui portent déjà le droit. Aucune politique, aucune table,
-- aucun droit RLS ne bouge.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La contrainte qui énumère les onglets admis.
--
--    Elle est déclarée EN LIGNE dans `create table`, donc PostgreSQL lui a
--    donné un nom automatique. On ne le DEVINE pas : on le lit dans le
--    catalogue et on le supprime par son vrai nom, quel qu'il soit. Une
--    installation plus ancienne pourrait en porter un autre.
-- -----------------------------------------------------------------------------
do $$
declare
  v_nom text;
begin
  for v_nom in
    select con.conname
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'onglets_par_role'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%onglet%'
  loop
    execute format('alter table public.onglets_par_role drop constraint %I', v_nom);
    raise notice 'contrainte % supprimée', v_nom;
  end loop;
end $$;

alter table public.onglets_par_role
  add constraint onglets_par_role_onglet_check
  check (onglet in (
    'circulations','affluence','horaires','bandeau','medias','ecrans',
    'parametres','utilisateurs','journal'));

-- -----------------------------------------------------------------------------
-- 2. Le nouvel onglet, accordé aux trois rôles qui portent déjà `affluence`.
--
--    PAS au technique : il ne déclare pas de remplissage, et lui ouvrir
--    l'onglet contredirait la matrice du code (src/core/roles.ts).
--
--    `do nothing`, jamais `do update` : rejouer ce script ne doit pas rendre
--    un onglet que l'exploitant aurait masqué depuis.
--
--    ⚠ Un rôle qui n'a AUCUNE ligne dans cette table retombe sur la matrice
--    du code et voit donc déjà le nouvel onglet — l'insertion ne concerne que
--    les rôles déjà réglés, ce qui est le cas des quatre après le seed.
-- -----------------------------------------------------------------------------
insert into onglets_par_role (role, onglet) values
  ('admin', 'affluence'),
  ('supervision', 'affluence'),
  ('caisse', 'affluence')
on conflict (role, onglet) do nothing;

-- -----------------------------------------------------------------------------
-- VÉRIFICATION APRÈS — lecture seule.
--
-- 1. La contrainte admet bien les NEUF onglets. Une ligne attendue, dont la
--    définition contient 'affluence'.
-- -----------------------------------------------------------------------------
select con.conname as contrainte,
       pg_get_constraintdef(con.oid) like '%affluence%' as admet_affluence
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'onglets_par_role' and con.contype = 'c';

-- -----------------------------------------------------------------------------
-- 2. Qui voit l'onglet « Places ». TROIS lignes attendues : admin,
--    supervision, caisse — et surtout PAS technique.
-- -----------------------------------------------------------------------------
select role from onglets_par_role where onglet = 'affluence' order by role;

-- -----------------------------------------------------------------------------
-- 3. Le compte total. Le seed d'origine posait 20 lignes (technique 4,
--    admin 6, supervision 6, caisse 4) ; avec les trois ajoutées, 23.
--    Un autre nombre veut dire que l'exploitant a masqué ou rouvert des
--    onglets depuis — ce n'est pas une erreur, c'est à lire.
-- -----------------------------------------------------------------------------
select count(*) as lignes_total from onglets_par_role;
