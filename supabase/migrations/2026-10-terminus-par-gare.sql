-- =============================================================================
-- Terminus par gare : limiter une montée au Col de Voza (20/10/2026)
--
-- À EXÉCUTER À LA MAIN dans l'éditeur SQL Supabase : D'ABORD sur la base de
-- TEST, puis en PRODUCTION AVANT la fusion vers `main` (mise-en-service.md §I).
-- Rejouable. Déjà recopié dans supabase/schema.sql pour les nouvelles bases.
--
-- QUOI. L'exploitant limite une montée de la grille au Col de Voza comme il
-- la limitait à Bellevue — train par train (colonne Terminus) et par la
-- bascule « Terminus [gare] à partir du TRAIN N ».
--
-- POURQUOI CETTE FORME — UNIQUEMENT DES AJOUTS.
--  1. `circulations.terminus` garde son nom et son sens (« où s'arrête la
--     montée ; 'nid-daigle' = non limitée ») : la contrainte est ÉLARGIE à
--     'col-de-voza'. Rien de renommé, rien de retiré — l'ancien front, qui
--     nomme la colonne dans son select, continue de lire.
--  2. `jours.terminus_bascule_gare` est AJOUTÉE à côté de
--     `terminus_bellevue_a_partir_du_train`, qui reste le numéro N. NULL =
--     Bellevue : c'est ce que vaut toute ligne écrite avant, ou par l'ancien
--     front (qui ignore la colonne). L'ancien front lit `jours` en `select *`
--     et n'écrit que la colonne N : il ne voit pas la nouvelle et ne casse pas.
--  3. Le journal des écritures suit la nouvelle colonne.
-- =============================================================================

-- 1. Colonne Terminus : Col de Voza accepté.
alter table public.circulations drop constraint if exists circulations_terminus_check;
alter table public.circulations
  add constraint circulations_terminus_check
  check (terminus in ('nid-daigle', 'bellevue', 'col-de-voza'));

-- 2. Gare de la bascule « à partir du TRAIN N ». NULL = Bellevue.
alter table public.jours add column if not exists terminus_bascule_gare text;
alter table public.jours drop constraint if exists jours_terminus_bascule_gare;
alter table public.jours
  add constraint jours_terminus_bascule_gare
  check (terminus_bascule_gare is null or terminus_bascule_gare in ('bellevue', 'col-de-voza'));

-- 3. Journal : la gare de la bascule est une écriture d'exploitation comme N.
drop trigger if exists trg_journal_jours on public.jours;
create trigger trg_journal_jours
  after insert or update or delete on public.jours
  for each row execute function private.tracer_ecriture(
    'date', 'date', 'terminus_bellevue_a_partir_du_train', 'terminus_bascule_gare'
  );

-- 4. Contrôle (lecture seule) : doit rendre les deux contraintes et la colonne.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname in ('circulations_terminus_check', 'jours_terminus_bascule_gare');
