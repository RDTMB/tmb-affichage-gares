-- =============================================================================
-- TRAIN SPÉCIAL — ÉTAPE A : ce qui S'AJOUTE, et rien d'autre
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Recopié dans supabase/schema.sql (qui porte
-- l'état FINAL, A + B) ; src/data/commanditaire.test.ts compare les copies.
--
-- ⚠ L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No rows
-- returned » est le résultat NORMAL d'une migration réussie, et ne prouve
-- rien à lui seul. Le bloc VÉRIFICATION en fin de script, lui, prouve.
--
-- -----------------------------------------------------------------------------
-- SÉQUENCE DE MISE EN SERVICE — dans cet ordre, sans en sauter une :
--
--   1. A sur la base de TEST
--   2. déploiement du front (GitHub Pages)
--   3. vérifier les SIX écrans de gare ET la supervision
--   4. B sur la base de TEST
--   5. même vérification
--   6. les trois mêmes étapes en PRODUCTION, hors service
--
-- POURQUOI DEUX FICHIERS. Trois changements se contredisent s'ils partent
-- ensemble :
--   • la supervision qui demande `commanditaire` EXIGE que la colonne existe ;
--   • la révocation de la lecture en bloc à `anon` EXIGE que le front ne fasse
--     plus `select('*')` ;
--   • `getJour` sans `select('*')` marche avec les anciens droits comme avec
--     les nouveaux — c'est le seul des trois qui soit sans danger.
-- SQL d'abord, et les six écrans s'éteignent le temps de Pages plus le cache
-- CDN, jusqu'à dix minutes. Front d'abord, et la supervision tombe sur
-- « column commanditaire does not exist ». Il n'y a pas d'ordre gagnant tant
-- que tout part ensemble.
--
-- Les droits de colonne sont ADDITIFS : tant qu'on n'a pas révoqué, un grant
-- restreint ne change rien. C'est ce qui rend ce découpage possible, et il ne
-- coûte rien. A n'enlève RIEN à personne — l'ancien front continue de marcher
-- après A, et le nouveau aussi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Le COMMANDITAIRE d'un train spécial : qui l'a affrété.
--
--    Colonne PROPRE et non `motif` : celui-ci porte déjà la raison d'une
--    suppression et celle d'un retard. Un troisième sens en ferait le piège
--    qu'a été `terminus`, déjà payé par deux correctifs.
--
--    Nullable : une circulation de grille n'a pas de commanditaire. Pas de
--    chaîne vide qui voudrait dire « aucun ».
-- -----------------------------------------------------------------------------
alter table circulations add column if not exists commanditaire text;

comment on column circulations.commanditaire is
  'Qui a affrété le train spécial. INTERNE : jamais servi aux écrans — le '
  'droit de SELECT est retiré à anon par la migration B.';

-- -----------------------------------------------------------------------------
-- 2. Le JOURNAL suit la colonne. Sans cette ligne, changer le commanditaire
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
-- 2. A n'a RIEN retiré : `anon` lit encore la table en bloc, donc l'ancien
--    front tient jusqu'au déploiement. C'est B qui fermera.
--    Attendu : `t`. Un `f` ici signifierait que B a déjà été jouée.
-- -----------------------------------------------------------------------------
select not exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'circulations'
            and grantee = 'anon'
       ) as lecture_en_bloc_encore_ouverte;

-- -----------------------------------------------------------------------------
-- 3. ESSAI — sur la base de TEST uniquement, lignes à décommenter. Remplacer
--    la date et le numéro par un train qui existe réellement ce jour-là.
-- -----------------------------------------------------------------------------
-- update circulations set commanditaire = 'Essai A' where date = '2026-07-15' and numero = 9;
-- select date, numero, commanditaire from circulations where date = '2026-07-15' and numero = 9;
-- select quand, qui, cle, champ, avant, apres from journal_exploitation
--  where table_cible = 'circulations' and champ = 'commanditaire' order by quand desc limit 5;
-- update circulations set commanditaire = null where date = '2026-07-15' and numero = 9;
