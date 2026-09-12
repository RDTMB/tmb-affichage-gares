-- =============================================================================
-- LIBELLÉ LIBRE d'une course hors grille (docs/01 §2.10)
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Recopié dans supabase/schema.sql ;
-- src/data/commanditaire.test.ts compare les listes de colonnes.
--
-- ⚠ L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No rows
-- returned » est le résultat NORMAL d'une migration réussie, et ne prouve
-- rien à lui seul. Le bloc VÉRIFICATION en fin de script, lui, prouve.
--
-- -----------------------------------------------------------------------------
-- SÉQUENCE DE MISE EN SERVICE — dans cet ordre, sans en sauter une :
--
--   1. ce script sur la base de TEST
--   2. déploiement du front (GitHub Pages)
--   3. vérifier les SIX écrans de gare ET la supervision
--   4. ce script en PRODUCTION
--   5. FUSION de la branche
--
-- CE SCRIPT NE SE COUPE PAS EN DEUX, contrairement à ceux du 11/09. Il
-- n'enlève RIEN : une colonne s'ajoute, et un `grant select (colonne)` s'ajoute
-- aux droits de colonne existants sans en révoquer un seul. Il n'y a donc
-- aucune fenêtre d'écran noir, et l'ancien front continue de marcher après lui.
--
-- L'ORDRE, LUI, RESTE LE MÊME ET N'EST PAS NÉGOCIABLE : la migration passe en
-- PRODUCTION AVANT la fusion. Le nouveau front demande `libelle` NOMMÉMENT
-- (`getJour` énumère ses colonnes depuis le 11/09), et PostgREST refuse la
-- requête ENTIÈRE si une colonne manque — pas la colonne, la requête. Un front
-- déployé avant la colonne éteindrait donc les six gares d'un coup.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La colonne.
--
--    FACULTATIVE par décision de l'exploitant du 12/09/2026 : sans libellé, le
--    badge affiche « SPÉ n » ou « SUP n » comme avant. `null` et non chaîne
--    vide — « pas de libellé » est une absence, pas un nom vide.
--
--    Elle ne remplace PAS le numéro : celui-ci reste dans sa plage (spécial
--    ≥ 201, supplémentaire 101–199, contrainte `circulations_nature_numero`
--    du 11/09, qu'on ne relâche pas). Le libellé ne fait que le MASQUER à
--    l'affichage.
-- -----------------------------------------------------------------------------
alter table circulations add column if not exists libelle text;

comment on column circulations.libelle is
  'Libellé d''AFFICHAGE d''une course hors grille (facultatif). Remplace '
  '« SPÉ n » / « SUP n » partout où le train est nommé ; le numéro technique '
  'reste dans sa plage et ne bouge pas.';

-- -----------------------------------------------------------------------------
-- 2. Le droit de lecture pour `anon`.
--
--    Le libellé S'AFFICHE EN GARE : il doit donc être lisible par la clé
--    publiable, contrairement à `commanditaire`. C'est un `grant` ADDITIF —
--    il ne touche à aucune des seize colonnes déjà accordées le 11/09.
--
--    ⚠ Toute colonne nouvelle qui doit s'afficher en gare se déclare à TROIS
--    endroits : ici, dans `schema.sql`, et dans les deux `select` de
--    `getJour` (src/data/supabase.ts). En oublier un donne soit
--    « permission denied » sur les six écrans, soit une colonne lisible par
--    tout Internet sans que personne l'ait voulu.
-- -----------------------------------------------------------------------------
grant select (libelle) on circulations to anon;

-- -----------------------------------------------------------------------------
-- 3. Le JOURNAL suit la colonne : renommer une course est une décision
--    d'exploitation, et on doit pouvoir dire qui l'a prise.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_journal_circulations on circulations;
create trigger trg_journal_circulations
  after insert or update or delete on circulations
  for each row execute function private.tracer_ecriture(
    'date,numero', 'date',
    'statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif',
    'sans_voyageurs', 'commanditaire', 'nature', 'libelle'
  );

-- =============================================================================
-- VÉRIFICATION — à lire, pas à survoler.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La colonne existe.
--    Attendu : une ligne, libelle / text / YES (nullable).
-- -----------------------------------------------------------------------------
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'circulations'
   and column_name = 'libelle';

-- -----------------------------------------------------------------------------
-- 2. `anon` lit DIX-SEPT colonnes, `libelle` comprise, et toujours PAS
--    `commanditaire`. Attendu : 17 / t / f.
-- -----------------------------------------------------------------------------
select count(*) filter (where privilege_type = 'SELECT')  as colonnes_lues_par_anon,
       bool_or(column_name = 'libelle')                   as libelle_lisible,
       bool_or(column_name = 'commanditaire')             as commanditaire_expose
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'circulations'
   and grantee = 'anon';

-- -----------------------------------------------------------------------------
-- 3. Rien n'a été retiré : les seize colonnes du 11/09 sont toujours là.
--    Attendu : AUCUNE ligne.
-- -----------------------------------------------------------------------------
with attendues(colonne) as (values
  ('date'), ('numero'), ('sens'), ('express'), ('facultatif'), ('facultatif_actif'),
  ('velos'), ('rame'), ('terminus'), ('statut'), ('retard_min'), ('motif'),
  ('sans_voyageurs'), ('nature'), ('passages'), ('depart_reel')
)
select a.colonne as manquante_pour_anon
  from attendues a
 where not exists (
   select 1 from information_schema.column_privileges p
    where p.table_schema = 'public' and p.table_name = 'circulations'
      and p.grantee = 'anon' and p.privilege_type = 'SELECT'
      and p.column_name = a.colonne
 );

-- -----------------------------------------------------------------------------
-- 4. ESSAI — sur la base de TEST uniquement, lignes à décommenter. Remplacer
--    la date et le numéro par une course hors grille qui existe vraiment.
--
--    Attendu : la première requête renvoie le libellé sous `anon` (il
--    s'affiche en gare), la seconde échoue toujours sur `commanditaire`.
-- -----------------------------------------------------------------------------
-- update circulations set libelle = 'SCOLAIRE' where date = '2026-07-15' and numero = 201;
-- set local role anon;
-- select date, numero, libelle from circulations where numero = 201;
-- select date, numero, commanditaire from circulations where numero = 201;  -- doit ÉCHOUER
-- reset role;
-- update circulations set libelle = null where date = '2026-07-15' and numero = 201;
