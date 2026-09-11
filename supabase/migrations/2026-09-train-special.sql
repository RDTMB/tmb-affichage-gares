-- =============================================================================
-- TRAIN SPÉCIAL — §6 : le COMMANDITAIRE, et la fermeture de `circulations`
--                      à la clé publiable
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Déjà recopié dans supabase/schema.sql pour
-- les nouvelles installations ; src/data/securite.test.ts compare les deux
-- copies.
--
-- ⚠ L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No rows
-- returned » est le résultat NORMAL d'une migration réussie, et ne prouve
-- rien à lui seul. Le bloc VÉRIFICATION en fin de script, lui, prouve.
--
-- ⚠ CETTE MIGRATION VA DE PAIR AVEC UN DÉPLOIEMENT DU FRONT. Elle retire à
-- `anon` le droit de lire `circulations` en bloc ; un front antérieur, qui
-- demande `select=*`, reçoit alors « permission denied for column
-- commanditaire » et les SIX ÉCRANS DE GARE s'éteignent ensemble. Jouer la
-- migration APRÈS la mise en ligne du front, ou dans la même fenêtre.
--
-- POURQUOI UNE COLONNE PROPRE, ET NON `motif`.
-- `motif` porte déjà deux sens — la raison d'une suppression et celle d'un
-- retard. Y ranger le commanditaire en ferait un troisième, et c'est
-- exactement le piège de la colonne `terminus`, déjà payé par deux
-- correctifs : une colonne à plusieurs sens finit par être lue avec le
-- mauvais. Le commanditaire répond à une autre question (« pour qui ce train
-- roule-t-il ? »), il a donc sa colonne.
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
-- front la demande, les éteindra. C'est une charge réelle ; elle est tenue
-- par src/data/commanditaire.test.ts, qui compare cette liste à celle que le
-- front demande vraiment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La colonne. Nullable : seuls les trains spéciaux la renseignent, et une
--    circulation de grille n'a pas de commanditaire — pas de chaîne vide qui
--    voudrait dire « aucun ».
-- -----------------------------------------------------------------------------
alter table circulations add column if not exists commanditaire text;

comment on column circulations.commanditaire is
  'Qui a affrété le train spécial. INTERNE : jamais servi aux écrans — '
  'le droit de SELECT est retiré à anon (droits de colonne ci-dessous).';

-- -----------------------------------------------------------------------------
-- 2. Les droits de COLONNE sur `circulations`.
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
  terminus, statut, retard_min, motif, sans_voyageurs, supplementaire,
  passages, depart_reel
) on circulations to anon;

-- `authenticated` garde la table entière : la supervision doit voir le
-- commanditaire, et la recette RLS comme le journal en dépendent. Redonné
-- explicitement pour que ce script se suffise à lui-même.
grant select, insert, update, delete on circulations to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Le JOURNAL suit la colonne. Sans cette ligne, changer le commanditaire
--    d'un train affrété ne laisserait aucune trace — or c'est précisément la
--    donnée dont on aura besoin le jour où l'on cherche qui a demandé quoi.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_journal_circulations on circulations;
create trigger trg_journal_circulations
  after insert or update or delete on circulations
  for each row execute function private.tracer_ecriture(
    'date,numero', 'date',
    'statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif',
    'sans_voyageurs', 'commanditaire'
  );

-- =============================================================================
-- VÉRIFICATION — à lire, pas à survoler.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La colonne existe.
--    Attendu : une ligne, commanditaire / text / YES (nullable).
-- -----------------------------------------------------------------------------
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'circulations'
   and column_name = 'commanditaire';

-- -----------------------------------------------------------------------------
-- 2. Les droits de colonne. Deux critères SÉPARÉS — les confondre est ce qui
--    avait laissé passer la fuite de `affluence.maj_par` :
--      • `anon` ne doit avoir AUCUNE ligne portant `commanditaire` ;
--      • `anon` doit avoir SELECT sur les SEIZE autres — une colonne oubliée
--        ici éteint les écrans, ce n'est pas un simple manque.
--    Attendu : 16 lignes pour anon, toutes en SELECT, sans `commanditaire`.
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
-- 3. ESSAI — sur la base de TEST uniquement, lignes à décommenter.
--    Le résultat attendu : la première requête renvoie la circulation, la
--    seconde ÉCHOUE avec « permission denied for column commanditaire ». Un
--    succès de la seconde est le défaut que cette migration corrige.
-- -----------------------------------------------------------------------------
-- set local role anon;
-- select date, numero, statut from circulations limit 1;
-- select date, numero, commanditaire from circulations limit 1;  -- doit ÉCHOUER
-- reset role;
