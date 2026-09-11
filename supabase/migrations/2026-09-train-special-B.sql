-- =============================================================================
-- TRAIN SPÉCIAL — ÉTAPE B : ce qui RETIRE, et qui exige le nouveau front
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Recopié dans supabase/schema.sql (qui porte
-- l'état FINAL, A + B) ; src/data/commanditaire.test.ts compare les copies.
--
-- ⚠ NE PAS JOUER CE SCRIPT AVANT QUE LE NOUVEAU FRONT SOIT EN LIGNE. Il retire
-- à `anon` la lecture en bloc de `circulations` : un front qui demande encore
-- `select=*` reçoit « permission denied for column commanditaire », et les SIX
-- écrans de gare s'éteignent ensemble.
--
-- -----------------------------------------------------------------------------
-- SÉQUENCE DE MISE EN SERVICE — dans cet ordre, sans en sauter une :
--
--   1. A sur la base de TEST
--   2. déploiement du front (GitHub Pages)
--   3. vérifier les SIX écrans de gare ET la supervision
--   4. B sur la base de TEST          ← vous êtes ici
--   5. même vérification
--   6. les trois mêmes étapes en PRODUCTION, hors service
--
-- Après B, jouer supabase/tests/roles-rls.sql : ses cas « anonyme » sur
-- `circulations` ne passent QUE si ce script a été exécuté.
--
-- POURQUOI DES DROITS DE COLONNE, ET POURQUOI ILS COÛTENT PLUS CHER ICI.
-- `circulations` porte la politique « lecture publique … using (true) » : les
-- écrans lisent sans compte. RLS ne filtre que des LIGNES — pour retirer une
-- COLONNE à la clé publiable, il n'y a que les droits de colonne. C'est le
-- traitement déjà appliqué à `affluence.maj_par` le 10/09/2026.
--
-- La différence avec `affluence` est le nombre de colonnes : trois là-bas,
-- seize ici. Chaque colonne ajoutée à `circulations` devra désormais être
-- ajoutée à ce `grant`, sans quoi elle sera invisible des écrans — ou, si le
-- front la demande, les éteindra. C'est une charge réelle ; elle est tenue par
-- src/data/commanditaire.test.ts, qui compare cette liste à celle que le front
-- demande vraiment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Les droits de COLONNE sur `circulations`.
--
--    `anon`, c'est la clé publiable, donc tout Internet : il ne doit lire que
--    ce qu'un écran de gare affiche. Il n'a par ailleurs aucune raison de
--    conserver les droits d'ÉCRITURE que le rôle Supabase reçoit par défaut —
--    RLS les bloque déjà, mais un droit qu'on n'utilise pas est un droit qu'on
--    oublie de surveiller.
--
--    La liste est exactement celle que le front demande (`getJour`), et rien
--    de plus : ni `id`, ni `maj`, ni `commanditaire`.
-- -----------------------------------------------------------------------------
revoke all on circulations from anon;

grant select (
  date, numero, sens, express, facultatif, facultatif_actif, velos, rame,
  terminus, statut, retard_min, motif, sans_voyageurs, nature,
  passages, depart_reel
) on circulations to anon;

-- `authenticated` garde la table entière : la supervision doit voir le
-- commanditaire, et la recette RLS comme le journal en dépendent. Redonné
-- explicitement pour que ce script se suffise à lui-même.
grant select, insert, update, delete on circulations to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Les CONTRAINTES de nature. Elles arrivent seulement maintenant : avant le
--    déploiement, l'ancien front créait encore des renforts sans écrire
--    `nature`, et la contrainte de plage les aurait refusés.
--
--    Rattrapage d'abord — ce que l'ancien front aurait créé pendant la fenêtre
--    A. La condition ne touche PAS un spécial correctement écrit ('special'
--    porte bien `supplementaire` à vrai) : elle ne vise que l'incohérence.
-- -----------------------------------------------------------------------------
update circulations
   set nature = case when supplementaire then 'supplementaire' else 'grille' end
 where supplementaire <> (nature <> 'grille');

do $$
begin
  -- (a) La colonne de compatibilité ne peut plus diverger. Le déclencheur la
  --     tient déjà ; la contrainte le dit à la base, qui est la seule à ne
  --     jamais oublier.
  if not exists (select 1 from pg_constraint where conname = 'circulations_nature_supplementaire') then
    alter table circulations add constraint circulations_nature_supplementaire
      check (supplementaire = (nature <> 'grille'));
  end if;

  -- (b) La PLAGE DE NUMÉROS. Elle n'était qu'une convention du front
  --     (`NUMERO_SUP_MIN = 101`) tant que seule la supervision écrivait cette
  --     table. Elle devient porteuse dès qu'admin peut y insérer des lignes
  --     'special' : sans elle, un spécial numéroté 9 s'afficherait « TRAIN 9 »
  --     en gare, pour quelque chose que personne à l'exploitation n'a créé.
  --     Le `using` d'une politique ne l'attrape pas — il n'y a pas d'ancienne
  --     ligne à l'INSERT.
  --
  --     La parité reste liée au sens dans TOUTES les plages : impair = montée,
  --     pair = descente. 201 est impair, la convention tient. Elle n'est pas
  --     mise en contrainte ici : aucune donnée existante ne la viole, mais une
  --     contrainte qui ferait ÉCHOUER cette migration en production hors
  --     service coûterait plus cher qu'elle ne protège.
  if not exists (select 1 from pg_constraint where conname = 'circulations_nature_numero') then
    alter table circulations add constraint circulations_nature_numero
      check (
        (nature = 'grille' and numero between 1 and 99)
        or (nature = 'supplementaire' and numero between 101 and 199)
        or (nature = 'special' and numero >= 201)
      );
  end if;
end $$;

-- =============================================================================
-- VÉRIFICATION — à lire, pas à survoler.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Les contraintes sont posées. Attendu : trois lignes.
-- -----------------------------------------------------------------------------
select conname
  from pg_constraint
 where conrelid = 'public.circulations'::regclass
   and conname in (
     'circulations_nature_valeurs',
     'circulations_nature_supplementaire',
     'circulations_nature_numero'
   )
 order by conname;

-- -----------------------------------------------------------------------------
-- 1. Les droits de colonne. Deux critères SÉPARÉS — les confondre est ce qui
--    avait laissé passer la fuite de `affluence.maj_par` :
--      • `anon` ne doit avoir AUCUNE ligne portant `commanditaire` ;
--      • `anon` doit avoir SELECT sur les SEIZE autres — une colonne oubliée
--        ici éteint les écrans, ce n'est pas un simple manque.
--    Attendu : 16 lignes pour anon, toutes en SELECT, sans `commanditaire`
--    ni `supplementaire` (le front lit `nature`).
-- -----------------------------------------------------------------------------
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'circulations'
   and grantee = 'anon'
 order by privilege_type, column_name;

-- Le même contrôle, mais en une seule ligne de réponse. Attendu : 16 / f.
select count(*) filter (where privilege_type = 'SELECT')            as colonnes_lues_par_anon,
       bool_or(column_name = 'commanditaire')                       as commanditaire_expose
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'circulations'
   and grantee = 'anon';

-- -----------------------------------------------------------------------------
-- 2. ESSAI — sur la base de TEST uniquement, lignes à décommenter.
--    Le résultat attendu : la première requête renvoie la circulation, la
--    seconde ÉCHOUE avec « permission denied for column commanditaire ». Un
--    succès de la seconde est le défaut que cette migration corrige.
-- -----------------------------------------------------------------------------
-- set local role anon;
-- select date, numero, statut from circulations limit 1;
-- select date, numero, commanditaire from circulations limit 1;  -- doit ÉCHOUER
-- select * from circulations limit 1;                            -- doit ÉCHOUER
-- reset role;
