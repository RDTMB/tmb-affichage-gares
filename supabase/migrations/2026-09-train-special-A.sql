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
-- 2. La NATURE de la circulation : grille, renfort, ou spécial.
--
--    UN SEUL champ, et c'est le sujet. Deux booléens côte à côte
--    (`supplementaire` + `special`) rendraient représentable la combinaison
--    « sup ET spécial », qui n'existe pas en exploitation et que rien
--    n'empêcherait en base.
--
--    Pas de contrainte de PLAGE ici : pendant la fenêtre A, l'ancien front
--    crée encore des renforts sans écrire `nature` — ils arriveraient en
--    'grille' avec un numéro 101, et la contrainte les refuserait. Elle est
--    dans B, après le déploiement.
-- -----------------------------------------------------------------------------
alter table circulations add column if not exists nature text not null default 'grille';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'circulations_nature_valeurs') then
    alter table circulations add constraint circulations_nature_valeurs
      check (nature in ('grille', 'supplementaire', 'special'));
  end if;
end $$;

comment on column circulations.nature is
  'grille | supplementaire | special. Remplace le booléen supplementaire, '
  'qui reste dérivé par déclencheur jusqu''à son retrait (saison 2027).';

-- Report de l'existant : tout ce qui portait `supplementaire` est un renfort.
update circulations set nature = 'supplementaire'
 where supplementaire and nature <> 'supplementaire';

-- -----------------------------------------------------------------------------
-- 3. Le déclencheur qui tient les deux colonnes d'accord, DANS LES DEUX SENS.
--
--    Il existe pour la fenêtre A, et il vaut mieux qu'un simple report :
--      • l'ANCIEN front écrit `supplementaire` sans connaître `nature` — on
--        déduit dans ce sens-là, sinon un renfort créé pendant la fenêtre
--        resterait en 'grille' ;
--      • le NOUVEAU front écrit `nature` et n'envoie plus `supplementaire` —
--        sans ce déclencheur, la valeur par défaut `false` ferait échouer la
--        contrainte `circulations_sup_passages` sur tout renfort.
--
--    Il survit à B : c'est lui qui permet au front de ne plus jamais parler de
--    `supplementaire`, en attendant le retrait de la colonne (saison 2027).
-- -----------------------------------------------------------------------------
create or replace function private.circulations_nature()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  -- Ancien front : il pose `supplementaire` et laisse `nature` au défaut.
  if tg_op = 'INSERT' and new.nature = 'grille' and new.supplementaire then
    new.nature := 'supplementaire';
  end if;
  -- Dans tous les cas, la colonne de compatibilité SUIT la nature.
  new.supplementaire := (new.nature <> 'grille');
  return new;
end $fn$;
revoke all on function private.circulations_nature() from public;

drop trigger if exists trg_circulations_nature on circulations;
create trigger trg_circulations_nature
  before insert or update on circulations
  for each row execute function private.circulations_nature();

-- -----------------------------------------------------------------------------
-- 4. Le JOURNAL suit la colonne. Sans cette ligne, changer le commanditaire
--    d'un train affrété ne laisserait aucune trace — or c'est précisément la
--    donnée dont on aura besoin le jour où l'on cherche qui a demandé quoi.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_journal_circulations on circulations;
create trigger trg_journal_circulations
  after insert or update or delete on circulations
  for each row execute function private.tracer_ecriture(
    'date,numero', 'date',
    'statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif',
    'sans_voyageurs', 'commanditaire', 'nature'
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
   and column_name in ('commanditaire', 'nature')
 order by column_name;

-- -----------------------------------------------------------------------------
-- 1 bis. La nature reporte l'existant, et le déclencheur tient les deux
--        colonnes d'accord. Attendu : AUCUNE ligne (toute ligne renvoyée est
--        une incohérence).
-- -----------------------------------------------------------------------------
select date, numero, nature, supplementaire
  from circulations
 where supplementaire <> (nature <> 'grille')
 order by date, numero
 limit 20;

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
